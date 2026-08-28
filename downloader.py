"""
AI Video Clipper — Video Downloader

Downloads YouTube videos via yt-dlp and extracts audio via FFmpeg.
"""

import subprocess
import logging
import time
from pathlib import Path
from typing import Tuple

from yt_dlp import YoutubeDL
from config import DOWNLOADS_DIR, TEMP_DIR, YOUTUBE_BROWSER, BASE_DIR, PROXY_URL
import json

logger = logging.getLogger(__name__)


import httpx
import os
from config import DOWNLOADS_DIR, TEMP_DIR, BASE_DIR

def download_video(url: str, job_id: str) -> Tuple[Path, dict]:
    """
    Download the best quality video from a URL using the self-hosted Cobalt API.

    Args:
        url: Video URL (YouTube, TikTok, etc.)
        job_id: Unique job identifier for file organization

    Returns:
        Tuple of (video_path, video_info_dict)

    Raises:
        RuntimeError: If download fails for any reason
    """
    cobalt_api_url = os.environ.get("COBALT_API_URL")
    if not cobalt_api_url:
        raise RuntimeError("COBALT_API_URL is not set in .env")
        
    output_dir = DOWNLOADS_DIR / job_id
    output_dir.mkdir(parents=True, exist_ok=True)
    
    # We will save as mp4 temporarily
    video_path = output_dir / "downloaded_video.mp4"

    logger.info(f"Requesting Cobalt API for URL: {url}")
    
    headers = {
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    payload = {
        "url": url,
        "vCodec": "h264",
        "vQuality": "1080",
    }
    
    try:
        # 1. Ask Cobalt for the direct download link
        with httpx.Client(timeout=30.0) as client:
            res = client.post(cobalt_api_url, json=payload, headers=headers)
            
            if res.status_code != 200:
                raise RuntimeError(f"Cobalt API returned {res.status_code}: {res.text}")
                
            data = res.json()
            
            if data.get("status") == "error":
                raise RuntimeError(f"Cobalt Error: {data.get('text', 'Unknown error')}")
                
            direct_url = data.get("url")
            if not direct_url:
                raise RuntimeError("Cobalt returned a successful response but no download URL.")

        logger.info(f"Cobalt returned direct URL. Starting download...")
        
        # 2. Download the actual video file
        # We stream the download since videos can be large
        with httpx.stream("GET", direct_url, follow_redirects=True, timeout=120.0) as response:
            if response.status_code != 200:
                raise RuntimeError(f"Failed to download video file. HTTP {response.status_code}")
                
            with open(video_path, "wb") as f:
                for chunk in response.iter_bytes(chunk_size=8192):
                    f.write(chunk)

        if not video_path.exists() or video_path.stat().st_size == 0:
            raise RuntimeError("Downloaded video is empty (0 bytes)")

        # 3. Get Video Info (Since Cobalt doesn't return duration/title reliably, we use ffprobe)
        size_mb = video_path.stat().st_size / (1024 * 1024)
        duration = get_video_duration(video_path)
        
        video_info = {
            "title": "Cobalt Download", # Cobalt doesn't always provide title
            "duration": duration,
            "uploader": "Unknown",
            "description": "",
            "fps": 30,
            "width": 1080,
            "height": 1920,
        }
        
        logger.info(
            f"Download complete: {size_mb:.1f} MB, Duration: {duration:.1f}s"
        )

        return video_path, video_info

    except Exception as e:
        logger.error(f"Download failed: {e}")
        raise RuntimeError(f"Download failed: {e}")


def _resolve_downloaded_path(info: dict, output_dir: Path) -> Path:
    """
    Resolve the actual path of the downloaded file from yt-dlp info.

    yt-dlp can store the path in several places depending on version and format.
    """
    # Method 1: requested_downloads (most reliable)
    if info.get("requested_downloads"):
        filepath = info["requested_downloads"][0].get("filepath")
        if filepath:
            return Path(filepath)

    # Method 2: _filename field
    if info.get("_filename"):
        return Path(info["_filename"])

    # Method 3: Construct from template
    title = info.get("title", "video")
    # Sanitize title for filename
    safe_title = "".join(
        c for c in title if c.isalnum() or c in (" ", "-", "_", ".")
    ).strip()[:100]
    candidate = output_dir / f"{safe_title}.mp4"
    if candidate.exists():
        return candidate

    # Method 4: Find any mp4 in the output directory (including .temp.mp4)
    mp4_files = list(output_dir.glob("*.mp4"))
    if mp4_files:
        best_match = max(mp4_files, key=lambda f: f.stat().st_mtime)
        # If it's still named .temp.mp4, manually rename it to strip .temp
        if best_match.name.endswith(".temp.mp4"):
            new_path = best_match.with_name(best_match.name.replace(".temp.mp4", ".mp4"))
            try:
                best_match.rename(new_path)
                return new_path
            except Exception:
                return best_match  # Fallback to returning the .temp.mp4
        return best_match

    # Method 5: Find any video file
    video_extensions = ["*.mkv", "*.webm", "*.avi", "*.mov"]
    for ext in video_extensions:
        files = list(output_dir.glob(ext))
        if files:
            return max(files, key=lambda f: f.stat().st_mtime)

    raise RuntimeError(f"Could not locate downloaded video in {output_dir}")


def _progress_hook(d: dict):
    """yt-dlp progress callback for logging."""
    status = d.get("status")
    if status == "downloading":
        pct = d.get("_percent_str", "?%").strip()
        speed = d.get("_speed_str", "?").strip()
        eta = d.get("_eta_str", "?").strip()
        if pct and "100" not in pct:
            # Only log every ~10%
            try:
                pct_val = float(pct.replace("%", ""))
                if int(pct_val) % 10 == 0:
                    logger.info(f"Downloading: {pct} at {speed} (ETA: {eta})")
            except ValueError:
                pass
    elif status == "finished":
        logger.info("Download finished, processing...")


def get_video_duration(video_path: Path) -> float:
    """Use ffprobe to get the duration of a video file in seconds."""
    cmd = [
        "ffprobe",
        "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        str(video_path)
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        return float(result.stdout.strip())
    except (subprocess.CalledProcessError, ValueError) as e:
        logger.error(f"Failed to get video duration: {e}")
        return 0.0

def extract_audio(video_path: Path, job_id: str) -> Path:
    """
    Extract audio from video as MP3 optimized for Whisper transcription.

    - 16kHz sample rate (Whisper's native rate)
    - Mono channel
    - 192kbps quality

    Args:
        video_path: Path to source video
        job_id: Job identifier for temp directory

    Returns:
        Path to extracted audio file

    Raises:
        RuntimeError: If FFmpeg extraction fails
    """
    audio_dir = TEMP_DIR / job_id
    audio_dir.mkdir(parents=True, exist_ok=True)
    audio_path = audio_dir / "audio.mp3"

    cmd = [
        "ffmpeg",
        "-y",                     # Overwrite output
        "-i", str(video_path),    # Input video
        "-vn",                    # Discard video stream
        "-acodec", "libmp3lame",  # MP3 codec
        "-ab", "192k",            # Bitrate
        "-ar", "16000",           # 16kHz (optimal for Whisper)
        "-ac", "1",               # Mono (optimal for Whisper)
        "-loglevel", "error",     # Suppress verbose output
        str(audio_path),
    ]

    try:
        logger.info(f"Extracting audio: {video_path.name} → audio.mp3")

        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=600,  # 10-minute timeout for very long videos
        )

        if result.returncode != 0:
            stderr = result.stderr.strip()
            raise RuntimeError(f"FFmpeg audio extraction failed:\n{stderr}")

        if not audio_path.exists():
            raise RuntimeError("FFmpeg did not produce an output file")

        if audio_path.stat().st_size == 0:
            raise RuntimeError("FFmpeg produced an empty audio file")

        size_mb = audio_path.stat().st_size / (1024 * 1024)
        logger.info(f"Audio extracted: {audio_path} ({size_mb:.1f} MB)")

        return audio_path

    except subprocess.TimeoutExpired:
        raise RuntimeError(
            "Audio extraction timed out after 10 minutes. "
            "The video may be too long or the system is under heavy load."
        )
    except FileNotFoundError:
        raise RuntimeError(
            "FFmpeg not found. Make sure FFmpeg is installed and in your PATH."
        )
