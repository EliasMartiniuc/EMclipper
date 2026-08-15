import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Video, Clock, ChevronRight } from 'lucide-react';

export default function Projects() {
  const [projects, setProjects] = useState([]);

  useEffect(() => {
    const saved = JSON.parse(localStorage.getItem('projects') || '[]');
    setProjects(saved);
  }, []);

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

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '24px' }}>
        {projects.map(proj => (
          <Link key={proj.id} to={`/projects/${proj.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
            <div className="neu-card neu-card-interactive" style={{ padding: '24px', cursor: 'pointer' }}>
              <div style={{ 
                background: 'rgba(138,122,237,0.1)', 
                height: '160px', 
                borderRadius: '16px', 
                marginBottom: '20px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--accent-color)'
              }}>
                <Video size={48} strokeWidth={1} />
              </div>
              <h3 style={{ fontSize: '1.25rem', marginBottom: '8px' }}>{proj.title}</h3>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><Clock size={14} /> {proj.duration}</span>
                <span>{proj.clips} Clips Generated</span>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
