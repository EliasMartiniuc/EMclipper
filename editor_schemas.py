"""Validated contracts shared by draft persistence and the render worker."""
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator


class EditorModel(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False, extra="forbid")


class SourceSegment(EditorModel):
    source_start: float = Field(ge=0)
    source_end: float = Field(gt=0)

    @model_validator(mode="after")
    def ordered(self):
        if self.source_end - self.source_start < 0.001:
            raise ValueError("A segment must have a positive duration")
        return self


class CaptionWord(EditorModel):
    word: str = Field(max_length=500)
    start: float = Field(ge=0)
    end: float = Field(gt=0)

    @model_validator(mode="after")
    def ordered(self):
        if self.end <= self.start:
            raise ValueError("Word end must follow start")
        return self


class Caption(EditorModel):
    id: str | None = Field(default=None, max_length=100)
    text: str = Field(max_length=500)
    start: float = Field(ge=0)
    end: float = Field(gt=0)
    words: list[CaptionWord] = Field(default_factory=list, max_length=200)

    @model_validator(mode="after")
    def validate_words(self):
        if self.end <= self.start:
            raise ValueError("Caption end must follow start")
        for word in self.words:
            # Whisper may return overlapping words and slightly reversed onsets.
            # These are valid recognition results; each word still needs to fit.
            if word.start < self.start - 0.001 or word.end > self.end + 0.001:
                raise ValueError("Words must be inside their caption")
        if self.words and " ".join(self.text.split()) != " ".join(w.word for w in self.words):
            raise ValueError("Caption text must match its words")
        return self


class SubtitleStyle(EditorModel):
    font: Literal["Roboto", "Arial", "Liberation Sans"] = "Roboto"
    font_size: int = Field(default=58, ge=24, le=120)
    primary_color: str = Field(default="&H0000FFFF", pattern=r"^(#[0-9A-Fa-f]{6}|&H[0-9A-Fa-f]{8})$")
    secondary_color: str = Field(default="&H00FFFFFF", pattern=r"^(#[0-9A-Fa-f]{6}|&H[0-9A-Fa-f]{8})$")
    outline_color: str = Field(default="&H00000000", pattern=r"^(#[0-9A-Fa-f]{6}|&H[0-9A-Fa-f]{8})$")
    outline: float = Field(default=4, ge=0, le=10)
    shadow: float = Field(default=2, ge=0, le=10)
    position: float = Field(default=72, ge=10, le=90)


class RenderRequest(EditorModel):
    title: str | None = Field(default=None, max_length=200)
    segments: list[SourceSegment] = Field(min_length=1, max_length=128)
    subtitles: list[Caption] = Field(default_factory=list, max_length=2000)
    style: SubtitleStyle = Field(default_factory=SubtitleStyle)

    @model_validator(mode="after")
    def timeline_bounds(self):
        duration = sum(s.source_end - s.source_start for s in self.segments)
        if duration > 1800:
            raise ValueError("An edited clip cannot exceed 30 minutes")
        if any(s.end > duration + 0.001 for s in self.subtitles):
            raise ValueError("Captions must fit inside the output timeline")
        return self


class PreviewStyle(SubtitleStyle):
    primary_color: str = Field(default="#ffff00", pattern=r"^#[0-9A-Fa-f]{6}$")
    secondary_color: str = Field(default="#ffffff", pattern=r"^#[0-9A-Fa-f]{6}$")
    outline_color: str = Field(default="#000000", pattern=r"^#[0-9A-Fa-f]{6}$")


class VideoSegment(EditorModel):
    id: str = Field(max_length=100)
    startTime: float = Field(ge=0)
    duration: float = Field(gt=0)
    sourceStart: float = Field(ge=0)
    sourceEnd: float = Field(gt=0)


class SubtitleSegment(EditorModel):
    id: str = Field(max_length=100)
    startTime: float = Field(ge=0)
    duration: float = Field(gt=0)
    text: str = Field(max_length=500)


class VideoTrack(EditorModel):
    id: Literal["video"]
    type: Literal["video"]
    segments: list[VideoSegment] = Field(max_length=128)


class SubtitleTrack(EditorModel):
    id: Literal["subtitles"]
    type: Literal["subtitle"]
    segments: list[SubtitleSegment] = Field(max_length=2000)


class EditorDocument(EditorModel):
    title: str = Field(max_length=200)
    style: PreviewStyle
    tracks: tuple[VideoTrack, SubtitleTrack]
    subtitles: list[Caption] = Field(max_length=2000)

    @model_validator(mode="after")
    def valid_timeline(self):
        cursor = 0.0
        ids = []
        for segment in self.tracks[0].segments:
            length = segment.sourceEnd - segment.sourceStart
            if length < 0.001 or abs(length - segment.duration) > 0.001 or abs(cursor - segment.startTime) > 0.001:
                raise ValueError("Video segments must form a contiguous sequence")
            cursor += length
            ids.append(segment.id)
        if cursor > 1800 or any(s.end > cursor + 0.001 for s in self.subtitles):
            raise ValueError("Invalid timeline duration")
        ids.extend(s.id for s in self.subtitles)
        if None in ids or len(ids) != len(set(ids)):
            raise ValueError("Timeline IDs must be unique")
        return self


class DraftRequest(EditorModel):
    version: Literal[1]
    savedAt: int = Field(ge=0)
    document: EditorDocument
