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
        .order('created_at', { ascending: false })
        .limit(50);
        
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
        const { data: { session } } = await supabase.auth.getSession();
        const headers = session ? { 'Authorization': `Bearer ${session.access_token}` } : {};
        await fetch(`/api/project/${projId}`, { method: 'DELETE', headers });
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
        ) : projects.filter(proj => {
          // Filter out expired projects
          const expiresAt = new Date(new Date(proj.created_at).getTime() + 7 * 24 * 60 * 60 * 1000);
          return expiresAt > new Date();
        }).map(proj => {
          // Find the first available video URL to use as thumbnail
          const thumbnailVideo = proj.clips && proj.clips.find(c => c.video_url)?.video_url;
          
          // Calculate countdown
          const expiresAt = new Date(new Date(proj.created_at).getTime() + 7 * 24 * 60 * 60 * 1000);
          const now = new Date();
          const diffMs = expiresAt - now;
          let countdownText = "";
          
          const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
          const hours = Math.floor(diffMs / (1000 * 60 * 60));
          const minutes = Math.floor(diffMs / (1000 * 60));
          
          if (days > 0) {
            countdownText = `${days} day${days > 1 ? 's' : ''} left`;
          } else if (hours > 0) {
            countdownText = `${hours} hour${hours > 1 ? 's' : ''} left`;
          } else {
            countdownText = `${minutes} min${minutes > 1 ? 's' : ''} left`;
          }
          
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
                <div style={{
                  position: 'absolute',
                  top: '8px',
                  left: '8px',
                  background: 'rgba(255, 59, 48, 0.9)',
                  color: 'white',
                  padding: '4px 10px',
                  borderRadius: '20px',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  zIndex: 10,
                  backdropFilter: 'blur(4px)',
                  boxShadow: '0 2px 8px rgba(255, 59, 48, 0.4)'
                }}>
                  {countdownText}
                </div>
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
                <span>{proj.clips ? proj.clips.length : 0} Clips</span>
              </div>
            </div>
          </Link>
          );
        })}
      </div>
    </div>
  );
}
