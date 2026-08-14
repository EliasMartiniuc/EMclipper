"""
AI Video Clipper — Centralized Configuration

All settings are loaded from .env with sensible defaults.
Import this module to access any setting: from config import DEEPSEEK_MODEL
"""

import os
from pathlib import Path
from dotenv import load_dotenv

# Load .env from project root
_env_path = Path(__file__).parent / ".env"
load_dotenv(_env_path)

# ─── Base Paths ────────────────────────────────────────────────────────────────
BASE_DIR = Path(__file__).parent
DOWNLOADS_DIR = BASE_DIR / "downloads"
OUTPUTS_DIR = BASE_DIR / "outputs"
TEMP_DIR = BASE_DIR / "temp"

# Create directories on import
for _d in [DOWNLOADS_DIR, OUTPUTS_DIR, TEMP_DIR]:
    _d.mkdir(exist_ok=True)

# ─── Downloader ────────────────────────────────────────────────────────────────
# Which browser to extract cookies from for age-restricted videos (e.g. "chrome", "edge", "firefox")
YOUTUBE_BROWSER = os.getenv("YOUTUBE_BROWSER", "")

# Residential Proxy URL for bypassing YouTube Datacenter blocks (e.g. http://user:pass@ip:port)
PROXY_URL = os.getenv("PROXY_URL", "")

# ─── Serverless Execution (Modal) ─────────────────────────────────────────────
# Set to "true" to offload processing to Modal serverless containers
USE_MODAL = os.getenv("USE_MODAL", "false").lower() == "true"

# ─── Whisper Transcription (Groq Cloud) ────────────────────────────────────────
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GROQ_WHISPER_MODEL = os.getenv("GROQ_WHISPER_MODEL", "whisper-large-v3-turbo")

# ─── LLM Configuration (DeepSeek Cloud) ───────────────────────────────────────
DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY", "")
DEEPSEEK_MODEL = os.getenv("DEEPSEEK_MODEL", "deepseek-chat")
DEEPSEEK_BASE_URL = "https://api.deepseek.com/v1"

# ─── Subtitle Styling ─────────────────────────────────────────────────────────
# ASS color format: &HAABBGGRR (hex, BGR order, not RGB)
SUBTITLE_FONT = os.getenv("SUBTITLE_FONT", "Liberation Sans")
SUBTITLE_FONTSIZE = int(os.getenv("SUBTITLE_FONTSIZE", "58"))
SUBTITLE_PRIMARY_COLOR = os.getenv("SUBTITLE_PRIMARY_COLOR", "&H0000FFFF")      # Yellow (highlighted word)
SUBTITLE_SECONDARY_COLOR = os.getenv("SUBTITLE_SECONDARY_COLOR", "&H00FFFFFF")  # White (pre-highlight)
SUBTITLE_OUTLINE_COLOR = os.getenv("SUBTITLE_OUTLINE_COLOR", "&H00000000")      # Black outline
SUBTITLE_BACK_COLOR = os.getenv("SUBTITLE_BACK_COLOR", "&H80000000")            # Semi-transparent shadow
SUBTITLE_OUTLINE = int(os.getenv("SUBTITLE_OUTLINE", "4"))
SUBTITLE_SHADOW = int(os.getenv("SUBTITLE_SHADOW", "2"))
SUBTITLE_MARGIN_V = int(os.getenv("SUBTITLE_MARGIN_V", "550"))                  # Bottom margin in pixels
SUBTITLE_WORDS_PER_LINE = int(os.getenv("SUBTITLE_WORDS_PER_LINE", "4"))

# ─── Highlight Detection ──────────────────────────────────────────────────────
HIGHLIGHT_MIN_DURATION = int(os.getenv("HIGHLIGHT_MIN_DURATION", "20"))
HIGHLIGHT_MAX_DURATION = int(os.getenv("HIGHLIGHT_MAX_DURATION", "180"))
HIGHLIGHT_COUNT = int(os.getenv("HIGHLIGHT_COUNT", "3"))
