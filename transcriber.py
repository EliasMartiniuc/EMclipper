"""
AI Video Clipper — Whisper Transcription (Groq Cloud)

Transcribes audio via the Groq cloud API (whisper-large-v3-turbo).
Automatically chunks large audio files to bypass the 25MB API limit.
"""

import logging
import subprocess
from pathlib import Path
from typing import List, Tuple

from openai import OpenAI

from schemas import TranscriptWord, TranscriptSegment
from config import (
    GROQ_API_KEY,
    GROQ_WHISPER_MODEL,
    TEMP_DIR
)

logger = logging.getLogger(__name__)


# ─── Audio Chunking ───────────────────────────────────────────────────────────

def chunk_audio_if_needed(audio_path: Path, max_size_mb: int = 24) -> List[Tuple[Path, float]]:
    """
    Splits audio using FFmpeg if it exceeds max_size_mb (Groq API limit is 25MB).
    Returns a list of tuples: (chunk_path, offset_seconds).
    At 192kbps (which we extract), 10 mins (600s) is ~14MB, well under 24MB.
    """
    size_mb = audio_path.stat().st_size / (1024 * 1024)
    if size_mb <= max_size_mb:
        return [(audio_path, 0.0)]
    
    logger.info(f"Audio file {audio_path.name} is {size_mb:.1f}MB (> {max_size_mb}MB). Chunking...")
    
    chunk_dir = audio_path.parent / f"{audio_path.stem}_chunks"
    chunk_dir.mkdir(exist_ok=True)
    
    segment_time = 600  # 10 minutes per chunk
    out_pattern = chunk_dir / "chunk_%03d.mp3"
    
    cmd = [
        "ffmpeg", "-y",
        "-i", str(audio_path),
        "-f", "segment",
        "-segment_time", str(segment_time),
        "-c", "copy",  # No re-encoding, extremely fast
        str(out_pattern)
    ]
    
    try:
        subprocess.run(cmd, check=True, capture_output=True, text=True)
    except subprocess.CalledProcessError as e:
        logger.error(f"FFmpeg chunking failed: {e.stderr}")
        raise RuntimeError("Failed to chunk audio file for cloud transcription.")
        
    chunks = sorted(chunk_dir.glob("chunk_*.mp3"))
    if not chunks:
        raise RuntimeError("FFmpeg chunking produced no files.")
        
    logger.info(f"Chunked into {len(chunks)} parts.")
    
    result = []
    for i, chunk in enumerate(chunks):
        result.append((chunk, float(i * segment_time)))
        
    return result


# ─── Transcription ─────────────────────────────────────────────────────────────

def transcribe(audio_path: Path) -> Tuple[List[TranscriptSegment], List[TranscriptWord]]:
    """
    Transcribe audio using the Groq cloud Whisper API.

    Args:
        audio_path: Path to the audio file (MP3)

    Returns:
        Tuple of (segments, all_words) with word-level timestamps
    """
    logger.info(f"Starting Groq cloud transcription: {audio_path.name}")
    
    if not GROQ_API_KEY or GROQ_API_KEY == "your_groq_api_key_here":
        raise RuntimeError("GROQ_API_KEY is not set. Add it to your .env file.")
        
    client = OpenAI(base_url="https://api.groq.com/openai/v1", api_key=GROQ_API_KEY)
    
    chunks = chunk_audio_if_needed(audio_path, max_size_mb=24)
    
    segments: List[TranscriptSegment] = []
    all_words: List[TranscriptWord] = []
    
    try:
        for idx, (chunk_path, offset) in enumerate(chunks):
            logger.info(f"Processing chunk {idx+1}/{len(chunks)}: {chunk_path.name} (offset {offset}s)")
            
            with open(chunk_path, "rb") as f:
                transcription = client.audio.transcriptions.create(
                    file=(chunk_path.name, f.read()),
                    model=GROQ_WHISPER_MODEL,
                    response_format="verbose_json",
                    timestamp_granularities=["word", "segment"]
                )
                
            raw_segments = _get_val(transcription, "segments") or []
            raw_words = _get_val(transcription, "words") or []
            
            if not raw_words:
                logger.warning(f"No words found in chunk {idx+1}")
                continue
                
            # Map words to segments and apply the time offset
            if raw_segments:
                word_idx = 0
                for raw_seg in raw_segments:
                    seg_start = _get_val(raw_seg, 'start')
                    seg_end = _get_val(raw_seg, 'end')
                    seg_text = _get_val(raw_seg, 'text')
                    
                    seg_words = []
                    while word_idx < len(raw_words):
                        rw = raw_words[word_idx]
                        w_start = _get_val(rw, 'start')
                        w_end = _get_val(rw, 'end')
                        w_word = _get_val(rw, 'word')
                        
                        if w_start > seg_end + 1.0: # Margin for slight mismatches
                            break
                            
                        word_obj = TranscriptWord(
                            word=w_word.strip(),
                            start=round(w_start + offset, 3),
                            end=round(w_end + offset, 3),
                            probability=1.0
                        )
                        seg_words.append(word_obj)
                        all_words.append(word_obj)
                        word_idx += 1
                        
                    if seg_words:
                        segments.append(TranscriptSegment(
                            text=seg_text.strip(),
                            start=round(seg_start + offset, 3),
                            end=round(seg_end + offset, 3),
                            words=seg_words
                        ))
            else:
                # Fallback if API returns only words and no segments
                current_seg_words = []
                for rw in raw_words:
                    w_start = _get_val(rw, 'start')
                    w_end = _get_val(rw, 'end')
                    w_word = _get_val(rw, 'word')
                    
                    word_obj = TranscriptWord(
                        word=w_word.strip(),
                        start=round(w_start + offset, 3),
                        end=round(w_end + offset, 3),
                        probability=1.0
                    )
                    all_words.append(word_obj)
                    current_seg_words.append(word_obj)
                    
                    if len(current_seg_words) >= 15:
                        seg_text = " ".join([w.word for w in current_seg_words])
                        segments.append(TranscriptSegment(
                            text=seg_text,
                            start=current_seg_words[0].start,
                            end=current_seg_words[-1].end,
                            words=current_seg_words
                        ))
                        current_seg_words = []
                        
                if current_seg_words:
                    seg_text = " ".join([w.word for w in current_seg_words])
                    segments.append(TranscriptSegment(
                        text=seg_text,
                        start=current_seg_words[0].start,
                        end=current_seg_words[-1].end,
                        words=current_seg_words
                    ))
                    
    except Exception as e:
        logger.error(f"Groq transcription failed: {e}")
        raise RuntimeError(f"Groq transcription failed: {str(e)}")
        
    logger.info(f"Groq transcription complete: {len(segments)} segments, {len(all_words)} words.")
    return segments, all_words


# ─── Helpers ──────────────────────────────────────────────────────────────────


def _get_val(obj, key):
    """Helper to get a value from either an object or a dict (OpenAI API variability)."""
    if hasattr(obj, key):
        return getattr(obj, key)
    elif isinstance(obj, dict) and key in obj:
        return obj[key]
    return None


# ─── Transcript Formatting ────────────────────────────────────────────────────

def format_transcript_for_llm(segments: List[TranscriptSegment]) -> str:
    """
    Format transcript with timestamps for LLM consumption.
    Each line is: [MM:SS.mm -> MM:SS.mm] Segment text
    """
    lines = []
    for seg in segments:
        start_str = _format_timestamp(seg.start)
        end_str = _format_timestamp(seg.end)
        lines.append(f"[{start_str} -> {end_str}] {seg.text}")
    return "\n".join(lines)


def _format_timestamp(seconds: float) -> str:
    if seconds < 0: seconds = 0
    mins = int(seconds // 60)
    secs = seconds % 60
    return f"{mins:02d}:{secs:05.2f}"


def get_words_in_range(
    all_words: List[TranscriptWord],
    start_time: float,
    end_time: float,
    padding: float = 0.1,
) -> List[TranscriptWord]:
    """Get all words that fall within a time range."""
    return [
        w
        for w in all_words
        if w.start >= (start_time - padding) and w.end <= (end_time + padding)
    ]
