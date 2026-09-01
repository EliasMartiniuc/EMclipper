import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Save, Play, Pause, Loader2 } from 'lucide-react';
import { supabase } from '../supabase';
import ReactPlayer from 'react-player';
import Slider from 'rc-slider';
import 'rc-slider/assets/index.css';

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

export default function EditClip() {
  const { clipId } = useParams();
  const navigate = useNavigate();
  const [clip, setClip] = useState(null);
  const [project, setProject] = useState(null);
  
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [transcript, setTranscript] = useState('');
  const [playing, setPlaying] = useState(false);
  
  const playerRef = useRef(null);

  useEffect(() => {
    const loadClip = async () => {
      try {
        const { data: clipData, error: clipErr } = await supabase
          .from('clips')
          .select('*')
          .eq('id', clipId)
          .single();
          
        if (clipErr) throw clipErr;
        setClip(clipData);
        setStartTime(clipData.start_time || 0);
        setEndTime(clipData.end_time || 0);
        setTranscript(clipData.transcript || '');
        
        const { data: projData, error: projErr } = await supabase
          .from('projects')
          .select('*')
          .eq('id', clipData.project_id)
          .single();
          
        if (projErr) throw projErr;
        setProject(projData);
        
      } catch (err) {
        console.error(err);
        setError("Failed to load clip details.");
      } finally {
        setLoading(false);
      }
    };
    loadClip();
  }, [clipId]);

  const handleDuration = (dur) => {
    setDuration(dur);
    // If end_time was 0 (legacy clip), just set it to start_time + clip.duration or something
    if (endTime === 0 && clip && clip.duration) {
      setEndTime((clip.start_time || 0) + clip.duration);
    }
  };

  const handleProgress = (state) => {
    // Auto loop within the boundaries
    if (playing && state.playedSeconds >= endTime) {
      playerRef.current.seekTo(startTime);
    }
  };

  const handleSliderChange = (values) => {
    setStartTime(values[0]);
    setEndTime(values[1]);
    if (playerRef.current) {
      playerRef.current.seekTo(values[0]);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      
      const res = await fetch(`${API}/api/clips/${clipId}/edit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          project_id: project.id,
          start_time: startTime,
          end_time: endTime,
          transcript: transcript,
          source_video_url: project.source_video_url,
          title: clip.title
        })
      });
      
      if (!res.ok) {
        throw new Error(await res.text());
      }
      
      // Go back to the project detail page
      navigate(`/projects/${project.id}`);
      
    } catch (err) {
      console.error(err);
      setError("Failed to start save process. Make sure backend is running.");
      setSaving(false);
    }
  };

  if (loading) {
    return <div style={{ textAlign: 'center', marginTop: '60px' }}><Loader2 className="spinner" size={32} /></div>;
  }

  if (error) {
    return <div style={{ textAlign: 'center', color: 'red', marginTop: '60px' }}>{error}</div>;
  }

  return (
    <div style={{ maxWidth: '900px', margin: '40px auto', padding: '0 clamp(16px, 4vw, 24px)' }}>
      <Link to={`/projects/${project?.id}`} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', color: 'var(--text-muted)', textDecoration: 'none', marginBottom: '24px' }}>
        <ArrowLeft size={16} /> Back to Project
      </Link>
      
      <div className="neu-box" style={{ padding: 'clamp(24px, 5vw, 40px)' }}>
        <h1 className="kinetic-text" style={{ fontSize: '2rem', marginBottom: '24px' }}>Edit Clip</h1>
        
        {/* Video Player */}
        <div style={{ width: '100%', aspectRatio: '16/9', background: '#000', borderRadius: '16px', overflow: 'hidden', marginBottom: '24px', position: 'relative' }}>
          <ReactPlayer
            ref={playerRef}
            url={project?.source_video_url}
            width="100%"
            height="100%"
            playing={playing}
            controls={false}
            onDuration={handleDuration}
            onProgress={handleProgress}
          />
        </div>
        
        {/* Playback Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '24px' }}>
          <button className="neu-btn" onClick={() => setPlaying(!playing)} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {playing ? <Pause size={18} /> : <Play size={18} />} {playing ? 'Pause' : 'Play'}
          </button>
          <div style={{ flex: 1, padding: '0 16px' }}>
            <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
              Clip Timeline ({startTime.toFixed(1)}s - {endTime.toFixed(1)}s)
            </label>
            <Slider
              range
              min={0}
              max={duration || 100}
              step={0.1}
              value={[startTime, endTime]}
              onChange={handleSliderChange}
              trackStyle={[{ backgroundColor: 'var(--accent-color)' }]}
              handleStyle={[
                { borderColor: 'var(--accent-color)', backgroundColor: '#fff' },
                { borderColor: 'var(--accent-color)', backgroundColor: '#fff' }
              ]}
            />
          </div>
        </div>

        {/* Subtitle Editor */}
        <div style={{ marginBottom: '32px' }}>
          <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.9rem', color: 'var(--text-primary)' }}>
            Edit Subtitles
          </label>
          <textarea
            className="neu-input"
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            style={{ width: '100%', minHeight: '120px', resize: 'vertical' }}
            placeholder="Edit the spoken text here..."
          />
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '8px' }}>
            The backend will re-sync your edited text to the audio timestamps automatically.
          </p>
        </div>

        <button 
          className="neu-btn-primary" 
          onClick={handleSave} 
          disabled={saving}
          style={{ width: '100%', padding: '16px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px' }}
        >
          {saving ? <><Loader2 size={18} className="spinner" /> Processing on Server...</> : <><Save size={18} /> Save & Replace Clip</>}
        </button>
      </div>
    </div>
  );
}
