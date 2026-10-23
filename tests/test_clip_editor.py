import copy
import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from pydantic import ValidationError

import clip_editor
from editor_renderer import probe_media, render_edit, write_editor_ass
from editor_schemas import RenderRequest, SubtitleStyle

CLIP_ID = 'b2a62706-44dd-4fa4-9389-f915064d9521'
PROJECT_ID = 'c161dd63-a7a2-488a-a20b-625c6a6e371e'


class Database:
    def __init__(self):
        self.rows = {
            'clips': [{'id': CLIP_ID, 'project_id': PROJECT_ID, 'title': 'Test', 'duration': 4,
                       'video_url': f'/outputs/{PROJECT_ID}/baked.mp4',
                       'source_video_url': f'/outputs/{PROJECT_ID}/source.mp4', 'source_start': 0, 'source_end': 4}],
            'projects': [{'id': PROJECT_ID, 'user_id': 'owner'}],
        }

    def table(self, name):
        return Query(self.rows[name])


class Query:
    def __init__(self, rows):
        self.rows, self.filters, self.changes = rows, [], None

    def select(self, *_):
        return self

    def eq(self, key, value):
        self.filters.append((key, value))
        return self

    def update(self, changes):
        self.changes = changes
        return self

    def execute(self):
        rows = [row for row in self.rows if all(row.get(k) == v for k, v in self.filters)]
        if self.changes:
            for row in rows:
                row.update(self.changes)
        return SimpleNamespace(data=copy.deepcopy(rows))


class EditorAPI(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.root = Path(self.folder.name)
        self.output_patch = patch.object(clip_editor, 'OUTPUTS_DIR', self.root)
        self.temp_patch = patch.object(clip_editor, 'TEMP_DIR', self.root / 'tmp')
        self.output_patch.start()
        self.temp_patch.start()
        (self.root / PROJECT_ID).mkdir()
        (self.root / PROJECT_ID / 'source.mp4').write_bytes(b'source')
        self.db = Database()

        async def auth(request):
            token = request.headers.get('Authorization')
            if not token:
                raise HTTPException(401, 'Not authenticated')
            return SimpleNamespace(id=token, email='test@example.com')

        app = FastAPI()
        app.include_router(clip_editor.create_editor_router(self.db, None, auth, lambda *_: {'tier': 'pro'}))
        self.client = TestClient(app)
        self.headers = {'Authorization': 'owner'}

    def tearDown(self):
        self.client.close()
        self.output_patch.stop()
        self.temp_patch.stop()
        self.folder.cleanup()

    def test_ownership_and_authentication(self):
        url = f'/api/clips/{CLIP_ID}/editor'
        self.assertEqual(self.client.get(url).status_code, 401)
        self.assertEqual(self.client.get(url, headers={'Authorization': 'stranger'}).status_code, 404)
        self.assertEqual(self.client.get(url, headers=self.headers).status_code, 200)

    def test_render_rejects_invalid_ranges(self):
        url = f'/api/clips/{CLIP_ID}/re-render'
        for segments in [[{'source_start': 3, 'source_end': 2}], [{'source_start': 0, 'source_end': 10}], []]:
            result = self.client.post(url, headers=self.headers, json={'segments': segments})
            self.assertEqual(result.status_code, 422)

    def test_export_updates_output_without_replacing_clean_source(self):
        self.db.rows['clips'][0].update(source_start=12.5, source_end=16.5, source_time_offset=12.5)
        def fake_render(_source, payload, output, _workspace, **_options):
            self.assertEqual([(s.source_start, s.source_end) for s in payload.segments], [(2, 4), (0, 1)])
            output.write_bytes(b'export')
        payload = {'segments': [{'source_start': 14.5, 'source_end': 16.5}, {'source_start': 12.5, 'source_end': 13.5}],
                   'subtitles': [{'text': 'Hello', 'start': 0, 'end': 1}]}
        with patch.object(clip_editor, 'render_edit', side_effect=fake_render):
            result = self.client.post(f'/api/clips/{CLIP_ID}/re-render', headers=self.headers, json=payload)
        self.assertEqual(result.status_code, 202, result.text)
        render_id = result.json()['render_id']
        state = self.client.get(f'/api/clips/{CLIP_ID}/renders/{render_id}', headers=self.headers).json()
        self.assertEqual(state['status'], 'completed')
        clip = self.db.rows['clips'][0]
        self.assertEqual(clip['duration'], 3)
        self.assertTrue(clip['source_video_url'].endswith('/source.mp4'))
        self.assertIn('edited_', clip['video_url'])
        self.assertEqual(self.client.get(f'/api/clips/{CLIP_ID}/renders/{render_id}', headers={'Authorization': 'stranger'}).status_code, 404)

    def test_source_path_rejects_traversal_and_external_hosts(self):
        for url in ['http://169.254.169.254/latest', f'/outputs/{PROJECT_ID}/../secret', f'/outputs/{PROJECT_ID}/%2e%2e/secret', '/outputs/other/source.mp4']:
            with self.assertRaises(ValueError):
                clip_editor.media_key(url, PROJECT_ID)

    def test_full_queue_rejects_new_work(self):
        with patch.object(clip_editor, 'queue_slots') as slots:
            slots.acquire.return_value = False
            result = self.client.post(f'/api/clips/{CLIP_ID}/re-render', headers=self.headers,
                                      json={'segments': [{'source_start': 0, 'source_end': 1}]})
            self.assertEqual(result.status_code, 429)

    def test_interrupted_job_can_be_retried(self):
        render_id = '1d2969b3-9f15-4879-833c-6cd008804d68'
        path = self.root / PROJECT_ID / 'renders' / CLIP_ID / f'{render_id}.json'
        path.parent.mkdir(parents=True)
        path.write_text(json.dumps({'render_id': render_id, 'status': 'rendering', 'updated_at': 0}))
        response = self.client.get(f'/api/clips/{CLIP_ID}/renders/{render_id}', headers=self.headers)
        self.assertEqual(response.json()['status'], 'failed')

    def test_draft_roundtrip_and_invalid_timing(self):
        caption = {'id': 'c1', 'text': 'Hello', 'start': 0, 'end': 1, 'words': [{'word': 'Hello', 'start': 0, 'end': 1}]}
        document = {'title': 'New title', 'style': {}, 'tracks': [
            {'id': 'video', 'type': 'video', 'segments': [{'id': 'v1', 'startTime': 0, 'duration': 4, 'sourceStart': 0, 'sourceEnd': 4}]},
            {'id': 'subtitles', 'type': 'subtitle', 'segments': [{'id': 'c1', 'startTime': 0, 'duration': 1, 'text': 'Hello'}]},
        ], 'subtitles': [caption]}
        draft = {'version': 1, 'savedAt': 0, 'document': document}
        url = f'/api/clips/{CLIP_ID}/draft'
        result = self.client.put(url, headers=self.headers, json=draft)
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(self.db.rows['clips'][0]['editor_draft']['document']['title'], 'New title')
        document['tracks'][0]['segments'][0]['startTime'] = 1
        self.assertEqual(self.client.put(url, headers=self.headers, json=draft).status_code, 422)

    def test_generated_overlapping_words_save_and_export(self):
        # Regression: real Whisper timing shapes, including a reversed onset.
        times = [(22.52, 22.62), (22.62, 23.04), (22.58, 23.32), (23.32, 23.42)]
        clip = self.db.rows['clips'][0]
        clip.update(duration=30, source_end=30, subtitles=[
            {'word': f'word{i}', 'start': start, 'end': end}
            for i, (start, end) in enumerate(times)
        ])
        script = "import {makeDocument,exportPayload} from './frontend/src/editor/timeline.js'; let s=''; for await(const c of process.stdin)s+=c; const document=makeDocument(JSON.parse(s)); console.log(JSON.stringify({document,render:exportPayload(document)}));"
        result = subprocess.run(['node', '--input-type=module', '-e', script], input=json.dumps(clip),
                                capture_output=True, text=True, check=True, cwd=Path(__file__).resolve().parents[1])
        payload = json.loads(result.stdout)
        draft = {'version': 1, 'savedAt': 0, 'document': payload['document']}
        response = self.client.put(f'/api/clips/{CLIP_ID}/draft', headers=self.headers, json=draft)
        self.assertEqual(response.status_code, 200, response.text)
        words = self.db.rows['clips'][0]['editor_draft']['document']['subtitles'][0]['words']
        self.assertEqual([(w['start'], w['end']) for w in words], times)
        def fake_render(_source, _payload, output, _workspace, **_options):
            output.write_bytes(b'export')
        with patch.object(clip_editor, 'render_edit', side_effect=fake_render):
            response = self.client.post(f'/api/clips/{CLIP_ID}/re-render', headers=self.headers, json=payload['render'])
        self.assertEqual(response.status_code, 202, response.text)


class RenderValidation(unittest.TestCase):
    def test_bad_word_timing_colors_and_fonts(self):
        for extra in [
            {'style': {'font': 'Roboto,Injected'}}, {'style': {'primary_color': "yellow,Outline=0"}},
            {'subtitles': [{'text': 'Hello', 'start': 0, 'end': 1, 'words': [{'word': 'Hello', 'start': 2, 'end': 3}]}]},
        ]:
            with self.assertRaises(ValidationError):
                RenderRequest.model_validate({'segments': [{'source_start': 0, 'source_end': 4}], **extra})

    def test_ass_sanitizes_control_sequences_and_preserves_word_pauses(self):
        payload = RenderRequest.model_validate({'segments': [{'source_start': 0, 'source_end': 4}], 'subtitles': [
            {'text': '{hello} world', 'start': 0, 'end': 3, 'words': [
                {'word': '{hello}', 'start': 0, 'end': 1}, {'word': 'world', 'start': 2, 'end': 3}]}]})
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'captions.ass'
            write_editor_ass(path, payload.subtitles, SubtitleStyle())
            text = path.read_text(encoding='utf-8-sig')
        self.assertNotIn('{hello}', text)
        self.assertIn('0:00:00.00,0:00:02.00', text)
        self.assertIn(r'{\c&H00FFFF&}hello', text)
        self.assertIn(r'{\c&HFFFFFF&}world', text)
        self.assertIn(r'\pos(540,1382.40)', text)

    def test_overlapping_onsets_do_not_accumulate_highlight_delay(self):
        payload = RenderRequest.model_validate({'segments': [{'source_start': 0, 'source_end': 4}], 'subtitles': [
            {'text': 'one two three', 'start': 0, 'end': 2, 'words': [
                {'word': 'one', 'start': 0, 'end': 1.5}, {'word': 'two', 'start': 1, 'end': 1.8},
                {'word': 'three', 'start': 0.9, 'end': 2}]}]})
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'overlaps.ass'
            write_editor_ass(path, payload.subtitles, SubtitleStyle())
            text = path.read_text(encoding='utf-8-sig')
        self.assertIn('0:00:00.90,0:00:01.00', text)
        self.assertIn(r'{\c&HFFFFFF&}two {\c&H00FFFF&}three', text)


@unittest.skipUnless(shutil.which('ffmpeg') and shutil.which('ffprobe'), 'FFmpeg is not installed')
class FFmpegIntegration(unittest.TestCase):
    def test_audio_and_silent_sources(self):
        for audio in [False, True]:
            with self.subTest(audio=audio), tempfile.TemporaryDirectory() as folder:
                root = Path(folder)
                source, output = root / 'source.mp4', root / 'out.mp4'
                command = ['ffmpeg', '-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=160x284:rate=30:duration=2']
                if audio:
                    command += ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=2']
                command += ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-threads', '1', str(source)]
                subprocess.run(command, check=True, capture_output=True, timeout=30)
                payload = RenderRequest.model_validate({'segments': [{'source_start': 1, 'source_end': 1.5}, {'source_start': 0, 'source_end': 0.5}],
                    'subtitles': [{'text': 'Hello world', 'start': 0, 'end': 0.9}], 'style': {'font': 'Arial'}})
                render_edit(source, payload, output, root, watermark=True)
                info = probe_media(output)
                self.assertAlmostEqual(info['duration'], 1, delta=0.12)
                self.assertTrue(info['audio'])
                streams = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_streams', '-of', 'json', str(output)]))['streams']
                video = next(s for s in streams if s['codec_type'] == 'video')
                self.assertEqual((video['width'], video['height']), (1080, 1920))


if __name__ == '__main__':
    unittest.main()
