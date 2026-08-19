import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Video, Clock, Trash2, Loader2 } from 'lucide-react';
import { supabase } from '../supabase';
import { useAuth } from '../AuthContext';

export default function Projects() {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();

  useEffect(() => {
    const fetchProjects = async () => {
      if (!user) {
        setLoading(false);
        return;
      }
      
      const { data, error } = await supabase
        .from('projects')
        .select('*, clips(video_url)')
        .order('created_at', { ascending: false });
        
      if (error) {
        console.error("Error fetching projects:", error);
      } else {
        setProjects(data || []);
      }
      setLoading(false);
    };

    fetchProjects();
  }, [user]);

  const handleDeleteProject = async (e, projId) => {
    e.preventDefault(); // Stop Link navigation
    if (window.confirm('Are you sure you want to delete this project and all its clips?')) {
      // 1. Delete files from Cloudflare R2 via backend
      try {
        await fetch(`/api/project/${projId}`, { method: 'DELETE' });
      } catch (err) {
        console.error("Failed to delete R2 files:", err);
      }

      // 2. Delete from Supabase Database
      const { error } = await supabase
        .from('projects')
        .delete()
        .eq('id', projId)
        .eq('user_id', user.id);
        
      if (error) {
        console.error("Error deleting project:", error);
        alert("Failed to delete project.");
      } else {
        setProjects(prev => prev.filter(p => p.id !== projId));
      }
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
        {loading ? (
          <div style={{ padding: '40px', textAlign: 'center', gridColumn: '1 / -1' }}>
            <Loader2 className="spinner" size={32} style={{ color: 'var(--accent-color)' }} />
          </div>
        ) : projects.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', gridColumn: '1 / -1', color: 'var(--text-muted)' }}>
            {user ? "No projects found. Start by generating some clips!" : "Log in to see your projects."}
          </div>
        ) : projects.map(proj => {
          // Find the first available video URL to use as thumbnail
          const thumbnailVideo = proj.clips && proj.clips.find(c => c.video_url)?.video_url;
          
          return (
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
                overflow: 'hidden',
                position: 'relative'
              }}>
                {thumbnailVideo ? (
                  <video 
                    src={`${thumbnailVideo}#t=0.5`} 
                    preload="metadata"
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  ></video>
                ) : proj.thumbnail ? (
                  <img src={proj.thumbnail} alt="Thumbnail" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <Video size={48} strokeWidth={1} />
                )}
              </div>
              <h3 style={{ fontSize: '1.25rem', marginBottom: '8px' }}>{proj.title}</h3>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><Clock size={14} /> {new Date(proj.created_at).toLocaleDateString()}</span>
                <span>{proj.clips ? proj.clips.length : 0} Clips Generated</span>
              </div>
            </div>
          </Link>
          );
        })}
      </div>
    </div>
  );
}
