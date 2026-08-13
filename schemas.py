"""
AI Video Clipper — Data Schemas

Pydantic models used as typed contracts between pipeline stages.
"""

from pydantic import BaseModel, Field
from typing import List, Optional
from enum import Enum


class JobStatus(str, Enum):
    """Pipeline processing stages."""
    QUEUED = "queued"
    DOWNLOADING = "downloading"
    TRANSCRIBING = "transcribing"
    DETECTING_HIGHLIGHTS = "detecting_highlights"
    PROCESSING_CLIP = "processing_clip"
    GENERATING_SUBTITLES = "generating_subtitles"
    RENDERING = "rendering"
    COMPLETED = "completed"
    ERROR = "error"


# ─── API Models ────────────────────────────────────────────────────────────────

class JobRequest(BaseModel):
    """Incoming request to process a YouTube video."""
    url: Optional[str] = Field(None, description="YouTube video URL")
    subtitles_enabled: bool = Field(True, description="Whether to generate and burn subtitles into the video")


# ─── Transcription Models ─────────────────────────────────────────────────────

class TranscriptWord(BaseModel):
    """A single word with exact timing from Whisper."""
    word: str
    start: float          # Start time in seconds
    end: float            # End time in seconds
    probability: float = 0.0  # Whisper confidence


class TranscriptSegment(BaseModel):
    """A sentence/phrase segment with its words."""
    text: str
    start: float
    end: float
    words: List[TranscriptWord] = []


# ─── Highlight Detection Models ────────────────────────────────────────────────

class Highlight(BaseModel):
    """A detected highlight clip from the LLM."""
    start_time: float
    end_time: float
    title: str
    score: float = 0.0     # Engagement score (1-10)
    reason: str = ""       # Why this moment is engaging


# ─── Result Models ─────────────────────────────────────────────────────────────

class ClipResult(BaseModel):
    """Result info for a rendered clip."""
    index: int
    title: str
    output_path: str
    filename: str
    duration: float
    score: float = 0.0


class ProgressMessage(BaseModel):
    """A progress update from the pipeline."""
    stage: str
    message: str
    progress: Optional[float] = None  # 0.0 to 1.0
    time: Optional[str] = None
