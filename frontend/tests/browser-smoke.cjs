/* Run against `npm run dev -- --host 127.0.0.1`.
 * Uses Playwright from the local development environment (no production dependency).
 */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

(async () => {
  const root = path.resolve(__dirname, '../..');
  const artifactDir = path.join(root, 'temp', 'editor-smoke');
  fs.mkdirSync(artifactDir, { recursive: true });
  const source = path.join(artifactDir, 'fixture.mp4');
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=270x480:rate=30:duration=8', '-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', source]);
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.route('**/__editor_fixture.mp4', (route) => {
      const media = fs.readFileSync(source);
      const range = route.request().headers().range?.match(/bytes=(\d+)-(\d*)/);
      const start = range ? Number(range[1]) : 0;
      const end = range?.[2] ? Number(range[2]) : media.length - 1;
      return route.fulfill({ status: range ? 206 : 200, contentType: 'video/mp4',
        headers: { 'Accept-Ranges': 'bytes', 'Content-Length': String(end - start + 1), ...(range ? { 'Content-Range': `bytes ${start}-${end}/${media.length}` } : {}) },
        body: media.subarray(start, end + 1) });
    });
    await page.route('**/api/clips/fonts/**', (route) => route.fulfill({ contentType: 'font/ttf', body: fs.readFileSync(path.join(root, 'font.ttf')) }));
    let saved, exported;
    await page.route('**/api/clips/browser-test/draft', async (route) => { saved = route.request().postDataJSON(); await route.fulfill({ json: { status: 'saved' } }); });
    await page.route('**/api/clips/browser-test/re-render', async (route) => { exported = route.request().postDataJSON(); await route.fulfill({ status: 202, json: { render_id: 'test-render', status: 'queued' } }); });
    await page.route('**/api/clips/browser-test/renders/test-render', (route) => route.fulfill({ json: { render_id: 'test-render', status: 'completed', video_url: '/export.mp4' } }));
    await page.goto('http://127.0.0.1:5173/tests/editor.html');
    await page.getByRole('button', { name: 'Play', exact: true }).waitFor();
    await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
    await page.getByRole('button', { name: 'one', exact: true }).click();
    await page.locator('.ed-video-segment').first().click();
    await page.keyboard.press('c');
    await page.waitForFunction(() => document.querySelectorAll('.ed-video-segment').length === 2);
    await page.keyboard.press('Control+z');
    assert.equal(await page.locator('.ed-video-segment').count(), 1);
    await page.keyboard.press('Control+y');
    assert.equal(await page.locator('.ed-video-segment').count(), 2);
    await page.keyboard.press('v');
    // A whole drag is one history entry, including live trim previews.
    const first = page.locator('.ed-video-segment').first();
    const originalWidth = (await first.boundingBox()).width;
    const trim = await first.locator('.ed-trim-handle.right').boundingBox();
    await page.mouse.move(trim.x + 3, trim.y + 20);
    await page.mouse.down();
    await page.mouse.move(trim.x - 29, trim.y + 20, { steps: 8 });
    await page.locator('.ed-drag-tooltip').waitFor();
    await page.mouse.up();
    assert.ok((await first.boundingBox()).width < originalWidth - 25);
    await page.keyboard.press('Control+z');
    assert.equal((await first.boundingBox()).width, originalWidth);
    const firstBox = await first.boundingBox(), lastBox = await page.locator('.ed-video-segment').last().boundingBox();
    await page.mouse.move(firstBox.x + 30, firstBox.y + 35);
    await page.mouse.down();
    await page.mouse.move(lastBox.x + lastBox.width + 15, lastBox.y + 35, { steps: 10 });
    await page.mouse.up();
    await page.getByRole('button', { name: 'Save draft', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Draft saved' }).waitFor();
    assert.equal(saved.document.tracks[0].segments[0].sourceStart, 15.5);
    await page.keyboard.press('Control+z');
    await page.locator('.ed-video-segment').first().click();
    await page.keyboard.press('Control+c');
    await page.keyboard.press('Control+v');
    assert.equal(await page.locator('.ed-video-segment').count(), 3);
    await page.keyboard.press('Control+z');
    const text = page.getByRole('textbox', { name: 'Caption 1 text', exact: true });
    await text.fill('Every brilliant story');
    await page.keyboard.press('Space'); // Typing must not toggle playback or invoke editor shortcuts.
    assert.equal(await page.getByRole('button', { name: 'Play', exact: true }).count(), 1);
    await page.getByRole('tab', { name: 'Styling', exact: true }).click();
    await page.getByRole('slider', { name: 'Font size', exact: true }).fill('72');
    await page.getByRole('button', { name: 'Save draft', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Draft saved' }).waitFor();
    assert.equal(saved.document.style.font_size, 72);
    assert.equal(saved.document.subtitles[0].text.trim(), 'Every brilliant story');
    const beforePlay = await page.locator('.ed-timecode b').innerText();
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await page.waitForTimeout(450);
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    assert.notEqual(await page.locator('.ed-timecode b').innerText(), beforePlay, 'Playback must advance the output playhead');
    await page.getByRole('button', { name: 'Export clip', exact: true }).click();
    await page.getByText('Your export is ready.', { exact: false }).waitFor();
    assert.equal(exported.segments.length, 2);
    assert.equal(exported.style.font_size, 72);
    assert.ok(exported.style.primary_color.startsWith('&H'));
    await page.screenshot({ path: path.join(artifactDir, 'desktop.png'), fullPage: true });
    assert.ok(await page.evaluate(() => document.querySelector('.ed-timeline').getBoundingClientRect().bottom <= innerHeight), 'Desktop timeline should remain visible below the monitor');
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: path.join(artifactDir, 'mobile.png'), fullPage: true });
    assert.deepEqual(errors, []);
    console.log('Browser smoke passed: split, drag trimming/reordering, undo/redo, copy/paste, captions, styling, playback, save/export, mobile layout.');
  } finally { await browser.close(); }
})().catch((err) => { console.error(err); process.exitCode = 1; });
