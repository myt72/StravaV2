# Themes

Default lives in `public/styles.css` and is never edited for a theme. Every other theme is one CSS file in this folder, registered in `THEMES` in `themes.js` and loaded by `applyTheme()`. Default is the only theme with the light/dark toggle.

## Rules

- Every selector is scoped under `body[data-theme="<id>"]`.
- Each theme overrides the same CSS variables Default uses (`--bg-2`, `--surface*`, `--text*`, `--border`, `--accent*`, `--distance`, `--time`, `--elevation`, `--danger`, `--success`, `--warning`, `--shadow*`, `--radius*`, `--glass`) and also overrides hard-coded colors in `styles.css` (tone gradients, `.menu-trigger`, `.segmented-btn.active`, `.bar-fill`, `.stack-list-fill`, `.annual-strip-fill`, `.hero-main::before`, `.brand-orb`, `.kpi-card::after`, `.spinner-wheel`) so Default colors never leak.
- Same markup and data in every theme. Do not hide filters, charts, records, bikes or the advanced actions dropdown.
- Charts: `.timeline-bar-value/label`, `.annual-strip-top/label/sub` and `.bar-value/label` get explicit colors with at least 4.5:1 contrast on `--surface-muted`. Never put a gradient on `.timeline-bars-wrap.tone-*` (it sits behind the text); style `.timeline-bar-fill` instead.
- CSS only (gradients, pseudo-elements, inline SVG data URIs), system font stacks with fallbacks, animations wrapped in `prefers-reduced-motion: no-preference`.
- Themes are self-contained. Share a file only between specific themes, and never load it for Default.
- Decorative DOM, if ever needed, must carry `data-theme-decor` so `applyTheme()` removes it on switch.

## Optional per-theme script (decor hook)

A registry entry may add `script: "themes/<id>.js"`. After the stylesheet is applied, `applyTheme()` loads the script once (the load promise is cached) and calls `window.ThemeDecor[id].start()`. On every switch it first calls `stop()` for the previously active decor theme. Themes without `script` make no extra requests; a load failure only logs a `console.warn`.

Contract: the script registers `window.ThemeDecor = window.ThemeDecor || {}; window.ThemeDecor["<id>"] = { start(), stop() }`. Created elements must carry `data-theme-decor`, the decor must respect `prefers-reduced-motion` (static frame, no animation), and `stop()` must fully clean up (cancel animation frames, remove listeners and elements).

`matrix-thriller` uses this for its animated Matrix digital-rain canvas (`themes/matrix-thriller.js`), a fixed, click-through canvas behind the page (panels are semi-transparent so the streams show through). It respects `prefers-reduced-motion` by default (static frame), but a small fixed "Rain: animated / static" toggle (bottom-right) lets users override it. The choice is stored in `localStorage["strava:matrixRain"]` (`"on"` always animates, `"off"` is static, absent follows the system) and can also be set with `?rain=on` / `?rain=off` in the URL.

## Adding a theme

1. Create `themes/<id>.css`.
2. Add it to `THEMES` in `themes.js` with a `group` index (into `THEME_GROUPS`) and a `swatch` array of 3–4 representative CSS colors.
3. Add it to the list below.

## Hiding and restoring themes

Choose **Manage themes…** from the theme picker or the Advanced Actions menu to show or hide themes from the picker. Changes take effect immediately. **Show all** restores every theme, while **Hide all except Default and current** keeps a route back to Default and protects the active theme. Default and the active theme cannot be hidden.

Hidden theme IDs are saved on the server in `settings.json` at the repo root (gitignored), so they survive restarts and are the same in every browser and address. `localStorage["strava:hiddenThemes"]` is kept as a fast cache and offline fallback: if the server can't be reached the dialog shows "Saved locally only" and syncs on the next change or page load. Existing browser-only selections are pushed to the server automatically the first time. Newly added themes are visible by default. Hiding a theme only removes it from the picker—saved theme IDs still load normally. Unknown or removed IDs are ignored, and picker groups with no visible themes are omitted.

Endpoints:

- `GET /api/settings` – returns `{ "hiddenThemes": [...], "hasHiddenThemes": bool }`.
- `PUT /api/settings/hidden-themes` – body `{ "hiddenThemes": ["lcars", ...] }` (max 100 IDs matching `/^[a-z0-9-]{1,40}$/`); returns the saved list, or 400 on invalid input.

## Themes

Default (first in the picker)

**Sci-Fi / Retro-Tech**: `lcars`, `cyberpunk` (neon-cyberpunk.css), `synthwave`, `aero-instrumentation`, `green-terminal`, `blueprint`, `hud`, `anime-hud`, `sharper-image`, `retro-os`

**Editorial / Minimal**: `ft-salmon`, `swiss-minimal`, `nyt-data`, `nord`

**Print / Vintage**: `googie`, `vintage-cartoon`, `ledger-1920s`, `pulp-tabloid`, `yellow-pages`, `catalog-midcentury`

**Playful / Bold**: `neo-brutalist`, `dark-pop`, `comic-letters`

**Album / Poster / Pop-Art**: `blue-note`, `saul-bass`, `memphis`

**Data Terminals / Technical**: `sportsbook`, `trading-terminal`, `glass-cockpit`, `bauhaus`

**Modern / Glass**: `liquid-glass`

**Time Periods**: `western-wanted`, `art-deco-1920s`, `diner-1950s`, `psychedelic-1960s`, `disco-1970s`, `greek-roman`, `egyptian`

**Cinema / Album / Print**: `prism`, `matrix-thriller`, `encyclopedia`

**Exotic / Novelty**: `tiki-lounge`, `steampunk`

**Modern / Minimal**: `y2k-cyber`, `dark-academia`, `japandi`, `cyber-minimal`, `lcars-modern`, `cyberpunk-breach`
