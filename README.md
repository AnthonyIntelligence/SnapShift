# SnapShift (Chrome extension)

Firefox-style screenshots for Chrome: capture the visible area, a selected area or the full page, then copy or download.

## Install
1. Download or clone this repository.
2. Open `chrome://extensions`, turn on **Developer mode**.
3. Click **Load unpacked** and pick the `SnapShift` folder.
4. Pin the extension (puzzle icon → pin) if you want the toolbar button.

## Use
| Shortcut | Action |
|---|---|
| `Ctrl+Shift+S` (Mac: `Cmd+Shift+S`) | Open the menu, then `Enter` captures the highlighted mode (it remembers your last choice). `↑`/`↓` switch, or press `V` / `F` / `S` directly |
| `Alt+Shift+V` | Capture visible area straight away |
| `Alt+Shift+F` | Capture full page straight away |
| `Alt+Shift+S` | Select an area straight away: drag on the page, `Esc` cancels |

The screenshot opens in a new tab, ready for `Ctrl+C`, so the quickest flow is `Ctrl+Shift+S` → `Enter` → `Ctrl+C`. Optionally drag to select an area first, then:
- **Copy** (`Ctrl/Cmd+C`) puts it on the clipboard as PNG
- **Download** (`Ctrl/Cmd+S`) saves it as `<page title> <date time>.png`
- `Esc` clears the selection

Change shortcuts at `chrome://extensions/shortcuts`. If another extension already uses a shortcut, Chrome leaves it blank, so set it there.

## Limits
- Chrome blocks capture on `chrome://` pages and the Chrome Web Store.
- Select area covers what's on screen. For something taller, capture the full page and crop it in the preview.
- Full page works by scrolling and stitching. On apps that scroll an inner panel (Gmail, some web apps) it captures the largest panel on its own, without the surrounding page. Panels inside iframes or shadow DOM aren't found.
- Fixed headers and side navs are shown once at the top, sticky elements stay in their normal place, and bottom bars and floating widgets are left out. Very long pages are scaled down to stay under Chrome's ~32,000 px canvas limit, and capture stops after 150 screens. The preview says so when either happens.
- Stay on the tab during a full-page capture: switching tabs stops it.
- Full page takes about 0.5 s per screen because Chrome rate-limits tab captures.

## Permissions
`activeTab` (only the tab you trigger it on, only when you trigger it), `scripting` (scroll the page for full-page capture, show the selection overlay), `clipboardWrite`. No host permissions, no network access.

## Privacy
SnapShift makes no network requests and collects nothing. See [PRIVACY.md](PRIVACY.md).

## Tests
`npm install`, then `npm test`. Runs real captures of the pages in `test/fixtures` in Chromium. It looks for a Playwright Chromium, or set `CHROME_PATH`. Set `DPR=1.25` (or another value) to test a display scale, since stitching bugs show up at fractional scales. Incognito isn't covered.

## Publishing
Run `powershell -File pack.ps1` to build `dist/SnapShift-<version>.zip` for the Chrome Web Store. Listing text and permission justifications are in [STORE.md](STORE.md).
