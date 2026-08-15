import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Download, Edit3, Star, Clock, Loader2 } from 'lucide-react';
import { getVideoData } from '../UploadContext';

const ClipCard = ({ clip, videoId }) => {
  const [videoUrl, setVideoUrl] = useState('');

  useEffect(() => {
    const loadVideo = async () => {
      if (clip.clipId) {
        const base64Data = await getVideoData(clip.clipId);
        if (base64Data) {
          try {
            const byteString = atob(base64Data);
            const ab = new ArrayBuffer(byteString.length);
            const ia = new Uint8Array(ab);
            for (let i = 0; i < byteString.length; i++) {
              ia[i] = byteString.charCodeAt(i);
            }
            const blob = new Blob([ab], { type: 'video/mp4' });
            setVideoUrl(URL.createObjectURL(blob));
            return;
          } catch (e) {
            console.error('Failed to create Blob from base64:', e);
          }
        }
      }
      
      // Fallback
      if (clip.filename) {
        setVideoUrl(`/outputs/${videoId}/${clip.filename}`);
      }
    };
    loadVideo();
  }, [clip, videoId]);

  return (
    <div className="neu-card" style={{ padding: '24px', display: 'flex', flexDirection: 'column' }}>
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
};

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
        {project.clips && project.clips.length > 0 ? project.clips.map((clip, index) => (
          <ClipCard key={index} clip={clip} videoId={videoId} />
        )) : (
          <p>No clips generated for this video yet.</p>
        )}
      </div>
    </div>
  );
}
