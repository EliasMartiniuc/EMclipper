import React, { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Upload, XCircle, PlayCircle, Loader2 } from 'lucide-react';
import { useUpload } from '../UploadContext';
import { useAuth } from '../AuthContext';

export default function Home() {
  const {
    file, handleFileChange, isProcessing, progress, progressText, 
    speedText, logs, error, startProcessing, stopProcessing, activeJobId, hasClips,
    subscriptionStatus
  } = useUpload();
  const { user } = useAuth();
  
  const logEndRef = useRef(null);

  useEffect(() => {
    if (logEndRef.current && logEndRef.current.parentElement) {
      logEndRef.current.parentElement.scrollTop = logEndRef.current.parentElement.scrollHeight;
    }
  }, [logs]);

  const canUpload = !subscriptionStatus || subscriptionStatus.can_upload;
  const remaining = subscriptionStatus?.uploads_remaining;
  const tier = subscriptionStatus?.tier || 'free';
  const isAdmin = subscriptionStatus?.is_admin;

  return (
    <div>
      <div style={{ textAlign: 'center', marginBottom: '60px' }}>
        <h1 className="kinetic-text home-title">
          AI that turns long videos into viral shorts in seconds.
        </h1>
        <p className="home-subtitle">
          Upload your podcast or vlog. We find the highlights and generate TikTok-ready clips automatically.
        </p>
      </div>

      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <div className="neu-card" style={{ width: '100%', maxWidth: '600px', textAlign: 'center' }}>
          
          {/* Uploads remaining indicator */}
          {user && subscriptionStatus && !isAdmin && (
            <div style={{ 
              display: 'flex', 
              justifyContent: 'center', 
              marginBottom: '20px' 
            }}>
              <div style={{
                background: canUpload ? 'rgba(138,122,237,0.1)' : 'rgba(255, 59, 48, 0.1)',
                color: canUpload ? 'var(--accent-color)' : 'rgb(255, 59, 48)',
                padding: '8px 20px',
                borderRadius: '24px',
                fontSize: '0.9rem',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}>
                {canUpload ? (
                  <>
                    <Upload size={16} />
                    {remaining} upload{remaining !== 1 ? 's' : ''} remaining
                    {tier !== 'free' && <span style={{ opacity: 0.6 }}>({tier})</span>}
                  </>
                ) : (
                  <>
                    No uploads remaining — 
                    <Link to="/subscription" style={{ color: 'var(--accent-color)', textDecoration: 'underline', fontWeight: 700 }}>
                      Upgrade now
                    </Link>
                  </>
                )}
              </div>
            </div>
          )}

          {error && <div style={{ color: 'red', marginBottom: '16px', fontWeight: 'bold' }}>{error}</div>}
          
          {!isProcessing ? (
            <>
              <div className="upload-box" style={{ opacity: canUpload ? 1 : 0.5, pointerEvents: canUpload ? 'auto' : 'none' }}>
                <Upload size={48} color="var(--accent-color)" style={{ marginBottom: '16px' }} />
                <h3 style={{ marginBottom: '8px' }}>Drop your video file here</h3>
                <p style={{ color: 'var(--text-muted)', marginBottom: '24px', fontSize: '0.875rem' }}>MP4, MOV, or WEBM up to unlimited size</p>
                
                <input 
                  type="file" 
                  onChange={handleFileChange} 
                  accept="video/*"
                  disabled={!canUpload}
                  style={{
                    position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', opacity: 0, cursor: canUpload ? 'pointer' : 'not-allowed'
                  }}
                />
                <button className="neu-btn" style={{ pointerEvents: 'none' }}>Choose File</button>
              </div>

              {file && (
                <div style={{ marginBottom: '24px', color: 'var(--accent-color)', fontWeight: 'bold' }}>
                  Ready to process: {file.name} ({(file.size / (1024 * 1024)).toFixed(1)} MB)
                </div>
              )}

              <button 
                className="neu-btn-primary" 
                onClick={startProcessing} 
                disabled={!canUpload && !isAdmin}
                style={{ width: '100%', padding: '16px', fontSize: '1.1rem', opacity: canUpload || isAdmin ? 1 : 0.5 }}
              >
                <PlayCircle size={24} /> Generate Clips
              </button>

              {!canUpload && !isAdmin && (
                <Link to="/subscription" style={{ textDecoration: 'none' }}>
                  <button className="neu-btn-primary" style={{ width: '100%', padding: '16px', fontSize: '1.1rem', marginTop: '12px' }}>
                    Upgrade to Pro
                  </button>
                </Link>
              )}
            </>
          ) : (
            <div style={{ padding: '20px 0' }}>
              <Loader2 className="spinner" style={{ margin: '0 auto', marginBottom: '24px', width: '48px', height: '48px', display: 'block' }} />
              
              <h3 style={{ marginBottom: '8px' }} className="kinetic-text">{progressText}</h3>
              {speedText && <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '24px' }}>{speedText}</p>}
              
              <div style={{ 
                background: 'var(--bg-color)', 
                boxShadow: 'var(--neu-inset)', 
                height: '16px', 
                borderRadius: '8px', 
                overflow: 'hidden',
                marginBottom: '24px'
              }}>
                <div style={{ 
                  width: `${progress}%`, 
                  height: '100%', 
                  background: 'var(--accent-color)', 
                  transition: 'width 0.3s ease' 
                }}></div>
              </div>

              <div style={{ 
                textAlign: 'left', 
                background: 'var(--bg-color)', 
                boxShadow: 'var(--neu-inset)', 
                padding: '16px', 
                borderRadius: '12px',
                height: '200px',
                overflowY: 'auto',
                fontSize: '0.875rem',
                fontFamily: 'monospace',
                marginBottom: '24px'
              }}>
                {logs.map((log, i) => (
                  <div key={i} style={{ color: log.level === 'error' ? 'red' : 'var(--text-primary)', marginBottom: '8px' }}>
                    &gt; {log.message}
                  </div>
                ))}
                <div ref={logEndRef}></div>
              </div>

              <button className="neu-btn" onClick={stopProcessing} style={{ width: '100%' }}>
                <XCircle size={18} /> Stop Processing
              </button>

              {activeJobId && hasClips && (
                <div style={{ marginTop: '16px' }}>
                  <Link to={`/projects/${activeJobId}`} style={{ textDecoration: 'none' }}>
                    <button className="neu-btn-primary" style={{ width: '100%', animation: 'pulse 2s infinite' }}>
                      <PlayCircle size={18} /> See Clips
                    </button>
                  </Link>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
