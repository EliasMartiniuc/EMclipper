"""
AI Video Clipper — Final Video Renderer

Renders the final native 16:9 clip using FFmpeg.
If subtitles are enabled, re-encodes the video to burn them in.
If subtitles are disabled, uses stream copy for lightning-fast trimming.
"""

import subprocess
import logging
from pathlib import Path
from typing import Optional, Callable, List

logger = logging.getLogger(__name__)

def render_short(
    source_video: Path,
    ass_path: Optional[Path],
    start_time: float,
    end_time: float,
    output_path: Path,
    job_id: str,
    progress_callback: Optional[Callable[[float], None]] = None,
    subprocess_tracker: Optional[List] = None,
) -> Path:
    """
    Render the final video clip.

    Args:
        source_video: Path to the original downloaded video
        ass_path: Path to the .ass subtitle file, or None if disabled
        start_time: Clip start time in the source video (seconds)
        end_time: Clip end time in the source video (seconds)
        output_path: Where to write the final MP4
        job_id: Job identifier
        progress_callback: Optional function called with progress (0.0 to 1.0)
    """
    source_video = Path(source_video)
    output_path = Path(output_path)
    
    # Ensure output directory exists
    output_path.parent.mkdir(parents=True, exist_ok=True)
    
    duration = end_time - start_time
    
    if not source_video.exists():
        raise RuntimeError(f"Source video not found: {source_video}")

    logger.info(f"Rendering clip: {duration:.1f}s. Subtitles: {'Yes' if ass_path else 'No'}")
    
    # ── Build FFmpeg command ──
    ffmpeg_cmd = [
        "ffmpeg",
        "-y",
        "-hide_banner",
        "-loglevel", "error",
        "-ss", f"{start_time:.3f}",
        "-to", f"{end_time:.3f}",
        "-i", str(source_video),
    ]

    # Ensure vertical 9:16 padding (1080x1920)
    if ass_path and ass_path.exists():
        ass_path_ffmpeg = _escape_ffmpeg_path(str(ass_path))
        filter_str = f"[0:v]scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,ass='{ass_path_ffmpeg}'[outv]"
    else:
        filter_str = "[0:v]scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2[outv]"

    ffmpeg_cmd.extend([
        "-filter_complex", filter_str,
        "-map", "[outv]",
        "-map", "0:a?",
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "20",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-b:a", "192k"
    ])

    ffmpeg_cmd.extend([
        "-movflags", "+faststart",
        str(output_path)
    ])

    logger.debug(f"FFmpeg command: {' '.join(ffmpeg_cmd)}")

    # ── Start FFmpeg subprocess ──
    proc = subprocess.Popen(
        ffmpeg_cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )

    # Register for cancellation tracking
    if subprocess_tracker is not None:
        subprocess_tracker.append(proc)

    try:
        # Since we use stream copy or fast filter, we can't easily parse frame progress from stdout
        # without complicating the pipe. We will just report 0% and 100%.
        if progress_callback:
            progress_callback(0.0)

        stdout, stderr = proc.communicate(timeout=300)

        if proc.returncode != 0:
            error_text = stderr.decode("utf-8", errors="replace")
            error_tail = error_text[-2000:] if len(error_text) > 2000 else error_text
            raise RuntimeError(
                f"FFmpeg rendering failed (exit code {proc.returncode}):\n{error_tail}"
            )

        if not output_path.exists():
            raise RuntimeError("FFmpeg did not produce an output file")

        file_size = output_path.stat().st_size
        if file_size == 0:
            raise RuntimeError("FFmpeg produced an empty output file (0 bytes)")

        if progress_callback:
            progress_callback(1.0)

        return output_path

    except subprocess.TimeoutExpired:
        proc.kill()
        raise RuntimeError("FFmpeg rendering timed out after 5 minutes.")
    except Exception:
        try:
            proc.kill()
        except Exception:
            pass
        raise
    finally:
        if subprocess_tracker is not None and proc in subprocess_tracker:
            subprocess_tracker.remove(proc)

def _escape_ffmpeg_path(path: str) -> str:
    escaped = path.replace("\\", "/")
    escaped = escaped.replace(":", "\\:")
    return escaped
