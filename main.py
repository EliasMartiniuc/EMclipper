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
import base64
import asyncio
import logging
import threading
import boto3
import ctypes
import os
import signal
from pathlib import Path
from typing import Dict, List, Optional
from datetime import datetime
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request, UploadFile, File, Form
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from sse_starlette.sse import EventSourceResponse
import stripe

from schemas import JobRequest, JobStatus
from config import (
    BASE_DIR, DOWNLOADS_DIR, OUTPUTS_DIR, TEMP_DIR,
    R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ENDPOINT_URL, R2_BUCKET_NAME, R2_PUBLIC_URL,
    STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRO_PRICE_ID, STRIPE_ULTRA_PRICE_ID,
    FREE_UPLOAD_LIMIT, PRO_UPLOAD_LIMIT, ULTRA_UPLOAD_LIMIT, ADMIN_EMAIL,
    SUPABASE_URL, SUPABASE_KEY,
)

# Initialize Stripe
stripe.api_key = STRIPE_SECRET_KEY

# Initialize Supabase client for server-side operations
from supabase import create_client
supabase_admin = create_client(SUPABASE_URL, SUPABASE_KEY) if SUPABASE_URL and SUPABASE_KEY else None

# Global dictionary to track active jobs for cancellation
active_jobs = {}

# Initialize Cloudflare R2 Client
s3_client = boto3.client(
    "s3",
    endpoint_url=R2_ENDPOINT_URL,
    aws_access_key_id=R2_ACCESS_KEY_ID,
    aws_secret_access_key=R2_SECRET_ACCESS_KEY,
    region_name="auto" # Cloudflare R2 uses 'auto' region
) if R2_ACCESS_KEY_ID else None

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

    def __init__(self, job_id: str, url: Optional[str] = None, subtitles_enabled: bool = True):
        self.id: str = job_id
        self.url: Optional[str] = url
        self.subtitles_enabled: bool = subtitles_enabled
        self.uploaded_video_path: Optional[Path] = None
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
            "is_upload": self.uploaded_video_path is not None,
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
            
        # Check distributed state in R2 (in case cancel hit a different Cloud Run instance)
        if s3_client:
            cancelled_in_r2 = False
            try:
                s3_client.head_object(Bucket=R2_BUCKET_NAME, Key=f"jobs/{job_id}/CANCELLED")
                cancelled_in_r2 = True
            except Exception:
                pass  # File doesn't exist or S3 error — not cancelled
            
            if cancelled_in_r2:
                job.cancelled = True
                raise RuntimeError("Job cancelled by user (detected via R2)")


    try:
        check_cancelled()
        # ════════════════════════════════════════════════════════════════
        # STAGE 1: DOWNLOAD
        # ════════════════════════════════════════════════════════════════
        if job.uploaded_video_path:
            # Skip download, use the uploaded file
            job.status = JobStatus.DOWNLOADING # keep status same for UI compatibility
            job.add_progress("download", "Using uploaded video file...")
            video_path = job.uploaded_video_path
            
            # Use ffprobe to get duration
            duration = downloader.get_video_duration(video_path)
            video_info = {
                "title": job.video_title,
                "duration": duration,
                "width": "Unknown",
                "height": "Unknown",
            }
            job.add_progress("download", f"Verified uploaded file ({duration:.1f}s)")
        else:
            # Fallback to YouTube download
            job.status = JobStatus.DOWNLOADING
            job.add_progress("download", "Starting video download from YouTube...")

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
        # Sort highlights from best to worst score
        highlights.sort(key=lambda h: getattr(h, "score", 0), reverse=True)
        
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

            # Create a safe filename from the title (no spaces - use underscores for URL safety)
            safe_title = "".join(
                c if c.isalnum() or c in ("-", "_") else "_"
                for c in highlight.title
            ).strip("_")
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

            # Check cancellation AFTER render completes but BEFORE uploading to R2
            check_cancelled()

            # Record the clip result
            file_size_mb = output_filepath.stat().st_size / (1024 * 1024)
            
            # Upload the rendered video directly to Cloudflare R2
            logger.info(f"Clip {clip_num}: Uploading to Cloudflare R2 ({file_size_mb:.1f} MB)...")
            job.add_progress("rendering", f"Clip {clip_num}: Uploading to Cloudflare R2...")
            
            # One more check right before the upload
            check_cancelled()

            r2_key = f"{job_id}/{output_filename}"
            if s3_client:
                s3_client.upload_file(
                    str(output_filepath),
                    R2_BUCKET_NAME,
                    r2_key,
                    ExtraArgs={'ContentType': 'video/mp4'}
                )
                
                video_url = f"{R2_PUBLIC_URL}/{r2_key}"
                logger.info(f"Clip {clip_num}: Uploaded successfully: {video_url}")
            else:
                video_url = None
                logger.warning("No S3 client configured, skipping R2 upload.")
            
            clip_result = {
                "index": clip_idx,
                "title": highlight.title,
                "filename": output_filename,
                "duration": round(clip_duration, 1),
                "score": highlight.score,
                "reason": highlight.reason,
                "video_url": video_url,
            }
            job.clips.append(clip_result)

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

@app.post("/api/upload_chunk")
async def upload_chunk(
    job_id: str = Form(...),
    chunk_index: int = Form(...),
    total_chunks: int = Form(...),
    filename: str = Form(...),
    chunk: UploadFile = File(...)
):
    """
    Receive a chunk of a video file and append it to the temporary file on disk.
    Allows bypassing Cloud Run's 32MB request body limit.
    """
    # Sanitize filename
    safe_filename = "".join(c for c in filename if c.isalnum() or c in (".", "-", "_")).strip()
    if not safe_filename:
        safe_filename = "uploaded_video.mp4"
        
    job_temp_dir = TEMP_DIR / job_id
    job_temp_dir.mkdir(parents=True, exist_ok=True)
    
    video_path = job_temp_dir / safe_filename
    
    # Append the chunk to the file
    with video_path.open("ab") as buffer:
        content = await chunk.read()
        buffer.write(content)
        
    logger.info(f"[{job_id}] Received chunk {chunk_index + 1}/{total_chunks} for {safe_filename} ({len(content)} bytes)")
    
    return {"status": "success", "chunk_index": chunk_index}


@app.post("/api/process_stream")
async def process_stream(
    url: str = Form(""), 
    subtitles_enabled: bool = Form(True),
    job_id: str = Form(""),
    filename: str = Form("")
):
    """
    Stream real-time progress updates via Server-Sent Events (SSE).
    This handles the processing request completely statelessly via POST.
    """
    url = url.strip()
    job_id = job_id.strip()
    
    if not url and not job_id:
        raise HTTPException(status_code=400, detail="Must provide either a URL or a chunked upload job_id")

    if not job_id:
        job_id = str(uuid.uuid4())
        
    job = Job(job_id, url if url else None, subtitles_enabled)
    active_jobs[job_id] = job
    
    if not url and job_id and filename:
        # Check if the chunked file exists
        safe_filename = "".join(c for c in filename if c.isalnum() or c in (".", "-", "_")).strip()
        if not safe_filename:
            safe_filename = "uploaded_video.mp4"
            
        video_path = TEMP_DIR / job_id / safe_filename
        
        if video_path.exists():
            job.uploaded_video_path = video_path
            job.video_title = filename
            logger.info(f"[{job_id}] Found stitched video file ({video_path.stat().st_size} bytes) at {video_path}")
        else:
            raise HTTPException(status_code=400, detail="Uploaded file not found on server")
    elif url:
        logger.info(f"[{job_id}] Processing YouTube URL: {url}")

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
        finally:
            active_jobs.pop(job_id, None)

    return EventSourceResponse(event_generator())


@app.post("/api/cancel/{job_id}")
async def cancel_job(job_id: str):
    """Explicitly cancel a job and kill its processes."""
    # 1. Cancel locally if the job is on this instance
    job = active_jobs.get(job_id)
    if job:
        job.cancelled = True
        for proc in job.active_subprocesses:
            try:
                proc.kill()
            except Exception:
                pass
        active_jobs.pop(job_id, None)
        
    # 2. Write a CANCELLED marker to R2 so other instances know it's cancelled
    try:
        if s3_client:
            s3_client.put_object(
                Bucket=R2_BUCKET_NAME,
                Key=f"jobs/{job_id}/CANCELLED",
                Body=b""
            )
    except Exception as e:
        logger.error(f"Failed to write CANCELLED marker to R2: {e}")

    return {"status": "cancelled"}

@app.delete("/api/project/{project_id}")
async def delete_project_files(project_id: str):
    """Delete all files associated with a project from Cloudflare R2."""
    # Clips are stored at {project_id}/filename.mp4
    # Cancel markers are stored at jobs/{project_id}/CANCELLED
    prefixes = [f"{project_id}/", f"jobs/{project_id}/"]
    try:
        paginator = s3_client.get_paginator('list_objects_v2')
        for prefix in prefixes:
            for page in paginator.paginate(Bucket=R2_BUCKET_NAME, Prefix=prefix):
                if 'Contents' in page:
                    objects_to_delete = [{'Key': obj['Key']} for obj in page['Contents']]
                    s3_client.delete_objects(Bucket=R2_BUCKET_NAME, Delete={'Objects': objects_to_delete})
        return {"status": "deleted"}
    except Exception as e:
        logger.error(f"Error deleting files for project {project_id}: {e}")
        return {"status": "error"}


# ═══════════════════════════════════════════════════════════════════════════════
# STRIPE SUBSCRIPTION ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════════


def _get_upload_limit(tier: str) -> int:
    """Return the upload limit for a given tier."""
    limits = {
        'free': FREE_UPLOAD_LIMIT,
        'pro': PRO_UPLOAD_LIMIT,
        'ultra': ULTRA_UPLOAD_LIMIT,
    }
    return limits.get(tier, FREE_UPLOAD_LIMIT)


def _get_or_create_subscription(user_id: str, email: str = "") -> dict:
    """Get or create a user_subscriptions row. Returns the row as a dict."""
    if not supabase_admin:
        return {'tier': 'free', 'uploads_used': 0}
    
    try:
        result = supabase_admin.table('user_subscriptions').select('*').eq('user_id', user_id).execute()
        
        if result.data and len(result.data) > 0:
            return result.data[0]
        
        # Create a new free subscription row
        new_sub = {
            'user_id': user_id,
            'tier': 'free',
            'uploads_used': 0,
        }
        if email:
            new_sub['email'] = email
        insert_result = supabase_admin.table('user_subscriptions').insert(new_sub).execute()
        return insert_result.data[0] if insert_result.data else new_sub
    except Exception as e:
        logger.error(f"Error accessing user_subscriptions table (did you run supabase_schema.sql?): {e}")
        return {'tier': 'free', 'uploads_used': 0}


@app.get("/api/subscription-status")
async def subscription_status(request: Request):
    """Return the current user's subscription tier, uploads used, and uploads remaining."""
    # Extract user from Supabase JWT in Authorization header
    auth_header = request.headers.get('Authorization', '')
    if not auth_header.startswith('Bearer '):
        raise HTTPException(status_code=401, detail="Not authenticated")
    
    token = auth_header.split(' ')[1]
    try:
        user_response = supabase_admin.auth.get_user(token)
        user = user_response.user
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Invalid token: {e}")
    
    # Admin bypass
    if user.email == ADMIN_EMAIL:
        return {
            'tier': 'admin',
            'uploads_used': 0,
            'upload_limit': 999999,
            'uploads_remaining': 999999,
            'can_upload': True,
            'is_admin': True,
        }
    
    sub = _get_or_create_subscription(user.id, user.email)
    tier = sub.get('tier', 'free')
    uploads_used = sub.get('uploads_used', 0)
    limit = _get_upload_limit(tier)
    
    # For pro/ultra, check if the billing period has expired and reset the counter
    if tier in ('pro', 'ultra') and sub.get('period_end'):
        from datetime import timezone
        period_end = datetime.fromisoformat(sub['period_end'].replace('Z', '+00:00'))
        if datetime.now(timezone.utc) > period_end:
            # Period expired, reset counter
            uploads_used = 0
            supabase_admin.table('user_subscriptions').update({
                'uploads_used': 0
            }).eq('user_id', user.id).execute()
    
    return {
        'tier': tier,
        'uploads_used': uploads_used,
        'upload_limit': limit,
        'uploads_remaining': max(0, limit - uploads_used),
        'can_upload': uploads_used < limit,
        'is_admin': False,
    }


@app.post("/api/increment-upload")
async def increment_upload(request: Request):
    """Increment the upload counter for the current user. Called after successful processing."""
    auth_header = request.headers.get('Authorization', '')
    if not auth_header.startswith('Bearer '):
        raise HTTPException(status_code=401, detail="Not authenticated")
    
    token = auth_header.split(' ')[1]
    try:
        user_response = supabase_admin.auth.get_user(token)
        user = user_response.user
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")
    
    # Admin bypass
    if user.email == ADMIN_EMAIL:
        return {'status': 'ok', 'is_admin': True}
    
    sub = _get_or_create_subscription(user.id)
    new_count = sub.get('uploads_used', 0) + 1
    
    supabase_admin.table('user_subscriptions').update({
        'uploads_used': new_count
    }).eq('user_id', user.id).execute()
    
    return {'status': 'ok', 'uploads_used': new_count}


@app.delete("/api/account")
async def delete_account(request: Request):
    """Delete the user's account, cancel their Stripe subscription, and remove all files from Cloudflare R2."""
    auth_header = request.headers.get('Authorization', '')
    if not auth_header.startswith('Bearer '):
        raise HTTPException(status_code=401, detail="Not authenticated")
    
    token = auth_header.split(' ')[1]
    try:
        user_response = supabase_admin.auth.get_user(token)
        user = user_response.user
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Invalid token: {e}")
        
    user_id = user.id
    
    # 1. Cancel Stripe Subscription if active
    sub = _get_or_create_subscription(user_id, user.email)
    stripe_sub_id = sub.get('stripe_subscription_id')
    if stripe_sub_id:
        try:
            stripe.Subscription.delete(stripe_sub_id)
            logger.info(f"Cancelled Stripe subscription {stripe_sub_id} for user {user_id}")
        except Exception as e:
            logger.error(f"Failed to cancel Stripe subscription for {user_id}: {e}")
            
    # 2. Delete all projects' videos from Cloudflare R2
    if s3_client:
        try:
            projects_res = supabase_admin.table('projects').select('id').eq('user_id', user_id).execute()
            if projects_res.data:
                for proj in projects_res.data:
                    project_id = proj['id']
                    # List all objects with this prefix (folder)
                    prefix = f"{project_id}/"
                    paginator = s3_client.get_paginator('list_objects_v2')
                    for page in paginator.paginate(Bucket=R2_BUCKET_NAME, Prefix=prefix):
                        if 'Contents' in page:
                            objects_to_delete = [{'Key': obj['Key']} for obj in page['Contents']]
                            s3_client.delete_objects(Bucket=R2_BUCKET_NAME, Delete={'Objects': objects_to_delete})
                            logger.info(f"Deleted {len(objects_to_delete)} objects for project {project_id} from R2")
        except Exception as e:
            logger.error(f"Failed to clean up R2 for user {user_id}: {e}")
            
    # 3. Delete user from Supabase Auth (cascades to user_subscriptions, projects, clips)
    try:
        supabase_admin.auth.admin.delete_user(user_id)
        logger.info(f"Deleted user {user_id} from Supabase")
    except Exception as e:
        logger.error(f"Failed to delete user {user_id} from Supabase: {e}")
        raise HTTPException(status_code=500, detail="Failed to fully delete account")
        
    return {"status": "ok", "message": "Account deleted successfully"}


@app.post("/api/create-checkout-session")
async def create_checkout_session(request: Request):
    """Create a Stripe Checkout session for Pro or Ultra tier."""
    auth_header = request.headers.get('Authorization', '')
    if not auth_header.startswith('Bearer '):
        raise HTTPException(status_code=401, detail="Not authenticated")
    
    token = auth_header.split(' ')[1]
    try:
        user_response = supabase_admin.auth.get_user(token)
        user = user_response.user
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")
    
    body = await request.json()
    plan = body.get('plan', 'pro')
    
    price_id = STRIPE_PRO_PRICE_ID if plan == 'pro' else STRIPE_ULTRA_PRICE_ID
    
    try:
        # Get or create Stripe customer
        sub = _get_or_create_subscription(user.id, user.email)
        customer_id = sub.get('stripe_customer_id')
        
        if not customer_id:
            customer = stripe.Customer.create(
                email=user.email,
                metadata={'supabase_user_id': user.id}
            )
            customer_id = customer.id
            try:
                supabase_admin.table('user_subscriptions').update({
                    'stripe_customer_id': customer_id
                }).eq('user_id', user.id).execute()
            except Exception as e:
                logger.error(f"Failed to save stripe_customer_id to Supabase (check SUPABASE_KEY): {e}")
        
        # Determine the origin for success/cancel URLs
        origin = request.headers.get('origin', request.headers.get('referer', 'https://emclipper.com'))
        if origin.endswith('/'):
            origin = origin[:-1]
        
        session = stripe.checkout.Session.create(
            customer=customer_id,
            line_items=[{'price': price_id, 'quantity': 1}],
            mode='subscription',
            success_url=f"{origin}/subscription?success=true",
            cancel_url=f"{origin}/subscription?cancelled=true",
            metadata={'supabase_user_id': user.id, 'plan': plan},
        )
        
        return {'checkout_url': session.url}
    except stripe.StripeError as e:
        logger.error(f"Stripe Error: {e.user_message or str(e)}")
        raise HTTPException(status_code=400, detail=f"Stripe configuration error: {e.user_message or str(e)}")
    except Exception as e:
        logger.error(f"Checkout Error: {e}")
        raise HTTPException(status_code=500, detail=f"Checkout failed: {str(e)}")


@app.post("/api/create-portal-session")
async def create_portal_session(request: Request):
    """Create a Stripe Customer Portal session for managing/canceling subscriptions."""
    auth_header = request.headers.get('Authorization', '')
    if not auth_header.startswith('Bearer '):
        raise HTTPException(status_code=401, detail="Not authenticated")
    
    token = auth_header.split(' ')[1]
    try:
        user_response = supabase_admin.auth.get_user(token)
        user = user_response.user
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")
    
    sub = _get_or_create_subscription(user.id, user.email)
    customer_id = sub.get('stripe_customer_id')
    
    if not customer_id:
        raise HTTPException(status_code=400, detail="No active subscription found.")
        
    origin = request.headers.get('origin', request.headers.get('referer', 'https://emclipper.com'))
    if origin.endswith('/'):
        origin = origin[:-1]
        
    try:
        session = stripe.billing_portal.Session.create(
            customer=customer_id,
            return_url=f"{origin}/subscription",
        )
        return {'portal_url': session.url}
    except Exception as e:
        logger.error(f"Portal Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/stripe-webhook")
async def stripe_webhook(request: Request):
    """Handle Stripe webhook events for subscription lifecycle."""
    payload = await request.body()
    sig_header = request.headers.get('stripe-signature', '')
    
    try:
        if STRIPE_WEBHOOK_SECRET:
            event = stripe.Webhook.construct_event(payload, sig_header, STRIPE_WEBHOOK_SECRET)
        else:
            # No webhook secret configured, parse directly (less secure)
            event = stripe.Event.construct_from(json.loads(payload), stripe.api_key)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid payload")
    except stripe.error.SignatureVerificationError:
        raise HTTPException(status_code=400, detail="Invalid signature")
    
    event_type = event['type']
    data = event['data']['object']
    
    if hasattr(data, 'to_dict'):
        data = data.to_dict()
    
    logger.info(f"[Stripe] Received event: {event_type}")
    
    try:
        if event_type == 'checkout.session.completed':
            # A new subscription was created
            customer_id = data.get('customer')
            subscription_id = data.get('subscription')
            user_id = data.get('metadata', {}).get('supabase_user_id')
            plan = data.get('metadata', {}).get('plan', 'pro')
            
            if user_id and subscription_id:
                # Fetch subscription details from Stripe to get billing period
                stripe_sub = stripe.Subscription.retrieve(subscription_id)
                if hasattr(stripe_sub, 'to_dict'):
                    stripe_sub = stripe_sub.to_dict()
                period_start = datetime.fromtimestamp(stripe_sub.get('current_period_start', 0)).isoformat()
                period_end = datetime.fromtimestamp(stripe_sub.get('current_period_end', 0)).isoformat()
                
                # Also grab the customer email from Stripe for troubleshooting
                customer_email = data.get('customer_details', {}).get('email', '') or data.get('customer_email', '')
                
                update_data = {
                    'tier': plan,
                    'stripe_customer_id': customer_id,
                    'stripe_subscription_id': subscription_id,
                    'uploads_used': 0,
                    'period_start': period_start,
                    'period_end': period_end,
                }
                if customer_email:
                    update_data['email'] = customer_email
                supabase_admin.table('user_subscriptions').update(update_data).eq('user_id', user_id).execute()
                logger.info(f"[Stripe] User {user_id} upgraded to {plan}")
        
        elif event_type == 'invoice.paid':
            # Subscription renewed — reset upload counter
            subscription_id = data.get('subscription')
            if subscription_id:
                stripe_sub = stripe.Subscription.retrieve(subscription_id)
                if hasattr(stripe_sub, 'to_dict'):
                    stripe_sub = stripe_sub.to_dict()
                period_start = datetime.fromtimestamp(stripe_sub.get('current_period_start', 0)).isoformat()
                period_end = datetime.fromtimestamp(stripe_sub.get('current_period_end', 0)).isoformat()
                
                result = supabase_admin.table('user_subscriptions').select('*').eq('stripe_subscription_id', subscription_id).execute()
                if result.data:
                    supabase_admin.table('user_subscriptions').update({
                        'uploads_used': 0,
                        'period_start': period_start,
                        'period_end': period_end,
                    }).eq('stripe_subscription_id', subscription_id).execute()
                    logger.info(f"[Stripe] Subscription {subscription_id} renewed, reset uploads")
        
        elif event_type in ('customer.subscription.deleted', 'customer.subscription.canceled'):
            # Subscription cancelled — downgrade to free and block uploads
            subscription_id = data.get('id')
            if subscription_id:
                supabase_admin.table('user_subscriptions').update({
                    'tier': 'free',
                    'stripe_subscription_id': None,
                    'uploads_used': FREE_UPLOAD_LIMIT,  # Max out free uploads so they can't upload
                    'period_start': None,
                    'period_end': None,
                }).eq('stripe_subscription_id', subscription_id).execute()
                logger.info(f"[Stripe] Subscription {subscription_id} cancelled, downgraded to free (uploads blocked)")
        
        return JSONResponse(content={'status': 'ok'})
    except Exception as e:
        logger.error(f"[Stripe Webhook] Error processing event {event_type}: {e}", exc_info=True)
        return JSONResponse(content={'error': str(e), 'type': type(e).__name__}, status_code=500)


@app.get("/api/debug/info")
async def debug_info():
    """Global debug endpoint: provides container diagnostics, active jobs, and files."""
    import socket
    import shutil
    
    outputs = [d.name for d in OUTPUTS_DIR.iterdir() if d.is_dir()] if OUTPUTS_DIR.exists() else []
    temp_dirs = [d.name for d in TEMP_DIR.iterdir() if d.is_dir()] if TEMP_DIR.exists() else []
    downloads = [f.name for f in DOWNLOADS_DIR.iterdir()] if DOWNLOADS_DIR.exists() else []
    
    disk = shutil.disk_usage(str(BASE_DIR))
    
    return {
        "hostname": socket.gethostname(),
        "time": datetime.now().isoformat(),
        "outputs_jobs": outputs,
        "temp_dirs": temp_dirs,
        "downloads_files": downloads,
        "disk_free_mb": round(disk.free / (1024 * 1024), 1),
        "disk_total_mb": round(disk.total / (1024 * 1024), 1),
    }

@app.get("/api/debug/outputs/{job_id}")
async def debug_outputs(job_id: str):
    """Debug endpoint: list files in the outputs directory for a specific job."""
    import socket
    job_dir = OUTPUTS_DIR / job_id
    all_jobs = [d.name for d in OUTPUTS_DIR.iterdir() if d.is_dir()] if OUTPUTS_DIR.exists() else []
    
    if not job_dir.exists():
        return {
            "error": "Job outputs directory not found on this container instance",
            "hostname": socket.gethostname(),
            "requested_job_id": job_id,
            "available_job_dirs_on_this_instance": all_jobs,
            "outputs_root": str(OUTPUTS_DIR),
        }
    
    files_info = []
    for f in job_dir.iterdir():
        files_info.append({
            "name": f.name,
            "size_bytes": f.stat().st_size,
            "size_mb": round(f.stat().st_size / (1024 * 1024), 2),
        })
        
    return {
        "hostname": socket.gethostname(),
        "job_id": job_id,
        "files": files_info,
        "job_dir": str(job_dir),
    }

@app.get("/api/download/{job_id}/{filename}")
async def download_clip(job_id: str, filename: str):
    """Serve a rendered clip file for download from the stateless temp directory."""
    job_dir = OUTPUTS_DIR / job_id
    if not job_dir.exists():
        raise HTTPException(status_code=404, detail="Job outputs not found on this server instance.")

    # Prevent directory traversal attacks
    safe_filename = filename.replace("/", "").replace("\\", "")
    clip_path = job_dir / safe_filename
    
    # Backward compatibility: if the old cached frontend sends an index like "0"
    if not clip_path.exists() and safe_filename.isdigit():
        clip_index = int(safe_filename)
        clip_num = clip_index + 1
        
        # Search the directory for a file starting with "{clip_num}_"
        for file in job_dir.iterdir():
            if file.name.startswith(f"{clip_num}_") and file.name.endswith(".mp4"):
                clip_path = file
                safe_filename = file.name
                break
                
    if not clip_path.exists():
        raise HTTPException(status_code=404, detail=f"Clip file not found: {safe_filename}")

    return FileResponse(
        path=str(clip_path),
        filename=safe_filename,
        media_type="video/mp4",
    )


# ─── Frontend Serving (SPA Routing) ──────────────────────────────────────────

frontend_dir = BASE_DIR / "frontend" / "dist"

# Mount outputs directory for direct video streaming/preview
OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)
app.mount(
    "/outputs",
    StaticFiles(directory=str(OUTPUTS_DIR)),
    name="outputs",
)

# Mount Vite assets directory
assets_dir = frontend_dir / "assets"
if assets_dir.exists():
    app.mount(
        "/assets",
        StaticFiles(directory=str(assets_dir)),
        name="assets",
    )

@app.get("/{full_path:path}")
async def serve_frontend(full_path: str):
    """Serve static files from dist, or fall back to index.html for SPA routing."""
    # Exclude API endpoints from falling through to the frontend
    if full_path.startswith("api/"):
        raise HTTPException(status_code=404, detail="API route not found")
    
    # Check if the requested path is an actual static file in dist (e.g., logo.jpg)
    if full_path:
        static_file = frontend_dir / full_path
        if static_file.exists() and static_file.is_file():
            return FileResponse(str(static_file))
    
    # Otherwise, serve index.html for SPA client-side routing
    index_path = frontend_dir / "index.html"
    if index_path.exists():
        return FileResponse(str(index_path), media_type="text/html")
        
    return HTMLResponse(
        "<h1>AI Video Clipper API</h1>"
        "<p>Frontend not found. Please run 'npm run build' in the frontend/ directory.</p>"
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
