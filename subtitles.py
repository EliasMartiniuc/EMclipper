"""
AI Video Clipper — ASS Subtitle Generator

Generates Advanced SubStation Alpha (.ass) subtitle files with karaoke
word-by-word highlighting. Uses \\kf (karaoke fill) tags that create a
smooth left-to-right color sweep across each word — the same technique
used by OpusClip.

Word-level timestamps from faster-whisper are converted into karaoke
durations in centiseconds. Words are grouped into lines of N words each
for readability.
"""

import logging
from pathlib import Path
from typing import List

from schemas import TranscriptWord
from config import (
    SUBTITLE_FONT,
    SUBTITLE_FONTSIZE,
    SUBTITLE_PRIMARY_COLOR,
    SUBTITLE_SECONDARY_COLOR,
    SUBTITLE_OUTLINE_COLOR,
    SUBTITLE_BACK_COLOR,
    SUBTITLE_OUTLINE,
    SUBTITLE_SHADOW,
    SUBTITLE_MARGIN_V,
    SUBTITLE_WORDS_PER_LINE,
)

logger = logging.getLogger(__name__)


# ─── ASS File Template ────────────────────────────────────────────────────────

ASS_HEADER_TEMPLATE = """\
[Script Info]
Title: AI Clipper Subtitles
ScriptType: v4.00+
WrapStyle: 0
ScaledBorderAndShadow: yes
YCbCr Matrix: None
PlayResX: {play_res_x}
PlayResY: {play_res_y}

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,{font},{fontsize},{primary},{secondary},{outline_color},{back_color},-1,0,0,0,100,100,0,0,1,{outline},{shadow},2,30,30,{margin_v},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""


# ─── Public API ────────────────────────────────────────────────────────────────


def generate_ass(
    words: List[TranscriptWord],
    clip_start: float,
    clip_end: float,
    output_path: Path,
    video_width: int = 1080,
    video_height: int = 1920,
) -> Path:
    """
    Generate an ASS subtitle file with karaoke word-by-word highlighting.

    All timestamps are offset so that clip_start becomes 0:00:00.00 in the
    subtitle file. This is necessary because the rendered clip starts from
    time zero, not from the original video timestamp.

    Words are grouped into lines of SUBTITLE_WORDS_PER_LINE words. Each word
    receives a \\kf<duration> tag where duration is the word's speech time
    in centiseconds (1/100th second).

    Args:
        words: List of TranscriptWord from the full transcript
        clip_start: Clip start time in seconds (in original video time)
        clip_end: Clip end time in seconds (in original video time)
        output_path: Where to write the .ass file
        video_width: Output video width (for PlayResX)
        video_height: Output video height (for PlayResY)

    Returns:
        Path to the generated .ass file
    """
    output_path = Path(output_path)

    # ── Filter words to clip time range ──
    clip_words = _get_words_in_range(words, clip_start, clip_end)

    if not clip_words:
        logger.warning(
            f"No words found in clip range "
            f"[{clip_start:.2f}s - {clip_end:.2f}s]. "
            f"Generating empty subtitle file."
        )
        # Write a minimal ASS with no dialogue
        _write_ass_file(output_path, video_width, video_height, [])
        return output_path

    logger.info(
        f"Generating karaoke subtitles: "
        f"{len(clip_words)} words, "
        f"grouped into lines of {SUBTITLE_WORDS_PER_LINE}"
    )

    # ── Group words into lines ──
    word_groups = _group_words(clip_words, SUBTITLE_WORDS_PER_LINE)

    # ── Generate dialogue lines with karaoke tags ──
    dialogue_lines = []

    for group in word_groups:
        line = _build_karaoke_dialogue_line(group, clip_start)
        if line:
            dialogue_lines.append(line)

    # ── Write the ASS file ──
    _write_ass_file(output_path, video_width, video_height, dialogue_lines)

    logger.info(
        f"ASS subtitle file written: {output_path.name} "
        f"({len(dialogue_lines)} dialogue lines)"
    )

    return output_path


# ─── Internal Functions ────────────────────────────────────────────────────────


def _get_words_in_range(
    all_words: List[TranscriptWord],
    start: float,
    end: float,
    padding: float = 0.15,
) -> List[TranscriptWord]:
    """
    Extract words that fall within the clip time range.

    First tries exact range, then widens with padding if nothing found.
    """
    # Exact range
    in_range = [w for w in all_words if w.start >= start and w.end <= end]

    if in_range:
        return in_range

    # Wider range with padding
    in_range = [
        w
        for w in all_words
        if w.start >= (start - padding) and w.end <= (end + padding)
    ]

    if in_range:
        return in_range

    # Overlapping range (word partially in clip)
    in_range = [
        w for w in all_words if w.start < end and w.end > start
    ]

    return in_range


def _group_words(
    words: List[TranscriptWord], words_per_line: int
) -> List[List[TranscriptWord]]:
    """
    Group words into display lines.

    Groups by count but also respects natural pauses — if there's a gap
    of more than 0.8s between words, force a new line even if the current
    group isn't full yet.
    """
    groups: List[List[TranscriptWord]] = []
    current_group: List[TranscriptWord] = []
    PAUSE_THRESHOLD = 0.8  # seconds

    for i, word in enumerate(words):
        # Check for natural pause (gap between this word and the previous)
        if current_group and (word.start - current_group[-1].end) > PAUSE_THRESHOLD:
            groups.append(current_group)
            current_group = []

        current_group.append(word)

        # Group is full
        if len(current_group) >= words_per_line:
            groups.append(current_group)
            current_group = []

    # Don't forget the last group
    if current_group:
        groups.append(current_group)

    return groups


def _build_karaoke_dialogue_line(
    word_group: List[TranscriptWord], clip_start: float
) -> str | None:
    """
    Build a single ASS Dialogue line with karaoke fill tags.

    Each word gets: {\\kf<centiseconds>}WordText
    The \\kf tag creates a smooth color fill from SecondaryColour to
    PrimaryColour over the specified duration.

    Times are offset by clip_start so the subtitle starts at 0:00.
    """
    if not word_group:
        return None

    # Line timing (relative to clip start)
    line_start = word_group[0].start - clip_start
    line_end = word_group[-1].end - clip_start

    # Clamp to valid range
    line_start = max(0.0, line_start)
    line_end = max(line_start + 0.05, line_end)

    # Build karaoke text for each word
    karaoke_parts = []

    for word in word_group:
        # TikTok/Opus viral clips generally use all uppercase for captions
        clean_word = word.word.strip().upper()
        if not clean_word:
            continue

        # Calculate word duration in centiseconds (1/100th of a second)
        word_duration_s = word.end - word.start
        word_duration_cs = max(1, round(word_duration_s * 100))

        # The \\kf tag: fill-based karaoke
        # Duration in centiseconds = how long the fill animation takes for this word
        karaoke_parts.append(f"{{\\kf{word_duration_cs}}}{clean_word}")

    if not karaoke_parts:
        return None

    # Join words with spaces
    karaoke_text = " ".join(karaoke_parts)

    # Format ASS timestamps
    start_ts = _seconds_to_ass_timestamp(line_start)
    end_ts = _seconds_to_ass_timestamp(line_end)

    # ASS Dialogue line format:
    # Dialogue: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
    return f"Dialogue: 0,{start_ts},{end_ts},Default,,0,0,0,,{karaoke_text}"


def _seconds_to_ass_timestamp(seconds: float) -> str:
    """
    Convert seconds to ASS timestamp format: H:MM:SS.cc

    ASS uses centisecond precision (1/100th second), not milliseconds.
    Format: H:MM:SS.cc (single-digit hour, no leading zero on hours)
    """
    if seconds < 0:
        seconds = 0.0

    total_cs = round(seconds * 100)
    hours = total_cs // 360000
    remaining = total_cs % 360000
    minutes = remaining // 6000
    remaining = remaining % 6000
    secs = remaining // 100
    centiseconds = remaining % 100

    return f"{hours}:{minutes:02d}:{secs:02d}.{centiseconds:02d}"


def _write_ass_file(
    output_path: Path,
    video_width: int,
    video_height: int,
    dialogue_lines: List[str],
) -> None:
    """Write the complete ASS file to disk."""
    header = ASS_HEADER_TEMPLATE.format(
        play_res_x=video_width,
        play_res_y=video_height,
        font=SUBTITLE_FONT,
        fontsize=SUBTITLE_FONTSIZE,
        primary=SUBTITLE_PRIMARY_COLOR,
        secondary=SUBTITLE_SECONDARY_COLOR,
        outline_color=SUBTITLE_OUTLINE_COLOR,
        back_color=SUBTITLE_BACK_COLOR,
        outline=SUBTITLE_OUTLINE,
        shadow=SUBTITLE_SHADOW,
        margin_v=SUBTITLE_MARGIN_V,
    )

    content = header + "\n".join(dialogue_lines) + "\n"

    output_path.parent.mkdir(parents=True, exist_ok=True)
    # Write with UTF-8 BOM for maximum compatibility on Windows
    output_path.write_text(content, encoding="utf-8-sig")
