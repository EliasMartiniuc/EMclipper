import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Play, Pause, Volume2, VolumeX, Film } from 'lucide-react';
import { clamp, FRAME, segmentAt, timecode, videoSegments } from './timeline';

export default function PlayerMonitor({ clip, timeline, playing, setPlaying, onError }) {
  const { document: doc, currentTime, setCurrentTime, duration } = timeline;
  const videoRef = useRef(null);
  const latest = useRef({ doc, currentTime, duration });
  const [ready, setReady] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [volume, setVolume] = useState(0.8);
  const [width, setWidth] = useState(280);
  const frameRef = useRef(null);
  const sourceOffset = clip.source_time_offset ?? 0;
  const active = segmentAt(doc, currentTime) ?? videoSegments(doc).at(-1);
  const caption = doc.subtitles.find((s) => currentTime >= s.start && currentTime < s.end);

  useEffect(() => { latest.current = { doc, currentTime, duration }; }, [doc, currentTime, duration]);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(frameRef.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const video = videoRef.current;
    if (!ready || !active) return;
    const target = active.sourceStart - sourceOffset + clamp(currentTime - active.startTime, 0, active.duration);
    if (Math.abs(video.currentTime - target) > (playing ? 0.09 : 0.001)) video.currentTime = target;
  }, [active, currentTime, playing, ready, sourceOffset]);
  useEffect(() => {
    const video = videoRef.current;
    if (!ready) return;
    video.playbackRate = speed;
    video.volume = volume;
    if (playing && duration > 0) video.play().catch(() => { setPlaying(false); onError('Playback could not start. Try pressing Play again.'); });
    else video.pause();
  }, [playing, speed, volume, ready, duration, setPlaying, onError]);
  useEffect(() => {
    if (!playing || !ready) return;
    let frame;
    const tick = () => {
      const video = videoRef.current;
      const state = latest.current;
      const segment = segmentAt(state.doc, state.currentTime);
      if (!segment) { setPlaying(false); return; }
      if (!video.seeking) {
        if (video.currentTime >= segment.sourceEnd - sourceOffset - 0.008 || video.ended) {
          const next = videoSegments(state.doc).find((s) => s.startTime >= segment.startTime + segment.duration - 0.00001);
          if (next) {
            video.currentTime = next.sourceStart - sourceOffset;
            latest.current = { ...state, currentTime: next.startTime };
            setCurrentTime(next.startTime);
            if (video.paused) video.play().catch(() => setPlaying(false));
          } else { setCurrentTime(state.duration); setPlaying(false); return; }
        } else {
          const time = clamp(segment.startTime + video.currentTime + sourceOffset - segment.sourceStart, segment.startTime, segment.startTime + segment.duration);
          latest.current = { ...state, currentTime: time };
          setCurrentTime(time);
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, ready, setPlaying, setCurrentTime, sourceOffset]);

  function toggle() {
    if (currentTime >= duration) setCurrentTime(0);
    setPlaying(!playing);
  }
  function step(delta) { setPlaying(false); setCurrentTime(clamp(currentTime + delta, 0, duration)); }
  const style = doc.style;
  const scale = width / 1080;
  return <section className="ed-monitor" aria-label="Video preview">
    <div className="ed-panel-heading"><span><span className="ed-live-dot" /> PROGRAM MONITOR</span><span>9:16 <span className="ed-muted">/</span> 1080 × 1920</span></div>
    <div className="ed-preview-stage">
      <div className="ed-video-frame" ref={frameRef}>
        <video ref={videoRef} src={clip.source_video_url || clip.video_url} playsInline preload="auto"
          onLoadedMetadata={() => setReady(true)} onError={() => { setPlaying(false); onError('The source video could not be loaded. It may have expired.'); }} />
        {!ready && <div className="ed-media-placeholder"><Film size={32} /><span>Loading source…</span></div>}
        {!active && <div className="ed-media-placeholder"><Film size={32} /><span>Your sequence is empty</span></div>}
        {caption && active && <div className="ed-subtitle-overlay" style={{
          top: `${style.position}%`, fontFamily: `"EMclipper ${style.font}", Arial, sans-serif`, fontSize: style.font_size * scale,
          color: style.secondary_color, WebkitTextStroke: `${style.outline * scale}px ${style.outline_color}`,
          textShadow: style.shadow ? `${style.shadow * scale}px ${style.shadow * scale}px ${style.shadow * scale}px #0009` : 'none',
        }}>{(caption.words?.length ? caption.words : [{ word: caption.text, start: caption.start, end: caption.end }]).map((word, i) =>
          <span key={i} style={{ color: currentTime >= word.start ? style.primary_color : style.secondary_color }}>{word.word}{' '}</span>)}</div>}
        <div className="ed-frame-badge">PREVIEW</div>
      </div>
    </div>
    <div className="ed-transport">
      <div className="ed-timecode"><b>{timecode(currentTime)}</b><span> / {timecode(duration)}</span></div>
      <div className="ed-play-controls">
        <button aria-label="Previous frame" title="Previous frame (←)" onClick={() => step(-FRAME)}><ChevronLeft size={20} /></button>
        <button className="ed-play" aria-label={playing ? 'Pause' : 'Play'} onClick={toggle} disabled={!ready || !duration}>{playing ? <Pause size={19} fill="currentColor" /> : <Play size={19} fill="currentColor" />}</button>
        <button aria-label="Next frame" title="Next frame (→)" onClick={() => step(FRAME)}><ChevronRight size={20} /></button>
      </div>
      <div className="ed-audio-controls">
        <select aria-label="Playback speed" value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>{[0.5, 1, 1.5, 2].map((v) => <option key={v} value={v}>{v}×</option>)}</select>
        <button aria-label={volume ? 'Mute' : 'Unmute'} onClick={() => setVolume(volume ? 0 : 0.8)}>{volume ? <Volume2 size={16} /> : <VolumeX size={16} />}</button>
        <input aria-label="Volume" type="range" min="0" max="1" step="0.01" value={volume} onChange={(e) => setVolume(Number(e.target.value))} />
      </div>
    </div>
  </section>;
}
