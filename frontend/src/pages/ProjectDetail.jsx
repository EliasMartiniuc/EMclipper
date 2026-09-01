import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Download, Edit3, Star, Clock, Loader2 } from 'lucide-react';
import { supabase } from '../supabase';

const ClipCard = ({ clip }) => {
  const videoUrl = clip.video_url;

  const handleDownload = async (e) => {
    e.preventDefault();
    try {
      // Fetching the file as a blob forces the browser to download instead of open it
      const response = await fetch(videoUrl);
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = clip.title ? `${clip.title}.mp4` : 'clip.mp4';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(blobUrl);
      document.body.removeChild(a);
    } catch (err) {
      console.error("Download failed:", err);
      // Fallback if fetch fails due to CORS
      window.open(videoUrl, '_blank');
    }
  };

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
        <button onClick={handleDownload} className="neu-btn-primary" style={{ width: '100%', padding: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
          <Download size={18} /> Download
        </button>
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
        <div style={{ color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '16px' }}>
          <span>Project ID: {videoId}</span>
          
          {(() => {
            const expiresAt = new Date(new Date(project.created_at).getTime() + 7 * 24 * 60 * 60 * 1000);
            const now = new Date();
            const diffMs = expiresAt - now;
            
            if (diffMs <= 0) {
              return (
                <span style={{
                  background: 'rgba(255, 59, 48, 0.1)',
                  color: 'rgb(255, 59, 48)',
                  padding: '4px 12px',
                  borderRadius: '20px',
                  fontSize: '0.875rem',
                  fontWeight: 600,
                }}>
                  Expired
                </span>
              );
            }
            
            const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
            const hours = Math.floor(diffMs / (1000 * 60 * 60));
            const minutes = Math.floor(diffMs / (1000 * 60));
            
            let countdownText = "";
            if (days > 0) {
              countdownText = `${days} day${days > 1 ? 's' : ''} left before deletion`;
            } else if (hours > 0) {
              countdownText = `${hours} hour${hours > 1 ? 's' : ''} left before deletion`;
            } else {
              countdownText = `${minutes} min${minutes > 1 ? 's' : ''} left before deletion`;
            }
            
            return (
              <span style={{
                background: 'rgba(255, 59, 48, 0.9)',
                color: 'white',
                padding: '4px 12px',
                borderRadius: '20px',
                fontSize: '0.875rem',
                fontWeight: 600,
                boxShadow: '0 2px 8px rgba(255, 59, 48, 0.4)'
              }}>
                {countdownText}
              </span>
            );
          })()}
        </div>
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
