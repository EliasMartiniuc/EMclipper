import React, { createContext, useContext, useState, useRef, useMemo, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from './supabase';
import { useAuth } from './AuthContext';

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
  const [thumbnail, setThumbnail] = useState(null);
  const [hasClips, setHasClips] = useState(false);
  const [subscriptionStatus, setSubscriptionStatus] = useState(null);
  const abortControllerRef = useRef(null);
  
  const navigate = useNavigate();
  const { user } = useAuth();

  // Fetch subscription status whenever user changes
  const fetchSubscriptionStatus = useCallback(async () => {
    if (!user) {
      setSubscriptionStatus(null);
      return;
    }
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      
      const res = await fetch(`${API}/api/subscription-status`, {
        headers: { 'Authorization': `Bearer ${session.access_token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setSubscriptionStatus(data);
      }
    } catch (err) {
      console.error("Failed to fetch subscription status:", err);
    }
  }, [user]);

  useEffect(() => {
    fetchSubscriptionStatus();
  }, [fetchSubscriptionStatus]);

  const generateThumbnail = (videoFile) => {
    const video = document.createElement('video');
    const url = URL.createObjectURL(videoFile);
    video.src = url;
    video.muted = true;
    video.playsInline = true;
    
    video.onloadedmetadata = () => {
      video.currentTime = Math.min(1.0, video.duration / 2);
    };
    
    video.onseeked = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = 180;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      setThumbnail(canvas.toDataURL('image/jpeg', 0.7));
      URL.revokeObjectURL(url);
    };

    video.onerror = () => {
      URL.revokeObjectURL(url);
    };
  };

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      setFile(e.target.files[0]);
      setError('');
      setThumbnail(null);
      generateThumbnail(e.target.files[0]);
    }
  };

  const stopProcessing = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    if (activeJobId) {
      fetch(`${API}/api/cancel/${activeJobId}`, { method: 'POST' }).catch(() => {});
    }
    setIsProcessing(false);
    setActiveJobId(null);
    setHasClips(false);
    setProgressText('Processing stopped.');
    setLogs(prev => [...prev, { level: 'error', message: 'User stopped processing.' }]);
  };

  const startProcessing = async () => {
    if (!file) {
      setError("Please select a video file.");
      return;
    }
    if (!user) {
      setError("You must be logged in to upload and save projects.");
      return;
    }

    // Check subscription limits before processing
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        const res = await fetch(`${API}/api/subscription-status`, {
          headers: { 'Authorization': `Bearer ${session.access_token}` }
        });
        if (res.ok) {
          const status = await res.json();
          setSubscriptionStatus(status);
          if (!status.can_upload) {
            if (status.tier === 'free') {
              setError(`You've used all ${status.upload_limit} free uploads. Upgrade to Pro or Ultra to continue!`);
            } else {
              setError(`You've reached your monthly limit of ${status.upload_limit} uploads. Your limit resets next billing cycle.`);
            }
            return;
          }
        }
      }
    } catch (err) {
      console.error("Failed to check subscription:", err);
    }

    setIsProcessing(true);
    setError('');
    setLogs([]);
    setHasClips(false);
    setProgress(0);
    setProgressText('Preparing upload...');
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

      let lastRenderTime = 0;
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
        
        const now = Date.now();
        if (now - lastRenderTime > 150 || i === totalChunks - 1) {
          const currentProgress = Math.round(((i + 1) / totalChunks) * 100);
          setProgress(currentProgress);
          setProgressText(`Uploading... ${currentProgress}%`);
          
          const elapsedSeconds = (now - startTime) / 1000;
          const speedMBps = ((end / (1024 * 1024)) / elapsedSeconds).toFixed(1);
          setSpeedText(`${speedMBps} MB/s`);
          lastRenderTime = now;
        }
      }

      setSpeedText('');
      setProgressText('Upload Complete! Starting AI Processing...');

      // Pre-create the Project in Supabase before processing starts
      const { error: projError } = await supabase.from('projects').insert({
        id: jobId,
        user_id: user.id,
        title: filename,
        thumbnail_url: thumbnail || null,
      });
      if (projError) {
        console.error("Failed to create project in database:", projError);
        throw new Error("Database error while creating project.");
      }

      // Increment upload counter
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          await fetch(`${API}/api/increment-upload`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${session.access_token}` }
          });
          fetchSubscriptionStatus();
        }
      } catch (err) {
        console.error("Failed to increment upload counter:", err);
      }

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
                setLogs(prev => {
                  const newLogs = [...prev, { level: parsed.level || 'info', message: parsed.message }];
                  if (newLogs.length > 50) return newLogs.slice(newLogs.length - 50);
                  return newLogs;
                });
                setProgressText(parsed.message);
              }
              if (parsed.clip) {
                setHasClips(true);
                const clipMeta = parsed.clip;
                
                const { error: clipError } = await supabase.from('clips').insert({
                  project_id: jobId,
                  user_id: user.id,
                  title: clipMeta.title,
                  video_url: clipMeta.video_url,
                  score: clipMeta.score,
                  duration: clipMeta.duration,
                  start_time: clipMeta.start_time,
                  end_time: clipMeta.end_time,
                  transcript: clipMeta.transcript
                });
                
                if (clipError) {
                  console.error("Failed to save clip to DB:", clipError);
                } else {
                  window.dispatchEvent(new Event('db-update'));
                }
              }
              if (eventType === 'done' || eventType === 'error') {
                setIsProcessing(false);
                if (eventType === 'done') {
                  setLogs(prev => [...prev, { level: 'success', message: '✓ Processing finished successfully!' }]);
                  setProgressText('✓ Processing finished successfully!');
                  
                  if (parsed.video_title) {
                    await supabase.from('projects')
                      .update({ title: parsed.video_title })
                      .eq('id', jobId)
                      .eq('user_id', user.id);
                  }
                  
                  window.dispatchEvent(new Event('db-update'));

                  setTimeout(() => {
                     setFile(null);
                     setThumbnail(null);
                     navigate(`/projects/${jobId}`);
                  }, 1500);
                } else if (eventType === 'error') {
                  setError(`Processing failed: ${parsed.error || 'Unknown error'}`);
                  setLogs(prev => [...prev, { level: 'error', message: `❌ Error: ${parsed.error}` }]);
                }
              }
            } catch(e) {
              console.warn('SSE parse error:', e);
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

  const contextValue = useMemo(() => ({
    file, handleFileChange, isProcessing, progress, progressText, speedText, logs, error, 
    startProcessing, stopProcessing, activeJobId, hasClips, subscriptionStatus, fetchSubscriptionStatus
  }), [file, isProcessing, progress, progressText, speedText, logs, error, activeJobId, hasClips, subscriptionStatus, fetchSubscriptionStatus]);

  return (
    <UploadContext.Provider value={contextValue}>
      {children}
    </UploadContext.Provider>
  );
}

export function useUpload() {
  return useContext(UploadContext);
}
