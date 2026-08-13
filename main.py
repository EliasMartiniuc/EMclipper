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

from fastapi import FastAPI, HTTPException, Request, UploadFile, File
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.middleware.cors import CORSMiddleware
from sse_starlette.sse import EventSourceResponse

from schemas import JobRequest, JobStatus
from config import BASE_DIR, DOWNLOADS_DIR, OUTPUTS_DIR, TEMP_DIR, USE_MODAL

import downloader
import transcriber
import llm_agent
import subtitles
import renderer

# Conditionally import Modal for serverless execution
if USE_MODAL:
    import modal

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


# In-memory job storage (sufficient for a local-first single-user tool)
jobs: Dict[str, Job] = {}


# ═══════════════════════════════════════════════════════════════════════════════
# PROCESSING PIPELINE
# ═══════════════════════════════════════════════════════════════════════════════


def _process_video_modal(job_id: str):
    """
    Delegate the full pipeline to a Modal serverless container.
    
    Calls the remote Modal function, waits for the result, then
    syncs progress and clip info back into the local Job object
    so the SSE endpoint can stream it to the frontend.
    """
    job = jobs[job_id]

    try:
        job.status = JobStatus.DOWNLOADING
        job.add_progress("init", "🚀 Launching serverless container...")

        # Read cookies if available (to pass to the remote container)
        cookies_content = None
        cookie_file = BASE_DIR / "cookies.txt"
        if cookie_file.exists():
            cookies_content = cookie_file.read_text()

        # Look up the remote Modal function
        process_fn = modal.Function.from_name("ai-video-clipper", "process_video_remote")

        # Call Modal and wait for the result
        result = process_fn.remote(
            url=job.url,
            job_id=job_id,
            subtitles_enabled=job.subtitles_enabled,
            cookies_content=cookies_content,
        )

        # Replay all progress messages from the remote container
        for p in result.get("progress", []):
            job.add_progress(p["stage"], p["message"])

        job.video_title = result.get("video_title", "")

        if result["status"] == "completed":
            # Copy clip metadata and download clip files from Modal volume
            get_clip_fn = modal.Function.from_name("ai-video-clipper", "get_clip_bytes")
            
            for clip_data in result.get("clips", []):
                # Download clip bytes from Modal volume to local disk
                output_dir = OUTPUTS_DIR / job_id
                output_dir.mkdir(parents=True, exist_ok=True)
                local_path = output_dir / clip_data["filename"]

                clip_bytes = get_clip_fn.remote(
                    job_id=job_id,
                    filename=clip_data["filename"],
                )
                local_path.write_bytes(clip_bytes)

                clip_result = {
                    "index": clip_data["index"],
                    "title": clip_data["title"],
                    "output_path": str(local_path),
                    "filename": clip_data["filename"],
                    "duration": clip_data["duration"],
                    "score": clip_data["score"],
                    "reason": clip_data.get("reason", ""),
                }
                job.clips.append(clip_result)

            # Clean up remote clips
            try:
                cleanup_fn = modal.Function.from_name("ai-video-clipper", "cleanup_job_clips")
                cleanup_fn.remote(job_id=job_id)
            except Exception:
                pass  # Non-critical

            job.status = JobStatus.COMPLETED
            job.add_progress(
                "complete",
                f"✓ All {len(job.clips)} clips rendered in the cloud! "
                f"Ready for download.",
            )
        else:
            job.status = JobStatus.ERROR
            job.error = result.get("error", "Unknown error in serverless container")
            job.add_progress("error", f"✗ Pipeline failed: {job.error}")

    except Exception as e:
        error_msg = str(e)
        logger.exception(f"Modal pipeline failed for job {job_id}")
        job.status = JobStatus.ERROR
        job.error = f"Serverless processing failed: {error_msg}"
        job.add_progress("error", f"✗ Serverless processing failed: {error_msg}")


def process_video(job_id: str):
    """
    Main processing pipeline — runs in a background thread.
    
    If USE_MODAL is enabled, delegates the entire pipeline to a
    Modal serverless container. Otherwise, runs locally.
    
    Stages:
    1. Download video from YouTube
    2. Extract audio for transcription
    3. Transcribe with Groq Whisper (word-level timestamps)
    4. Send transcript to DeepSeek for highlight detection
    5. For each highlight:
       a. Generate karaoke subtitles (.ass) if enabled
       b. Render final 9:16 letterboxed video
    """
    job = jobs[job_id]

    if USE_MODAL:
        _process_video_modal(job_id)
        return

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
            job.error = error_msg
            job.add_progress("error", f"✗ Pipeline failed: {error_msg}")


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


@app.post("/api/process")
async def start_processing(request: JobRequest):
    """
    Start processing a YouTube video URL.
    
    Returns immediately with a job_id. Connect to /api/status/{job_id}
    for real-time progress updates via SSE.
    """
    # Validate URL minimally
    url = request.url.strip()
    if not url:
        raise HTTPException(status_code=400, detail="URL cannot be empty")

    # Create job
    job_id = str(uuid.uuid4())
    job = Job(job_id, url, request.subtitles_enabled)
    jobs[job_id] = job

    job.add_progress("init", f"Job created for: {url}")

    # Run pipeline in a background daemon thread
    t = threading.Thread(target=process_video, args=(job_id,), daemon=True)
    job.thread = t
    t.start()

    return {"job_id": job_id, "status": "queued"}


@app.get("/api/status/{job_id}")
async def job_status_sse(job_id: str):
    """
    Stream real-time progress updates via Server-Sent Events (SSE).
    
    The client connects once and receives progress events until the
    job completes or fails. Events:
      - "progress": New progress message (stage, message, time)
      - "done": Job finished (status, clips, error)
    """
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    async def event_generator():
        last_idx = 0

        while True:
            # Send any new progress messages since last check
            current_len = len(job.progress)
            while last_idx < current_len:
                msg = job.progress[last_idx]
                yield {
                    "event": "progress",
                    "data": json.dumps(msg),
                }
                last_idx += 1

            # Check if job is terminal
            if job.status in (JobStatus.COMPLETED, JobStatus.ERROR):
                yield {
                    "event": "done",
                    "data": json.dumps(
                        {
                            "status": job.status.value,
                            "clips": job.clips,
                            "error": job.error,
                            "video_title": job.video_title,
                        }
                    ),
                }
                break

            # Poll interval
            await asyncio.sleep(0.5)

    return EventSourceResponse(event_generator())


@app.get("/api/jobs")
async def list_jobs():
    """List all jobs and their current statuses."""
    job_list = []
    for job in reversed(list(jobs.values())):  # Newest first
        job_list.append(
            {
                "id": job.id,
                "url": job.url,
                "status": job.status.value,
                "video_title": job.video_title,
                "clips_count": len(job.clips),
                "created_at": job.created_at,
                "error": job.error,
            }
        )
    return {"jobs": job_list}


@app.get("/api/job/{job_id}")
async def get_job(job_id: str):
    """Get detailed info for a specific job."""
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job.to_dict()


@app.get("/api/download/{job_id}/{clip_index}")
async def download_clip(job_id: str, clip_index: int):
    """Download a rendered clip as MP4."""
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    if clip_index < 0 or clip_index >= len(job.clips):
        raise HTTPException(status_code=404, detail="Clip index out of range")

    clip = job.clips[clip_index]
    file_path = Path(clip["output_path"])

    if not file_path.exists():
        raise HTTPException(
            status_code=404, detail="Clip file not found on disk"
        )

    return FileResponse(
        path=str(file_path),
        filename=clip["filename"],
        media_type="video/mp4",
    )


@app.post("/api/cancel/{job_id}")
async def cancel_job(job_id: str):
    """Immediately cancel a running job by killing its thread and subprocesses."""
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    if job.status in (JobStatus.COMPLETED, JobStatus.ERROR):
        return {"status": "already_finished"}

    job.cancelled = True
    logger.info(f"Job {job_id[:8]} — IMMEDIATE CANCEL requested")

    # 1. Kill any active child processes (ffmpeg, yt-dlp) immediately
    for proc in list(job.active_subprocesses):
        try:
            proc.kill()
            logger.info(f"Killed child subprocess PID {proc.pid}")
        except Exception:
            pass
    job.active_subprocesses.clear()

    # 2. Force-terminate the worker thread by injecting an exception
    if job.thread and job.thread.is_alive():
        tid = job.thread.ident
        if tid is not None:
            res = ctypes.pythonapi.PyThreadState_SetAsyncExc(
                ctypes.c_long(tid),
                ctypes.py_object(SystemExit)
            )
            if res == 0:
                logger.warning(f"Thread {tid} not found for cancellation")
            elif res > 1:
                # Reset if more than one thread was affected (shouldn't happen)
                ctypes.pythonapi.PyThreadState_SetAsyncExc(ctypes.c_long(tid), None)
            else:
                logger.info(f"Injected SystemExit into worker thread {tid}")

    # 3. Mark job as stopped
    job.status = JobStatus.ERROR
    job.error = "Job was stopped by user."
    job.add_progress("stopped", "⏹ Pipeline stopped immediately.")

    return {"status": "cancelled"}


@app.post("/api/upload_cookies")
async def upload_cookies(file: UploadFile = File(...)):
    """Upload a cookies.txt file to authenticate yt-dlp."""
    cookie_file = BASE_DIR / "cookies.txt"
    try:
        content = await file.read()
        with open(cookie_file, "wb") as f:
            f.write(content)
        logger.info(f"Successfully saved uploaded cookies to {cookie_file}")
        return {"status": "success", "message": "Cookies uploaded successfully."}
    except Exception as e:
        logger.error(f"Failed to save cookies file: {e}")
        raise HTTPException(status_code=500, detail="Failed to save cookies file.")


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
