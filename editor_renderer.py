"""Render an ordered edit decision list from a clean source, then burn captions.

Trim and concatenate in one filter graph so intermediate AAC encoder padding
cannot accumulate and push captions out of sync at segment boundaries.
"""
import json
import logging
import subprocess
from pathlib import Path

from editor_schemas import Caption, RenderRequest, SubtitleStyle
from renderer import _escape_ffmpeg_path
from subtitles import _seconds_to_ass_timestamp
from config import BASE_DIR
from editor_fonts import resolve_font

logger = logging.getLogger(__name__)


def run_ffmpeg(command, timeout=900):
    try:
        result = subprocess.run(command, capture_output=True, timeout=timeout, check=False)
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError("Rendering exceeded its time limit") from exc
    if result.returncode:
        logger.error("FFmpeg failed: %s", result.stderr.decode(errors="replace")[-3000:])
        raise RuntimeError("The video could not be rendered")


def probe_media(source: Path) -> dict:
    result = subprocess.run(["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(source)],
                            capture_output=True, timeout=30, check=True)
    info = json.loads(result.stdout)
    if not any(s["codec_type"] == "video" for s in info["streams"]):
        raise ValueError("The source does not contain video")
    return {"duration": float(info["format"]["duration"]),
            "audio": any(s["codec_type"] == "audio" for s in info["streams"])}


def ass_color(value: str) -> str:
    if value.startswith("&H"):
        return value
    return f"&H00{value[5:7]}{value[3:5]}{value[1:3]}".upper()


def safe_text(value: str) -> str:
    # User text cannot inject ASS override commands or extra dialogue lines.
    return value.replace("\\", "").replace("{", "").replace("}", "").replace("\r", " ").replace("\n", " ")


def write_editor_ass(path: Path, captions: list[Caption], style: SubtitleStyle):
    family, _ = resolve_font(style.font)
    header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,{family},{style.font_size},{ass_color(style.primary_color)},{ass_color(style.secondary_color)},{ass_color(style.outline_color)},&H80000000,-1,0,0,0,100,100,0,0,1,{style.outline},{style.shadow},5,54,54,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    dialogues = []
    for caption in captions:
        if not caption.text.strip():
            continue
        position = f"{{\\pos(540,{1920 * style.position / 100:.2f})}}"
        if caption.words:
            # Render at absolute onset boundaries rather than accumulating word
            # durations. Whisper overlaps/backward onsets must not delay later
            # highlights; the preview also highlights each word by its own start.
            boundaries = sorted({caption.start, caption.end, *(max(caption.start, min(caption.end, w.start)) for w in caption.words)})
            for start, end in zip(boundaries, boundaries[1:]):
                start_ts, end_ts = _seconds_to_ass_timestamp(start), _seconds_to_ass_timestamp(end)
                if start_ts == end_ts:
                    continue
                text = " ".join(
                    f"{{\\c&H{ass_color(style.primary_color if w.start <= start + 1e-9 else style.secondary_color)[4:]}&}}{safe_text(w.word)}"
                    for w in caption.words
                )
                dialogues.append(f"Dialogue: 0,{start_ts},{end_ts},Default,,0,0,0,,{position}{text}")
        else:
            text = safe_text(caption.text)
            dialogues.append(f"Dialogue: 0,{_seconds_to_ass_timestamp(caption.start)},{_seconds_to_ass_timestamp(caption.end)},Default,,0,0,0,,{position}{text}")
    path.write_text(header + "\n".join(dialogues) + "\n", encoding="utf-8-sig")


def render_edit(source: Path, payload: RenderRequest, output: Path, workspace: Path, watermark=False, progress=None):
    info = probe_media(source)
    if any(s.source_end > info["duration"] + 0.05 for s in payload.segments):
        raise ValueError("A segment exceeds the source duration")
    command = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-filter_complex_threads", "1"]
    graph, concat_inputs = [], []
    total = sum(s.source_end - s.source_start for s in payload.segments)
    for i, segment in enumerate(payload.segments):
        length = segment.source_end - segment.source_start
        command += ["-threads", "1", "-ss", f"{segment.source_start:.6f}", "-t", f"{length:.6f}", "-i", str(source)]
        graph.append(f"[{i}:v:0]trim=duration={length:.6f},setpts=PTS-STARTPTS,setsar=1[v{i}]")
        concat_inputs.append(f"[v{i}]")
        if info["audio"]:
            graph.append(f"[{i}:a:0]asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,apad=whole_dur={length:.6f},atrim=duration={length:.6f}[a{i}]")
            concat_inputs.append(f"[a{i}]")
    if info["audio"]:
        graph.append(f"{''.join(concat_inputs)}concat=n={len(payload.segments)}:v=1:a=1[vcat][acat]")
        audio_map = "[acat]"
    else:
        command += ["-f", "lavfi", "-t", str(total), "-i", "anullsrc=r=48000:cl=stereo"]
        graph.append(f"{''.join(concat_inputs)}concat=n={len(payload.segments)}:v=1:a=0[vcat]")
        audio_map = f"{len(payload.segments)}:a:0"
    ass = workspace / "captions.ass"
    write_editor_ass(ass, payload.subtitles, payload.style)
    filters = ["scale=1080:1920:force_original_aspect_ratio=decrease", "pad=1080:1920:(ow-iw)/2:(oh-ih)/2", "fps=30",
               f"ass='{_escape_ffmpeg_path(str(ass))}':fontsdir='{_escape_ffmpeg_path(str(BASE_DIR))}'"]
    if watermark:
        font = _escape_ffmpeg_path(str(BASE_DIR / 'font.ttf'))
        filters.append(f"drawtext=fontfile='{font}':text='EMclipper.com':fontcolor=white@0.9:fontsize=28:x=24:y=24:borderw=2:bordercolor=black@0.8")
    output.parent.mkdir(parents=True, exist_ok=True)
    graph.append(f"[vcat]{','.join(filters)}[outv]")
    if progress:
        progress(10)
    command += ["-filter_complex", ";".join(graph), "-map", "[outv]", "-map", audio_map, "-t", f"{total:.6f}",
                "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-threads", "1", "-pix_fmt", "yuv420p",
                "-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-ac", "2", "-movflags", "+faststart", str(output)]
    run_ffmpeg(command, timeout=min(3600, max(300, total * 10)))
    if not output.exists() or not output.stat().st_size:
        raise RuntimeError("Rendering produced no video")
    return output
