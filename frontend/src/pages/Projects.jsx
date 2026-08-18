import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Video, Clock, Trash2 } from 'lucide-react';
import { deleteVideoData } from '../UploadContext';

export default function Projects() {
  const [projects, setProjects] = useState([]);

  useEffect(() => {
    const saved = JSON.parse(localStorage.getItem('projects') || '[]');
    setProjects(saved);
  }, []);

  const handleDeleteProject = (e, projId) => {
    e.preventDefault(); // Stop Link navigation
    if (window.confirm('Are you sure you want to delete this project and all its clips?')) {
      const saved = JSON.parse(localStorage.getItem('projects') || '[]');
      const projToDelete = saved.find(p => p.id === projId);
      
      // Cleanup IndexedDB memory
      if (projToDelete && projToDelete.clips) {
        projToDelete.clips.forEach(clip => {
          if (clip.clipId) deleteVideoData(clip.clipId);
        });
      }

      // Cleanup localStorage
      const updated = saved.filter(p => p.id !== projId);
      localStorage.setItem('projects', JSON.stringify(updated));
      setProjects(updated);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '40px' }}>
        <div>
          <h1 className="kinetic-text" style={{ fontSize: '2.5rem', marginBottom: '8px' }}>Your Projects</h1>
          <p style={{ color: 'var(--text-muted)' }}>Manage and download your generated clips.</p>
        </div>
        <Link to="/" style={{ textDecoration: 'none' }}>
          <button className="neu-btn-primary">New Project</button>
        </Link>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 280px), 1fr))', gap: '24px' }}>
        {projects.map(proj => (
          <Link key={proj.id} to={`/projects/${proj.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
            <div className="neu-card neu-card-interactive" style={{ padding: '24px', cursor: 'pointer', position: 'relative' }}>
              <button 
                onClick={(e) => handleDeleteProject(e, proj.id)}
                style={{
                  position: 'absolute',
                  top: '16px',
                  right: '16px',
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  zIndex: 10
                }}
                onMouseOver={(e) => e.currentTarget.style.color = 'red'}
                onMouseOut={(e) => e.currentTarget.style.color = 'var(--text-muted)'}
              >
                <Trash2 size={20} />
              </button>

              <div style={{ 
                background: 'rgba(138,122,237,0.1)', 
                height: '160px', 
                borderRadius: '16px', 
                marginBottom: '20px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--accent-color)',
                overflow: 'hidden'
              }}>
                {proj.thumbnail ? (
                  <img src={proj.thumbnail} alt="Thumbnail" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <Video size={48} strokeWidth={1} />
                )}
              </div>
              <h3 style={{ fontSize: '1.25rem', marginBottom: '8px' }}>{proj.title}</h3>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><Clock size={14} /> {proj.date}</span>
                <span>{proj.clips ? proj.clips.length : 0} Clips Generated</span>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
