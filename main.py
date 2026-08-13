"""
AI Video Clipper — Main Application

FastAPI server that orchestrates the full pipeline:
  YouTube URL → Download → Transcribe (Groq) → Detect Highlights (DeepSeek) → Render Clips

Endpoints:
  POST /api/process          — Start processing a YouTube URL (returns job_id)
  GET  /api/status/{job_id}  — SSE stream of real-time progress updates
  GET  /api/jobs             — List all jobs and their statuses
  GET  /api/job/{job_id}     — Get detailed job info
  GET  /api/download/{job_id}/{clip_index} — Download a rendered clip
  GET  /                     — Serve the frontend UI

Run:
  python main.py
  → Server starts at http://localhost:8000
"""

import uuid
import json
import asyncio
import logging
import threading
import ctypes
import os
import signal
from pathlib import Path
from typing import Dict, List, Optional
from datetime import datetime
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request, UploadFile, File, Form
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.middleware.cors import CORSMiddleware
from sse_starlette.sse import EventSourceResponse

from schemas import JobRequest, JobStatus
from config import BASE_DIR, DOWNLOADS_DIR, OUTPUTS_DIR, TEMP_DIR

import downloader
import transcriber
import llm_agent
import subtitles
import renderer

# ─── Logging Setup ─────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)-12s] %(levelname)-7s %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("main")


# ═══════════════════════════════════════════════════════════════════════════════
# JOB MANAGEMENT
# ═══════════════════════════════════════════════════════════════════════════════


class Job:
    """
    Tracks the state of a single video processing job.
    
    Stores all progress messages, output clips, and error state.
    Progress messages are consumed by the SSE endpoint for real-time UI updates.
    """

    def __init__(self, job_id: str, url: str, subtitles_enabled: bool = True):
        self.id: str = job_id
        self.url: str = url
        self.subtitles_enabled: bool = subtitles_enabled
        self.status: JobStatus = JobStatus.QUEUED
        self.progress: List[dict] = []
        self.clips: List[dict] = []
        self.error: Optional[str] = None
        self.created_at: str = datetime.now().isoformat()
        self.video_title: str = ""
        self.cancelled: bool = False
        self.thread: Optional[threading.Thread] = None
        self.active_subprocesses: List = []  # Track running child processes

    def add_progress(
        self, stage: str, message: str, pct: Optional[float] = None, clip: dict = None
    ):
        """Append a progress message (consumed by SSE endpoint)."""
        entry = {
            "stage": stage,
            "message": message,
            "progress": pct,
            "time": datetime.now().strftime("%H:%M:%S"),
        }
        if clip:
            entry["clip"] = clip
        self.progress.append(entry)
        logger.info(f"[{self.id[:8]}] [{stage}] {message}")

    def to_dict(self) -> dict:
        """Serialize job state to dict for API responses."""
        return {
            "id": self.id,
            "url": self.url,
            "status": self.status.value,
            "progress": self.progress,
            "clips": self.clips,
            "error": self.error,
            "created_at": self.created_at,
            "video_title": self.video_title,
        }


# ═══════════════════════════════════════════════════════════════════════════════
# PROCESSING PIPELINE
# ═══════════════════════════════════════════════════════════════════════════════


def process_video_stateless(job: Job):
    """
    Main processing pipeline — runs in a background thread.
    
    Stages:
    1. Download video from YouTube
    2. Extract audio for transcription
    3. Transcribe with Groq Whisper (word-level timestamps)
    4. Send transcript to DeepSeek for highlight detection
    5. For each highlight:
       a. Generate karaoke subtitles (.ass) if enabled
       b. Render final 9:16 letterboxed video
    """
    job_id = job.id

    def check_cancelled():
        """Check if the job was cancelled and raise if so."""
        if job.cancelled:
            raise RuntimeError("Job cancelled by user")

    try:
        check_cancelled()
        # ════════════════════════════════════════════════════════════════
        # STAGE 1: DOWNLOAD
        # ════════════════════════════════════════════════════════════════
        job.status = JobStatus.DOWNLOADING
        job.add_progress("download", "Starting video download...")

        video_path, video_info = downloader.download_video(job.url, job_id)
        job.video_title = video_info["title"]

        job.add_progress(
            "download",
            f"Downloaded: \"{video_info['title']}\" "
            f"({video_info['duration']}s, "
            f"{video_info['width']}x{video_info['height']})",
        )

        # Extract audio for transcription
        job.add_progress("download", "Extracting audio track...")
        audio_path = downloader.extract_audio(video_path, job_id)
        job.add_progress("download", "Audio extracted (16kHz mono)")

        check_cancelled()

        # ════════════════════════════════════════════════════════════════
        # STAGE 2: TRANSCRIBE
        # ════════════════════════════════════════════════════════════════
        job.status = JobStatus.TRANSCRIBING
        job.add_progress(
            "transcribe",
            "Starting Groq cloud transcription...",
        )

        segments, all_words = transcriber.transcribe(audio_path)

        job.add_progress(
            "transcribe",
            f"Transcription complete: {len(segments)} segments, "
            f"{len(all_words)} words",
        )

        check_cancelled()

        if not all_words:
            raise RuntimeError(
                "Transcription produced no words. "
                "The audio may be silent, music-only, or in an unsupported language."
            )

        # ════════════════════════════════════════════════════════════════
        # STAGE 3: HIGHLIGHT DETECTION
        # ════════════════════════════════════════════════════════════════
        job.status = JobStatus.DETECTING_HIGHLIGHTS
        job.add_progress("highlights", "Formatting transcript for LLM...")

        transcript_text = transcriber.format_transcript_for_llm(segments)

        job.add_progress(
            "highlights",
            f"Sending to LLM for highlight detection "
            f"({len(transcript_text)} chars)...",
        )

        highlights = llm_agent.detect_highlights(
            transcript_text, video_info["duration"]
        )

        job.add_progress(
            "highlights", f"LLM identified {len(highlights)} highlight clips:"
        )
        for i, h in enumerate(highlights):
            job.add_progress(
                "highlights",
                f"  Clip {i + 1}: [{h.start_time:.1f}s → {h.end_time:.1f}s] "
                f"\"{h.title}\" (score: {h.score}/10)",
            )

        # ════════════════════════════════════════════════════════════════
        # STAGE 4: PROCESS EACH CLIP
        # ════════════════════════════════════════════════════════════════
        # ════════════════════════════════════════════════════════════════
        for clip_idx, highlight in enumerate(highlights):
            check_cancelled()
            clip_num = clip_idx + 1
            clip_duration = highlight.end_time - highlight.start_time

            job.status = JobStatus.PROCESSING_CLIP
            job.add_progress(
                "processing",
                f"═══ Processing clip {clip_num}/{len(highlights)}: "
                f"\"{highlight.title}\" ({clip_duration:.1f}s) ═══",
            )

            # ── 4a: Generate Subtitles ─────────────────────────────────
            ass_path = None
            if job.subtitles_enabled:
                job.add_progress(
                    "subtitles",
                    f"Clip {clip_num}: Generating karaoke subtitles...",
                )

                ass_dir = TEMP_DIR / job_id
                ass_dir.mkdir(parents=True, exist_ok=True)
                ass_path = ass_dir / f"clip_{clip_num}.ass"

                subtitles.generate_ass(
                    words=all_words,
                    clip_start=highlight.start_time,
                    clip_end=highlight.end_time,
                    output_path=ass_path,
                )

                job.add_progress(
                    "subtitles",
                    f"Clip {clip_num}: Subtitles generated ({ass_path.name})",
                )

            # ── 4b: Render Final Video ─────────────────────────────────
            job.add_progress(
                "rendering",
                f"Clip {clip_num}: Rendering final video...",
            )

            output_dir = OUTPUTS_DIR / job_id
            output_dir.mkdir(parents=True, exist_ok=True)

            # Create a safe filename from the title
            safe_title = "".join(
                c
                for c in highlight.title
                if c.isalnum() or c in (" ", "-", "_")
            ).strip()
            safe_title = safe_title[:50] if safe_title else f"clip_{clip_num}"
            output_filename = f"{clip_num}_{safe_title}.mp4"
            output_filepath = output_dir / output_filename

            last_reported_render = [0]

            def render_progress(pct: float):
                threshold = int(pct * 4)
                if threshold > last_reported_render[0]:
                    last_reported_render[0] = threshold
                    job.add_progress(
                        "rendering",
                        f"Clip {clip_num}: Rendering {pct * 100:.0f}%",
                    )

            renderer.render_short(
                source_video=video_path,
                ass_path=ass_path,
                start_time=highlight.start_time,
                end_time=highlight.end_time,
                output_path=output_filepath,
                job_id=job_id,
                progress_callback=render_progress,
                subprocess_tracker=job.active_subprocesses,
            )

            # Record the clip result
            clip_result = {
                "index": clip_idx,
                "title": highlight.title,
                "output_path": str(output_filepath),
                "filename": output_filename,
                "duration": round(clip_duration, 1),
                "score": highlight.score,
                "reason": highlight.reason,
            }
            job.clips.append(clip_result)

            file_size_mb = output_filepath.stat().st_size / (1024 * 1024)
            job.add_progress(
                "rendering",
                f"Clip {clip_num}: ✓ Render complete! "
                f"({file_size_mb:.1f} MB)",
                clip=clip_result
            )

        # ════════════════════════════════════════════════════════════════
        # ALL DONE
        # ════════════════════════════════════════════════════════════════
        job.status = JobStatus.COMPLETED
        job.add_progress(
            "complete",
            f"✓ All {len(highlights)} clips rendered successfully! "
            f"Ready for download.",
        )

    except Exception as e:
        error_msg = str(e)
        if job.cancelled or "cancelled" in error_msg.lower():
            logger.info(f"Job {job_id[:8]} was stopped by user.")
            job.status = JobStatus.ERROR
            job.error = "Job was stopped by user."
            job.add_progress("stopped", "⏹ Pipeline stopped by user.")
        else:
            logger.exception(f"Pipeline failed for job {job_id}")
            job.status = JobStatus.ERROR
        job.error = str(e)
        logger.error(f"[{job_id}] Pipeline error: {e}", exc_info=True)
        job.add_progress("error", f"Error: {str(e)}")
        raise


# ═══════════════════════════════════════════════════════════════════════════════
# FASTAPI APPLICATION
# ═══════════════════════════════════════════════════════════════════════════════


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application startup and shutdown lifecycle."""
    logger.info("╔══════════════════════════════════════╗")
    logger.info("║     AI Video Clipper — Starting      ║")
    logger.info("╚══════════════════════════════════════╝")
    logger.info(f"  Downloads: {DOWNLOADS_DIR}")
    logger.info(f"  Outputs:   {OUTPUTS_DIR}")
    logger.info(f"  Temp:      {TEMP_DIR}")
    logger.info(f"  Frontend:  http://localhost:8000")
    yield
    logger.info("AI Video Clipper shutting down...")


app = FastAPI(
    title="AI Video Clipper",
    description="Local-first AI video clipping tool",
    version="1.0.0",
    lifespan=lifespan,
)

# Allow CORS for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── API Endpoints ─────────────────────────────────────────────────────────────


@app.post("/api/process_stream")
async def process_stream(
    url: str = Form(...), 
    subtitles_enabled: bool = Form(True),
    cookies_file: UploadFile = File(None)
):
    """
    Stream real-time progress updates via Server-Sent Events (SSE).
    This handles the processing request completely statelessly via POST.
    """
    url = url.strip()
    if not url:
        raise HTTPException(status_code=400, detail="URL cannot be empty")

    job_id = str(uuid.uuid4())
    job = Job(job_id, url, subtitles_enabled)
    
    if cookies_file and cookies_file.filename:
        # Create temp dir for this job and save cookies
        job_temp_dir = TEMP_DIR / job_id
        job_temp_dir.mkdir(parents=True, exist_ok=True)
        cookies_path = job_temp_dir / "cookies.txt"
        content = await cookies_file.read()
        cookies_path.write_bytes(content)
        logger.info(f"[{job_id}] Saved uploaded cookies.txt ({len(content)} bytes) to {cookies_path}")
    else:
        logger.info(f"[{job_id}] No cookies file uploaded (cookies_file={cookies_file}, filename={getattr(cookies_file, 'filename', None)})")

    queue = asyncio.Queue()
    loop = asyncio.get_running_loop()

    def custom_add_progress(stage: str, message: str, pct: Optional[float] = None, clip: dict = None):
        entry = {
            "stage": stage,
            "message": message,
            "progress": pct,
            "time": datetime.now().strftime("%H:%M:%S"),
            "job_id": job_id,
        }
        if clip:
            entry["clip"] = clip
        
        # We must use call_soon_threadsafe because process_video runs in a thread
        loop.call_soon_threadsafe(
            queue.put_nowait,
            {"event": "progress", "data": json.dumps(entry)}
        )
        logger.info(f"[{job.id[:8]}] [{stage}] {message}")

    job.add_progress = custom_add_progress
    job.add_progress("init", f"Job created for: {url}")

    async def run_processing():
        try:
            await asyncio.to_thread(process_video_stateless, job)
            await queue.put({
                "event": "done",
                "data": json.dumps({
                    "status": "completed",
                    "clips": job.clips,
                    "video_title": job.video_title,
                    "job_id": job_id
                })
            })
        except Exception as e:
            await queue.put({
                "event": "done",
                "data": json.dumps({
                    "status": "error",
                    "error": str(e)
                })
            })

    # Start processing in the background (but tied to this request)
    task = asyncio.create_task(run_processing())

    async def event_generator():
        try:
            while True:
                msg = await queue.get()
                yield msg
                if msg["event"] == "done":
                    break
        except asyncio.CancelledError:
            # Client disconnected (e.g. closed the browser tab or clicked Stop)
            logger.info(f"[{job_id[:8]}] Client disconnected. Cancelling job...")
            job.cancelled = True
            
            # Kill any active subprocesses (FFmpeg, yt-dlp)
            for proc in job.active_subprocesses:
                try:
                    proc.kill()
                    logger.info(f"[{job_id[:8]}] Killed subprocess {proc.pid}")
                except Exception:
                    pass
            
            # Note: We can't easily kill the asyncio.to_thread itself, but it will
            # raise an exception internally at the next `check_cancelled()` or die
            # because its subprocesses were killed.
            raise

    return EventSourceResponse(event_generator())

# Note: /api/download remains, but requires the file to still exist on disk.
# On Cloud Run, the file exists only on the instance that processed it.
# To download clips properly in a stateless way without Cloud Storage,
# the frontend must intercept the files directly, OR we serve them immediately.
# But for now, we'll leave this endpoint for local testing, though Cloud Run 
# users might want to upload clips directly to Cloud Storage (S3).
@app.get("/api/download/{job_id}/{clip_index}")
async def download_clip(job_id: str, clip_index: int):
    """Serve a rendered clip file for download from the stateless temp directory."""
    job_dir = OUTPUTS_DIR / job_id
    if not job_dir.exists():
        raise HTTPException(status_code=404, detail="Job outputs not found on this server instance.")

    # Search for the clip file
    clip_path = job_dir / f"clip_{clip_index}.mp4"
    if not clip_path.exists():
        raise HTTPException(status_code=404, detail="Clip file not found.")

    return FileResponse(
        path=str(clip_path),
        filename=f"ai_clip_{job_id[:6]}_{clip_index}.mp4",
        media_type="video/mp4",
    )


# ─── Frontend Serving ──────────────────────────────────────────────────────────

frontend_dir = BASE_DIR / "frontend"


@app.get("/")
async def serve_frontend():
    """Serve the frontend HTML page."""
    index_path = frontend_dir / "index.html"
    if index_path.exists():
        return FileResponse(str(index_path), media_type="text/html")
    return HTMLResponse(
        "<h1>AI Video Clipper API</h1>"
        "<p>Frontend not found. Place index.html in the frontend/ directory.</p>"
    )


# Mount static files from frontend directory (for CSS, JS, images)
if frontend_dir.exists():
    app.mount(
        "/static",
        StaticFiles(directory=str(frontend_dir)),
        name="static",
    )


# ═══════════════════════════════════════════════════════════════════════════════
# ENTRY POINT
# ═══════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        app,
        host="0.0.0.0",
        port=8000,
        log_level="info",
    )
