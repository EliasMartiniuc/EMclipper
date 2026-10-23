import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copySegment, durationOf, exportPayload, makeDocument, moveSegment, pasteSegment, removeSegment, splitSegment, trimSegment, updateCaption, videoSegments } from '../src/editor/timeline.js';
import { historyReducer } from '../src/editor/useTimelineState.js';

function fixture() {
  return makeDocument({ title: 'A story', duration: 10, source_video_url: '/source.mp4', source_start: 12.5, source_end: 22.5,
    subtitles: [{ word: 'Hello', start: 1, end: 2 }, { word: 'world', start: 3, end: 4 }, { word: 'again', start: 6, end: 7 }] });
}
function assertTimeline(doc) {
  let cursor = 0;
  for (const s of videoSegments(doc)) { assert.equal(s.startTime, cursor); assert.equal(s.duration, s.sourceEnd - s.sourceStart); cursor += s.duration; }
  for (const s of doc.subtitles) {
    assert.ok(s.start >= 0 && s.end > s.start && s.end <= cursor);
    assert.ok(s.words.every((w) => w.start >= s.start && w.end <= s.end));
  }
  assert.equal(doc.tracks[1].segments.length, doc.subtitles.length);
}
test('split preserves source time and is immutable', () => {
  const doc = fixture(), before = JSON.stringify(doc);
  const next = splitSegment(doc, videoSegments(doc)[0].id, 5);
  assert.equal(JSON.stringify(doc), before);
  assert.deepEqual(videoSegments(next).map((s) => [s.sourceStart, s.sourceEnd, s.startTime]), [[12.5, 17.5, 0], [17.5, 22.5, 5]]);
  assertTimeline(next);
  assert.equal(splitSegment(doc, videoSegments(doc)[0].id, 0), doc);
});
test('delete and reorder ripple the attached captions', () => {
  const original = fixture();
  const split = splitSegment(original, videoSegments(original)[0].id, 5);
  const [a, b] = videoSegments(split);
  const removed = removeSegment(split, a.id);
  assert.equal(durationOf(removed), 5);
  assert.equal(removed.subtitles.find((s) => s.text === 'again').start, 1);
  const moved = moveSegment(split, b.id, a.id);
  assert.equal(moved.subtitles.find((s) => s.text === 'again').start, 1);
  assert.equal(moved.subtitles.find((s) => s.text === 'Hello').start, 6);
  assertTimeline(removed); assertTimeline(moved);
});
test('trim clips words and extending a trim does not borrow adjacent captions', () => {
  let doc = fixture();
  doc = splitSegment(doc, videoSegments(doc)[0].id, 5);
  const second = videoSegments(doc)[1];
  const next = trimSegment(doc, second.id, 'start', 13.5);
  assert.equal(next.subtitles.filter((s) => s.text === 'Hello').length, 1);
  assertTimeline(next);
  const original = fixture();
  const trimmed = trimSegment(original, videoSegments(original)[0].id, 'start', 14);
  assert.equal(trimmed.subtitles[0].start, 0);
  assert.equal(trimmed.subtitles[0].end, 0.5);
  assertTimeline(trimmed);
});
test('paste at playhead splits the destination and duplicates its captions', () => {
  const doc = fixture(), clipboard = copySegment(doc, videoSegments(doc)[0].id);
  const next = pasteSegment(doc, clipboard, 5);
  assert.equal(durationOf(next), 20);
  assert.deepEqual(videoSegments(next).map((s) => s.duration), [5, 10, 5]);
  assert.equal(next.subtitles.find((s) => s.text === 'again' && s.start < 15).start, 11);
  assertTimeline(next);
  const empty = removeSegment(doc, videoSegments(doc)[0].id);
  assert.equal(durationOf(pasteSegment(empty, clipboard, 0)), 10);
});
test('editing a misheard word preserves timestamps; timing edits scale them', () => {
  const doc = fixture(), caption = doc.subtitles[0];
  const edited = updateCaption(doc, caption.id, { text: 'Goodbye' });
  assert.equal(edited.subtitles[0].words[0].start, caption.words[0].start);
  const timed = updateCaption(edited, caption.id, { start: 2, end: 4 });
  assert.equal(timed.subtitles[0].words[0].start, 2);
  assert.equal(timed.subtitles[0].words[0].end, 4);
});
test('gesture history is one undo step; redo and edit invalidate future', () => {
  const doc = fixture();
  let history = { present: doc, past: [], future: [], gesture: null };
  history = historyReducer(history, { type: 'begin' });
  for (const title of ['a', 'ab', 'abc']) history = historyReducer(history, { type: 'edit', update: (d) => ({ ...d, title }) });
  history = historyReducer(history, { type: 'end' });
  assert.equal(history.past.length, 1);
  history = historyReducer(history, { type: 'undo' });
  assert.equal(history.present.title, doc.title);
  history = historyReducer(history, { type: 'redo' });
  assert.equal(history.present.title, 'abc');
  history = historyReducer(history, { type: 'undo' });
  history = historyReducer(history, { type: 'edit', update: (d) => ({ ...d, title: 'new' }), now: 100 });
  assert.equal(history.future.length, 0);
});
test('export uses ordered source ranges and converts RGB to ASS BGR', () => {
  const payload = exportPayload(fixture());
  assert.deepEqual(payload.segments, [{ source_start: 12.5, source_end: 22.5 }]);
  assert.equal(payload.style.primary_color, '&H0000FFFF');
});
