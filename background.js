import { putShot } from './store.js';

// Chrome allows about 2 captureVisibleTab calls per second.
const CAPTURE_GAP_MS = 550;
// Canvas limits: keep the output inside what Chrome can encode.
const MAX_SIDE = 32000;
const MAX_AREA = 200_000_000;
const MAX_FRAMES = 150;
// Time for the page to react to a scroll (lazy images, sticky state) before capturing.
const SETTLE_MS = 150;
// Frames overlap slightly: at fractional display scales scroll positions snap to device
// pixels, and butting frames together leaves 1px gaps.
const OVERLAP = 2;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MODES = new Set(['visible', 'full', 'select']);
const COMMANDS = { 'capture-visible': 'visible', 'capture-full': 'full', 'capture-select': 'select' };

// Only accept requests from this extension's own pages (the popup).
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || sender.tab) return;
  if (msg?.type !== 'capture' || !MODES.has(msg.mode) || !Number.isInteger(msg.tabId)) return;
  // Selecting happens on the page, so the popup is told to close as soon as the overlay is up.
  chrome.tabs.get(msg.tabId).then((tab) => run(msg.mode, tab, () => sendResponse({ ok: true })))
    .then(() => sendResponse({ ok: true }), (e) => {
      flashError(e.message); // the popup may already be closed
      sendResponse({ ok: false, error: e.message });
    });
  return true; // async response
});

chrome.commands.onCommand.addListener((command, tab) => {
  const mode = COMMANDS[command];
  if (!mode) return;
  run(mode, tab).catch((e) => flashError(e.message));
});

let running = false;

async function run(mode, tab, onReady) {
  if (!tab?.id) throw new Error('No active tab.');
  if (running) throw new Error('A capture is already in progress.');
  checkCapturable(tab.url);
  running = true;
  try {
    await capture(mode, tab, onReady);
  } finally {
    running = false;
  }
}

// Fail fast with a clear message on pages Chrome never lets extensions capture.
function checkCapturable(url) {
  if (!url) return; // URL is hidden until activeTab is granted; let Chrome decide.
  const u = new URL(url);
  const blockedHost = u.hostname === 'chromewebstore.google.com' ||
    (u.hostname === 'chrome.google.com' && u.pathname.startsWith('/webstore'));
  if (!['http:', 'https:', 'file:', 'data:'].includes(u.protocol) || blockedHost) {
    throw new Error("Chrome doesn't allow screenshots of this page (browser and Web Store pages are protected).");
  }
}

async function capture(mode, tab, onReady) {
  const shot = mode === 'full' ? await captureFull(tab)
    : mode === 'select' ? await captureSelect(tab, onReady)
    : await captureVisible(tab);
  if (!shot) return; // selection cancelled
  const { blob, note } = shot;
  const id = await putShot({ blob, note, title: tab.title || '', url: tab.url || '', mode, created: Date.now() });
  await chrome.tabs.create({
    url: chrome.runtime.getURL(`preview.html?id=${id}`),
    index: tab.index + 1,
    openerTabId: tab.id,
  });
}

async function flashError(message) {
  await chrome.action.setBadgeBackgroundColor({ color: '#d93025' });
  await chrome.action.setBadgeText({ text: '!' });
  await chrome.action.setTitle({ title: `SnapShift: ${message}` });
  setTimeout(() => {
    chrome.action.setBadgeText({ text: '' });
    chrome.action.setTitle({ title: 'SnapShift' });
  }, 6000);
}

let lastGrab = 0;

async function grab(windowId) {
  await sleep(Math.max(0, lastGrab + CAPTURE_GAP_MS - Date.now()));
  try {
    return await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
  } catch (e) {
    throw new Error(`Chrome won't capture this page (${e.message}). Internal pages like chrome:// and the Web Store are blocked.`);
  } finally {
    lastGrab = Date.now();
  }
}

const toBlob = async (dataUrl) => (await fetch(dataUrl)).blob();

async function captureVisible(tab) {
  return { blob: await toBlob(await grab(tab.windowId)) };
}

async function captureSelect(tab, onReady) {
  const target = { tabId: tab.id };
  try {
    await chrome.scripting.executeScript({ target, func: showPicker });
  } catch (e) {
    throw new Error(`Can't access this page to select an area (${e.message}).`);
  }
  onReady?.();

  // The user can take their time, so keep the service worker from going idle meanwhile.
  const keepAlive = setInterval(() => chrome.runtime.getPlatformInfo(), 20000);
  // Leaving the tab cancels, otherwise the overlay would block captures on every other tab.
  const onSwitch = (info) => {
    if (info.windowId !== tab.windowId || info.tabId === tab.id) return;
    chrome.scripting.executeScript({ target, func: cancelPick }).catch(() => {});
  };
  chrome.tabs.onActivated.addListener(onSwitch);
  let picked;
  try {
    // Navigating away ends the script without a result, which counts as cancelling.
    [picked] = await chrome.scripting.executeScript({ target, func: waitForPick }).catch(() => []);
  } finally {
    clearInterval(keepAlive);
    chrome.tabs.onActivated.removeListener(onSwitch);
  }
  const rect = picked?.result;
  if (!rect) return null;

  await checkStillActive(tab);
  const bmp = await createImageBitmap(await toBlob(await grab(tab.windowId)));
  const px = bmp.width / rect.viewW; // device pixels per CSS pixel (DPI + zoom)
  const canvas = new OffscreenCanvas(Math.round(rect.w * px), Math.round(rect.h * px));
  canvas.getContext('2d').drawImage(bmp, rect.x * px, rect.y * px, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
  bmp.close();
  return { blob: await canvas.convertToBlob({ type: 'image/png' }) };
}

// captureVisibleTab takes whatever tab is showing, so never let another one into the image.
async function checkStillActive(tab) {
  const [active] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
  if (active?.id !== tab.id) throw new Error('Capture stopped because you switched tabs. Try again and stay on the page.');
}

async function captureFull(tab) {
  const target = { tabId: tab.id };
  let m;
  try {
    [{ result: m }] = await chrome.scripting.executeScript({ target, func: preparePage });
  } catch (e) {
    throw new Error(`Can't access this page for a full-page capture (${e.message}).`);
  }

  try {
    // Scroll until the page stops moving, so content added along the way is included.
    const frames = [];
    const notes = m.panel ? ['Scrolling panel only'] : [];
    for (let y = 0; ;) {
      const [{ result: actualY }] = await chrome.scripting.executeScript({
        target, func: scrollToY, args: [y, frames.length === 0],
      });
      if (frames.length && actualY <= frames.at(-1).y) break;
      if (frames.length === MAX_FRAMES) {
        notes.push(`Stopped after ${MAX_FRAMES} screens`);
        break;
      }
      await sleep(SETTLE_MS);
      await checkStillActive(tab);
      frames.push({ y: actualY, blob: await toBlob(await grab(tab.windowId)) });
      y = actualY + m.crop.h - OVERLAP;
    }
    return await stitch(frames, m, notes);
  } finally {
    await chrome.scripting.executeScript({ target, func: restorePage }).catch(() => {});
  }
}

async function stitch(frames, m, notes) {
  const { crop } = m;
  const first = await createImageBitmap(frames[0].blob);
  const px = first.width / m.viewW; // device pixels per CSS pixel (DPI + zoom)
  // Fractional scales can make the crop a fraction bigger than the bitmap really is.
  const srcW = Math.min(crop.w * px, first.width - crop.x * px);
  const srcH = Math.min(crop.h * px, first.height - crop.y * px);
  first.close();
  const w = srcW, h = frames.at(-1).y * px + srcH;
  const shrink = Math.min(1, MAX_SIDE / h, MAX_SIDE / w, Math.sqrt(MAX_AREA / (w * h)));
  if (shrink < 1) notes.push('Scaled down to fit');
  const outScale = px * shrink;
  const outW = Math.round(srcW * shrink), outH = Math.round(srcH * shrink);
  const canvas = new OffscreenCanvas(outW, Math.round(frames.at(-1).y * outScale) + outH);
  const ctx = canvas.getContext('2d');
  // Last frame first: it can overlap the one before it, and only the first frame has the header.
  for (const f of frames.reverse()) {
    const bmp = await createImageBitmap(f.blob);
    ctx.drawImage(bmp, crop.x * px, crop.y * px, srcW, srcH,
      0, Math.round(f.y * outScale), outW, outH);
    bmp.close();
  }
  return { blob: await canvas.convertToBlob({ type: 'image/png' }), note: notes.join(' · ') };
}

// ---- Functions injected into the page (must be self-contained) ----

function showPicker() {
  const root = document.createElement('div');
  root.id = '__qs_pick';
  root.style.cssText = 'all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;' +
    'overflow:hidden!important;cursor:crosshair!important;background:rgba(0,0,0,.35)!important';
  // A shadow root keeps the page's CSS away from the box and the hint.
  const shadow = root.attachShadow({ mode: 'closed' });
  const box = document.createElement('div');
  box.style.cssText = 'position:absolute;display:none;box-sizing:border-box;border:1.5px dashed #fff;' +
    'outline:1px solid rgba(0,0,0,.6);box-shadow:0 0 0 9999px rgba(0,0,0,.45)';
  const hint = document.createElement('div');
  hint.textContent = 'Drag to select an area · Esc to cancel';
  hint.style.cssText = 'position:absolute;top:16px;left:50%;transform:translateX(-50%);padding:8px 14px;border-radius:6px;' +
    'background:#323232;color:#fff;font:13px system-ui,sans-serif;white-space:nowrap;pointer-events:none';
  shadow.append(box, hint);

  window.__qsPick = new Promise((resolve) => {
    const finish = async (rect) => {
      window.removeEventListener('keydown', onKey, true);
      root.remove();
      delete window.__qsPick;
      delete window.__qsCancel;
      // Let the overlay leave the screen before the capture.
      if (rect) await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      resolve(rect);
    };
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      finish(null);
    };
    window.__qsCancel = () => finish(null);
    window.addEventListener('keydown', onKey, true);

    root.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const clamp = (v, max) => Math.max(0, Math.min(max, v));
      const x0 = e.clientX, y0 = e.clientY;
      let sel = null;
      root.setPointerCapture(e.pointerId);
      const move = (ev) => {
        const x1 = clamp(ev.clientX, root.clientWidth), y1 = clamp(ev.clientY, root.clientHeight);
        sel = { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
        root.style.setProperty('background', 'transparent', 'important');
        hint.style.display = 'none';
        Object.assign(box.style, { display: 'block', left: `${sel.x}px`, top: `${sel.y}px`, width: `${sel.w}px`, height: `${sel.h}px` });
      };
      root.addEventListener('pointermove', move);
      root.addEventListener('pointerup', () => {
        root.removeEventListener('pointermove', move);
        if (sel && sel.w >= 4 && sel.h >= 4) return finish({ ...sel, viewW: window.innerWidth });
        // A click or a tiny drag: stay open and let the user try again.
        box.style.display = 'none';
        hint.style.display = '';
        root.style.setProperty('background', 'rgba(0,0,0,.35)', 'important');
      }, { once: true });
    });
  });
  document.documentElement.appendChild(root);
}

function waitForPick() {
  return window.__qsPick;
}

function cancelPick() {
  window.__qsCancel?.();
}

function preparePage() {
  const style = document.createElement('style');
  style.id = '__qs_style';
  style.textContent =
    'html{scroll-behavior:auto!important;scrollbar-width:none!important}' +
    '::-webkit-scrollbar{display:none!important}';
  document.documentElement.appendChild(style);
  const x = window.scrollX, y = window.scrollY;
  const viewW = window.innerWidth, viewH = window.innerHeight;

  // Apps that scroll an inner panel don't move the window, so capture the biggest panel instead.
  window.scrollTo({ top: 1e9, left: 0, behavior: 'instant' });
  const windowScrolls = window.scrollY > viewH * 0.05;
  window.scrollTo({ top: y, left: x, behavior: 'instant' });
  let scroller = null, area = viewW * viewH * 0.25;
  if (!windowScrolls && document.body) {
    for (const el of [document.body, ...document.body.querySelectorAll('*')]) {
      if (el.scrollHeight <= el.clientHeight + 1 || el.clientWidth * el.clientHeight <= area) continue;
      if (!['auto', 'scroll'].includes(getComputedStyle(el).overflowY)) continue;
      scroller = el;
      area = el.clientWidth * el.clientHeight;
    }
  }

  window.__qsState = { x, y, undo: [], seen: new Set(), scroller, panelY: scroller?.scrollTop };
  if (!scroller) return { viewW, crop: { x: 0, y: 0, w: viewW, h: viewH } };
  const r = scroller.getBoundingClientRect();
  return {
    viewW, panel: true,
    crop: { x: r.left + scroller.clientLeft, y: r.top + scroller.clientTop, w: scroller.clientWidth, h: scroller.clientHeight },
  };
}

async function scrollToY(y, firstFrame) {
  const st = window.__qsState, sc = st.scroller;
  (sc || window).scrollTo({ top: y, left: 0, behavior: 'instant' });
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  const set = (el, prop, value) => {
    st.undo.push([el, prop, el.style.getPropertyValue(prop), el.style.getPropertyPriority(prop)]);
    el.style.setProperty(prop, value, 'important');
  };
  // Checked on every frame, after scrolling: many headers only become fixed once the page moves.
  for (const el of document.querySelectorAll('body *')) {
    if (st.seen.has(el)) continue;
    const pos = getComputedStyle(el).position;
    if (pos === 'sticky') {
      // Sticky elements go back to their place in the page, so they appear once, where they belong.
      st.seen.add(el);
      set(el, 'position', 'relative');
      for (const side of ['top', 'right', 'bottom', 'left']) set(el, side, 'auto');
    } else if (pos === 'fixed' && !el.contains(sc)) {
      // The first frame keeps headers and side navs, but not cookie bars and chat bubbles.
      if (firstFrame && !sc && el.getBoundingClientRect().top < window.innerHeight / 3) continue;
      st.seen.add(el);
      set(el, 'visibility', 'hidden');
    }
  }
  return sc ? sc.scrollTop : window.scrollY;
}

function restorePage() {
  document.getElementById('__qs_style')?.remove();
  const st = window.__qsState;
  if (!st) return;
  for (const [el, prop, value, priority] of st.undo.reverse()) {
    if (value) el.style.setProperty(prop, value, priority);
    else el.style.removeProperty(prop);
  }
  st.scroller?.scrollTo({ top: st.panelY, left: 0, behavior: 'instant' });
  window.scrollTo({ top: st.y, left: st.x, behavior: 'instant' });
  delete window.__qsState;
}
