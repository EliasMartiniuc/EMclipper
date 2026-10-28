# EMclipper

AI video clipping with React/Vite, FastAPI, FFmpeg, and Supabase.

## Clip editor

Open a project and click **Edit** on a generated clip. The workspace route is
`/projects/:projectId/editor/:clipId`. It includes a 9:16 monitor, live caption
editing and styling, and zoomable video and caption tracks.

Video edits use a **contiguous ripple timeline**: deleting, trimming, reordering,
and inserting video move the affected captions with the footage. Drag video
blocks to reorder them and drag their edges to trim. Caption blocks can be moved
and trimmed independently. Paste inserts at the playhead and splits the
destination segment when necessary. Video source ranges are limited to the
initial clip. Full-video timestamps are retained as `original_start`/`original_end`.

Word corrections with the same word count preserve original timestamps. Adding
or removing words redistributes the line's timing evenly. Changing line timing
scales its word timings. Preview and export use the same server font files,
colors, outline, shadow, and vertical position. Exports are 1080 × 1920 at 30 FPS.
Missing optional fonts fall back to bundled Arial in both views.

### Setup

For the security updates, apply `migrations/20261028_security_controls.sql` before
deploying **both** backend and frontend. It adds server-only processing/deletion
state and durable media tombstones independent of project/account deletion.
The backend requires `SUPABASE_SERVICE_ROLE_KEY`. Existing RLS policies remain
required; browser project writes are limited to the fields the UI uses.

Uploads now create their project before sending chunks, accept chunks up to
8 MiB, reject duplicates/out-of-order chunks, and enforce a default 128 MiB
per-file and total temporary-storage budget per instance. Set `MAX_UPLOAD_BYTES`
and `MAX_UPLOAD_STORAGE_BYTES` only according to the worker's disk/memory capacity.
Abandoned uploads expire after 24 hours on the next upload; processing cleans
its input files when it finishes. Request-body limits apply before parsing.
Paid usage resets only through verified renewal events, never status reads.
Both media retrieval routes deny retired/deleted project IDs across instances;
retired IDs cannot be reused to recover old local files.

1. Apply `migrations/20261023_clip_editor.sql` in the Supabase SQL editor **before
   deploying the frontend or generating new clips**. Existing RLS policies remain
   in place; the editor APIs verify ownership of the parent project.
2. Keep the existing backend Supabase and R2 settings. The backend service role
   needs project read and clip update access. FFmpeg/FFprobe with libx264, libass,
   and drawtext are required; the Dockerfile installs FFmpeg and fonts.
3. Run `python main.py`, then `cd frontend`, `npm install`, and `npm run dev`.
   Vite proxies `/api` and `/outputs` to port 8000. Build with `npm run build`.

New clips retain a playable source without captions alongside the rendered
output, and save word timestamps. This adds one source encode and a second video
file per clip. Existing clips open with a baked-caption notice: their old burned
text cannot be removed. On first export, their original media is frozen as the
edit source so repeated exports do not compound edits.

**Save draft** persists a versioned document in Supabase. Browser backup recovers
unsaved changes after navigation or refresh. Export saves the draft first,
renders a snapshot, and updates the clip's output URL/duration on success. Later
draft edits remain independent of an export in progress.

### API

Clip data endpoints require `Authorization: Bearer <Supabase access token>`.
Only the parent project's owner can load, save, render, or poll a clip.

| Method | Endpoint | Result |
| --- | --- | --- |
| GET | `/api/clips/{clip_id}/editor` | Clip, source metadata, initial subtitles, saved draft |
| PUT | `/api/clips/{clip_id}/draft` | Save `{ version: 1, savedAt, document }` |
| POST | `/api/clips/{clip_id}/re-render` | `202 { render_id, status: "queued", progress }` |
| GET | `/api/clips/{clip_id}/renders/{render_id}` | Status; `video_url` when completed |

The re-render body accepts `segments: [{ source_start, source_end }]`,
`subtitles: [{ text, start, end, words?: [{ word, start, end }] }]`, and `style`.
Source times use the original full-video clock; `source_time_offset` maps them
to the retained highlight file. Subtitle times refer to assembled output.
Segment **array order** determines playback order. Styles accept ASS
`&HAABBGGRR` or CSS `#RRGGBB` colors. Style fields: `font`, `font_size`,
`primary_color`, `secondary_color`, `outline_color`, `outline`, `shadow`, and
`position` (percent from top). Omitted fields use defaults.

Validation rejects invalid times, out-of-range sources, caption/word mismatches,
unsafe fonts/colors, more than 128 segments, and output longer than 30 minutes.
Sources resolve only from the owner's configured media storage: requests cannot
supply arbitrary URLs or filesystem paths. ASS text is escaped. Free-tier exports
retain a watermark.

Exports use FastAPI background tasks with one renderer and at most three admitted
jobs per process. R2 stores status across instances; without R2, local output
storage must persist. Keep workers alive and CPU available after the HTTP response.
Execution is process-bound: a restart interrupts work and requires a retry. Use a
durable external worker queue for deployments requiring restart recovery. Stale
queued/rendering status is reported as interrupted. Configure R2 media for browser
playback and HTTP byte-range requests.

### Shortcuts

| Shortcut | Action |
| --- | --- |
| Space | Play/pause |
| Left / Right | Step 1/30 second |
| Shift + Left / Right | Step one second |
| V | Select tool |
| C | Blade tool and split at playhead |
| Ctrl/Cmd + C / V | Copy / paste video segment |
| Delete / Backspace | Remove selected video or caption |
| Ctrl/Cmd + Z / Y | Undo / redo (Cmd + Shift + Z also works) |
| Ctrl/Cmd + S | Save draft |

Text inputs and inspector sliders do not trigger timeline shortcuts.

### Verification

- `cd frontend; npm test`: immutable timeline, ripple caption mapping, edits,
  source coordinate conversion, and gesture history.
- `python -m unittest discover -s tests -v`: API authentication/ownership, source
  isolation, validation, drafts, and real FFmpeg exports for audio/silent inputs.
  Install `httpx` in the test environment for TestClient.
- `cd frontend; npm run build` and `npm run lint`.
- With Vite running and Playwright in the development Node environment, run
  `node tests/browser-smoke.cjs` from `frontend`. It uses a local video and mocked
  APIs, verifies editing/playback in Edge, and saves screenshots under
  `temp/editor-smoke`. Set `PLAYWRIGHT_CHANNEL` for another installed Chromium
  channel. The fixture is excluded from production and does not touch an account.
