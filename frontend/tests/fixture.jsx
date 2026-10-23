// Isolated browser fixture. This is not imported by the production entry point.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { EditorWorkspace } from '../src/pages/ClipEditor';
import { supabase } from '../src/supabase';
import '../src/index.css';

supabase.auth.getSession = async () => ({ data: { session: { access_token: 'browser-test-only' } } });
const clip = { id: 'browser-test', project_id: 'fixture', title: 'The moment everything changed', duration: 8,
  video_url: '/__editor_fixture.mp4', source_video_url: '/__editor_fixture.mp4', source_start: 12.5, source_end: 20.5, source_time_offset: 12.5,
  subtitles: [
    { word: 'Every', start: 0.2, end: 0.7 }, { word: 'great', start: 0.7, end: 1.2 }, { word: 'story', start: 1.2, end: 1.8 }, { word: 'starts', start: 1.8, end: 2.4 },
    { word: 'with', start: 2.6, end: 3 }, { word: 'one', start: 3, end: 3.6 }, { word: 'small', start: 3.6, end: 4.2 }, { word: 'step.', start: 4.2, end: 4.9 },
    { word: 'Make', start: 5.2, end: 5.7 }, { word: 'yours', start: 5.7, end: 6.3 }, { word: 'count.', start: 6.3, end: 7.3 },
  ] };
createRoot(document.getElementById('root')).render(<BrowserRouter><EditorWorkspace clip={clip} /></BrowserRouter>);
