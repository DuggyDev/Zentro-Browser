# Zentro Browser

An original, privacy-minded web browser for Windows 10 and 11, built on Electron (Chromium). Dark by default, black / charcoal / deep red.

```
npm install
npm start            # run the browser
npm run dev          # run with developer tools for the browser UI
npm test             # unit tests + static checks (no Electron needed)
npm run build:win    # creates dist\Zentro-Setup.exe
```

## Get Zentro-Setup.exe without installing anything (GitHub builds it)

1. Create a **new** repository on GitHub, e.g. `ZentroBrowser` (keep it separate from the download manager).
2. In this folder, in PowerShell:
   ```
   git init
   git add .
   git commit -m "Zentro Browser"
   git branch -M main
   git remote add origin https://github.com/YOUR-NAME/ZentroBrowser.git
   git push -u origin main
   ```
3. Open the repository's **Actions** tab, open **Build Zentro Browser (Windows)**, wait 3 to 6 minutes for the green check.
4. Open the run, download **Zentro-Setup** under *Artifacts*, unzip it, double-click `Zentro-Setup.exe`.
   Windows SmartScreen may warn because the installer is not code-signed: **More info > Run anyway**.

(Tag a release with `git tag v1.0.0 && git push origin v1.0.0` to get the .exe as a direct download under *Releases*.)

## What is in it

| Area | What it does |
| --- | --- |
| Tabs | Real Chromium tab per page (own process), favicons, titles, close, new, duplicate, pin, mute, drag to reorder, reopen closed tabs, restore previous session, optional sleeping tabs, vertical tabs mode |
| Address bar | URL or search detection, suggestions from bookmarks and history, Google by default (DuckDuckGo, Bing, Brave Search, Ecosia available), security indicator |
| Shortcuts | Ctrl+T, W, Shift+T, L, Tab, R, F, D, H, J, N, Shift+N, P, +/-/0, Alt+Left/Right/Home, F5, F11, F12, Ctrl+Alt+1-9 |
| Bookmarks | Star button, folders, edit, search, import and export (standard Netscape HTML) |
| History | Searchable, grouped by day, delete one or clear by time range. Never recorded in private windows |
| Downloads | Progress, speed, pause/resume, cancel, retry, open file, show in folder, own folder setting. Never auto-opened; executables ask first |
| New tab | Clock, search, speed dial with the sites' own logos (add/edit/remove), recent sites, real Shield statistics, backgrounds (Ember, Graphite, Midnight, and a gallery of your own uploads by button or drag and drop), accent colours |
| Dark mode | The browser is dark by default and websites are asked for their dark theme. "Dark mode for websites" (Settings > Appearance, on by default, needs a restart) additionally darkens sites that have no dark theme |
| Sidebar | Compact or expanded rail with built-in Bookmarks, History, Downloads, Collections panels plus any websites you add (side panel or tab). Nothing third-party is bundled |
| Collections | Save pages and notes together |
| Reading mode | Text-only version of article pages |
| Zentro Shield | Blocks third-party requests to known ad/tracker domains (bundled list, optional update from pgl.yoyo.org), optional third-party cookie blocking, HTTPS first, per-site off switch, honest per-page counter |
| Private windows | Separate in-memory session, deleted on close, third-party cookies blocked by default, no history |
| Permissions | Location, camera/microphone, notifications etc. are asked per site, remembered only if you choose, revocable in Settings |
| Extensions | Install from the Chrome Web Store (paste a link) or load unpacked folders (see limits) |
| Settings | Search engine, startup, homepage, theme (dark/light/system), accent, tab layout, sidebar, sleeping tabs, downloads, Shield, permissions, clear browsing data, restore defaults |

## Security design

- Every web page runs in a sandboxed renderer with `nodeIntegration: false`, `contextIsolation: true`. Websites receive no bridge object at all.
- The browser's own pages live on a private `zentro://` scheme. The preload exposes an API only when `location.protocol === 'zentro:'`.
- All calls go through one IPC channel. The main process checks the sender is a top-level `zentro://` frame of one of our views, checks the method's scope (toolbar-only vs. any browser page) and validates every argument. Pages never send file paths.
- Websites cannot navigate to `zentro://`. `file:`, `javascript:`, `view-source:` and unknown protocols are never opened from links; `mailto:` and `tel:` ask first.
- Settings changes are whitelisted and type-checked; hand-edited profile files fall back to defaults.
- Certificate errors are never bypassed. Own pages have strict CSPs, no inline scripts, and write page data with `textContent` only.
- Speed-dial logos are downloaded from the shortcut's own website (never from a third-party icon service) and cached on your computer.
- Nothing leaves your computer except the pages you visit. There is no telemetry or sync. The only optional request Zentro makes by itself is the filter-list download when you press the button.

## Limits you should know about

- **Signing in with a Google account**: Google refuses embedded Chromium browsers ("This browser or app may not be secure"). Zentro works around this only on Google's sign-in pages (accounts.google.com) by presenting a Firefox identity there. This is a workaround, not a guarantee: Google may change its checks at any time, and some banks and other sites may refuse Zentro as well.
- **No DRM video** (Netflix, Disney+ ...): Electron ships without Widevine.
- **Extensions**: Electron implements only part of Chrome's extension APIs. You can install from the Chrome Web Store by pasting its link, but there are no toolbar popups and extensions that need Chrome APIs Electron lacks will not run. Not tested against any particular extension.
- **Shield** is a domain blocklist, not a full content blocker: no cosmetic filtering, no fingerprint protection, no VPN. Third-party detection uses an approximate public-suffix list.
- **No password manager** (not implemented, because it must not be done insecurely), no sync, no automatic updates, not registered as the Windows default browser.
- Pop-ups opened with `window.open` open as normal tabs (`window.opener` is not kept), which can break some pop-up based logins.
- The installer is unsigned. Windows may warn once.

## Tested vs. not tested

Automated tests (`npm test`) cover address-bar parsing, URL safety, Shield matching, settings validation, profile storage (bookmarks, history, collections, session, permissions), bookmark import/export, keyboard shortcut mapping, and static checks that every page button calls an existing IPC method, every element id exists and no page uses inline scripts or unsafe HTML.
The Electron window itself (layout, views, native menus, Windows title-bar buttons, downloads, Shield on live traffic) cannot be run in the build sandbox and has to be verified on a real Windows machine. If something looks wrong on first launch, report it with a screenshot.


## Accounts, Premium and VPN (1.2)
Sign-in (email or Google), Zentro Premium (Stripe) and a browser VPN, plus a forced "you need to update" screen. See [SETUP.md](SETUP.md) for the one-time setup.

## AI assistant, profile picture and animations (1.2)
- **AI button** (toolbar or Ctrl+Shift+A): a floating, draggable panel with ChatGPT, Claude, Gemini, Grok or your own AI link (Settings > AI assistant). It shows the AI's real website, so you sign in there with your own account. The Share button puts the page text, your selection or a screenshot in the AI's message box when you press it; you still press Send. Nothing is shared automatically.
- **Profile picture** (Account & Premium): five animated styles, or upload a picture/GIF.
- **Animations** can be turned off in Settings > Appearance (and follow the system "reduce motion" setting).
