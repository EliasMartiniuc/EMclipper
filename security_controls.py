"""Filesystem confinement and bounded, replay-safe local upload accounting."""
import os
import sqlite3
import time
from contextlib import closing
from pathlib import Path

from fastapi import HTTPException

CHUNK_LIMIT = 8 * 1024 * 1024
UPLOAD_LIMIT = int(os.getenv('MAX_UPLOAD_BYTES', 128 * 1024 * 1024))
STORAGE_LIMIT = int(os.getenv('MAX_UPLOAD_STORAGE_BYTES', 128 * 1024 * 1024))


def contained(root, *parts):
    root = Path(root).resolve()
    candidate = root.joinpath(*parts).resolve()
    if candidate == root or not candidate.is_relative_to(root):
        raise HTTPException(400, 'Invalid file path')
    return candidate


async def append_upload(root, user_id, job_id, filename, index, total, chunk):
    root = Path(root)
    root.mkdir(parents=True, exist_ok=True)
    # Bounded read even for clients that bypass the UI's five-MiB chunks.
    content = await chunk.read(CHUNK_LIMIT + 1)
    if len(content) > CHUNK_LIMIT:
        raise HTTPException(413, 'Chunk exceeds the 8 MiB limit')
    with closing(sqlite3.connect(root / '.uploads.sqlite3', timeout=10)) as db:
        db.execute('CREATE TABLE IF NOT EXISTS uploads (job TEXT PRIMARY KEY, owner TEXT, filename TEXT, total INTEGER, next INTEGER, size INTEGER, touched REAL)')
        db.execute('BEGIN IMMEDIATE')
        # Expire abandoned upload bytes before accounting. Processing claims
        # remain protected by the project's separate one-shot DB state.
        for job, name in db.execute('SELECT job, filename FROM uploads WHERE touched < ?', (time.time() - 86400,)).fetchall():
            contained(root, job, name).unlink(missing_ok=True)
            db.execute('DELETE FROM uploads WHERE job = ?', (job,))
        row = db.execute('SELECT owner, filename, total, next, size FROM uploads WHERE job = ?', (job_id,)).fetchone()
        if row is None:
            if index != 0:
                raise HTTPException(409, 'Upload must start with chunk zero')
            row = (str(user_id), filename, total, 0, 0)
        if row[:3] != (str(user_id), filename, total) or row[3] != index:
            raise HTTPException(409, 'Duplicate, out-of-order, or inconsistent upload chunk')
        # Include pre-upgrade/untracked temporary files, not only ledger rows.
        ledger_names = {'.uploads.sqlite3', '.uploads.sqlite3-journal', '.uploads.sqlite3-wal', '.uploads.sqlite3-shm'}
        used = sum(p.stat().st_size for p in root.rglob('*') if p.is_file() and not (p.parent == root and p.name in ledger_names))
        if row[4] + len(content) > UPLOAD_LIMIT or used + len(content) > STORAGE_LIMIT:
            raise HTTPException(413, 'Upload storage limit reached; remove an upload or retry after expiry')
        path = contained(root, job_id, filename)
        path.parent.mkdir(parents=True, exist_ok=True)
        if not path.exists() and row[4]:
            raise HTTPException(409, 'Upload expired; start a new project')
        if path.exists() and path.stat().st_size != row[4]:
            raise HTTPException(409, 'Upload file does not match its recorded size')
        try:
            with path.open('r+b' if path.exists() else 'wb') as target:
                target.seek(row[4])
                target.write(content)
            db.execute('INSERT OR REPLACE INTO uploads VALUES (?, ?, ?, ?, ?, ?, ?)',
                       (job_id, str(user_id), filename, total, index + 1, row[4] + len(content), time.time()))
            db.commit()
        except Exception:
            if path.exists():
                with path.open('r+b') as target:
                    target.truncate(row[4])
            raise


def upload_complete(root, job_id, filename):
    if not (Path(root) / '.uploads.sqlite3').exists():
        raise HTTPException(409, 'Upload is incomplete')
    with closing(sqlite3.connect(Path(root) / '.uploads.sqlite3')) as db:
        row = db.execute('SELECT filename, total, next FROM uploads WHERE job = ?', (job_id,)).fetchone()
    if not row or row[0] != filename or row[1] != row[2]:
        raise HTTPException(409, 'Upload is incomplete')


def remove_local_project(project_id, roots):
    import shutil
    for root in roots:
        path = contained(root, project_id)
        if path.exists():
            shutil.rmtree(path)
    root = Path(roots[-1])
    if (root / '.uploads.sqlite3').exists():
        with closing(sqlite3.connect(root / '.uploads.sqlite3')) as db:
            db.execute('DELETE FROM uploads WHERE job = ?', (project_id,))
            db.commit()


class BodyLimitMiddleware:
    """Enforce the limit before multipart parsing can spool attacker bytes."""
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http' or scope['method'] not in ('POST', 'PUT', 'PATCH'):
            return await self.app(scope, receive, send)
        limit = CHUNK_LIMIT + 1024 * 1024 if scope['path'] == '/api/upload_chunk' else 2 * 1024 * 1024
        body = bytearray()
        while True:
            message = await receive()
            if message['type'] == 'http.disconnect':
                return
            chunk = message.get('body', b'')
            if len(body) + len(chunk) > limit:
                from starlette.responses import PlainTextResponse
                return await PlainTextResponse('Request body too large', status_code=413)(scope, receive, send)
            body.extend(chunk)
            if not message.get('more_body', False):
                break
        delivered = False
        async def bounded_receive():
            nonlocal delivered
            if not delivered:
                delivered = True
                return {'type': 'http.request', 'body': bytes(body), 'more_body': False}
            return await receive()
        await self.app(scope, bounded_receive, send)
