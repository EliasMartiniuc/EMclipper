-- Apply before deploying the security fixes.
alter table public.projects
  add column if not exists processing_started_at timestamptz,
  add column if not exists media_deleted_at timestamptz;

-- Independent of project/auth cascades: retired IDs must never expose copies
-- left on another instance even if a client reuses a deleted project UUID.
create table if not exists public.media_tombstones (project_id text primary key);
alter table public.media_tombstones enable row level security;
revoke all on public.media_tombstones from anon, authenticated;
grant all on public.media_tombstones to service_role;

-- Only backend service-role operations may claim processing or deletion state.
-- Keep existing RLS policies; prevent clients granting themselves backend state.
revoke insert, update on public.projects from anon, authenticated;
grant insert (id, user_id, title, thumbnail_url) on public.projects to authenticated;
grant update (title, thumbnail_url) on public.projects to authenticated;
