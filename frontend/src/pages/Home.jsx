import React, { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Upload, XCircle, PlayCircle, Loader2, Link2, X, Sparkles } from 'lucide-react';
import { useUpload } from '../UploadContext';
import { useAuth } from '../AuthContext';

export default function Home() {
  const {
    file, setFile, handleFileChange, url, setUrl, isProcessing, progress, progressText, 
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

  const hasInput = Boolean(file || (url && url.trim()));

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
              {/* ─── Video URL Input Bar ─── */}
              <div style={{ marginBottom: '24px', textAlign: 'left' }}>
                <label style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: '8px', 
                  fontSize: '0.875rem', 
                  fontWeight: 600, 
                  color: 'var(--text-primary)', 
                  marginBottom: '10px' 
                }}>
                  <Link2 size={16} color="var(--accent-color)" /> Paste Video Link
                </label>

                <div style={{
                  position: 'relative',
                  display: 'flex',
                  alignItems: 'center',
                  background: 'var(--bg-color)',
                  boxShadow: 'var(--neu-inset)',
                  borderRadius: '16px',
                  padding: '4px 8px 4px 16px',
                  border: url ? '1px solid var(--accent-color)' : '1px solid transparent',
                  transition: 'border 0.2s ease, box-shadow 0.2s ease',
                  opacity: canUpload || isAdmin ? 1 : 0.5
                }}>
                  <input 
                    type="url"
                    placeholder="https://www.youtube.com/watch?v=..."
                    value={url}
                    onChange={(e) => {
                      setUrl(e.target.value);
                      if (e.target.value && file) setFile(null);
                    }}
                    disabled={!canUpload && !isAdmin}
                    style={{
                      flex: 1,
                      border: 'none',
                      outline: 'none',
                      background: 'transparent',
                      color: 'var(--text-primary)',
                      fontSize: '0.95rem',
                      padding: '12px 0',
                      minWidth: 0
                    }}
                  />
                  {url && (
                    <button
                      type="button"
                      onClick={() => setUrl('')}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--text-muted)',
                        cursor: 'pointer',
                        padding: '8px',
                        display: 'flex',
                        alignItems: 'center'
                      }}
                      title="Clear URL"
                    >
                      <X size={16} />
                    </button>
                  )}
                </div>

                {url && (
                  <div style={{ 
                    marginTop: '8px', 
                    fontSize: '0.8rem', 
                    color: 'var(--accent-color)', 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: '4px' 
                  }}>
                    <Sparkles size={13} /> Link ready to fetch via Cobalt
                  </div>
                )}
              </div>

              {/* ─── Stylized Divider ─── */}
              <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                margin: '20px 0',
                color: 'var(--text-muted)',
                fontSize: '0.75rem',
                fontWeight: 700,
                letterSpacing: '1.5px',
                textTransform: 'uppercase'
              }}>
                <div style={{ flex: 1, height: '1px', background: 'rgba(255, 255, 255, 0.08)' }} />
                <span style={{ padding: '0 16px', opacity: 0.6 }}>OR</span>
                <div style={{ flex: 1, height: '1px', background: 'rgba(255, 255, 255, 0.08)' }} />
              </div>

              {/* ─── File Drop Box ─── */}
              <div 
                className="upload-box" 
                style={{ 
                  opacity: (canUpload || isAdmin) ? (url ? 0.6 : 1) : 0.5, 
                  pointerEvents: (canUpload || isAdmin) ? 'auto' : 'none',
                  transition: 'opacity 0.2s ease'
                }}
              >
                <Upload size={44} color="var(--accent-color)" style={{ marginBottom: '14px' }} />
                <h2 style={{ marginBottom: '6px', fontSize: '1.25rem' }}>Drop your video file here</h2>
                <p style={{ color: 'var(--text-muted)', marginBottom: '20px', fontSize: '0.875rem' }}>
                  MP4, MOV, or WEBM up to unlimited size
                </p>
                
                <input 
                  type="file" 
                  onChange={handleFileChange} 
                  accept="video/*"
                  aria-label="Upload video file"
                  disabled={!canUpload && !isAdmin}
                  style={{
                    position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', opacity: 0, cursor: (canUpload || isAdmin) ? 'pointer' : 'not-allowed'
                  }}
                />
                <button className="neu-btn" style={{ pointerEvents: 'none' }}>Choose File</button>
              </div>

              {file && (
                <div style={{ marginTop: '16px', marginBottom: '24px', color: 'var(--accent-color)', fontWeight: 'bold' }}>
                  Ready to process: {file.name} ({(file.size / (1024 * 1024)).toFixed(1)} MB)
                </div>
              )}

              <button 
                className="neu-btn-primary" 
                onClick={startProcessing} 
                disabled={(!canUpload && !isAdmin) || !hasInput}
                style={{ 
                  width: '100%', 
                  padding: '16px', 
                  fontSize: '1.1rem', 
                  marginTop: '20px',
                  opacity: (canUpload || isAdmin) && hasInput ? 1 : 0.5,
                  cursor: (canUpload || isAdmin) && hasInput ? 'pointer' : 'not-allowed'
                }}
              >
                <PlayCircle size={22} /> {url ? 'Fetch & Generate Clips' : 'Generate Clips'}
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
              
              <h2 style={{ marginBottom: '8px', fontSize: '1.5rem', fontWeight: 'bold' }} className="kinetic-text">{progressText}</h2>
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
