import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi.testclient import TestClient
from pydantic import ValidationError
import main
import security_controls as controls
from editor_schemas import RenderRequest, Caption, SubtitleStyle
from editor_renderer import write_editor_ass
from test_clip_editor import Database


class SecurityTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.db = Database()
        self.db.rows['projects'] = [{'id': 'job', 'user_id': 'owner'}]
        self.db.rows['user_subscriptions'] = [{'user_id': 'owner', 'uploads_used': 0}]
        self.patches = [patch.object(main, 'supabase_admin', self.db), patch.object(main, 's3_client', None),
                        patch.object(main, '_check_user_can_upload', return_value=(True, 'free', 0, 2))]
        for name in ['TEMP_DIR', 'OUTPUTS_DIR', 'DOWNLOADS_DIR']:
            folder = self.root / name
            folder.mkdir()
            self.patches.append(patch.object(main, name, folder))
        async def authenticate(_request):
            return SimpleNamespace(id='owner', email='owner@example.test')
        self.patches.append(patch.object(main, 'get_authenticated_user', authenticate))
        for p in self.patches:
            p.start()
        self.client = TestClient(main.app)

    def tearDown(self):
        self.client.close()
        for p in reversed(self.patches):
            p.stop()
        self.tmp.cleanup()

    def upload(self, job='job', index=0, total=1, content=b'video'):
        return self.client.post('/api/upload_chunk', data={'job_id': job, 'filename': 'video.mp4', 'chunk_index': index, 'total_chunks': total}, files={'chunk': ('blob', content)})

    def test_other_owner_cannot_upload_process_or_cancel(self):
        self.db.rows['projects'][0]['user_id'] = 'victim'
        self.assertEqual(self.upload().status_code, 404)
        self.assertEqual(self.client.post('/api/process_stream', data={'job_id': 'job', 'filename': 'video.mp4'}).status_code, 404)
        self.assertEqual(self.client.post('/api/cancel/job').status_code, 404)
        self.assertFalse((main.TEMP_DIR / 'job').exists())

    def test_upload_replay_and_limits_preserve_original(self):
        self.assertEqual(self.upload().status_code, 200)
        self.assertEqual(self.upload().status_code, 409)
        self.assertEqual((main.TEMP_DIR / 'job/video.mp4').read_bytes(), b'video')
        self.db.rows['projects'].append({'id': 'second', 'user_id': 'owner'})
        with patch.object(controls, 'UPLOAD_LIMIT', 4):
            self.assertEqual(self.upload('second').status_code, 413)
        with patch.object(controls, 'STORAGE_LIMIT', 6):
            self.assertEqual(self.upload('second', content=b'xx').status_code, 413)

    def test_body_limit_before_multipart(self):
        response = self.client.post('/api/upload_chunk', content=b'x' * (9 * 1024 * 1024 + 1))
        self.assertEqual(response.status_code, 413)

    def test_owner_cancellation_remains_available(self):
        self.assertEqual(self.client.post('/api/cancel/job').status_code, 200)

    def test_ledger_named_video_cannot_bypass_storage_limit(self):
        self.db.rows['projects'].append({'id': 'second', 'user_id': 'owner'})
        with patch.object(controls, 'STORAGE_LIMIT', 6):
            for job, expected in [('job', 200), ('second', 413)]:
                response = self.client.post('/api/upload_chunk', data={'job_id': job, 'filename': '.uploads.sqlite3.mp4', 'chunk_index': 0, 'total_chunks': 1}, files={'chunk': ('blob', b'video')})
                self.assertEqual(response.status_code, expected)

    def test_account_deletion_cleans_local_only_deployment(self):
        self.db.auth = SimpleNamespace(get_user=lambda _: SimpleNamespace(user=SimpleNamespace(id='owner', email='owner@example.test')),
                                       admin=SimpleNamespace(delete_user=lambda _: None))
        for root in [main.TEMP_DIR, main.DOWNLOADS_DIR, main.OUTPUTS_DIR]:
            (root / 'job').mkdir()
            (root / 'job/video.mp4').write_bytes(b'video')
        with patch.object(main, '_get_or_create_subscription', return_value={}):
            r = self.client.delete('/api/account', headers={'Authorization': 'Bearer test'})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertTrue(self.db.rows['media_tombstones'])
        self.assertFalse((main.OUTPUTS_DIR / 'job').exists())

    def test_owner_can_upload_and_process_complete_file_once(self):
        self.assertEqual(self.upload().status_code, 200)
        with patch.object(main, 'process_video_stateless', return_value=None):
            response = self.client.post('/api/process_stream', data={'job_id': 'job', 'filename': 'video.mp4'})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertIn('completed', response.text)
        self.assertEqual(self.upload(index=1, total=2).status_code, 409)
        self.assertEqual(self.client.post('/api/process_stream', data={'job_id': 'job', 'filename': 'video.mp4'}).status_code, 409)
        self.assertEqual(self.db.rows['user_subscriptions'][0]['uploads_used'], 1)

    def test_traversal_and_normal_spa(self):
        dist = self.root / 'frontend/dist'
        dist.mkdir(parents=True)
        (dist / 'index.html').write_text('index')
        (self.root / 'secret.txt').write_text('sentinel')
        with patch.object(main, 'frontend_dir', dist):
            for url in ['/%2e%2e/%2e%2e/secret.txt', '/..%5C..%5Csecret.txt']:
                r = self.client.get(url)
                self.assertEqual(r.status_code, 400, r.text)
                self.assertNotIn('sentinel', r.text)
            self.assertEqual(self.client.get('/projects/normal/editor/clip').text, 'index')

    def test_deleted_media_blocked_on_both_aliases(self):
        folder = main.OUTPUTS_DIR / 'job'
        folder.mkdir()
        (folder / 'video.mp4').write_bytes(b'video')
        self.assertEqual(self.client.get('/outputs/job/video.mp4').status_code, 200)
        self.assertEqual(self.client.get('/api/download/job/video.mp4').status_code, 200)
        response = self.client.delete('/api/project/job')
        self.assertEqual(response.json()['status'], 'deleted')
        # Simulate another instance retaining or recreating its local copy.
        folder.mkdir(exist_ok=True)
        (folder / 'video.mp4').write_bytes(b'video')
        for url in ['/outputs/job/video.mp4', '/api/download/job/video.mp4']:
            self.assertEqual(self.client.get(url).status_code, 404)
        self.db.rows['projects'].append({'id': 'other', 'user_id': 'owner'})
        self.assertEqual(self.client.get('/outputs/other/%2e%2e/job/video.mp4').status_code, 400)
        # A project UUID reused after the old row was deleted stays retired.
        self.db.rows['projects'][0] = {'id': 'job', 'user_id': 'owner'}
        self.assertEqual(self.client.get('/outputs/job/video.mp4').status_code, 404)


class PureSecurityTests(unittest.TestCase):
    def test_expired_paid_quota_is_not_replenished(self):
        sub = {'tier': 'pro', 'uploads_used': 9999, 'period_end': '2020-01-01T00:00:00Z'}
        with patch.object(main, '_get_or_create_subscription', return_value=sub):
            for _ in range(3):
                self.assertFalse(main._check_user_can_upload('user', 'user@example.test')[0])
        self.assertEqual(sub['uploads_used'], 9999)

    def test_caption_budget_rejects_schema_and_direct_writer(self):
        words = [{'word': 'x', 'start': i / 10, 'end': (i + 1) / 10} for i in range(200)]
        caption = {'text': ' '.join('x' for _ in words), 'start': 0, 'end': 20, 'words': words}
        with self.assertRaises(ValidationError):
            RenderRequest.model_validate({'segments': [{'source_start': 0, 'source_end': 30}], 'subtitles': [caption] * 2000})
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaises(ValueError):
                write_editor_ass(Path(folder) / 'out.ass', [Caption.model_validate(caption)] * 2000, SubtitleStyle())


if __name__ == '__main__':
    unittest.main()
