import React, { useState, useRef, useEffect } from 'react';
import { Upload, XCircle, PlayCircle, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const API = ''; // Empty for same-origin

export default function Home() {
  const navigate = useNavigate();
  const [file, setFile] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressText, setProgressText] = useState('');
  const [speedText, setSpeedText] = useState('');
  const [logs, setLogs] = useState([]);
  const [error, setError] = useState('');
  const abortControllerRef = useRef(null);
  const logEndRef = useRef(null);

  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      setFile(e.target.files[0]);
      setError('');
    }
  };

  const stopProcessing = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setIsProcessing(false);
    setProgressText('Processing stopped.');
    setLogs(prev => [...prev, { level: 'error', message: 'User stopped processing.' }]);
  };

  const startProcessing = async () => {
    if (!file) {
      setError('Please select a video file first.');
      return;
    }

    setIsProcessing(true);
    setError('');
    setLogs([]);
    setProgress(0);
    setProgressText('Starting upload...');
    setSpeedText('');

    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    try {
      const jobId = crypto.randomUUID();
      const filename = file.name;
      
      const chunkSize = 5 * 1024 * 1024;
      const totalChunks = Math.ceil(file.size / chunkSize);
      const startTime = Date.now();

      for (let i = 0; i < totalChunks; i++) {
        if (signal.aborted) throw new Error("AbortError");
        
        const start = i * chunkSize;
        const end = Math.min(start + chunkSize, file.size);
        const chunk = file.slice(start, end);
        
        const chunkData = new FormData();
        chunkData.append('job_id', jobId);
        chunkData.append('chunk_index', i);
        chunkData.append('total_chunks', totalChunks);
        chunkData.append('filename', filename);
        chunkData.append('chunk', chunk);
        
        const uploadRes = await fetch(`${API}/api/upload_chunk`, {
          method: 'POST',
          body: chunkData,
          signal
        });
        
        if (!uploadRes.ok) {
          throw new Error(`Chunk upload failed: ${await uploadRes.text()}`);
        }
        
        const currentProgress = Math.round(((i + 1) / totalChunks) * 100);
        setProgress(currentProgress);
        setProgressText(`Uploading... ${currentProgress}%`);
        
        const elapsedSeconds = (Date.now() - startTime) / 1000;
        const speedMBps = ((end / (1024 * 1024)) / elapsedSeconds).toFixed(1);
        setSpeedText(`${speedMBps} MB/s`);
      }

      setProgressText('Upload Complete! Starting AI Processing...');

      const formData = new FormData();
      formData.append('subtitles_enabled', 'true');
      formData.append('job_id', jobId);
      formData.append('filename', filename);

      const response = await fetch(`${API}/api/process_stream`, {
        method: 'POST',
        body: formData,
        signal
      });

      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        
        let boundary = buffer.indexOf('\n\n');
        if (boundary === -1) boundary = buffer.indexOf('\r\n\r\n');
        
        while (boundary !== -1) {
          const separatorLen = buffer.startsWith('\r\n', boundary) ? 4 : 2;
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + separatorLen);
          
          let eventType = 'message';
          let dataStr = '';
          
          const lines = block.split(/\r?\n/);
          for (const line of lines) {
            if (line.startsWith('event: ')) {
              eventType = line.substring(7).trim();
            } else if (line.startsWith('data: ')) {
              dataStr += line.substring(6);
            }
          }
          
          if (dataStr) {
            try {
              const parsed = JSON.parse(dataStr);
              if (parsed.message) {
                setLogs(prev => [...prev, { level: parsed.level || 'info', message: parsed.message }]);
                setProgressText(parsed.message);
              }
              if (eventType === 'done' || eventType === 'error') {
                setIsProcessing(false);
                if (eventType === 'done') {
                  // Wait 1 second, then navigate to the project dashboard for this video
                  setTimeout(() => {
                     navigate(`/projects/${jobId}`);
                  }, 1000);
                }
              }
            } catch(e) {
              // Not JSON
            }
          }
          
          boundary = buffer.indexOf('\n\n');
          if (boundary === -1) boundary = buffer.indexOf('\r\n\r\n');
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error(err);
        setError('Connection lost or processing failed.');
        setIsProcessing(false);
      }
    }
  };

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
