import { getShot } from './store.js';

const $ = (id) => document.getElementById(id);
const img = $('img'), wrap = $('wrap'), selBox = $('sel');
let shot, sel = null; // sel in CSS pixels of the displayed image

function toast(msg) {
  $('toast').textContent = msg;
  $('toast').classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => $('toast').classList.remove('show'), 1800);
}

function fileName() {
  const d = new Date(shot.created);
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}.${pad(d.getMinutes())}.${pad(d.getSeconds())}`;
  const title = (shot.title || 'Screenshot').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80);
  return `${title} ${stamp}.png`;
}

async function outputBlob() {
  if (!sel || sel.w < 2 || sel.h < 2) return shot.blob;
  const k = img.naturalWidth / img.clientWidth;
  const c = document.createElement('canvas');
  c.width = Math.round(sel.w * k);
  c.height = Math.round(sel.h * k);
  c.getContext('2d').drawImage(img, sel.x * k, sel.y * k, c.width, c.height, 0, 0, c.width, c.height);
  return new Promise((r) => c.toBlob(r, 'image/png'));
}

async function copy() {
  try {
    const blob = await outputBlob();
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    toast(sel ? 'Selection copied' : 'Copied to clipboard');
  } catch (e) {
    toast(`Copy failed: ${e.message}`);
  }
}

async function download() {
  const url = URL.createObjectURL(await outputBlob());
  const a = Object.assign(document.createElement('a'), { href: url, download: fileName() });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function drawSel() {
  const on = !!sel;
  selBox.style.display = on ? 'block' : 'none';
  $('clear').hidden = !on;
  if (on) Object.assign(selBox.style, { left: `${sel.x}px`, top: `${sel.y}px`, width: `${sel.w}px`, height: `${sel.h}px` });
  $('download').textContent = on ? 'Download selection' : 'Download';
}

// Drag on the image to select an area to crop.
wrap.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  const r = img.getBoundingClientRect();
  const clamp = (v, max) => Math.max(0, Math.min(max, v));
  const x0 = clamp(e.clientX - r.left, r.width), y0 = clamp(e.clientY - r.top, r.height);
  wrap.setPointerCapture(e.pointerId);
  const move = (ev) => {
    const rr = img.getBoundingClientRect();
    const x1 = clamp(ev.clientX - rr.left, rr.width), y1 = clamp(ev.clientY - rr.top, rr.height);
    sel = { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
    drawSel();
  };
  const up = () => {
    wrap.removeEventListener('pointermove', move);
    if (sel && (sel.w < 4 || sel.h < 4)) { sel = null; drawSel(); }
  };
  wrap.addEventListener('pointermove', move);
  wrap.addEventListener('pointerup', up, { once: true });
});

$('copy').onclick = copy;
$('download').onclick = download;
$('clear').onclick = () => { sel = null; drawSel(); };
window.addEventListener('resize', () => { sel = null; drawSel(); });

const mac = navigator.platform.toUpperCase().includes('MAC');
document.addEventListener('keydown', (e) => {
  const mod = mac ? e.metaKey : e.ctrlKey;
  if (mod && e.key.toLowerCase() === 'c') { e.preventDefault(); copy(); }
  if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); download(); }
  if (e.key === 'Escape') { sel = null; drawSel(); }
});

(async () => {
  const id = new URLSearchParams(location.search).get('id');
  shot = /^[0-9a-f-]{36}$/i.test(id || '') ? await getShot(id).catch(() => null) : null;
  if (!shot) { $('info').textContent = 'This screenshot is no longer available.'; return; }
  img.src = URL.createObjectURL(shot.blob);
  await img.decode();
  document.title = `Screenshot – ${shot.title || shot.url}`;
  const kind = shot.mode === 'full' ? 'Full page' : 'Visible area';
  $('info').replaceChildren();
  const b = document.createElement('b');
  b.textContent = shot.title || shot.url;
  $('info').append(b, ` · ${kind} · ${img.naturalWidth}×${img.naturalHeight} · drag to crop · Ctrl+C to copy`);
  $('info').title = shot.url;
  window.focus();
})();
