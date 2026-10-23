// All edit operations are pure. Video is a contiguous, ripple-edited sequence;
// caption times always refer to the output sequence, source times to the media.
export const FPS = 30;
export const FRAME = 1 / FPS;
export const uid = () => crypto.randomUUID();
export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
export const defaultStyle = {
  font: 'Roboto', font_size: 58, primary_color: '#ffff00',
  secondary_color: '#ffffff', outline_color: '#000000',
  outline: 4, shadow: 2, position: 72,
};
export const videoSegments = (doc) => doc.tracks[0].segments;
export const durationOf = (doc) => videoSegments(doc).reduce((sum, s) => sum + s.duration, 0);
export const segmentAt = (doc, time) => videoSegments(doc).find((s) =>
  time >= s.startTime - 0.00001 && time < s.startTime + s.duration - 0.00001);
export function timecode(seconds = 0) {
  const ms = Math.round(Math.max(0, seconds) * 1000);
  return `${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
}
export function normalize(doc) {
  let cursor = 0;
  const segments = videoSegments(doc).map((s) => {
    const duration = s.sourceEnd - s.sourceStart;
    const next = { ...s, duration, startTime: cursor };
    cursor += duration;
    return next;
  });
  const subtitles = doc.subtitles.filter((s) => s.end > s.start && s.start < cursor)
    .map((s) => ({ ...s, end: Math.min(s.end, cursor) })).sort((a, b) => a.start - b.start);
  return { ...doc, subtitles, tracks: [
    { id: 'video', type: 'video', segments },
    { id: 'subtitles', type: 'subtitle', segments: subtitles.map((s) => ({
      id: s.id, startTime: s.start, duration: s.end - s.start, text: s.text,
    })) },
  ] };
}
export function retimeWords(text, start, end) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return words.map((word, i) => ({ word, start: start + (end - start) * i / words.length,
    end: start + (end - start) * (i + 1) / words.length }));
}
export function makeDocument(clip) {
  if (clip.editor_draft?.version === 1) return normalize(clip.editor_draft.document);
  const sourceStart = clip.source_video_url ? (clip.source_start ?? 0) : 0;
  const sourceEnd = clip.source_video_url ? (clip.source_end ?? sourceStart + clip.duration) : clip.duration;
  let subtitles = clip.subtitles ?? [];
  if (subtitles[0]?.word !== undefined) {
    const groups = [];
    subtitles.forEach((word) => {
      if (!groups.length || groups.at(-1).length >= 4 || word.start - groups.at(-1).at(-1).end > 0.8) groups.push([]);
      groups.at(-1).push(word);
    });
    subtitles = groups.map((words) => ({ id: uid(), text: words.map((w) => w.word).join(' '),
      start: words[0].start, end: words.at(-1).end, words }));
  }
  return normalize({ title: clip.title || 'Untitled clip', style: { ...defaultStyle, ...clip.subtitle_style },
    tracks: [{ id: 'video', type: 'video', segments: [{ id: uid(), sourceStart, sourceEnd,
      duration: sourceEnd - sourceStart, startTime: 0 }] }],
    subtitles: subtitles.map((s) => ({ ...s, id: s.id || uid(), words: s.words ?? retimeWords(s.text, s.start, s.end) })),
  });
}
function sliceCaptions(subtitles, start, end, destination) {
  return subtitles.filter((s) => s.start < end && s.end > start).map((s) => {
    const words = (s.words ?? []).filter((w) => w.start < end && w.end > start).map((w) => ({
      ...w, start: Math.max(start, w.start) - start + destination,
      end: Math.min(end, w.end) - start + destination,
    }));
    const clipped = s.start < start - 0.00001 || s.end > end + 0.00001;
    return { ...s, id: uid(), start: Math.max(start, s.start) - start + destination,
      end: Math.min(end, s.end) - start + destination,
      text: clipped && words.length ? words.map((w) => w.word).join(' ') : s.text, words };
  });
}
// Each piece records its old interval, allowing captions to follow any splice.
function rebuild(doc, pieces) {
  let cursor = 0;
  const subtitles = [];
  const segments = pieces.map(({ segment, fromStart, fromEnd, captions }) => {
    subtitles.push(...sliceCaptions(captions ?? doc.subtitles, fromStart, fromEnd, cursor));
    const next = { ...segment, startTime: cursor };
    cursor += segment.sourceEnd - segment.sourceStart;
    return next;
  });
  return normalize({ ...doc, subtitles, tracks: [{ ...doc.tracks[0], segments }] });
}
const piece = (s) => ({ segment: s, fromStart: s.startTime, fromEnd: s.startTime + s.duration });
export function splitSegment(doc, id, time) {
  const s = videoSegments(doc).find((v) => v.id === id);
  if (!s || time - s.startTime < FRAME || s.startTime + s.duration - time < FRAME) return doc;
  const cut = s.sourceStart + time - s.startTime;
  return rebuild(doc, videoSegments(doc).flatMap((v) => v.id !== id ? [piece(v)] : [
    { segment: { ...s, sourceEnd: cut }, fromStart: s.startTime, fromEnd: time },
    { segment: { ...s, id: uid(), sourceStart: cut }, fromStart: time, fromEnd: s.startTime + s.duration },
  ]));
}
export function trimSegment(doc, id, edge, sourceTime) {
  const target = videoSegments(doc).find((s) => s.id === id);
  if (!target || Math.abs((edge === 'start' ? target.sourceStart : target.sourceEnd) - sourceTime) < 0.00001) return doc;
  return rebuild(doc, videoSegments(doc).map((s) => {
    if (s.id !== id) return piece(s);
    const sourceStart = edge === 'start' ? Math.min(sourceTime, s.sourceEnd - FRAME) : s.sourceStart;
    const sourceEnd = edge === 'end' ? Math.max(sourceTime, s.sourceStart + FRAME) : s.sourceEnd;
    return { segment: { ...s, sourceStart, sourceEnd },
      fromStart: s.startTime + sourceStart - s.sourceStart,
      fromEnd: s.startTime + sourceEnd - s.sourceStart,
      captions: sliceCaptions(doc.subtitles, s.startTime, s.startTime + s.duration, s.startTime) };
  }));
}
export function removeSegment(doc, id) {
  if (!videoSegments(doc).some((s) => s.id === id)) return doc;
  return rebuild(doc, videoSegments(doc).filter((s) => s.id !== id).map(piece));
}
export function moveSegment(doc, id, beforeId) {
  if (id === beforeId) return doc;
  const list = videoSegments(doc);
  const moved = list.find((s) => s.id === id);
  if (!moved) return doc;
  const rest = list.filter((s) => s.id !== id);
  const index = beforeId ? rest.findIndex((s) => s.id === beforeId) : rest.length;
  rest.splice(index < 0 ? rest.length : index, 0, moved);
  if (rest.every((s, i) => s.id === list[i].id)) return doc;
  return rebuild(doc, rest.map(piece));
}
export function copySegment(doc, id) {
  const s = videoSegments(doc).find((v) => v.id === id);
  return s ? { segment: { ...s }, subtitles: sliceCaptions(doc.subtitles, s.startTime, s.startTime + s.duration, 0) } : null;
}
export function pasteSegment(doc, clipboard, time) {
  if (!clipboard) return doc;
  const insertion = { segment: { ...clipboard.segment, id: uid() }, fromStart: 0,
    fromEnd: clipboard.segment.duration, captions: clipboard.subtitles };
  const pieces = [];
  let inserted = false;
  for (const s of videoSegments(doc)) {
    if (!inserted && time <= s.startTime + 0.00001) { pieces.push(insertion); inserted = true; }
    if (!inserted && time < s.startTime + s.duration - 0.00001) {
      const cut = s.sourceStart + time - s.startTime;
      pieces.push({ segment: { ...s, sourceEnd: cut }, fromStart: s.startTime, fromEnd: time }, insertion,
        { segment: { ...s, id: uid(), sourceStart: cut }, fromStart: time, fromEnd: s.startTime + s.duration });
      inserted = true;
    } else pieces.push(piece(s));
  }
  if (!inserted) pieces.push(insertion);
  return rebuild(doc, pieces);
}
export function updateCaption(doc, id, changes) {
  return normalize({ ...doc, subtitles: doc.subtitles.map((s) => {
    if (s.id !== id) return s;
    const next = { ...s, ...changes };
    if (changes.text !== undefined) {
      const tokens = next.text.trim().split(/\s+/).filter(Boolean);
      next.words = tokens.length === s.words.length ? s.words.map((w, i) => ({ ...w, word: tokens[i] })) : retimeWords(next.text, next.start, next.end);
    }
    else if (changes.start !== undefined || changes.end !== undefined) {
      next.words = s.words.map((w) => ({ ...w,
        start: next.start + (w.start - s.start) / (s.end - s.start) * (next.end - next.start),
        end: next.start + (w.end - s.start) / (s.end - s.start) * (next.end - next.start) }));
    }
    return next;
  }) });
}
export function mergeCaption(doc, id) {
  const i = doc.subtitles.findIndex((s) => s.id === id);
  if (i < 0 || i === doc.subtitles.length - 1) return doc;
  const a = doc.subtitles[i], b = doc.subtitles[i + 1];
  return normalize({ ...doc, subtitles: doc.subtitles.filter((s) => s.id !== b.id).map((s) => s.id !== id ? s : {
    ...a, text: `${a.text} ${b.text}`, end: Math.max(a.end, b.end), words: [...a.words, ...b.words] }) });
}
export function toAssColor(hex) {
  return `&H00${hex.slice(5, 7)}${hex.slice(3, 5)}${hex.slice(1, 3)}`.toUpperCase();
}
export function exportPayload(doc) {
  return { title: doc.title, segments: videoSegments(doc).map((s) => ({ source_start: s.sourceStart, source_end: s.sourceEnd })),
    subtitles: doc.subtitles.map(({ text, start, end, words }) => ({ text, start, end, words })),
    style: { ...doc.style, ...Object.fromEntries(['primary_color', 'secondary_color', 'outline_color'].map((key) => [key, toAssColor(doc.style[key])])) } };
}
