import React, { useEffect, useRef } from 'react';
import { Upload, XCircle, PlayCircle, Loader2 } from 'lucide-react';
import { useUpload } from '../UploadContext';

export default function Home() {
  const {
    file, handleFileChange, isProcessing, progress, progressText, 
    speedText, logs, error, startProcessing, stopProcessing
  } = useUpload();
  
  const logEndRef = useRef(null);

  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  return (
    <div>
      <div style={{ textAlign: 'center', marginBottom: '60px' }}>
        <h1 className="kinetic-text" style={{ fontSize: '3.5rem', marginBottom: '16px' }}>
          AI that turns long videos into viral shorts in seconds.
        </h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '1.25rem' }}>
          Upload your podcast or vlog. We find the highlights and generate TikTok-ready clips automatically.
        </p>
      </div>

      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <div className="neu-card" style={{ width: '100%', maxWidth: '600px', textAlign: 'center' }}>
          {error && <div style={{ color: 'red', marginBottom: '16px', fontWeight: 'bold' }}>{error}</div>}
          
          {!isProcessing ? (
            <>
              <div style={{ 
                border: '2px dashed var(--shadow-dark)', 
                borderRadius: '16px', 
                padding: '40px', 
                marginBottom: '24px',
                position: 'relative'
              }}>
                <Upload size={48} color="var(--accent-color)" style={{ marginBottom: '16px' }} />
                <h3 style={{ marginBottom: '8px' }}>Drop your video file here</h3>
                <p style={{ color: 'var(--text-muted)', marginBottom: '24px', fontSize: '0.875rem' }}>MP4, MOV, or WEBM up to unlimited size</p>
                
                <input 
                  type="file" 
                  onChange={handleFileChange} 
                  accept="video/*"
                  style={{
                    position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer'
                  }}
                />
                <button className="neu-btn" style={{ pointerEvents: 'none' }}>Choose File</button>
              </div>

              {file && (
                <div style={{ marginBottom: '24px', color: 'var(--accent-color)', fontWeight: 'bold' }}>
                  Ready to process: {file.name} ({(file.size / (1024 * 1024)).toFixed(1)} MB)
                </div>
              )}

              <button className="neu-btn-primary" onClick={startProcessing} style={{ width: '100%', padding: '16px', fontSize: '1.1rem' }}>
                <PlayCircle size={24} /> Generate Clips
              </button>
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
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
