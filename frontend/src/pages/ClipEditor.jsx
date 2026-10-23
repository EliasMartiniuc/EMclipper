import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowUpRight, Check, ChevronRight, Download, Film, Loader2, Redo2, Save, Undo2, ZoomIn, AlertCircle } from 'lucide-react';
import useTimelineState from '../editor/useTimelineState';
import { clamp, copySegment, exportPayload, FRAME, makeDocument, normalize, pasteSegment, removeSegment, segmentAt, splitSegment, trimSegment, videoSegments } from '../editor/timeline';
import { editorRequest } from '../editor/api';
import PlayerMonitor from '../editor/PlayerMonitor';
import SubtitleInspector from '../editor/SubtitleInspector';
import Timeline from '../editor/TimelineCanvas';
import '../editor/editor.css';

export function EditorWorkspace({ clip }) {
  const [initialDocument] = useState(() => makeDocument(clip));
  const timeline = useTimelineState(initialDocument);
  const { document: doc, edit, currentTime, setCurrentTime, duration, undo, redo } = timeline;
  const [selection, setSelection] = useState(null);
  const [tool, setTool] = useState('select');
  const [playing, setPlaying] = useState(false);
  const [clipboard, setClipboard] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(JSON.stringify(doc));
  const [render, setRender] = useState(null);
  const [exported, setExported] = useState(null);
  const [recovered, setRecovered] = useState(false);
  const mounted = useRef(true);
  const documentRef = useRef(doc);
  const savedRef = useRef(saved);
  const draftKey = `emclipper:draft:${clip.id}`;
  const dirty = JSON.stringify(doc) !== saved;
  const busy = render && !['completed', 'failed'].includes(render.status);
  const pause = useCallback(() => setPlaying(false), []);
  const seek = useCallback((time) => { setPlaying(false); setCurrentTime(clamp(time, 0, duration)); }, [duration, setCurrentTime]);
  const reportError = useCallback((message) => setError(message), []);

  useEffect(() => { documentRef.current = doc; savedRef.current = saved; }, [doc, saved]);
  useEffect(() => {
    mounted.current = true;
    try {
      const local = JSON.parse(localStorage.getItem(draftKey));
      if (local?.version === 1 && local.savedAt > (clip.editor_draft?.savedAt ?? 0)) {
        const recoveredDocument = normalize(local.document);
        edit(() => recoveredDocument); setRecovered(true);
      }
    } catch { /* An unavailable or corrupt local backup must not block editing. */ }
    try {
      const pendingRender = localStorage.getItem(`${draftKey}:render`);
      if (pendingRender) setRender({ render_id: pendingRender, status: 'queued' });
    } catch { /* optional export recovery */ }
    return () => {
      mounted.current = false;
      if (JSON.stringify(documentRef.current) !== savedRef.current) {
        try { localStorage.setItem(draftKey, JSON.stringify({ version: 1, savedAt: Date.now(), document: documentRef.current })); }
        catch { /* browser storage may be disabled */ }
      }
    };
  }, [clip.editor_draft?.savedAt, draftKey, edit]);
  useEffect(() => {
    const timer = setTimeout(() => {
      if (dirty) {
        try { localStorage.setItem(draftKey, JSON.stringify({ version: 1, savedAt: Date.now(), document: doc })); }
        catch { setError('Browser backup is unavailable. Use Save draft to keep your changes.'); }
      }
    }, 800);
    return () => clearTimeout(timer);
  }, [doc, dirty, draftKey]);
  useEffect(() => {
    const warn = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  useEffect(() => {
    if (!busy || !render.render_id) return;
    let cancelled = false, timer;
    async function poll() {
      try {
        const next = await editorRequest(`/api/clips/${clip.id}/renders/${render.render_id}`);
        if (cancelled) return;
        setRender(next);
        if (next.status === 'completed' || next.status === 'failed') {
          try { localStorage.removeItem(`${draftKey}:render`); } catch { /* optional export recovery */ }
        }
        if (next.status === 'completed') { setExported(next.video_url); window.dispatchEvent(new Event('db-update')); }
        else if (next.status === 'failed') setError(next.error || 'Export failed. Your draft is safe.');
        else timer = setTimeout(poll, 2000);
      } catch (err) {
        if (!cancelled) {
          if (err.status === 404) {
            setRender((r) => ({ ...r, status: 'failed' }));
            try { localStorage.removeItem(`${draftKey}:render`); } catch { /* optional export recovery */ }
            setError('This export is no longer available. Your draft is safe; export again to retry.');
          } else { setError(`Export status unavailable: ${err.message}`); timer = setTimeout(poll, 5000); }
        }
      }
    }
    timer = setTimeout(poll, 1000);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [busy, clip.id, draftKey, render?.render_id]);

  const selected = selection?.type === 'video' ? videoSegments(doc).find((s) => s.id === selection.id) : null;
  function split(id, at = currentTime) {
    const target = id ?? selected?.id ?? segmentAt(doc, at)?.id;
    edit((d) => splitSegment(d, target, at)); pause();
  }
  function copy() { if (selected) setClipboard(copySegment(doc, selected.id)); }
  function paste() { if (clipboard) { edit((d) => pasteSegment(d, clipboard, currentTime)); pause(); } }
  function remove() {
    if (!selection) return;
    edit((d) => selection.type === 'video' ? removeSegment(d, selection.id) : normalize({ ...d, subtitles: d.subtitles.filter((s) => s.id !== selection.id) }));
    setSelection(null); pause();
  }
  function trim(edge) {
    if (!selected || currentTime <= selected.startTime + FRAME || currentTime >= selected.startTime + selected.duration - FRAME) return;
    edit((d) => trimSegment(d, selected.id, edge, selected.sourceStart + currentTime - selected.startTime)); pause();
  }
  async function saveDraft() {
    const snapshot = documentRef.current;
    setSaving(true); setError('');
    try {
      await editorRequest(`/api/clips/${clip.id}/draft`, { method: 'PUT', body: JSON.stringify({ version: 1, savedAt: Date.now(), document: snapshot }) });
      if (mounted.current) {
        setSaved(JSON.stringify(snapshot)); setRecovered(false);
        if (documentRef.current === snapshot) { try { localStorage.removeItem(draftKey); } catch { /* optional backup */ } }
      }
      return true;
    } catch (err) { if (mounted.current) setError(err.message); return false; }
    finally { if (mounted.current) setSaving(false); }
  }
  async function startExport() {
    setError(''); setExported(null); setRender({ status: 'submitting' }); pause();
    try {
      if (!await saveDraft()) { setRender(null); return; }
      const result = await editorRequest(`/api/clips/${clip.id}/re-render`, { method: 'POST', body: JSON.stringify(exportPayload(doc)) });
      if (mounted.current) {
        setRender(result);
        try { localStorage.setItem(`${draftKey}:render`, result.render_id); } catch { /* optional export recovery */ }
      }
    } catch (err) { if (mounted.current) { setError(err.message); setRender(null); } }
  }
  useEffect(() => {
    function key(e) {
      if (e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
      const modifier = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (modifier && k === 'z') { e.preventDefault(); pause(); if (e.shiftKey) redo(); else undo(); }
      else if (modifier && k === 'y') { e.preventDefault(); pause(); redo(); }
      else if (modifier && k === 'c' && selected) { e.preventDefault(); copy(); }
      else if (modifier && k === 'v' && clipboard) { e.preventDefault(); paste(); }
      else if (modifier && k === 's') { e.preventDefault(); if (!saving) saveDraft(); }
      else if (!modifier && e.code === 'Space') { e.preventDefault(); if (duration) { if (currentTime >= duration) setCurrentTime(0); setPlaying((v) => !v); } }
      else if (!modifier && ['ArrowLeft', 'ArrowRight'].includes(e.key)) { e.preventDefault(); seek(currentTime + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 1 : FRAME)); }
      else if (!modifier && k === 'c') { e.preventDefault(); setTool('blade'); split(); }
      else if (!modifier && k === 'v') setTool('select');
      else if (['Delete', 'Backspace'].includes(e.key)) { e.preventDefault(); remove(); }
    }
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  return <div className="clip-editor">
    <header className="ed-header">
      <div className="ed-brand"><Link to={`/projects/${clip.project_id}`} className="ed-back" aria-label="Back to project"><ArrowLeft size={19} /></Link><img src="/logo.webp" alt="" /><strong>EMclipper<span>STUDIO</span></strong></div>
      <span className="ed-header-divider" />
      <div className="ed-title-group"><span className="ed-eyebrow">CLIP EDITOR <ChevronRight size={10} /> SEQUENCE 01</span><input aria-label="Clip title" maxLength={200} value={doc.title} onChange={(e) => edit((d) => ({ ...d, title: e.target.value }), 'title')} /></div>
      <label className="ed-header-zoom"><ZoomIn size={15} /><input aria-label="Header timeline zoom" type="range" min="12" max="240" value={timeline.zoom} onChange={(e) => timeline.setZoom(Number(e.target.value))} /><span>{Math.round(timeline.zoom / 64 * 100)}%</span></label>
      <div className="ed-save-status" role="status"><span className={dirty ? 'ed-unsaved-dot' : 'ed-live-dot'} />{recovered ? 'Browser draft recovered' : dirty ? 'Unsaved changes' : 'Draft saved'}</div>
      <div className="ed-header-actions"><button className="ed-icon" aria-label="Undo" title="Undo (Ctrl+Z)" disabled={!timeline.canUndo} onClick={() => { pause(); undo(); }}><Undo2 size={17} /></button><button className="ed-icon" aria-label="Redo" title="Redo (Ctrl+Y)" disabled={!timeline.canRedo} onClick={() => { pause(); redo(); }}><Redo2 size={17} /></button><span className="ed-divider" />
        <button className="ed-secondary" disabled={saving} onClick={saveDraft}>{saving ? <Loader2 size={15} className="ed-spin" /> : <Save size={15} />}<span>Save draft</span></button>
        <button className="ed-primary" disabled={busy || !duration || !doc.title.trim()} onClick={startExport}>{busy ? <Loader2 size={16} className="ed-spin" /> : <ArrowUpRight size={17} />}<span>{busy ? 'Exporting…' : 'Export clip'}</span></button>
      </div>
    </header>
    {error && <div className="ed-banner ed-error" role="alert"><AlertCircle size={15} />{error}<button onClick={() => setError('')} aria-label="Dismiss error">×</button></div>}
    {(!clip.source_video_url || clip.source_has_baked_subtitles) && <div className="ed-banner"><AlertCircle size={15} />This older clip has baked-in captions. New captions appear on top. Generate a new clip for a clean, fully editable source.</div>}
    {exported && <div className="ed-banner ed-success" role="status"><Check size={15} />Your export is ready. The project now uses this version.<a href={exported} target="_blank" rel="noreferrer"><Download size={14} /> Open export</a></div>}
    <div className="ed-workspace-heading"><div><span className="ed-eyebrow">THE CUTTING ROOM</span><h1>A little polish. A bigger impact.</h1></div><span className="ed-project-chip"><Film size={14} /> Vertical short <span>9:16</span></span></div>
    <div className="ed-middle"><PlayerMonitor clip={clip} timeline={timeline} playing={playing} setPlaying={setPlaying} onError={reportError} /><SubtitleInspector timeline={timeline} selection={selection} setSelection={setSelection} seek={seek} /></div>
    <div className="ed-timeline-heading"><div><h2>Timeline</h2><span>Shape the story, frame by frame.</span></div><label><ZoomIn size={15} /><input aria-label="Timeline zoom" type="range" min="12" max="240" value={timeline.zoom} onChange={(e) => timeline.setZoom(Number(e.target.value))} /><span>{Math.round(timeline.zoom / 64 * 100)}%</span></label></div>
    <Timeline timeline={timeline} clip={clip} selection={selection} setSelection={setSelection} tool={tool} setTool={setTool} seek={seek} pause={pause} actions={{ split, copy, paste, trim, remove, hasClipboard: !!clipboard }} />
  </div>;
}

export default function ClipEditor() {
  const { projectId, clipId } = useParams();
  const [state, setState] = useState({ loading: true });
  useEffect(() => {
    let cancelled = false;
    setState({ loading: true });
    editorRequest(`/api/clips/${encodeURIComponent(clipId)}/editor`).then((clip) => {
      if (String(clip.project_id) !== projectId) throw new Error('This clip does not belong to this project.');
      if (!cancelled) setState({ clip });
    }).catch((error) => { if (!cancelled) setState({ error: error.message }); });
    return () => { cancelled = true; };
  }, [projectId, clipId]);
  if (!state.clip) return <div className="clip-editor ed-loading">{state.loading ? <><Loader2 className="ed-spin" size={28} /><p>Opening your editing room…</p></> : <><AlertCircle size={28} /><p>{state.error}</p><Link to={`/projects/${projectId}`}>Back to project</Link></>}</div>;
  return <EditorWorkspace key={clipId} clip={state.clip} />;
}
