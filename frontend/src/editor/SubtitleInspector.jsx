import { useState } from 'react';
import { Captions, SlidersHorizontal, Plus, Trash2, Combine } from 'lucide-react';
import { clamp, FRAME, mergeCaption, normalize, retimeWords, timecode, uid, updateCaption } from './timeline';

export default function SubtitleInspector({ timeline, selection, setSelection, seek }) {
  const [tab, setTab] = useState('subtitles');
  const { document: doc, edit, duration, currentTime } = timeline;
  function style(key, value) { edit((d) => ({ ...d, style: { ...d.style, [key]: value } }), `style-${key}`); }
  function add() {
    if (!duration) return;
    const start = Math.min(currentTime, Math.max(0, duration - 1));
    const end = Math.min(duration, start + 2);
    const id = uid(), text = 'New caption';
    edit((d) => normalize({ ...d, subtitles: [...d.subtitles, { id, text, start, end, words: retimeWords(text, start, end) }] }));
    setSelection({ type: 'subtitle', id });
  }
  return <aside className="ed-inspector">
    <div className="ed-inspector-tabs" role="tablist" aria-label="Inspector">
      <button role="tab" aria-selected={tab === 'subtitles'} className={tab === 'subtitles' ? 'active' : ''} onClick={() => setTab('subtitles')}><Captions size={16} /> Subtitles <span>{doc.subtitles.length}</span></button>
      <button role="tab" aria-selected={tab === 'style'} className={tab === 'style' ? 'active' : ''} onClick={() => setTab('style')}><SlidersHorizontal size={15} /> Styling</button>
    </div>
    {tab === 'subtitles' ? <div className="ed-inspector-content" role="tabpanel" aria-label="Subtitles">
      <div className="ed-caption-heading"><div><h3>Make every word count</h3><p>Edit a line. Click a word to seek.</p></div><button className="ed-icon" title="Add caption" aria-label="Add caption" disabled={!duration} onClick={add}><Plus size={17} /></button></div>
      {!doc.subtitles.length && <div className="ed-empty"><Captions size={30} /><h3>Your words, your way</h3><p>Add a caption at the playhead to get started.</p><button className="ed-secondary" onClick={add} disabled={!duration}><Plus size={15} /> Add caption</button></div>}
      {doc.subtitles.map((s, index) => <div key={s.id} className={`ed-caption-card ${selection?.id === s.id ? 'selected' : ''} ${currentTime >= s.start && currentTime < s.end ? 'speaking' : ''}`}>
        <div className="ed-caption-meta"><button className="ed-caption-index" onClick={() => { seek(s.start); setSelection({ type: 'subtitle', id: s.id }); }}>{String(index + 1).padStart(2, '0')}</button>
          <span>{timecode(s.start)} <span className="ed-muted">→</span> {timecode(s.end)}</span>
          <button aria-label={`Merge caption ${index + 1} with next`} title="Merge with next line" disabled={index === doc.subtitles.length - 1} onClick={() => edit((d) => mergeCaption(d, s.id))}><Combine size={13} /></button>
          <button aria-label={`Delete caption ${index + 1}`} title="Delete caption" onClick={() => edit((d) => normalize({ ...d, subtitles: d.subtitles.filter((v) => v.id !== s.id) }))}><Trash2 size={13} /></button>
        </div>
        <textarea aria-label={`Caption ${index + 1} text`} rows={2} value={s.text} maxLength={500}
          onFocus={() => setSelection({ type: 'subtitle', id: s.id })}
          onChange={(e) => edit((d) => updateCaption(d, s.id, { text: e.target.value }), `text-${s.id}`)} />
        <div className="ed-word-list">{s.words.map((w, i) => <button key={i} className={currentTime >= w.start && currentTime < w.end ? 'active' : ''} title={timecode(w.start)} onClick={() => seek(w.start)}>{w.word}</button>)}</div>
        <div className="ed-caption-timing">
          <label>IN <input type="number" aria-label={`Caption ${index + 1} start`} min="0" max={s.end - FRAME} step="0.01" value={Number(s.start.toFixed(3))} onChange={(e) => edit((d) => updateCaption(d, s.id, { start: clamp(Number(e.target.value), 0, s.end - FRAME) }), `start-${s.id}`)} /></label>
          <label>OUT <input type="number" aria-label={`Caption ${index + 1} end`} min={s.start + FRAME} max={duration} step="0.01" value={Number(s.end.toFixed(3))} onChange={(e) => edit((d) => updateCaption(d, s.id, { end: clamp(Number(e.target.value), s.start + FRAME, duration) }), `end-${s.id}`)} /></label>
        </div>
      </div>)}
    </div> : <div className="ed-inspector-content ed-style-panel" role="tabpanel" aria-label="Subtitle styling">
      <div><h3>A look that’s yours</h3><p>Changes appear instantly in your preview.</p></div>
      <label>Typeface<select value={doc.style.font} onChange={(e) => style('font', e.target.value)}>{['Roboto', 'Arial', 'Liberation Sans'].map((font) => <option key={font}>{font}</option>)}</select></label>
      {[['font_size', 'Font size', 24, 120, 'px'], ['outline', 'Outline thickness', 0, 10, 'px'], ['shadow', 'Drop shadow', 0, 10, 'px'], ['position', 'Vertical position', 10, 90, '%']].map(([key, label, min, max, unit]) =>
        <label key={key}><span>{label}<output>{doc.style[key]}{unit}</output></span><input aria-label={label} type="range" min={min} max={max} value={doc.style[key]} onChange={(e) => style(key, Number(e.target.value))} /></label>)}
      <div className="ed-colors">{[['primary_color', 'Karaoke highlight'], ['secondary_color', 'Text color'], ['outline_color', 'Outline color']].map(([key, label]) => <label key={key}>{label}<span><input aria-label={label} type="color" value={doc.style[key]} onChange={(e) => style(key, e.target.value)} /><code>{doc.style[key].toUpperCase()}</code></span></label>)}</div>
      <div className="ed-style-note">Font size and outline use the 1080 × 1920 export canvas. The preview scales them to fit.</div>
    </div>}
    <div className="ed-inspector-footer"><span className="ed-live-dot" /> Live preview <span>All changes are non-destructive</span></div>
  </aside>;
}
