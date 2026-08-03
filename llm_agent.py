"""
AI Video Clipper — LLM Highlight Detection

Sends the transcript to DeepSeek to identify the most
engaging, viral-worthy moments for short-form clips.
"""

import json
import re
import time
import logging
from typing import List

from openai import OpenAI

from schemas import Highlight
from config import (
    DEEPSEEK_API_KEY,
    DEEPSEEK_MODEL,
    DEEPSEEK_BASE_URL,
    HIGHLIGHT_MIN_DURATION,
    HIGHLIGHT_MAX_DURATION,
    HIGHLIGHT_COUNT,
)

logger = logging.getLogger(__name__)


# ─── LLM Client Factory ───────────────────────────────────────────────────────


def get_llm_client() -> tuple:
    """
    Create the DeepSeek OpenAI-compatible client.

    Returns:
        Tuple of (client, model_name)
    """
    if not DEEPSEEK_API_KEY or DEEPSEEK_API_KEY == "your_deepseek_api_key_here":
        raise RuntimeError(
            "DEEPSEEK_API_KEY not set. Add it to your .env file."
        )
    client = OpenAI(
        api_key=DEEPSEEK_API_KEY,
        base_url=DEEPSEEK_BASE_URL,
    )
    logger.info(f"Using DeepSeek LLM: {DEEPSEEK_MODEL}")
    return client, DEEPSEEK_MODEL


# ─── System Prompt ─────────────────────────────────────────────────────────────

SYSTEM_PROMPT = f"""You are an expert viral video editor. Your job is to find the most engaging, shareable clips from a transcript for YouTube Shorts, TikTok, and Reels.

═══ THE #1 RULE (MOST IMPORTANT) ═══
Every clip MUST be a COMPLETE thought. The viewer must NEVER feel like the video was cut off.
- The clip must START at the BEGINNING of a topic, story, joke, or statement — NOT in the middle.
- The clip must END AFTER the punchline, conclusion, reaction, or natural pause — NEVER before it.
- If someone is telling a story, you MUST include the ENTIRE story from setup to payoff.
- If someone is making a point, you MUST include the full argument AND the conclusion.
- If someone asks a question, you MUST include the answer.
- If there is a joke, you MUST include the punchline AND any laughter/reaction after it.

═══ HOW TO SELECT TIMESTAMPS ═══
Follow this process for every clip:
1. FIND the engaging moment (the hook, joke, reveal, dramatic statement).
2. SCAN BACKWARDS to find where that topic/story BEGINS. Set start_time 2-3 seconds BEFORE that first sentence starts.
3. SCAN FORWARDS to find where that topic/story NATURALLY ENDS (punchline delivered, reaction complete, pause before next topic). Set end_time 2-3 seconds AFTER the last word of the conclusion.

PADDING IS CRITICAL:
- Always add ~2 seconds of buffer BEFORE the first word of the clip so it doesn't feel like it starts abruptly mid-conversation.
- Always add ~3 seconds of buffer AFTER the last word so the viewer has time to absorb what was said. Never cut immediately after the last word.

═══ WHAT MAKES A GREAT CLIP ═══
- Strong emotional hooks: surprise, humor, insight, controversy, or "wow" moments
- Self-contained: makes complete sense with ZERO outside context
- Strong opening: the first 3 seconds hook the viewer immediately
- Quotable or dramatic: clear statements, revelations, or reactions
- Complete emotional arc: setup → build → payoff

═══ DURATION RULES ═══
- Each clip MUST be between {HIGHLIGHT_MIN_DURATION} and {HIGHLIGHT_MAX_DURATION} seconds
- The sweet spot is around 30 seconds, but LONGER IS ALWAYS BETTER THAN CUTTING OFF A THOUGHT
- If a great moment needs 60 or 90 seconds to be complete, USE 60 or 90 seconds
- NEVER sacrifice completeness to hit a shorter duration
- Clips MUST NOT overlap with each other
- All times must be within the video duration

═══ COMMON MISTAKES TO AVOID ═══
- WRONG: Clip ends right as someone starts their punchline → viewer feels robbed
- WRONG: Clip starts mid-sentence, viewer is confused about context
- WRONG: Clip cuts off a story before the ending
- WRONG: Clip ends the exact millisecond the last word is spoken (no breathing room)
- RIGHT: Clip starts 2s before the topic begins, ends 3s after the conclusion

═══ RESPONSE FORMAT ═══
Respond with ONLY a valid JSON array. No markdown, no explanation, no text outside the JSON.

[
  {{
    "start_time": <seconds as float>,
    "end_time": <seconds as float>,
    "title": "<catchy 3-8 word title>",
    "score": <1-10 engagement score>,
    "reason": "<one sentence explaining why this is engaging>"
  }}
]"""


# ─── Main Detection Function ──────────────────────────────────────────────────


def detect_highlights(
    transcript_text: str, video_duration: float
) -> List[Highlight]:
    """
    Send transcript to LLM and get back highlight timestamps.

    Args:
        transcript_text: Formatted transcript with timestamps
        video_duration: Total video duration in seconds

    Returns:
        List of Highlight objects with validated, non-overlapping timestamps

    Raises:
        RuntimeError: If LLM call fails or no valid highlights are parsed
    """
    client, model = get_llm_client()

    # DeepSeek has a massive context window, so we can send large chunks.
    MAX_CHARS = 60000
    lines = transcript_text.split('\n')
    chunks = []
    current_chunk = []
    current_len = 0

    for line in lines:
        line_len = len(line) + 1  # +1 for newline
        if current_len + line_len > MAX_CHARS and current_chunk:
            chunks.append("\n".join(current_chunk))
            current_chunk = [line]
            current_len = line_len
        else:
            current_chunk.append(line)
            current_len += line_len
            
    if current_chunk:
        chunks.append("\n".join(current_chunk))

    all_highlights = []
    logger.info(f"Split transcript into {len(chunks)} chunks to respect token limits.")

    for i, chunk_text in enumerate(chunks):
        logger.info(f"Processing LLM chunk {i+1}/{len(chunks)} ({len(chunk_text)} chars)...")

        user_message = (
            f"Video Duration: {video_duration:.1f} seconds\n\n"
            f"TRANSCRIPT:\n{chunk_text}\n\n"
            f"Find all highly engaging, clip-worthy moments from this transcript. "
            f"CRITICAL REMINDER: Each clip must be a COMPLETE thought — include the full setup AND payoff. "
            f"Add 2-3 seconds of padding before and after the spoken content. "
            f"It is better to make a clip slightly longer than to cut off a thought. "
            f"Respond with ONLY a JSON array."
        )

        retries = 3
        while retries > 0:
            try:
                response = client.chat.completions.create(
                    model=model,
                    messages=[
                        {"role": "system", "content": SYSTEM_PROMPT},
                        {"role": "user", "content": user_message},
                    ],
                    temperature=0.3,
                    max_tokens=8000,
                )

                raw_response = response.choices[0].message.content
                chunk_highlights = _parse_highlights_json(raw_response, video_duration)
                
                if chunk_highlights:
                    all_highlights.extend(chunk_highlights)
                break

            except Exception as e:
                err_msg = str(e).lower()
                if "429" in err_msg or "rate limit" in err_msg:
                    logger.warning(f"Rate limit hit on chunk {i+1}. Sleeping 45 seconds before retry...")
                    time.sleep(45)
                    retries -= 1
                elif "413" in err_msg or "too large" in err_msg:
                    logger.error(f"Chunk {i+1} is STILL too large for the model! Skipping this chunk.")
                    break
                else:
                    logger.warning(f"LLM Error on chunk {i+1}: {e}. Retrying in 5s...")
                    time.sleep(5)
                    retries -= 1

    if not all_highlights:
        raise RuntimeError("Highlight detection failed: No valid highlights could be parsed from any LLM chunks.")

    # Sort all gathered highlights by score and take top N
    all_highlights.sort(key=lambda h: h.score, reverse=True)
    best_highlights = all_highlights

    # Re-sort chronologically for sequential processing
    best_highlights.sort(key=lambda h: h.start_time)

    logger.info(f"Final {len(best_highlights)} highlights selected across all chunks:")
    for i, h in enumerate(best_highlights):
        logger.info(
            f"  Highlight {i + 1}: "
            f"[{h.start_time:.1f}s - {h.end_time:.1f}s] "
            f'"{h.title}" (score: {h.score})'
        )

    return best_highlights


# ─── JSON Parsing with Fallbacks ───────────────────────────────────────────────


def _parse_highlights_json(
    raw: str, video_duration: float
) -> List[Highlight]:
    """
    Parse LLM response into Highlight objects with multiple fallback strategies.

    Handles common LLM output quirks:
    - Markdown code fences around JSON
    - Extra text before/after JSON
    - <think>...</think> reasoning blocks
    - Slightly malformed JSON
    """
    # Pre-processing: Strip thinking blocks
    cleaned = _strip_thinking_blocks(raw)

    # Strategy 1: Direct JSON parse
    result = _try_parse_json_array(cleaned.strip(), video_duration)
    if result:
        return result

    # Strategy 2: Extract from markdown code fences
    fence_pattern = r"```(?:json)?\s*\n?(.*?)\n?\s*```"
    for match in re.finditer(fence_pattern, cleaned, re.DOTALL):
        result = _try_parse_json_array(match.group(1).strip(), video_duration)
        if result:
            return result

    # Strategy 3: Find JSON array using bracket matching
    bracket_start = cleaned.find("[")
    bracket_end = cleaned.rfind("]")
    if bracket_start != -1 and bracket_end > bracket_start:
        candidate = cleaned[bracket_start : bracket_end + 1]
        result = _try_parse_json_array(candidate, video_duration)
        if result:
            return result

    # Strategy 4: Find individual JSON objects with start_time
    obj_pattern = r"\{[^{}]*?\"start_time\"\s*:\s*[\d.]+[^{}]*?\}"
    matches = re.findall(obj_pattern, cleaned, re.DOTALL)
    if matches:
        items = []
        for match in matches:
            try:
                obj = json.loads(match)
                items.append(obj)
            except json.JSONDecodeError:
                continue
        if items:
            return _validate_highlights(items, video_duration)

    # Strategy 5: Try fixing common JSON issues and re-parse
    fixed = _fix_common_json_issues(cleaned)
    result = _try_parse_json_array(fixed, video_duration)
    if result:
        return result

    # Log raw response for debugging
    from config import TEMP_DIR
    try:
        with open(TEMP_DIR / "llm_failure.log", "w", encoding="utf-8") as f:
            f.write(raw)
    except Exception:
        pass

    logger.error(
        f"All JSON parsing strategies failed. "
        f"Raw response saved to temp/llm_failure.log\n"
        f"Snippet:\n{raw[:1000]}"
    )
    return []


def _strip_thinking_blocks(text: str) -> str:
    """Remove <think>...</think> blocks from model responses."""
    # Remove complete thinking blocks
    cleaned = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL)
    # Remove unclosed thinking blocks (model cut off mid-think)
    cleaned = re.sub(r"<think>.*$", "", cleaned, flags=re.DOTALL)
    return cleaned.strip()


def _try_parse_json_array(
    text: str, video_duration: float
) -> List[Highlight] | None:
    """Try to parse text as a JSON array and validate it."""
    try:
        data = json.loads(text)
        if isinstance(data, list) and len(data) > 0:
            return _validate_highlights(data, video_duration)
    except json.JSONDecodeError:
        pass
    return None


def _fix_common_json_issues(text: str) -> str:
    """Fix common JSON formatting issues from LLMs."""
    # Remove trailing commas before ] or }
    text = re.sub(r",\s*([\]}])", r"\1", text)
    # Fix single quotes to double quotes
    text = text.replace("'", '"')
    # Remove any non-JSON text before the first [ and after the last ]
    start = text.find("[")
    end = text.rfind("]")
    if start != -1 and end > start:
        text = text[start : end + 1]
    elif start != -1 and end == -1:
        # Handle truncated JSON array: find last complete object and close array
        last_brace = text.rfind("}")
        if last_brace > start:
            text = text[start : last_brace + 1] + "]"
        else:
            # No complete object found, just close it to be safe
            text = text[start:] + "]"
    return text


# ─── Validation ────────────────────────────────────────────────────────────────


def _validate_highlights(
    items: list, video_duration: float
) -> List[Highlight]:
    """
    Validate and clean raw highlight data from LLM.

    - Ensures times are within video bounds
    - Enforces max duration constraint
    - Removes overlapping clips (keeps higher-scored ones)
    - Clamps scores to 1-10 range
    """
    highlights: List[Highlight] = []

    for item in items:
        try:
            # Extract fields with type coercion
            start = float(item.get("start_time", 0))
            end = float(item.get("end_time", 0))
            title = str(item.get("title", "Untitled Clip")).strip()
            score = float(item.get("score", 5))
            reason = str(item.get("reason", "")).strip()

            # ── Time validation ──
            # Clamp to video bounds
            start = max(0.0, start)
            end = min(video_duration, end)

            # Must have positive duration
            if end <= start:
                logger.warning(
                    f"Skipping clip '{title}': end ({end}) <= start ({start})"
                )
                continue

            duration = end - start

            # Warning if under minimum duration, but do NOT arbitrarily pad it
            # because padding blindly cuts into the middle of surrounding sentences!
            if duration < HIGHLIGHT_MIN_DURATION:
                logger.warning(
                    f"Clip '{title}' is {duration:.1f}s, which is slightly less than "
                    f"the requested minimum of {HIGHLIGHT_MIN_DURATION}s. Keeping original boundaries."
                )

            # Enforce maximum duration
            if duration > HIGHLIGHT_MAX_DURATION:
                end = start + HIGHLIGHT_MAX_DURATION
                logger.info(
                    f"Truncated clip '{title}' to {HIGHLIGHT_MAX_DURATION}s"
                )

            # ── Score validation ──
            score = max(1.0, min(10.0, score))

            # ── Title cleanup ──
            if not title or title == "Untitled Clip":
                title = f"Clip at {start:.0f}s"

            highlights.append(
                Highlight(
                    start_time=round(start, 2),
                    end_time=round(end, 2),
                    title=title,
                    score=score,
                    reason=reason,
                )
            )

        except (ValueError, TypeError, AttributeError) as e:
            logger.warning(f"Skipping invalid highlight item: {e} — data: {item}")
            continue

    # ── Remove overlapping clips ──
    # Sort by score descending, greedily keep non-overlapping
    highlights.sort(key=lambda h: h.score, reverse=True)
    non_overlapping: List[Highlight] = []

    for h in highlights:
        overlap = False
        for existing in non_overlapping:
            # Check if they overlap
            if h.start_time < existing.end_time and h.end_time > existing.start_time:
                overlap = True
                logger.info(
                    f"Removing overlapping clip '{h.title}' "
                    f"(conflicts with '{existing.title}')"
                )
                break
        if not overlap:
            non_overlapping.append(h)

    return non_overlapping
