# SnapShift (Chrome extension)

Firefox-style screenshots for Chrome: capture the visible area or the full page, drag to crop, then copy or download.

## Install
1. Download or clone this repository.
2. Open `chrome://extensions`, turn on **Developer mode**.
3. Click **Load unpacked** and pick the `SnapShift` folder.
4. Pin the extension (puzzle icon → pin) if you want the toolbar button.

## Use
| Shortcut | Action |
|---|---|
| `Ctrl+Shift+S` (Mac: `Cmd+Shift+S`) | Open the menu, then `Enter` captures the highlighted mode (it remembers your last choice). `↑`/`↓` switch, or press `V` / `F` directly |
| `Alt+Shift+V` | Capture visible area straight away |
| `Alt+Shift+F` | Capture full page straight away |

The screenshot opens in a new tab, ready for `Ctrl+C`, so the quickest flow is `Ctrl+Shift+S` → `Enter` → `Ctrl+C`. Optionally drag to select an area first, then:
- **Copy** (`Ctrl/Cmd+C`) puts it on the clipboard as PNG
- **Download** (`Ctrl/Cmd+S`) saves it as `<page title> <date time>.png`
- `Esc` clears the selection

Change shortcuts at `chrome://extensions/shortcuts`. If another extension already uses a shortcut, Chrome leaves it blank, so set it there.

## Limits
- Chrome blocks capture on `chrome://` pages and the Chrome Web Store.
- Full page works by scrolling the window and stitching. Pages that scroll inside an inner panel (Gmail, some web apps) only capture the visible part.
- Fixed/sticky headers are shown once at the top. Very long pages are scaled down to stay under Chrome's ~32,000 px canvas limit.
- Full page takes about 0.5 s per screen because Chrome rate-limits tab captures.

## Permissions
`activeTab` (only the tab you trigger it on, only when you trigger it), `scripting` (scroll the page for full-page capture), `clipboardWrite`. No host permissions, no network access.

## Privacy
SnapShift makes no network requests and collects nothing. See [PRIVACY.md](PRIVACY.md).

## Publishing
Run `powershell -File pack.ps1` to build `dist/SnapShift-<version>.zip` for the Chrome Web Store. Listing text and permission justifications are in [STORE.md](STORE.md).
