import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Download, Edit3, Star, Clock } from 'lucide-react';

export default function ProjectDetail() {
  const { videoId } = useParams();
  const [project, setProject] = useState(null);

  useEffect(() => {
    const loadProject = () => {
      const saved = JSON.parse(localStorage.getItem('projects') || '[]');
      const found = saved.find(p => p.id === videoId);
      setProject(found);
    };

    loadProject();
    
    // Listen for real-time updates from UploadContext
    window.addEventListener('local-storage-update', loadProject);
    return () => window.removeEventListener('local-storage-update', loadProject);
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

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '24px' }}>
        {project.clips && project.clips.length > 0 ? project.clips.map((clip, index) => {
          // The backend saves the files in /outputs/{job_id}/{clip_filename}
          // The filename typically looks like "1_title.mp4", but if clip.filename isn't provided,
          // we can assume the format based on rank index or use the debug API.
          // For now, let's construct the URL assuming the backend returns clip.filename.
          // If not, we fallback to a direct API request (but for now we use /outputs/id/name)
          const videoUrl = clip.filename ? `/outputs/${videoId}/${clip.filename}` : '';
          
          return (
            <div key={index} className="neu-card" style={{ padding: '24px', display: 'flex', flexDirection: 'column' }}>
              <div style={{ 
                background: 'black', 
                height: '450px', 
                borderRadius: '16px', 
                marginBottom: '20px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--text-muted)',
                position: 'relative',
                overflow: 'hidden'
              }}>
                {videoUrl ? (
                  <video src={videoUrl} controls style={{ width: '100%', height: '100%', objectFit: 'contain' }}></video>
                ) : (
                  <span>Preview Not Available</span>
                )}
                
                <div style={{ position: 'absolute', top: '12px', right: '12px', background: 'var(--accent-color)', color: 'white', padding: '4px 12px', borderRadius: '20px', fontSize: '0.875rem', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <Star size={14} fill="white" /> {clip.score}
                </div>
              </div>

              <h3 style={{ fontSize: '1.25rem', marginBottom: '12px', flexGrow: 1 }}>{clip.title}</h3>
              
              <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '24px' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><Clock size={14} /> {Math.round(clip.duration || 0)}s</span>
                <span>{clip.start_time} - {clip.end_time}</span>
              </div>

              <div style={{ display: 'flex', gap: '12px' }}>
                <button className="neu-btn" style={{ flex: 1, padding: '12px' }}>
                  <Edit3 size={18} /> Edit
                </button>
                <a href={videoUrl} download={clip.filename} style={{ flex: 1, textDecoration: 'none' }}>
                  <button className="neu-btn-primary" style={{ width: '100%', padding: '12px' }}>
                    <Download size={18} /> Download
                  </button>
                </a>
              </div>
            </div>
          );
        }) : (
          <p>No clips generated for this video yet.</p>
        )}
      </div>
    </div>
  );
}
