-- Run this in your Supabase SQL Editor
ALTER TABLE clips
ADD COLUMN start_time FLOAT8,
ADD COLUMN end_time FLOAT8,
ADD COLUMN transcript TEXT;

ALTER TABLE projects
ADD COLUMN source_video_url TEXT;
