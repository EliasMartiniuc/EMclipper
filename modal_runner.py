"""
AI Video Clipper — Modal Serverless Runner

Runs the full video processing pipeline (download → transcribe → detect highlights → render)
inside a serverless Modal container. Each user request gets its own dedicated container with
full CPU, RAM, and FFmpeg, enabling unlimited parallel processing with zero queues.

Deployment:
    modal deploy modal_runner.py

Local testing:
    modal run modal_runner.py --url "https://www.youtube.com/watch?v=VIDEO_ID"
"""

import modal
import os
import json
import logging
import tempfile
import shutil
from pathlib import Path
from typing import List, Dict, Any, Optional

logger = logging.getLogger(__name__)

# ═══════════════════════════════════════════════════════════════════════════════
# MODAL IMAGE DEFINITION
# ═══════════════════════════════════════════════════════════════════════════════

# Build a Docker image with all system deps (FFmpeg, fonts) and Python packages
modal_image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg", "fonts-liberation")
    .pip_install(
        "yt-dlp>=2024.0.0",
        "openai>=1.0.0",
        "python-dotenv>=1.0.0",
        "pydantic>=2.0.0",
    )
    # Copy our application source code into the Modal image
    .add_local_file("schemas.py", "/app/schemas.py")
    .add_local_file("downloader.py", "/app/downloader.py")
    .add_local_file("transcriber.py", "/app/transcriber.py")
    .add_local_file("llm_agent.py", "/app/llm_agent.py")
    .add_local_file("subtitles.py", "/app/subtitles.py")
    .add_local_file("renderer.py", "/app/renderer.py")
    .add_local_file("config.py", "/app/config.py")
)

# ═══════════════════════════════════════════════════════════════════════════════
# MODAL APP
# ═══════════════════════════════════════════════════════════════════════════════

app = modal.App(
    name="ai-video-clipper",
    image=modal_image,
    secrets=[modal.Secret.from_name("clipper-secrets")],
)

# Shared volume for passing rendered clips back to the web server
clips_volume = modal.Volume.from_name("clipper-clips", create_if_missing=True)


# ═══════════════════════════════════════════════════════════════════════════════
# SERVERLESS PROCESSING FUNCTION
# ═══════════════════════════════════════════════════════════════════════════════


@app.function(
    timeout=1800,  # 30-minute max per job
    cpu=2.0,
    memory=4096,  # 4 GB RAM — plenty for FFmpeg
    volumes={"/clips": clips_volume},
)
def process_video_remote(
    url: str,
    job_id: str,
    subtitles_enabled: bool = True,
    cookies_content: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Run the full pipeline inside a Modal serverless container.

    This function is called remotely from the Render web server. Each invocation
    gets its own isolated container with dedicated CPU and RAM.

    Args:
        url: YouTube video URL
        job_id: Unique job identifier
        subtitles_enabled: Whether to burn subtitles into clips
        cookies_content: Optional contents of cookies.txt for age-restricted videos

    Returns:
        Dict with keys: status, clips, video_title, error, progress
    """
    import sys
    sys.path.insert(0, "/app")

    # Ensure config directories exist
    os.makedirs("/app/downloads", exist_ok=True)
    os.makedirs("/app/outputs", exist_ok=True)
    os.makedirs("/app/temp", exist_ok=True)

    # Write cookies if provided
    if cookies_content:
        with open("/app/cookies.txt", "w") as f:
            f.write(cookies_content)
        logger.info("Wrote cookies.txt for yt-dlp authentication")

    # Re-import modules fresh inside the container
    import downloader
    import transcriber
    import llm_agent
    import subtitles
    import renderer
    from config import DOWNLOADS_DIR, OUTPUTS_DIR, TEMP_DIR

    progress_log: List[Dict[str, str]] = []
    clips_result: List[Dict[str, Any]] = []

    def log_progress(stage: str, message: str):
        entry = {"stage": stage, "message": message}
        progress_log.append(entry)
        logger.info(f"[{job_id[:8]}] [{stage}] {message}")

    try:
        # ── STAGE 1: DOWNLOAD ──────────────────────────────────────────
        log_progress("download", "Starting video download...")
        video_path, video_info = downloader.download_video(url, job_id)
        video_title = video_info["title"]
        log_progress(
            "download",
            f'Downloaded: "{video_title}" '
            f'({video_info["duration"]}s, '
            f'{video_info["width"]}x{video_info["height"]})',
        )

        log_progress("download", "Extracting audio track...")
        audio_path = downloader.extract_audio(video_path, job_id)
        log_progress("download", "Audio extracted (16kHz mono)")

        # ── STAGE 2: TRANSCRIBE ────────────────────────────────────────
        log_progress("transcribe", "Starting Groq cloud transcription...")
        segments, all_words = transcriber.transcribe(audio_path)
        log_progress(
            "transcribe",
            f"Transcription complete: {len(segments)} segments, "
            f"{len(all_words)} words",
        )

        if not all_words:
            raise RuntimeError(
                "Transcription produced no words. "
                "The audio may be silent, music-only, or in an unsupported language."
            )

        # ── STAGE 3: HIGHLIGHT DETECTION ───────────────────────────────
        log_progress("highlights", "Formatting transcript for LLM...")
        transcript_text = transcriber.format_transcript_for_llm(segments)
        log_progress(
            "highlights",
            f"Sending to LLM for highlight detection "
            f"({len(transcript_text)} chars)...",
        )

        highlights = llm_agent.detect_highlights(
            transcript_text, video_info["duration"]
        )

        log_progress(
            "highlights", f"LLM identified {len(highlights)} highlight clips:"
        )
        for i, h in enumerate(highlights):
            log_progress(
                "highlights",
                f"  Clip {i + 1}: [{h.start_time:.1f}s → {h.end_time:.1f}s] "
                f'"{h.title}" (score: {h.score}/10)',
            )

        # ── STAGE 4: PROCESS EACH CLIP ─────────────────────────────────
        for clip_idx, highlight in enumerate(highlights):
            clip_num = clip_idx + 1
            clip_duration = highlight.end_time - highlight.start_time

            log_progress(
                "processing",
                f'═══ Processing clip {clip_num}/{len(highlights)}: '
                f'"{highlight.title}" ({clip_duration:.1f}s) ═══',
            )

            # ── 4a: Generate Subtitles ─────────────────────────────────
            ass_path = None
            if subtitles_enabled:
                log_progress(
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

                log_progress(
                    "subtitles",
                    f"Clip {clip_num}: Subtitles generated ({ass_path.name})",
                )

            # ── 4b: Render Final Video ─────────────────────────────────
            log_progress(
                "rendering",
                f"Clip {clip_num}: Rendering final video...",
            )

            output_dir = OUTPUTS_DIR / job_id
            output_dir.mkdir(parents=True, exist_ok=True)

            safe_title = "".join(
                c
                for c in highlight.title
                if c.isalnum() or c in (" ", "-", "_")
            ).strip()
            safe_title = safe_title[:50] if safe_title else f"clip_{clip_num}"
            output_filename = f"{clip_num}_{safe_title}.mp4"
            output_filepath = output_dir / output_filename

            renderer.render_short(
                source_video=video_path,
                ass_path=ass_path,
                start_time=highlight.start_time,
                end_time=highlight.end_time,
                output_path=output_filepath,
                job_id=job_id,
            )

            # Copy rendered clip to the shared volume so Render can serve it
            volume_clip_dir = Path(f"/clips/{job_id}")
            volume_clip_dir.mkdir(parents=True, exist_ok=True)
            volume_clip_path = volume_clip_dir / output_filename
            shutil.copy2(str(output_filepath), str(volume_clip_path))

            file_size_mb = output_filepath.stat().st_size / (1024 * 1024)

            clip_result = {
                "index": clip_idx,
                "title": highlight.title,
                "filename": output_filename,
                "volume_path": str(volume_clip_path),
                "duration": round(clip_duration, 1),
                "score": highlight.score,
                "reason": highlight.reason,
                "size_mb": round(file_size_mb, 1),
            }
            clips_result.append(clip_result)

            log_progress(
                "rendering",
                f"Clip {clip_num}: ✓ Render complete! ({file_size_mb:.1f} MB)",
            )

        # Commit volume writes
        clips_volume.commit()

        log_progress(
            "complete",
            f"✓ All {len(highlights)} clips rendered successfully! "
            f"Ready for download.",
        )

        # Clean up temp files inside the container (they vanish anyway)
        shutil.rmtree(str(DOWNLOADS_DIR / job_id), ignore_errors=True)
        shutil.rmtree(str(TEMP_DIR / job_id), ignore_errors=True)

        return {
            "status": "completed",
            "video_title": video_title,
            "clips": clips_result,
            "progress": progress_log,
            "error": None,
        }

    except Exception as e:
        error_msg = str(e)
        logger.exception(f"Pipeline failed for job {job_id}")
        log_progress("error", f"✗ Pipeline failed: {error_msg}")

        return {
            "status": "error",
            "video_title": "",
            "clips": [],
            "progress": progress_log,
            "error": error_msg,
        }


# ═══════════════════════════════════════════════════════════════════════════════
# CLIP RETRIEVAL FUNCTION
# ═══════════════════════════════════════════════════════════════════════════════


@app.function(
    volumes={"/clips": clips_volume},
)
def get_clip_bytes(job_id: str, filename: str) -> bytes:
    """
    Read a rendered clip from the shared Modal volume and return its bytes.
    Called by the Render web server to serve downloads to users.
    """
    clips_volume.reload()
    clip_path = Path(f"/clips/{job_id}/{filename}")
    if not clip_path.exists():
        raise FileNotFoundError(f"Clip not found: {clip_path}")
    return clip_path.read_bytes()


@app.function(
    volumes={"/clips": clips_volume},
)
def cleanup_job_clips(job_id: str):
    """
    Delete all clips for a job from the shared volume.
    Called after the user has downloaded their clips, or after a TTL expires.
    """
    clips_volume.reload()
    job_dir = Path(f"/clips/{job_id}")
    if job_dir.exists():
        shutil.rmtree(str(job_dir), ignore_errors=True)
        clips_volume.commit()
        logger.info(f"Cleaned up clips for job {job_id}")


# ═══════════════════════════════════════════════════════════════════════════════
# LOCAL CLI ENTRY POINT (for testing)
# ═══════════════════════════════════════════════════════════════════════════════


@app.local_entrypoint()
def main(url: str = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"):
    """Test the serverless pipeline from the command line."""
    import uuid

    job_id = str(uuid.uuid4())
    print(f"Starting serverless processing for: {url}")
    print(f"Job ID: {job_id}")

    result = process_video_remote.remote(url=url, job_id=job_id)

    print(f"\nStatus: {result['status']}")
    print(f"Video: {result['video_title']}")

    if result["error"]:
        print(f"Error: {result['error']}")

    for clip in result["clips"]:
        print(f"  Clip {clip['index'] + 1}: {clip['title']} ({clip['duration']}s, {clip['size_mb']}MB)")

    print("\nProgress log:")
    for p in result["progress"]:
        print(f"  [{p['stage']}] {p['message']}")
