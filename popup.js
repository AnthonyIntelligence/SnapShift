const status = document.getElementById('status');
const buttons = [...document.querySelectorAll('button[data-mode]')];
let busy = false;
let current = 0;

function remembered() {
  try { return localStorage.getItem('mode'); } catch { return null; }
}

function highlight(i) {
  current = (i + buttons.length) % buttons.length;
  buttons.forEach((b, j) => b.classList.toggle('active', j === current));
  buttons[current].focus();
}

async function capture(mode) {
  if (busy) return;
  busy = true;
  try { localStorage.setItem('mode', mode); } catch {}
  buttons.forEach((b) => (b.disabled = true));
  status.className = '';
  status.textContent = mode === 'full' ? 'Capturing full page… keep this tab open.' : 'Capturing…';
  const res = await chrome.runtime.sendMessage({ type: 'capture', mode });
  if (res?.ok) return window.close();
  busy = false;
  status.className = 'err';
  status.textContent = res?.error || 'Capture failed.';
  buttons.forEach((b) => (b.disabled = false));
  highlight(current);
}

buttons.forEach((b, i) => {
  b.onclick = () => capture(b.dataset.mode);
  b.onmouseenter = () => highlight(i);
});
document.getElementById('shortcuts').onclick = (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
};

// Ctrl+Shift+S opens this popup. Enter captures the highlighted option,
// arrows move the highlight, V or F capture that mode directly.
document.addEventListener('keydown', (e) => {
  if (busy || e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase();
  let handled = true;
  if (k === 'enter' || k === ' ') capture(buttons[current].dataset.mode);
  else if (k === 'arrowdown' || (k === 'tab' && !e.shiftKey)) highlight(current + 1);
  else if (k === 'arrowup' || (k === 'tab' && e.shiftKey)) highlight(current - 1);
  else if (k === 'v') capture('visible');
  else if (k === 'f') capture('full');
  else handled = false;
  if (handled) e.preventDefault();
});

highlight(Math.max(0, buttons.findIndex((b) => b.dataset.mode === remembered())));
