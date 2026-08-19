import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Download, Edit3, Star, Clock, Loader2 } from 'lucide-react';
import { supabase } from '../supabase';

const ClipCard = ({ clip }) => {
  const videoUrl = clip.video_url;

  return (
    <div className="neu-card" style={{ padding: '24px', display: 'flex', flexDirection: 'column' }}>
      <div className="clip-preview">
        {videoUrl ? (
          <video src={videoUrl} preload="metadata" controls style={{ width: '100%', height: '100%', objectFit: 'contain' }}></video>
        ) : (
          <Loader2 className="spinner" size={32} />
        )}
        
        <div style={{ position: 'absolute', top: '12px', right: '12px', background: 'var(--accent-color)', color: 'white', padding: '4px 12px', borderRadius: '20px', fontSize: '0.875rem', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '4px' }}>
          <Star size={14} fill="white" /> {clip.score}
        </div>
      </div>

      <h3 style={{ fontSize: '1.25rem', marginBottom: '12px', flexGrow: 1 }}>{clip.title}</h3>
      
      <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '24px' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><Clock size={14} /> {Math.round(clip.duration || 0)}s</span>
      </div>

      <div style={{ display: 'flex', gap: '12px' }}>
        <a href={videoUrl} download={clip.filename} style={{ flex: 1, textDecoration: 'none' }} target="_blank" rel="noreferrer">
          <button className="neu-btn-primary" style={{ width: '100%', padding: '12px' }}>
            <Download size={18} /> Download
          </button>
        </a>
      </div>
    </div>
  );
};

export default function ProjectDetail() {
  const { videoId } = useParams();
  const [project, setProject] = useState(null);

  useEffect(() => {
    const loadProject = async () => {
      const { data, error } = await supabase
        .from('projects')
        .select('*, clips(*)')
        .eq('id', videoId)
        .single();
        
      if (error) {
        console.error("Error loading project:", error);
      } else {
        // Sort clips by score descending
        if (data.clips) {
          data.clips.sort((a, b) => (b.score || 0) - (a.score || 0));
        }
        setProject(data);
      }
    };

    loadProject();
    
    window.addEventListener('db-update', loadProject);
    return () => window.removeEventListener('db-update', loadProject);
  }, [videoId]);

  if (!project) {
    return <div style={{ textAlign: 'center', marginTop: '60px' }}>Loading or project not found...</div>;
  }

  return (
    <div>
      <div style={{ marginBottom: '40px' }}>
        <Link to="/projects" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', color: 'var(--text-muted)', textDecoration: 'none', marginBottom: '16px' }}>
          <ArrowLeft size={16} /> Back to Projects
        </Link>
        <h1 className="kinetic-text" style={{ fontSize: '2.5rem', marginBottom: '8px' }}>{project.title} - Generated Clips</h1>
        <p style={{ color: 'var(--text-muted)' }}>Project ID: {videoId}</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 280px), 1fr))', gap: '24px' }}>
        {project.clips && project.clips.length > 0 ? project.clips.map((clip, index) => (
          <ClipCard key={clip.id || index} clip={clip} />
        )) : (
          <p>No clips generated for this video yet.</p>
        )}
      </div>
    </div>
  );
}
