const status = document.getElementById('status');
const buttons = [...document.querySelectorAll('button')];

async function capture(mode) {
  buttons.forEach((b) => (b.disabled = true));
  status.className = '';
  status.textContent = mode === 'full' ? 'Capturing full page… keep this tab open.' : 'Capturing…';
  const res = await chrome.runtime.sendMessage({ type: 'capture', mode });
  if (res?.ok) return window.close();
  status.className = 'err';
  status.textContent = res?.error || 'Capture failed.';
  buttons.forEach((b) => (b.disabled = false));
}

document.getElementById('visible').onclick = () => capture('visible');
document.getElementById('full').onclick = () => capture('full');
document.getElementById('shortcuts').onclick = (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
};

// Ctrl+Shift+S opens this popup, then V or F picks the mode.
document.addEventListener('keydown', (e) => {
  if (buttons[0].disabled || e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === 'v') capture('visible');
  if (k === 'f') capture('full');
});
