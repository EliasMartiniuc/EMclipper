import { useRef, useState } from 'react';
import { MousePointer2, Scissors, Copy, ClipboardPaste, Trash2, PanelLeftClose, PanelRightClose, Film, Captions, Magnet } from 'lucide-react';
import { clamp, FRAME, moveSegment, timecode, trimSegment, updateCaption, videoSegments } from './timeline';

export default function TimelineCanvas({ timeline, clip, selection, setSelection, tool, setTool, seek, pause, actions }) {
  const { document: doc, duration, zoom, currentTime, edit, beginGesture, endGesture, cancelGesture } = timeline;
  const surface = useRef(null), drag = useRef(null), scroller = useRef(null);
  const [tooltip, setTooltip] = useState(null);
  const [snapping, setSnapping] = useState(true);
  const minSource = clip.source_video_url ? (clip.source_start ?? 0) : 0;
  const maxSource = clip.source_video_url ? (clip.source_end ?? minSource + clip.duration) : clip.duration;
  const tickStep = zoom >= 160 ? 0.25 : zoom >= 80 ? 0.5 : zoom >= 40 ? 1 : zoom >= 20 ? 2 : 5;
  const width = Math.max(700, duration * zoom + 100);
  const ticks = Array.from({ length: Math.ceil(width / zoom / tickStep) + 1 }, (_, i) => i * tickStep);
  const toTime = (e) => clamp((e.clientX - surface.current.getBoundingClientRect().left) / zoom, 0, duration);
  function snap(value, docBase, exclude) {
    if (!snapping) return value;
    const points = [0, currentTime, ...videoSegments(docBase).flatMap((s) => [s.startTime, s.startTime + s.duration]),
      ...docBase.subtitles.filter((s) => s.id !== exclude).flatMap((s) => [s.start, s.end])];
    return points.reduce((best, point) => Math.abs(value - point) < Math.abs(value - best) && Math.abs(value - point) < 7 / zoom ? point : best, value);
  }
  function startScrub(e) {
    if (e.button !== 0) return;
    pause();
    drag.current = { kind: 'scrub' };
    e.currentTarget.setPointerCapture(e.pointerId);
    seek(toTime(e));
  }
  function startEdit(e, kind, item, edge) {
    e.stopPropagation();
    if (e.button !== 0) return;
    pause();
    setSelection({ type: kind === 'video' ? 'video' : 'subtitle', id: item.id });
    if (tool === 'blade' && kind === 'video' && !edge) { actions.split(item.id, toTime(e)); return; }
    beginGesture();
    drag.current = { kind, item, edge, x: e.clientX, scroll: scroller.current.scrollLeft, base: doc };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function pointerMove(e) {
    const g = drag.current;
    if (!g) return;
    if (g.kind === 'scrub') { seek(toTime(e)); return; }
    const delta = (e.clientX - g.x + scroller.current.scrollLeft - g.scroll) / zoom;
    if (g.kind === 'video') {
      if (g.edge) {
        const raw = (g.edge === 'start' ? g.item.sourceStart : g.item.sourceEnd) + delta;
        const value = clamp(Math.round(raw / FRAME) * FRAME,
          g.edge === 'start' ? minSource : g.item.sourceStart + FRAME,
          g.edge === 'start' ? g.item.sourceEnd - FRAME : maxSource);
        edit(() => trimSegment(g.base, g.item.id, g.edge, value));
        setTooltip({ left: toTime(e) * zoom, text: `${g.edge === 'start' ? 'IN' : 'OUT'} ${timecode(value)}` });
      } else if (Math.abs(e.clientX - g.x) > 5) {
        const at = toTime(e);
        const before = videoSegments(g.base).filter((s) => s.id !== g.item.id).find((s) => at < s.startTime + s.duration / 2);
        edit(() => moveSegment(g.base, g.item.id, before?.id));
      }
    } else {
      let start = g.item.start, end = g.item.end;
      if (g.edge === 'start') start = clamp(snap(start + delta, g.base, g.item.id), 0, end - FRAME);
      else if (g.edge === 'end') end = clamp(snap(end + delta, g.base, g.item.id), start + FRAME, duration);
      else { start = clamp(snap(start + delta, g.base, g.item.id), 0, duration - (end - start)); end = start + g.item.end - g.item.start; }
      edit(() => updateCaption(g.base, g.item.id, { start, end }));
      setTooltip({ left: start * zoom, text: `${timecode(start)} → ${timecode(end)}` });
    }
    if (scroller.current) {
      const rect = scroller.current.getBoundingClientRect();
      if (e.clientX > rect.right - 35) scroller.current.scrollLeft += 12;
      if (e.clientX < rect.left + 35) scroller.current.scrollLeft -= 12;
    }
  }
  function finish(cancel = false) {
    if (drag.current && drag.current.kind !== 'scrub') { if (cancel) cancelGesture(); else endGesture(); }
    drag.current = null;
    setTooltip(null);
  }
  return <section className="ed-timeline" aria-label="Timeline editor">
    <div className="ed-timeline-toolbar">
      <div className="ed-tool-group">
        <button aria-label="Select tool" title="Select (V)" className={tool === 'select' ? 'active' : ''} onClick={() => setTool('select')}><MousePointer2 size={17} /></button>
        <button aria-label="Blade tool" title="Blade (C)" className={tool === 'blade' ? 'active' : ''} onClick={() => setTool('blade')}><Scissors size={17} /></button>
      </div><span className="ed-divider" />
      <button onClick={() => actions.split()} title="Split at playhead (C)"><Scissors size={15} /><span>Split</span></button>
      <button onClick={actions.copy} disabled={selection?.type !== 'video'} title="Copy segment (Ctrl+C)" aria-label="Copy segment"><Copy size={15} /></button>
      <button onClick={actions.paste} disabled={!actions.hasClipboard} title="Paste at playhead (Ctrl+V)" aria-label="Paste segment"><ClipboardPaste size={15} /></button>
      <span className="ed-divider" />
      <button onClick={() => actions.trim('start')} disabled={selection?.type !== 'video'} title="Trim start to playhead"><PanelLeftClose size={15} /><span>Trim in</span></button>
      <button onClick={() => actions.trim('end')} disabled={selection?.type !== 'video'} title="Trim end to playhead"><PanelRightClose size={15} /><span>Trim out</span></button>
      <button onClick={actions.remove} disabled={!selection} title="Delete selection (Delete)" aria-label="Delete selection"><Trash2 size={15} /></button>
      <div className="ed-toolbar-spacer" /><button aria-pressed={snapping} className={snapping ? 'active' : ''} onClick={() => setSnapping(!snapping)} title="Snap subtitle edges" aria-label="Toggle snapping"><Magnet size={15} /></button>
      <span className="ed-sequence-label">SEQUENCE 01 <span>{videoSegments(doc).length} segments</span></span>
    </div>
    <div className="ed-track-layout">
      <div className="ed-track-labels"><div className="ed-ruler-spacer">TRACKS</div><div><span className="ed-track-number">V1</span><Film size={15} /><span>Video</span></div><div><span className="ed-track-number subtitle">S1</span><Captions size={15} /><span>Captions</span></div></div>
      <div className="ed-timeline-scroll" ref={scroller}>
        <div ref={surface} className={`ed-timeline-surface ${tool === 'blade' ? 'blade' : ''}`} style={{ width }} onPointerDown={startScrub} onPointerMove={pointerMove} onPointerUp={() => finish()} onPointerCancel={() => finish(true)}>
          <div className="ed-ruler">{ticks.map((t, i) => <div className="ed-tick" key={i} style={{ left: t * zoom }}><span>{Number.isInteger(t) ? `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}` : `${(t % 60).toFixed(2)}`}</span></div>)}</div>
          <div className="ed-video-lane" style={{ backgroundSize: `${tickStep * zoom}px 100%` }}>
            {videoSegments(doc).map((s, i) => <div key={s.id} role="button" tabIndex={0} aria-label={`Video segment ${i + 1}, ${timecode(s.duration)}`} aria-pressed={selection?.id === s.id}
              className={`ed-segment ed-video-segment ${selection?.id === s.id ? 'selected' : ''}`} style={{ left: s.startTime * zoom, width: Math.max(3, s.duration * zoom) }}
              onFocus={() => setSelection({ type: 'video', id: s.id })} onPointerDown={(e) => startEdit(e, 'video', s)}>
              <span className="ed-trim-handle left" title="Drag to trim start" onPointerDown={(e) => startEdit(e, 'video', s, 'start')} />
              <span className="ed-segment-top"><Film size={13} /> {String(i + 1).padStart(2, '0')} · {doc.title}</span>
              <div className="ed-filmstrip" aria-hidden="true">{Array.from({ length: Math.min(60, Math.ceil(s.duration * zoom / 56)) }, (_, j) => <span key={j}><Film size={20} /></span>)}</div>
              <span className="ed-segment-duration">{timecode(s.duration)}</span><span className="ed-trim-handle right" title="Drag to trim end" onPointerDown={(e) => startEdit(e, 'video', s, 'end')} />
            </div>)}
          </div>
          <div className="ed-subtitle-lane" style={{ backgroundSize: `${tickStep * zoom}px 100%` }}>
            {doc.subtitles.map((s, i) => <div key={s.id} role="button" tabIndex={0} aria-label={`Subtitle ${i + 1}: ${s.text}`} aria-pressed={selection?.id === s.id}
              className={`ed-segment ed-caption-segment ${selection?.id === s.id ? 'selected' : ''}`} style={{ left: s.start * zoom, width: Math.max(4, (s.end - s.start) * zoom) }}
              onFocus={() => setSelection({ type: 'subtitle', id: s.id })} onPointerDown={(e) => startEdit(e, 'subtitle', s)}>
              <span className="ed-trim-handle left" onPointerDown={(e) => startEdit(e, 'subtitle', s, 'start')} /><Captions size={13} /><span>{s.text || '(empty)'}</span><span className="ed-trim-handle right" onPointerDown={(e) => startEdit(e, 'subtitle', s, 'end')} />
            </div>)}
          </div>
          <div className="ed-playhead" style={{ left: currentTime * zoom }}><span className="ed-playhead-head" /></div>
          {tooltip && <div className="ed-drag-tooltip" style={{ left: tooltip.left }}>{tooltip.text}</div>}
        </div>
      </div>
    </div>
    <div className="ed-timeline-footer"><span><span className="ed-live-dot" /> Ripple editing <span className="ed-muted">· Captions follow video edits</span></span><span><kbd>Space</kbd> play <kbd>←</kbd><kbd>→</kbd> frame <kbd>C</kbd> cut <kbd>V</kbd> select</span><span>30 FPS <span className="ed-muted">·</span> {timecode(duration)}</span></div>
  </section>;
}
