import React, { createContext, useContext, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

const UploadContext = createContext();
const API = '';

export function UploadProvider({ children }) {
  const [file, setFile] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressText, setProgressText] = useState('');
  const [speedText, setSpeedText] = useState('');
  const [logs, setLogs] = useState([]);
  const [error, setError] = useState('');
  const [activeJobId, setActiveJobId] = useState(null);
  const abortControllerRef = useRef(null);
  
  const navigate = useNavigate();

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
    setActiveJobId(null);
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
      setActiveJobId(jobId);
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

      setSpeedText('');
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
        if (done) {
          setIsProcessing(false);
          break;
        }

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
              if (parsed.clip) {
                // Save it to localStorage instantly!
                const saved = JSON.parse(localStorage.getItem('projects') || '[]');
                let projIndex = saved.findIndex(p => p.id === jobId);
                if (projIndex === -1) {
                  // create skeleton
                  saved.unshift({ 
                    id: jobId, 
                    title: filename, 
                    date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }), 
                    clips: [parsed.clip] 
                  });
                } else {
                  saved[projIndex].clips.push(parsed.clip);
                }
                localStorage.setItem('projects', JSON.stringify(saved));
                
                // Fire a custom event so ProjectDetail can re-render!
                window.dispatchEvent(new Event('local-storage-update'));
              }
              if (eventType === 'done' || eventType === 'error') {
                setIsProcessing(false);
                if (eventType === 'done') {
                  setLogs(prev => [...prev, { level: 'success', message: 'Processing finished successfully!' }]);
                  setProgressText('Processing finished successfully!');
                  
                  // Save project data to localStorage
                  const existingProjects = JSON.parse(localStorage.getItem('projects') || '[]');
                  const newProject = {
                    id: jobId,
                    title: parsed.video_title || filename,
                    date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
                    clips: parsed.clips || []
                  };
                  localStorage.setItem('projects', JSON.stringify([newProject, ...existingProjects]));

                  setTimeout(() => {
                     navigate(`/projects/${jobId}`);
                  }, 1500);
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
    <UploadContext.Provider value={{
      file, handleFileChange, isProcessing, progress, progressText, speedText, logs, error, startProcessing, stopProcessing, activeJobId
    }}>
      {children}
    </UploadContext.Provider>
  );
}

export function useUpload() {
  return useContext(UploadContext);
}
