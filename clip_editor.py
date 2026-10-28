"""Authenticated editor API. Never accept media URLs or paths from a render payload."""
import json
import logging
import re
import shutil
import tempfile
import threading
import time
import uuid
from pathlib import Path
from urllib.parse import unquote, urlparse

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request
from fastapi.responses import FileResponse
from starlette.concurrency import run_in_threadpool

from config import OUTPUTS_DIR, TEMP_DIR, R2_BUCKET_NAME, R2_PUBLIC_URL, ADMIN_EMAIL
from editor_schemas import DraftRequest, RenderRequest, SourceSegment
from editor_renderer import render_edit
from editor_fonts import resolve_font

logger = logging.getLogger(__name__)
# Bound expensive FFmpeg workers per server process. R2 stores status across instances.
render_slots = threading.BoundedSemaphore(1)
queue_slots = threading.BoundedSemaphore(3)


def validate_source_bounds(clip, segments):
    clean = bool(clip.get("source_video_url"))
    lower = float(clip.get("source_start") or 0) if clean else 0.0
    upper = float(clip.get("source_end") or lower + clip["duration"]) if clean else float(clip.get("source_duration") or clip["duration"])
    for segment in segments:
        if segment.source_start < lower - 0.001 or segment.source_end > upper + 0.001:
            raise HTTPException(422, "A segment is outside this clip's source range")


def media_key(url, project_id):
    """Only media already stored under the owner's project may be opened."""
    parsed, public = urlparse(url), urlparse(R2_PUBLIC_URL)
    prefix = public.path.rstrip("/") + "/"
    if public.netloc and parsed.scheme == public.scheme and parsed.netloc == public.netloc and parsed.path.startswith(prefix):
        key = unquote(parsed.path[len(prefix):])
    elif not parsed.netloc and parsed.path.startswith("/outputs/"):
        key = unquote(parsed.path[len("/outputs/"):])
    else:
        raise ValueError("This clip's source is not in configured media storage")
    parts = key.replace("\\", "/").split("/")
    if not parts or parts[0] != str(project_id) or any(p in ("", ".", "..") for p in parts) or ":" in key:
        raise ValueError("Invalid source media path")
    return key


def create_editor_router(db, storage, authenticate, subscription):
    router = APIRouter(prefix="/api/clips", tags=["Clip editor"])

    @router.get("/fonts/{font}")
    async def font_file(font: str):
        try:
            _, path = resolve_font(font)
        except ValueError:
            raise HTTPException(404, "Font not found")
        return FileResponse(path, media_type="font/ttf", headers={"Cache-Control": "public, max-age=86400"})

    async def owned_clip(clip_id, request):
        if db is None:
            raise HTTPException(503, "Database service is unavailable")
        user = await authenticate(request)
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", clip_id):
            raise HTTPException(400, "Invalid clip ID")
        result = await run_in_threadpool(lambda: db.table("clips").select("*").eq("id", clip_id).execute())
        if not result.data:
            raise HTTPException(404, "Clip not found")
        clip = result.data[0]
        retired = await run_in_threadpool(lambda: db.table('media_tombstones').select('project_id').eq('project_id', str(clip['project_id'])).execute())
        if retired.data:
            raise HTTPException(404, 'Clip not found')
        project = await run_in_threadpool(lambda: db.table("projects").select("user_id, media_deleted_at").eq("id", clip["project_id"]).execute())
        if not project.data or project.data[0].get('media_deleted_at') or str(project.data[0]["user_id"]) != str(user.id):
            raise HTTPException(404, "Clip not found")
        return clip, user

    def status_key(clip, render_id):
        return f"{clip['project_id']}/renders/{clip['id']}/{render_id}.json"

    def write_status(clip, state):
        state["updated_at"] = time.time()
        key = status_key(clip, state["render_id"])
        data = json.dumps(state).encode()
        if storage:
            storage.put_object(Bucket=R2_BUCKET_NAME, Key=key, Body=data, ContentType="application/json")
        path = OUTPUTS_DIR / key
        path.parent.mkdir(parents=True, exist_ok=True)
        temp = path.with_suffix(f".{uuid.uuid4().hex}.tmp")
        temp.write_bytes(data)
        temp.replace(path)

    def worker(clip, payload, render_id, watermark):
        state = {"render_id": render_id, "status": "queued", "progress": 0}
        try:
            with render_slots:
                state["status"] = "rendering"
                write_status(clip, state)
                TEMP_DIR.mkdir(parents=True, exist_ok=True)
                with tempfile.TemporaryDirectory(prefix="edit-", dir=TEMP_DIR) as folder:
                    workspace = Path(folder)
                    key = media_key(clip.get("source_video_url") or clip["video_url"], clip["project_id"])
                    local = (OUTPUTS_DIR / key).resolve()
                    if not local.is_relative_to(OUTPUTS_DIR.resolve()):
                        raise ValueError("Invalid media path")
                    if local.exists():
                        source = local
                    elif storage:
                        source = workspace / "source.mp4"
                        storage.download_file(R2_BUCKET_NAME, key, str(source))
                    else:
                        raise ValueError("The source video has expired or is unavailable")
                    output_key = f"{clip['project_id']}/edited_{render_id}.mp4"
                    output = workspace / "export.mp4"

                    def progress(value):
                        state["progress"] = value
                        write_status(clip, state)

                    # The retained file starts at zero; the public EDL/draft uses
                    # timestamps in the original full-video source clock.
                    offset = float(clip.get("source_time_offset") or 0)
                    render_payload = payload.model_copy(update={"segments": [
                        SourceSegment(source_start=max(0, s.source_start - offset), source_end=s.source_end - offset)
                        for s in payload.segments
                    ]})
                    render_edit(source, render_payload, output, workspace, watermark=watermark, progress=progress)
                    progress(90)
                    # Re-check existence before publishing if the project was deleted while rendering.
                    project = db.table("projects").select("id, media_deleted_at").eq("id", clip["project_id"]).execute()
                    retired = db.table('media_tombstones').select('project_id').eq('project_id', str(clip['project_id'])).execute()
                    if retired.data or not project.data or project.data[0].get('media_deleted_at'):
                        raise ValueError("The project was deleted during export")
                    if storage:
                        storage.upload_file(str(output), R2_BUCKET_NAME, output_key, ExtraArgs={"ContentType": "video/mp4"})
                        video_url = f"{R2_PUBLIC_URL.rstrip('/')}/{output_key}"
                    else:
                        destination = OUTPUTS_DIR / output_key
                        destination.parent.mkdir(parents=True, exist_ok=True)
                        shutil.copy2(output, destination)
                        video_url = f"/outputs/{output_key}"
                    # A deletion may race the preceding existence check/upload.
                    retired = db.table('media_tombstones').select('project_id').eq('project_id', str(clip['project_id'])).execute()
                    project = db.table('projects').select('id, media_deleted_at').eq('id', clip['project_id']).execute()
                    if retired.data or not project.data or project.data[0].get('media_deleted_at'):
                        if storage:
                            storage.delete_object(Bucket=R2_BUCKET_NAME, Key=output_key)
                        else:
                            (OUTPUTS_DIR / output_key).unlink(missing_ok=True)
                        raise ValueError('Project deleted during publication')
                    update = {"video_url": video_url, "duration": sum(s.source_end - s.source_start for s in payload.segments)}
                    if not clip.get("source_video_url"):
                        # Freeze the original legacy file as source before changing video_url.
                        update.update(source_video_url=clip["video_url"], source_start=0,
                                      source_end=clip.get("source_duration") or clip["duration"], source_has_baked_subtitles=True)
                    # Drafts remain independently saved; an export never overwrites later edits.
                    result = db.table("clips").update(update).eq("id", clip["id"]).execute()
                    if not result.data:
                        raise ValueError("The clip could not be updated")
                    state.update(status="completed", progress=100, video_url=video_url)
                    write_status(clip, state)
        except Exception:
            logger.exception("Clip export %s failed", render_id)
            state.update(status="failed", error="Export failed. Check that the source is still available and try again.")
            try:
                write_status(clip, state)
            except Exception:
                logger.exception("Could not persist export failure")
        finally:
            queue_slots.release()

    @router.get("/{clip_id}/editor")
    async def load_editor(clip_id: str, request: Request):
        clip, _ = await owned_clip(clip_id, request)
        if not clip.get("video_url"):
            raise HTTPException(409, "This clip has no playable video")
        # Legacy media duration must stay stable after exports change output duration.
        if not clip.get("source_video_url") and not clip.get("source_duration"):
            clip["source_duration"] = clip["duration"]
        return clip

    @router.put("/{clip_id}/draft")
    async def save_draft(clip_id: str, payload: DraftRequest, request: Request):
        clip, _ = await owned_clip(clip_id, request)
        segments = [SourceSegment(source_start=s.sourceStart, source_end=s.sourceEnd) for s in payload.document.tracks[0].segments]
        validate_source_bounds(clip, segments)
        draft = payload.model_dump(mode="json")
        draft["savedAt"] = int(time.time() * 1000)
        try:
            result = await run_in_threadpool(lambda: db.table("clips").update({"title": payload.document.title, "editor_draft": draft}).eq("id", clip_id).execute())
            if not result.data:
                raise RuntimeError("No clip updated")
        except Exception as exc:
            logger.exception("Draft save failed")
            raise HTTPException(503, "Draft could not be saved. Ensure the clip editor database migration has been applied.") from exc
        return {"status": "saved", "savedAt": draft["savedAt"]}

    @router.post("/{clip_id}/re-render", status_code=202)
    async def re_render(clip_id: str, payload: RenderRequest, request: Request, tasks: BackgroundTasks):
        clip, user = await owned_clip(clip_id, request)
        validate_source_bounds(clip, payload.segments)
        try:
            media_key(clip.get("source_video_url") or clip["video_url"], clip["project_id"])
        except ValueError as exc:
            raise HTTPException(409, str(exc)) from exc
        sub = await run_in_threadpool(subscription, user.id, user.email or "")
        is_admin = bool(ADMIN_EMAIL and (user.email or "").lower() == ADMIN_EMAIL.lower())
        watermark = sub.get("tier", "free") == "free" and not is_admin
        render_id = str(uuid.uuid4())
        state = {"render_id": render_id, "status": "queued", "progress": 0}
        if not queue_slots.acquire(blocking=False):
            raise HTTPException(429, "The export queue is full. Please try again shortly.")
        try:
            await run_in_threadpool(write_status, clip, state)
        except Exception as exc:
            queue_slots.release()
            raise HTTPException(503, "Export storage is unavailable. Please try again.") from exc
        tasks.add_task(worker, clip, payload, render_id, watermark)
        return state

    @router.get("/{clip_id}/renders/{render_id}")
    async def render_status(clip_id: str, render_id: str, request: Request):
        clip, _ = await owned_clip(clip_id, request)
        try:
            uuid.UUID(render_id)
        except ValueError:
            raise HTTPException(400, "Invalid render ID")
        key = status_key(clip, render_id)
        try:
            if storage:
                def read_status():
                    body = storage.get_object(Bucket=R2_BUCKET_NAME, Key=key)["Body"]
                    try:
                        return json.loads(body.read())
                    finally:
                        body.close()
                state = await run_in_threadpool(read_status)
            else:
                state = json.loads((OUTPUTS_DIR / key).read_text())
            stale_after = 14400 if state.get("status") == "queued" else 3900
            if state.get("status") in ("queued", "rendering") and time.time() - state.get("updated_at", 0) > stale_after:
                state.update(status="failed", error="This export was interrupted. Please export again; your saved draft is safe.")
            return state
        except Exception as exc:
            raise HTTPException(404, "Export not found") from exc

    return router
