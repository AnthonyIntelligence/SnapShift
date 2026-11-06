import { putShot } from './store.js';

// Chrome allows about 2 captureVisibleTab calls per second.
const CAPTURE_GAP_MS = 550;
// Canvas limits: keep the output inside what Chrome can encode.
const MAX_SIDE = 32000;
const MAX_AREA = 200_000_000;
const MAX_FRAMES = 150;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'capture') return;
  chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => run(msg.mode, tab))
    .then(() => sendResponse({ ok: true }), (e) => sendResponse({ ok: false, error: e.message }));
  return true; // async response
});

chrome.commands.onCommand.addListener((command, tab) => {
  const mode = command === 'capture-full' ? 'full' : command === 'capture-visible' ? 'visible' : null;
  if (!mode) return;
  run(mode, tab).catch((e) => flashError(e.message));
});

async function run(mode, tab) {
  if (!tab) throw new Error('No active tab.');
  const blob = mode === 'full' ? await captureFull(tab) : await captureVisible(tab);
  const id = await putShot({ blob, title: tab.title || '', url: tab.url || '', mode, created: Date.now() });
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

async function grab(windowId) {
  try {
    return await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
  } catch (e) {
    throw new Error(`Chrome won't capture this page (${e.message}). Internal pages like chrome:// and the Web Store are blocked.`);
  }
}

const toBlob = async (dataUrl) => (await fetch(dataUrl)).blob();

async function captureVisible(tab) {
  return toBlob(await grab(tab.windowId));
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
    const positions = [];
    for (let y = 0; y < m.height && positions.length < MAX_FRAMES; y += m.viewH) positions.push(y);

    let canvas, ctx, outScale, ratio;
    let last = 0;
    for (let i = 0; i < positions.length; i++) {
      const [{ result: actualY }] = await chrome.scripting.executeScript({
        target, func: scrollToY, args: [positions[i], i > 0],
      });
      await sleep(Math.max(150, last + CAPTURE_GAP_MS - Date.now()));
      const dataUrl = await grab(tab.windowId);
      last = Date.now();
      const bmp = await createImageBitmap(await toBlob(dataUrl));

      if (!canvas) {
        const px = bmp.width / m.viewW; // device pixels per CSS pixel (DPI + zoom)
        outScale = px;
        const w = m.viewW * px, h = m.height * px;
        const shrink = Math.min(1, MAX_SIDE / h, MAX_SIDE / w, Math.sqrt(MAX_AREA / (w * h)));
        outScale = px * shrink;
        ratio = shrink;
        canvas = new OffscreenCanvas(Math.round(m.viewW * outScale), Math.round(m.height * outScale));
        ctx = canvas.getContext('2d');
      }
      ctx.drawImage(bmp, 0, Math.round(actualY * outScale), Math.round(bmp.width * ratio), Math.round(bmp.height * ratio));
      bmp.close();
    }
    return await canvas.convertToBlob({ type: 'image/png' });
  } finally {
    await chrome.scripting.executeScript({ target, func: restorePage }).catch(() => {});
  }
}

// ---- Functions injected into the page (must be self-contained) ----

function preparePage() {
  const style = document.createElement('style');
  style.id = '__qs_style';
  style.textContent =
    'html{scroll-behavior:auto!important;scrollbar-width:none!important}' +
    '::-webkit-scrollbar{display:none!important}';
  document.documentElement.appendChild(style);
  window.__qsState = { x: window.scrollX, y: window.scrollY, hidden: [], fixedHidden: false };
  const de = document.documentElement, b = document.body;
  const height = Math.max(de.scrollHeight, de.offsetHeight, de.clientHeight, b ? b.scrollHeight : 0, b ? b.offsetHeight : 0);
  return { height, viewW: window.innerWidth, viewH: window.innerHeight };
}

async function scrollToY(y, hideFixed) {
  const st = window.__qsState;
  // After the first frame, hide fixed/sticky headers so they don't repeat down the image.
  if (hideFixed && !st.fixedHidden) {
    st.fixedHidden = true;
    for (const el of document.querySelectorAll('body *')) {
      const pos = getComputedStyle(el).position;
      if (pos === 'fixed' || pos === 'sticky') {
        st.hidden.push([el, el.style.getPropertyValue('visibility'), el.style.getPropertyPriority('visibility')]);
        el.style.setProperty('visibility', 'hidden', 'important');
      }
    }
  }
  window.scrollTo({ top: y, left: 0, behavior: 'instant' });
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  return window.scrollY;
}

function restorePage() {
  document.getElementById('__qs_style')?.remove();
  const st = window.__qsState;
  if (!st) return;
  for (const [el, value, priority] of st.hidden) {
    if (value) el.style.setProperty('visibility', value, priority);
    else el.style.removeProperty('visibility');
  }
  window.scrollTo({ top: st.y, left: st.x, behavior: 'instant' });
  delete window.__qsState;
}
