# Chrome Web Store submission notes

Text to paste into the Developer Dashboard. Not shipped in the extension package.

## Listing

**Name:** SnapShift

**Summary (max 132 chars):** Capture the visible area, a selected area or the full page, then copy or save it.

**Category:** Tools (Productivity)

**Description:**

> SnapShift takes screenshots with two keystrokes.
>
> Press Ctrl+Shift+S, then Enter. The screenshot opens in a new tab, ready to copy with Ctrl+C or save with Ctrl+S. Drag on it to crop first.
>
> • Visible area: exactly what's on screen
> • Full page: scrolls and stitches the whole page into one image
> • Select area: drag on the page to capture just that part
> • Crop by dragging, copy as PNG, or download with the page title and time as the file name
> • Keyboard-first: arrows to switch mode, V, F or S to capture directly, Alt+Shift+V / F / S to skip the menu
> • Remembers your last mode
> • Light and dark theme
>
> Private by design: no network access, no tracking, no account. Screenshots stay on your computer.
>
> Note: Chrome doesn't allow extensions to capture its own pages (chrome://) or the Web Store.

**Assets you still need to make:** at least one screenshot (1280×800 or 640×400) and a small promo tile (440×280). The 128×128 icon is `icons/icon128.png`.

## Privacy practices tab

**Single purpose:** Take screenshots of the current tab (visible area, selected area or full page) and let the user crop, copy or download them.

**Permission justifications:**

- **activeTab:** Gives temporary access to the tab only when the user clicks the toolbar button or uses a SnapShift keyboard shortcut, so the visible area can be captured with `tabs.captureVisibleTab`. No access to any other tab or at any other time.
- **scripting:** Used only on the tab the user invoked SnapShift on. For Select area it shows an overlay so the user can drag out a region, and removes it afterwards. For full-page capture it injects a small function that finds what scrolls, scrolls it step by step while frames are captured, temporarily hides fixed elements and unpins sticky ones so they don't repeat, then restores the page and its scroll position. It does not read or send page content.
- **clipboardWrite:** Copies the screenshot (or the cropped selection) to the clipboard as a PNG when the user presses Copy or Ctrl+C on the preview tab.

**Remote code:** No, I am not using remote code. All JavaScript is in the package.

**Data usage:** Tick nothing. SnapShift collects no user data. Screenshots, page title and URL are stored only locally in IndexedDB (last 5) to display the preview and are never transmitted.

Certify all three disclosures (no selling, no unrelated use, no creditworthiness use).

**Privacy policy URL:** https://gist.github.com/BigBaws/b36bc19d10f9d0b92f634224c2de3b0a (public gist of PRIVACY.md; update it with `gh gist edit b36bc19d10f9d0b92f634224c2de3b0a PRIVACY.md` whenever PRIVACY.md changes)

## Before each upload

1. Bump `version` in `manifest.json`.
2. Run `powershell -File pack.ps1` and upload `dist/SnapShift-<version>.zip`.
3. In "Why is this update needed" or the review notes, a one-liner is enough: "Screenshot tool; activeTab + scripting are used only on user-invoked capture."
