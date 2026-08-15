import React, { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Download, Edit3, Star, Clock } from 'lucide-react';

export default function ProjectDetail() {
  const { videoId } = useParams();

  // Mockup data for generated clips
  const clips = [
    { id: 'c1', title: 'The Ultimate Setup Guide', duration: 32, score: 95, timestamps: '0:42 - 1:14', videoUrl: '' },
    { id: 'c2', title: 'Why Lighting Matters', duration: 45, score: 88, timestamps: '5:22 - 6:07', videoUrl: '' },
    { id: 'c3', title: 'Best Microphone for Podcasts', duration: 28, score: 82, timestamps: '12:15 - 12:43', videoUrl: '' },
  ];

  return (
    <div>
      <div style={{ marginBottom: '40px' }}>
        <Link to="/projects" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', color: 'var(--text-muted)', textDecoration: 'none', marginBottom: '16px' }}>
          <ArrowLeft size={16} /> Back to Projects
        </Link>
        <h1 className="kinetic-text" style={{ fontSize: '2.5rem', marginBottom: '8px' }}>Full Podcast Ep 1 - Generated Clips</h1>
        <p style={{ color: 'var(--text-muted)' }}>Project ID: {videoId}</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '24px' }}>
        {clips.map(clip => (
          <div key={clip.id} className="neu-card" style={{ padding: '24px', display: 'flex', flexDirection: 'column' }}>
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
              {clip.videoUrl ? (
                <video src={clip.videoUrl} controls style={{ width: '100%', height: '100%', objectFit: 'contain' }}></video>
              ) : (
                <span>Preview Placeholder</span>
              )}
              
              <div style={{ position: 'absolute', top: '12px', right: '12px', background: 'var(--accent-color)', color: 'white', padding: '4px 12px', borderRadius: '20px', fontSize: '0.875rem', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <Star size={14} fill="white" /> {clip.score}
              </div>
            </div>

            <h3 style={{ fontSize: '1.25rem', marginBottom: '12px', flexGrow: 1 }}>{clip.title}</h3>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '24px' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><Clock size={14} /> {clip.duration}s</span>
              <span>{clip.timestamps}</span>
            </div>

            <div style={{ display: 'flex', gap: '12px' }}>
              <button className="neu-btn" style={{ flex: 1, padding: '12px' }}>
                <Edit3 size={18} /> Edit
              </button>
              <button className="neu-btn-primary" style={{ flex: 1, padding: '12px' }}>
                <Download size={18} /> Download
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
