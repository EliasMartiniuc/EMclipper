"""
AI Video Clipper — Video Downloader

Downloads YouTube videos via yt-dlp and extracts audio via FFmpeg.
"""

import subprocess
import logging
import time
from pathlib import Path
from typing import Tuple
import json
import httpx

from yt_dlp import YoutubeDL
from config import DOWNLOADS_DIR, TEMP_DIR, YOUTUBE_BROWSER, BASE_DIR, PROXY_URL, COBALT_API_URL, COBALT_API_KEY

logger = logging.getLogger(__name__)

# Candidate community Cobalt instances (user-configured URL has top priority)
COBALT_CANDIDATE_INSTANCES = [
    COBALT_API_URL,
    "https://cobalt.tools",
    "https://api.cobalt.tools",
]


def get_video_metadata(video_path: Path) -> dict:
    """Use ffprobe to extract video stream and format details."""
    cmd = [
        "ffprobe",
        "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "stream=width,height,r_frame_rate:format=duration",
        "-of", "json",
        str(video_path)
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        data = json.loads(result.stdout)
        stream = data.get("streams", [{}])[0] if data.get("streams") else {}
        fmt = data.get("format", {})
        
        # Calculate fps
        r_fps = stream.get("r_frame_rate", "30/1")
        try:
            if "/" in r_fps:
                num, den = r_fps.split("/")
                fps = round(float(num) / float(den), 1) if float(den) > 0 else 30
            else:
                fps = float(r_fps)
        except Exception:
            fps = 30

        return {
            "duration": float(fmt.get("duration", 0)),
            "width": int(stream.get("width", 1920)),
            "height": int(stream.get("height", 1080)),
            "fps": fps,
        }
    except Exception as e:
        logger.warning(f"ffprobe metadata extraction failed: {e}")
        return {
            "duration": get_video_duration(video_path),
            "width": 1920,
            "height": 1080,
            "fps": 30,
        }


def download_via_cobalt(url: str, job_id: str, output_dir: Path) -> Tuple[Path, dict]:
    """
    Attempt to download a video using the Cobalt API.
    Returns (video_path, video_info) on success.
    Raises RuntimeError if Cobalt fails or instances are unreachable.
    """
    active_instances = [inst for inst in COBALT_CANDIDATE_INSTANCES if inst]
    if not active_instances:
        raise RuntimeError("No Cobalt instances configured")

    payload = {
        "url": url,
        "videoQuality": "1080",
        "downloadMode": "auto"
    }
    
    headers = {
        "Accept": "application/json",
        "Content-Type": "application/json"
    }
    if COBALT_API_KEY:
        headers["Authorization"] = f"Api-Key {COBALT_API_KEY}"

    last_error = None
    for base_url in active_instances:
        try:
            endpoint = f"{base_url.rstrip('/')}/"
            logger.info(f"Trying Cobalt instance: {endpoint}")
            
            with httpx.Client(timeout=30.0, follow_redirects=True) as client:
                resp = client.post(endpoint, json=payload, headers=headers)
                if resp.status_code != 200:
                    last_error = f"Cobalt instance {base_url} returned HTTP {resp.status_code}: {resp.text[:100]}"
                    logger.warning(last_error)
                    continue

                data = resp.json()
                status = data.get("status")
                
                # Cobalt response types: "tunnel", "redirect", "stream"
                download_url = data.get("url")
                if status in ("tunnel", "redirect", "stream") and download_url:
                    filename = data.get("filename") or f"cobalt_video_{job_id[:8]}.mp4"
                    safe_filename = "".join(c for c in filename if c.isalnum() or c in (".", "-", "_", " ")).strip()
                    if not safe_filename.endswith(".mp4"):
                        safe_filename = f"{Path(safe_filename).stem}.mp4"
                    
                    target_path = output_dir / safe_filename
                    logger.info(f"Cobalt stream URL received, downloading to {target_path.name}...")
                    
                    # Stream download the file in 1MB chunks
                    with client.stream("GET", download_url, timeout=300.0) as stream_resp:
                        if stream_resp.status_code != 200:
                            raise RuntimeError(f"Failed to stream video from Cobalt: HTTP {stream_resp.status_code}")
                        
                        with open(target_path, "wb") as f:
                            for chunk in stream_resp.iter_bytes(chunk_size=1024 * 1024):
                                f.write(chunk)

                    if not target_path.exists() or target_path.stat().st_size == 0:
                        raise RuntimeError("Cobalt stream produced an empty file")

                    # Extract metadata via ffprobe
                    meta = get_video_metadata(target_path)
                    clean_title = Path(safe_filename).stem
                    video_info = {
                        "title": clean_title,
                        "duration": meta["duration"],
                        "uploader": "Cobalt",
                        "description": "",
                        "fps": meta["fps"],
                        "width": meta["width"],
                        "height": meta["height"],
                        "view_count": 0,
                        "upload_date": "",
                    }
                    size_mb = target_path.stat().st_size / (1024 * 1024)
                    logger.info(
                        f"Cobalt download complete: '{video_info['title']}' "
                        f"({video_info['duration']:.1f}s, {size_mb:.1f} MB, "
                        f"{video_info['width']}x{video_info['height']}@{video_info['fps']}fps)"
                    )
                    return target_path, video_info
                else:
                    err_detail = data.get("error", {}).get("code") or data.get("text") or status
                    last_error = f"Cobalt returned non-stream status: {err_detail}"
                    logger.warning(last_error)
        except Exception as e:
            last_error = f"Cobalt error on {base_url}: {e}"
            logger.warning(last_error)

    raise RuntimeError(last_error or "All Cobalt instances failed")


def download_video(url: str, job_id: str) -> Tuple[Path, dict]:
    """
    Download the best quality video from a YouTube URL.
    Attempts Cobalt first; if Cobalt fails, falls back automatically to yt-dlp.

    Args:
        url: YouTube video URL
        job_id: Unique job identifier for file organization

    Returns:
        Tuple of (video_path, video_info_dict)

    Raises:
        RuntimeError: If all download methods fail
    """
    output_dir = DOWNLOADS_DIR / job_id
    output_dir.mkdir(parents=True, exist_ok=True)

    # ════════════════════════════════════════════════════════════════
    # 1. ATTEMPT COBALT DOWNLOAD FIRST (Fast, No Proxies/Cookies Needed)
    # ════════════════════════════════════════════════════════════════
    try:
        logger.info(f"Attempting download via Cobalt for: {url}")
        video_path, video_info = download_via_cobalt(url, job_id, output_dir)
        return video_path, video_info
    except Exception as cobalt_err:
        logger.warning(f"Cobalt download could not complete ({cobalt_err}). Falling back to yt-dlp...")

    # ════════════════════════════════════════════════════════════════
    # 2. FALLBACK: yt-dlp DOWNLOAD
    # ════════════════════════════════════════════════════════════════
    output_template = str(output_dir / "%(title).100s.%(ext)s")

    ydl_opts = {
        # Format selection: cap at 1080p for fast processing and crisp 1080p clip output
        "format": "bestvideo[height<=1080]+bestaudio/best[height<=1080]/best",
        "outtmpl": output_template,
        "merge_output_format": "mp4",
        # Use 'ios' and 'android_creator' player clients. This is mandatory on headless servers
        # to bypass the IP-mismatch age restriction check and bot-checks, even when cookies are provided.
        "extractor_args": {"youtube": {"player_client": ["ios", "android_creator"]}},
        # Reliability
        "no_warnings": True,
        "quiet": True,
        "no_color": True,
        "socket_timeout": 30,
        "remote_components": ["ejs:github"],
        "retries": 5,
        "fragment_retries": 5,
        "file_access_retries": 10,
        # Avoid throttling
        "sleep_interval_requests": 1,
        # Don't download subtitles, thumbnails, etc.
        "writesubtitles": False,
        "writethumbnail": False,
        "writedescription": False,
        "writeinfojson": False,
        # Progress hooks for logging
        "progress_hooks": [_progress_hook],
    }

    job_cookie_file = TEMP_DIR / job_id / "cookies.txt"
    global_cookie_file = BASE_DIR / "cookies.txt"
    
    if job_cookie_file.exists():
        logger.info("Using uploaded cookies.txt for yt-dlp authentication")
        ydl_opts["cookiefile"] = str(job_cookie_file)
    elif global_cookie_file.exists():
        logger.info("Using global cookies.txt for yt-dlp authentication")
        ydl_opts["cookiefile"] = str(global_cookie_file)
    elif YOUTUBE_BROWSER:
        logger.info(f"Using browser cookies from: {YOUTUBE_BROWSER}")
        ydl_opts["cookiesfrombrowser"] = (YOUTUBE_BROWSER.lower(),)
        
    if PROXY_URL:
        logger.info("Routing download through residential proxy to bypass Datacenter blocks")
        ydl_opts["proxy"] = PROXY_URL

    try:
        with YoutubeDL(ydl_opts) as ydl:
            logger.info(f"Extracting info for: {url}")
            info = ydl.extract_info(url, download=False)

            if info is None:
                raise RuntimeError("yt-dlp returned no video info")

            logger.info(f"Starting download: {info.get('title', url)}")
            try:
                ydl.download([url])
            except Exception as dl_e:
                error_msg = str(dl_e)
                if "WinError 32" in error_msg:
                    logger.warning("yt-dlp hit a Windows file lock during cleanup. Sleeping 3s to let Defender finish...")
                    time.sleep(3)
                else:
                    raise dl_e

            # Resolve the actual downloaded file path
            video_path = _resolve_downloaded_path(info, output_dir)

            if not video_path.exists():
                raise RuntimeError(f"Downloaded file not found: {video_path}")

            if video_path.stat().st_size == 0:
                raise RuntimeError("Downloaded file is empty (0 bytes)")

            video_info = {
                "title": info.get("title", "Unknown"),
                "duration": info.get("duration", 0),
                "uploader": info.get("uploader", "Unknown"),
                "description": info.get("description", ""),
                "fps": info.get("fps", 30) or 30,
                "width": info.get("width", 1920) or 1920,
                "height": info.get("height", 1080) or 1080,
                "view_count": info.get("view_count", 0),
                "upload_date": info.get("upload_date", ""),
            }

            size_mb = video_path.stat().st_size / (1024 * 1024)
            logger.info(
                f"Download complete: '{video_info['title']}' "
                f"({video_info['duration']}s, {size_mb:.1f} MB, "
                f"{video_info['width']}x{video_info['height']}@{video_info['fps']}fps)"
            )

            return video_path, video_info

    except Exception as e:
        error_msg = str(e)

        # Provide user-friendly error messages for common failures
        if "Video unavailable" in error_msg or "Private video" in error_msg:
            raise RuntimeError(
                f"Video is unavailable or private. Check the URL and try again."
            )
        elif "Sign in to confirm" in error_msg or "age" in error_msg.lower():
            raise RuntimeError(
                f"Video is age-restricted and cannot be downloaded without authentication."
            )
        elif "Requested format is not available" in error_msg:
            raise RuntimeError(
                "YouTube blocked the video stream. If this is an age-restricted video, your uploaded cookies.txt may have been wiped out by a server restart. Please re-upload cookies.txt and try again."
            )
        elif "HTTP Error 429" in error_msg or "Too Many Requests" in error_msg:
            raise RuntimeError(
                f"YouTube rate limit hit. Wait a few minutes and try again."
            )
        elif "is not a valid URL" in error_msg or "Unsupported URL" in error_msg:
            raise RuntimeError(f"Invalid URL: {url}")
        else:
            logger.error(f"Download failed: {e}")
            raise RuntimeError(f"Download failed: {error_msg}")


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
