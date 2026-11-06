// Runs real captures in Chromium against the pages in test/fixtures.
// activeTab needs a real click or shortcut, so this loads a temporary copy of the
// extension with host access and a hook that calls run() directly.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixtures = join(root, 'test', 'fixtures');
const W = 1000, H = 700;

const RED = '#ff0000', GREEN = '#00ff00', BLUE = '#0000ff', YELLOW = '#ffff00', PINK = '#ff00ff', WHITE = '#ffffff';

function findChromium() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  if (existsSync(chromium.executablePath())) return chromium.executablePath();
  const cache = join(process.env.LOCALAPPDATA || '', 'ms-playwright');
  const builds = existsSync(cache) ? readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse() : [];
  for (const b of builds) {
    for (const dir of ['chrome-win64', 'chrome-win']) {
      const exe = join(cache, b, dir, 'chrome.exe');
      if (existsSync(exe)) return exe;
    }
  }
  throw new Error('No Chromium found. Set CHROME_PATH.');
}

function testCopy() {
  const dir = mkdtempSync(join(tmpdir(), 'snapshift-ext-'));
  for (const f of ['background.js', 'store.js', 'manifest.json', 'popup.html', 'popup.js', 'preview.html', 'preview.js']) {
    cpSync(join(root, f), join(dir, f));
  }
  cpSync(join(root, 'icons'), join(dir, 'icons'), { recursive: true });
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  manifest.host_permissions = ['<all_urls>'];
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest));
  const bg = readFileSync(join(dir, 'background.js'), 'utf8')
    .replace('frames.length === MAX_FRAMES', 'frames.length === (globalThis.__maxFrames ?? MAX_FRAMES)')
    .replace(' || sender.tab) return', ') return');
  writeFileSync(join(dir, 'background.js'), `${bg}\nglobalThis.__snap = (mode, id) => chrome.tabs.get(id).then((t) => run(mode, t));\n`);
  return dir;
}

let server, origin, ctx, sw, ext, profile;

before(async () => {
  server = createServer((req, res) => {
    const file = join(fixtures, req.url.split('?')[0].replace(/[^\w.-]/g, ''));
    if (!existsSync(file)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(readFileSync(file));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${server.address().port}`;

  ext = testCopy();
  profile = mkdtempSync(join(tmpdir(), 'snapshift-profile-'));
  ctx = await chromium.launchPersistentContext(profile, {
    executablePath: findChromium(),
    headless: false,
    viewport: null,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [
      '--headless=new', `--window-size=${W},${H}`,
      `--force-device-scale-factor=${process.env.DPR || 1}`,
      `--disable-extensions-except=${ext}`, `--load-extension=${ext}`,
    ],
  });
  sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
});

after(async () => {
  await ctx?.close();
  server?.close();
  for (const d of [ext, profile]) if (d) rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

async function open(name) {
  const page = await ctx.newPage();
  await page.goto(`${origin}/${name}`);
  await page.bringToFront();
  return page;
}

const startCapture = (page, mode, maxFrames) => sw.evaluate(async ({ url, mode, maxFrames }) => {
  globalThis.__maxFrames = maxFrames;
  const tab = (await chrome.tabs.query({})).find((t) => t.url === url);
  await globalThis.__snap(mode, tab.id);
}, { url: page.url(), mode, maxFrames });

// Captures a fixture and returns the color runs down a column of the result.
async function shoot(name, { mode = 'full', maxFrames, x = 0.5, prep } = {}) {
  const page = await open(name);
  if (prep) await prep(page);
  const [preview] = await Promise.all([ctx.waitForEvent('page'), startCapture(page, mode, maxFrames)]);
  const result = await readShot(preview, x);
  await preview.close();
  return { ...result, page };
}

function readShot(preview, x) {
  return preview.evaluate(async (x) => {
    const img = document.getElementById('img');
    while (!img.naturalWidth) await new Promise((r) => setTimeout(r, 20));
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    const px = g.getImageData(Math.floor(c.width * x), 0, 1, c.height).data;
    const runs = [];
    for (let y = 0; y < c.height; y++) {
      const [r, gr, b, a] = px.subarray(y * 4, y * 4 + 4);
      const color = a < 255 ? 'transparent' : `#${[r, gr, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
      const last = runs.at(-1);
      if (last?.color === color) last.height++;
      else runs.push({ color, y, height: 1 });
    }
    await new Promise((r) => setTimeout(r, 50));
    return { width: c.width, height: c.height, runs, info: document.getElementById('info').textContent };
  }, x);
}

const colors = (shot) => {
  assert.ok(!shot.runs.some((r) => r.color === 'transparent'), `gap in image: ${JSON.stringify(shot.runs)}`);
  return shot.runs.filter((r) => r.height > 2).map((r) => r.color);
};
const scale = Number(process.env.DPR || 1);

test('plain page: every band in order, nothing missing', async () => {
  const shot = await shoot('plain.html');
  assert.deepEqual(colors(shot), [RED, GREEN, BLUE, YELLOW]);
  assert.ok(Math.abs(shot.height - 3500 * scale) <= 2, `height ${shot.height}`);
  await shot.page.close();
});

test('page shorter than the window', async () => {
  const shot = await shoot('short.html');
  assert.deepEqual(colors(shot), [GREEN, WHITE]);
  await shot.page.close();
});

test('visible area', async () => {
  const shot = await shoot('plain.html', { mode: 'visible' });
  assert.deepEqual(colors(shot), [RED]);
  await shot.page.close();
});

test('header that becomes fixed after scrolling appears once', async () => {
  const shot = await shoot('js-header.html');
  assert.equal(shot.runs.filter((r) => r.color === PINK).length, 1, JSON.stringify(shot.runs));
  await shot.page.close();
});

test('header that is always fixed appears once, at the top', async () => {
  const shot = await shoot('fixed-top.html');
  const pink = shot.runs.filter((r) => r.color === PINK);
  assert.equal(pink.length, 1, JSON.stringify(shot.runs));
  assert.equal(pink[0].y, 0);
  await shot.page.close();
});

test('header survives when the last frame overlaps the first', async () => {
  const shot = await shoot('fixed-top-short.html');
  assert.deepEqual(colors(shot), [PINK, GREEN], JSON.stringify(shot.runs));
  await shot.page.close();
});

test('fixed bottom bar is not baked into the page', async () => {
  const shot = await shoot('fixed-bottom.html');
  assert.deepEqual(colors(shot), [GREEN], JSON.stringify(shot.runs));
  await shot.page.close();
});

test('sticky element below the first screen is kept', async () => {
  const shot = await shoot('sticky-below.html');
  assert.deepEqual(colors(shot), [GREEN, BLUE, YELLOW], JSON.stringify(shot.runs));
  await shot.page.close();
});

test('content added while scrolling is captured', async () => {
  const shot = await shoot('lazy-grow.html');
  assert.equal(colors(shot).at(-1), YELLOW, JSON.stringify(shot.runs));
  assert.ok(Math.abs(shot.height - 3500 * scale) <= 2, `height ${shot.height}`);
  await shot.page.close();
});

test('inner scrolling panel is captured in full', async () => {
  const shot = await shoot('inner-panel.html');
  assert.deepEqual(colors(shot), [GREEN, YELLOW], JSON.stringify(shot.runs));
  assert.ok(Math.abs(shot.height - 3000 * scale) <= 2, `height ${shot.height}`);
  await shot.page.close();
});

test('frame limit ends the image cleanly and says so', async () => {
  const shot = await shoot('plain.html', { maxFrames: 2 });
  assert.deepEqual(colors(shot), [RED, GREEN]);
  assert.match(shot.info, /stopped/i);
  await shot.page.close();
});

test('page is left as it was found', async () => {
  const snapshot = () => document.getElementById('s').style.cssText + '|' + scrollY;
  const page = await open('sticky-below.html');
  await page.evaluate(() => scrollTo(0, 300));
  const beforeState = await page.evaluate(snapshot);
  const [preview] = await Promise.all([ctx.waitForEvent('page'), startCapture(page, 'full')]);
  await preview.close();
  await page.bringToFront();
  assert.equal(await page.evaluate(snapshot), beforeState);
  await page.close();
});

test('inner panel scroll position is restored', async () => {
  const page = await open('inner-panel.html');
  await page.evaluate(() => { document.getElementById('p').scrollTop = 400; });
  const [preview] = await Promise.all([ctx.waitForEvent('page'), startCapture(page, 'full')]);
  await preview.close();
  await page.bringToFront();
  assert.equal(await page.evaluate(() => document.getElementById('p').scrollTop), 400);
  await page.close();
});

test('two captures in quick succession both work', async () => {
  const first = await shoot('short.html', { mode: 'visible' });
  const second = await shoot('short.html', { mode: 'visible' });
  assert.deepEqual(colors(second), colors(first));
  await first.page.close();
  await second.page.close();
});

async function picker(name) {
  const page = await open(name);
  const done = startCapture(page, 'select');
  await page.waitForSelector('#__qs_pick', { state: 'attached' });
  return { page, done };
}

async function drag(page, x0, y0, x1, y1) {
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(x1, y1, { steps: 4 });
  await page.mouse.up();
}

const pickerGone = (page) => page.waitForSelector('#__qs_pick', { state: 'detached' });

test('select area captures just the dragged region, without the overlay', async () => {
  const { page, done } = await picker('split.html');
  const previewOpened = ctx.waitForEvent('page');
  await drag(page, 100, 250, 300, 350);
  const [preview] = await Promise.all([previewOpened, done]);
  const shot = await readShot(preview, 0.5);
  assert.deepEqual(colors(shot), [RED, GREEN]);
  assert.ok(Math.abs(shot.width - 200 * scale) <= 2, `width ${shot.width}`);
  assert.ok(Math.abs(shot.height - 100 * scale) <= 2, `height ${shot.height}`);
  assert.ok(Math.abs(shot.runs[0].height - 50 * scale) <= 2, JSON.stringify(shot.runs));
  assert.match(shot.info, /Selection/);
  await pickerGone(page);
  await preview.close();
  await page.close();
});

test('a click leaves the overlay open for another try', async () => {
  const { page, done } = await picker('split.html');
  await page.mouse.click(200, 200);
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(await page.locator('#__qs_pick').count(), 1);
  await page.keyboard.press('Escape');
  await done;
  await page.close();
});

test('Esc cancels: no preview, and the next capture still works', async () => {
  const before = ctx.pages().length;
  const { page, done } = await picker('split.html');
  await page.keyboard.press('Escape');
  await done;
  await pickerGone(page);
  assert.equal(ctx.pages().length, before + 1);
  await page.close();
  const shot = await shoot('short.html', { mode: 'visible' });
  assert.deepEqual(colors(shot), [GREEN, WHITE]);
  await shot.page.close();
});

test('switching tabs cancels a selection', async () => {
  const other = await open('short.html');
  const { page, done } = await picker('split.html');
  await other.bringToFront();
  await done;
  await page.bringToFront();
  await pickerGone(page);
  await other.close();
  await page.close();
});

test('navigating away cancels a selection', async () => {
  const { page, done } = await picker('split.html');
  await page.goto(`${origin}/short.html`);
  await done;
  await page.close();
});

test('the menu is told to close as soon as the overlay is up', async () => {
  const page = await open('split.html');
  const menu = await ctx.newPage();
  await menu.goto(`chrome-extension://${new URL(sw.url()).host}/popup.html`);
  const url = page.url();
  const res = await menu.evaluate(async (url) => {
    const tab = (await chrome.tabs.query({})).find((t) => t.url === url);
    await chrome.tabs.update(tab.id, { active: true });
    return chrome.runtime.sendMessage({ type: 'capture', mode: 'select', tabId: tab.id });
  }, url);
  assert.equal(res.ok, true);
  await page.bringToFront();
  await page.keyboard.press('Escape');
  await pickerGone(page);
  await menu.close();
  await page.close();
});

test('switching tabs stops the capture instead of grabbing the other tab', async () => {
  const page = await open('plain.html');
  const other = await open('short.html');
  await page.bringToFront();
  const failed = startCapture(page, 'full').then(() => null, (e) => e.message);
  await new Promise((r) => setTimeout(r, 300));
  await other.bringToFront();
  assert.match(await failed ?? 'capture finished', /switched tabs/i);
  await other.close();
  await page.close();
});

test('errors from the menu also reach the toolbar badge', async () => {
  const menu = await ctx.newPage();
  await menu.goto(`chrome-extension://${new URL(sw.url()).host}/popup.html`);
  const res = await menu.evaluate(() => chrome.runtime.sendMessage({ type: 'capture', mode: 'visible', tabId: 999999 }));
  assert.equal(res.ok, false);
  assert.equal(await sw.evaluate(() => chrome.action.getBadgeText({})), '!');
  await menu.close();
});
