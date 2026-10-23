-- Run once in the Supabase SQL editor before deploying the editor.
-- Existing clips remain usable; their already-burned captions cannot be removed.
alter table public.clips
  add column if not exists source_video_url text,
  add column if not exists source_start double precision,
  add column if not exists source_end double precision,
  add column if not exists source_time_offset double precision not null default 0,
  add column if not exists original_start double precision,
  add column if not exists original_end double precision,
  add column if not exists source_has_baked_subtitles boolean not null default false,
  add column if not exists subtitles jsonb not null default '[]'::jsonb,
  add column if not exists subtitle_style jsonb,
  add column if not exists editor_draft jsonb;

comment on column public.clips.source_video_url is 'Immutable source, retained independently from the latest export';
comment on column public.clips.subtitles is 'Initial word timestamps relative to the generated clip, in seconds';
comment on column public.clips.editor_draft is 'Versioned editor document; caption times are relative to the output timeline';
