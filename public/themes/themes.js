const THEME_STORAGE_KEY = "strava:theme";
const COLOR_MODE_STORAGE_KEY = "strava:colorMode";
const HIDDEN_THEMES_STORAGE_KEY = "strava:hiddenThemes";

const THEME_GROUPS = ["Sci-Fi / Retro-Tech", "Editorial / Minimal", "Print / Vintage", "Playful / Bold", "Album / Poster / Pop-Art", "Data Terminals / Technical", "Modern / Glass", "Time Periods", "Cinema / Album / Print", "Exotic / Novelty", "Modern / Minimal"];

const THEMES = {
  default: { label: "Default", css: null, modes: ["light", "dark"], swatch: ["#f3f7ff", "#ffffff", "#4f8cff", "#9b6bff"] },
  // Sci-Fi / Retro-Tech
  lcars: { label: "LCARS", css: "themes/lcars.css", modes: ["dark"], group: 0, swatch: ["#000000", "#111122", "#ff9966", "#cc99cc"] },
  cyberpunk: { label: "Neon Cyberpunk", css: "themes/neon-cyberpunk.css", modes: ["dark"], group: 0, swatch: ["#05060a", "#0a0e18", "#00ffe1", "#ff2bd6"] },
  synthwave: { label: "Synthwave", css: "themes/synthwave.css", modes: ["dark"], group: 0, swatch: ["#1a0b2e", "#2d1150", "#ff4fd8", "#00e5ff"] },
  "aero-instrumentation": { label: "Aero-Instrumentation (Cold War Modern)", css: "themes/aero-instrumentation.css", modes: ["dark"], group: 0, swatch: ["#3d4a43", "#33403a", "#ff8a33", "#ffbf3c"] },
  "green-terminal": { label: "Green-Screen Terminal", css: "themes/green-terminal.css", modes: ["dark"], group: 0, swatch: ["#000000", "#031003", "#00ff00", "#ffb000"] },
  blueprint: { label: "Blueprint Technical", css: "themes/blueprint.css", modes: ["dark"], group: 0, swatch: ["#0a2540", "#0d2d4d", "#5fe3ff", "#ffffff"] },
  hud: { label: "HUD (Heads-Up Display)", css: "themes/hud.css", modes: ["dark"], group: 0, swatch: ["#020a07", "#02180c", "#39ff78", "#00e5ff"] },
  "anime-hud": { label: "Anime HUD (Evangelion Style)", css: "themes/anime-hud.css", modes: ["dark"], group: 0, swatch: ["#0b0906", "#15110b", "#ff6600", "#ffd400"] },
  "sharper-image": { label: "The Sharper Image (80s/90s High-Tech)", css: "themes/sharper-image.css", modes: ["dark"], group: 0, swatch: ["#000000", "#0a0a0a", "#00e5a0", "#00d8ff"] },
  "retro-os": { label: "Retro OS (Windows 95 / Classic Mac)", css: "themes/retro-os.css", modes: ["light"], group: 0, swatch: ["#008080", "#c0c0c0", "#000080", "#0a64a8"] },
  // Editorial / Minimal
  "ft-salmon": { label: "Financial Times (Salmon & Ink)", css: "themes/ft-salmon.css", modes: ["light"], group: 1, swatch: ["#fff1e5", "#fdf6ee", "#990f3d", "#0d7680"] },
  "swiss-minimal": { label: "Monochrome Swiss Minimalist", css: "themes/swiss-minimal.css", modes: ["light"], group: 1, swatch: ["#ffffff", "#f5f5f5", "#000000", "#555555"] },
  "nyt-data": { label: "NYT Data Journalism", css: "themes/nyt-data.css", modes: ["light"], group: 1, swatch: ["#ffffff", "#f7f7f7", "#326891", "#6b8fb3"] },
  nord: { label: "Solarized Dark / Nord Atmosphere", css: "themes/nord.css", modes: ["dark"], group: 1, swatch: ["#2e3440", "#3b4252", "#88c0d0", "#81a1c1"] },
  // Print / Vintage
  googie: { label: "Googie", css: "themes/googie.css", modes: ["light"], group: 2, swatch: ["#e8f7f5", "#ffffff", "#ff6b4a", "#1fb5ad"] },
  "vintage-cartoon": { label: "Vintage Cartoon (1930s Rubber Hose)", css: "themes/vintage-cartoon.css", modes: ["light"], group: 2, swatch: ["#f4f1ea", "#fbf8f1", "#b5372b", "#2d5f8a"] },
  "ledger-1920s": { label: "1920s Ledger / Account Book", css: "themes/ledger-1920s.css", modes: ["light"], group: 2, swatch: ["#e8f5e9", "#f3fbf3", "#8b1a1a", "#1d3f8a"] },
  "pulp-tabloid": { label: "Vintage Tabloid / Pulp Magazine", css: "themes/pulp-tabloid.css", modes: ["light"], group: 2, swatch: ["#efe0a6", "#f6ebc0", "#a1005f", "#006c8a"] },
  "yellow-pages": { label: "Yellow Pages / Classifieds", css: "themes/yellow-pages.css", modes: ["light"], group: 2, swatch: ["#ffde00", "#ffe433", "#b00000", "#000000"] },
  "catalog-midcentury": { label: "Sears / Montgomery Ward Catalog", css: "themes/catalog-midcentury.css", modes: ["light"], group: 2, swatch: ["#f2efe9", "#f7f5f0", "#1f4d2b", "#8c1c2b"] },
  // Playful / Bold
  "neo-brutalist": { label: "Neo-Brutalist Comic", css: "themes/neo-brutalist.css", modes: ["light"], group: 3, swatch: ["#ffe94d", "#f1e4ff", "#5b2bff", "#ff3d81"] },
  "dark-pop": { label: "Spotify Wrapped Dark-Pop", css: "themes/dark-pop.css", modes: ["dark"], group: 3, swatch: ["#0b0b0b", "#151515", "#1ed760", "#ff3ea5"] },
  "comic-letters": { label: "Retro Comic Book (Ben-Day)", css: "themes/comic-letters.css", modes: ["light"], group: 3, swatch: ["#fff7d6", "#ffffff", "#c8006b", "#0077c8"] },
  // Album / Poster / Pop-Art
  "blue-note": { label: "Blue Note Jazz Grid", css: "themes/blue-note.css", modes: ["dark"], group: 4, swatch: ["#101735", "#f8f6ed", "#e5b84a"] },
  "saul-bass": { label: "Saul Bass Silhouette (Vertigo)", css: "themes/saul-bass.css", modes: ["light"], group: 4, swatch: ["#e54b22", "#17120f", "#fff0d4"] },
  memphis: { label: "Memphis Milano (80s Pop-Art)", css: "themes/memphis.css", modes: ["light"], group: 4, swatch: ["#f5d9e8", "#fffdf7", "#13a9a1", "#ec3b86"] },
  // Data Terminals / Technical
  sportsbook: { label: "Sportsbook Betting Board", css: "themes/sportsbook.css", modes: ["dark"], group: 5, swatch: ["#0e1116", "#20262f", "#00e676", "#ffd700"] },
  "trading-terminal": { label: "Financial Trading Terminal", css: "themes/trading-terminal.css", modes: ["dark"], group: 5, swatch: ["#12161f", "#202631", "#00d2ff", "#f04f5d"] },
  "glass-cockpit": { label: "Glass Cockpit (Tactical Avionics)", css: "themes/glass-cockpit.css", modes: ["dark"], group: 5, swatch: ["#0a1118", "#202a30", "#ffb300", "#00f5ff"] },
  bauhaus: { label: "Bauhaus Technical", css: "themes/bauhaus.css", modes: ["light"], group: 5, swatch: ["#f4f4f6", "#0055a5", "#e5a93c", "#111111"] },
  // Modern / Glass
  "liquid-glass": { label: "Liquid Glass (iOS-style Translucency)", css: "themes/liquid-glass.css", modes: ["dark"], group: 6, swatch: ["#11172a", "#252d48", "#7f8cff", "#40d8ce"] },
  // Time Periods
  "western-wanted": { label: "1800s Western Wanted Poster", css: "themes/western-wanted.css", modes: ["light"], group: 7, swatch: ["#ead7b3", "#6e492c", "#1a120b", "#63300c"] },
  "art-deco-1920s": { label: "1920s Art Deco Jazz Age", css: "themes/art-deco-1920s.css", modes: ["dark"], group: 7, swatch: ["#111111", "#191a18", "#d4af37", "#82c8b6"] },
  "diner-1950s": { label: "1950s Retro Diner", css: "themes/diner-1950s.css", modes: ["light"], group: 7, swatch: ["#a3e4d7", "#fdfefe", "#f1948a", "#006258"] },
  "psychedelic-1960s": { label: "1960s Psychedelic Pop", css: "themes/psychedelic-1960s.css", modes: ["light"], group: 7, swatch: ["#ffd166", "#fff8de", "#ef476f", "#392754"] },
  "disco-1970s": { label: "1970s Disco Inferno", css: "themes/disco-1970s.css", modes: ["dark"], group: 7, swatch: ["#21180f", "#e5a93b", "#556b2f", "#ff9a50"] },
  "greek-roman": { label: "Ancient Greece / Classical Rome", css: "themes/greek-roman.css", modes: ["light"], group: 7, swatch: ["#f4f6f7", "#4a0e2e", "#315c3d"] },
  egyptian: { label: "Ancient Egyptian Papyrus", css: "themes/egyptian.css", modes: ["light"], group: 7, swatch: ["#edc9af", "#002fa7", "#673616"] },
  // Cinema / Album / Print
  prism: { label: "Dark Side Prism", css: "themes/prism.css", modes: ["dark"], group: 8, swatch: ["#000000", "#ffffff", "#ff6a54", "#57e887"] },
  "matrix-thriller": { label: "90s Cyber-Thriller (Matrix / Hackers)", css: "themes/matrix-thriller.css", modes: ["dark"], group: 8, swatch: ["#111612", "#172019", "#39ff66", "#00c7a5"], script: "themes/matrix-thriller.js" },
  encyclopedia: { label: "Vintage Encyclopedia / Atlas", css: "themes/encyclopedia.css", modes: ["light"], group: 8, swatch: ["#fdfbf7", "#f2eee5", "#36556c", "#785c3d"] },
  // Exotic / Novelty
  "tiki-lounge": { label: "Retro Tiki Lounge", css: "themes/tiki-lounge.css", modes: ["dark"], group: 9, swatch: ["#1a2421", "#d2b57d", "#22d9c3", "#ff8455"] },
  steampunk: { label: "Steampunk Nautilus", css: "themes/steampunk.css", modes: ["dark"], group: 9, swatch: ["#0b131f", "#d9b56e", "#73a17c", "#17232d"] },
  // Modern / Minimal
  "y2k-cyber": { label: "Y2K / Late 90s Cyber (iMac G3)", css: "themes/y2k-cyber.css", modes: ["light"], group: 10, swatch: ["#a9dded", "#f8fcff", "#176a91", "#8d3a1f"] },
  "dark-academia": { label: "Dark Academia / Library", css: "themes/dark-academia.css", modes: ["light"], group: 10, swatch: ["#2c2119", "#e9dfc8", "#364a35", "#702f38"] },
  japandi: { label: "Japandi / Wabi-Sabi", css: "themes/japandi.css", modes: ["light"], group: 10, swatch: ["#e9e2d5", "#f5f0e7", "#405340", "#814332"] },
  "cyber-minimal": { label: "Cyber-Minimalism / Monochrome Slate", css: "themes/cyber-minimal.css", modes: ["dark"], group: 10, swatch: ["#0d0f12", "#191d22", "#f4f6f8", "#b6e8ff"] },
  "lcars-modern": { label: "LCARS Evolution (Flat TNG)", css: "themes/lcars-modern.css", modes: ["dark"], group: 10, swatch: ["#11131e", "#bda0d8", "#e8ae73", "#e3cf9d"] },
  "cyberpunk-breach": { label: "Cyberpunk 2077 Breach", css: "themes/cyberpunk-breach.css", modes: ["dark"], group: 10, swatch: ["#120e18", "#fcee0a", "#ff6259", "#101523"] },
};

// Legacy builds stored "dark"/"light" under strava:theme; move that to strava:colorMode.
function migrateLegacyColorMode() {
  const saved = localStorage.getItem(THEME_STORAGE_KEY);
  if (saved === "dark" || saved === "light") {
    localStorage.setItem(COLOR_MODE_STORAGE_KEY, saved);
    localStorage.removeItem(THEME_STORAGE_KEY);
  }
}

function getSavedThemeId() {
  migrateLegacyColorMode();
  const saved = localStorage.getItem(THEME_STORAGE_KEY);
  return Object.prototype.hasOwnProperty.call(THEMES, saved) ? saved : "default";
}

function applyDefaultColorMode() {
  const saved = localStorage.getItem(COLOR_MODE_STORAGE_KEY);
  const dark = saved === "dark" || (saved !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.body.classList.toggle("dark", dark);
}

const themeScriptPromises = {};
let activeDecorId = null;

function loadThemeScript(src) {
  if (!themeScriptPromises[src]) {
    themeScriptPromises[src] = new Promise((resolve, reject) => {
      const el = document.createElement("script");
      el.src = src;
      el.onload = resolve;
      el.onerror = () => reject(new Error("Failed to load " + src));
      document.head.appendChild(el);
    }).catch(error => {
      delete themeScriptPromises[src];
      throw error;
    });
  }
  return themeScriptPromises[src];
}

function stopThemeDecor() {
  const previous = activeDecorId;
  activeDecorId = null;
  try {
    window.ThemeDecor?.[previous]?.stop?.();
  } catch (error) {
    console.warn("Theme decor stop failed", error);
  }
}

function startThemeDecor(themeId, src) {
  activeDecorId = themeId;
  loadThemeScript(src).then(() => {
    if (activeDecorId !== themeId || document.body.dataset.theme !== themeId) return;
    window.ThemeDecor?.[themeId]?.start?.();
  }).catch(error => console.warn("Theme decor unavailable", error));
}

function applyTheme(id) {
  migrateLegacyColorMode();
  const themeId = Object.prototype.hasOwnProperty.call(THEMES, id) ? id : "default";
  const theme = THEMES[themeId];

  stopThemeDecor();
  document.getElementById("theme-stylesheet")?.remove();
  document.querySelectorAll("[data-theme-decor]").forEach(el => el.remove());

  document.body.dataset.theme = themeId;
  document.body.classList.remove("dark");

  if (theme.css) {
    const link = document.createElement("link");
    link.id = "theme-stylesheet";
    link.rel = "stylesheet";
    link.href = theme.css;
    document.head.appendChild(link);
  } else {
    applyDefaultColorMode();
  }

  if (theme.script) startThemeDecor(themeId, theme.script);

  const toggle = document.getElementById("theme-toggle");
  if (toggle) toggle.hidden = themeId !== "default";
  localStorage.setItem(THEME_STORAGE_KEY, themeId);
  renderThemePicker();
  updateThemeManagerAvailability();
}

function getHiddenThemeIds() {
  try {
    const hidden = JSON.parse(localStorage.getItem(HIDDEN_THEMES_STORAGE_KEY) || "[]");
    return new Set(Array.isArray(hidden)
      ? hidden.filter(id => typeof id === "string" && id !== "default" && Object.prototype.hasOwnProperty.call(THEMES, id))
      : []);
  } catch (error) {
    return new Set();
  }
}

function saveHiddenThemeIds(hiddenIds) {
  const validIds = Object.keys(THEMES).filter(id => id !== "default" && hiddenIds.has(id));
  localStorage.setItem(HIDDEN_THEMES_STORAGE_KEY, JSON.stringify(validIds));
}

const THEME_API_BASE = "http://192.168.0.115:5000";
const HIDDEN_THEMES_DIRTY_KEY = "strava:hiddenThemesDirty";
let hiddenThemesSyncTimer = null;

function setThemeSyncNote(failed) {
  const note = document.getElementById("theme-manager-sync-note");
  if (note) note.hidden = !failed;
}

async function pushHiddenThemes() {
  const hiddenThemes = Array.from(getHiddenThemeIds());
  try {
    const res = await fetch(`${THEME_API_BASE}/api/settings/hidden-themes`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hiddenThemes })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    localStorage.removeItem(HIDDEN_THEMES_DIRTY_KEY);
    setThemeSyncNote(false);
    return true;
  } catch (error) {
    localStorage.setItem(HIDDEN_THEMES_DIRTY_KEY, "1");
    setThemeSyncNote(true);
    return false;
  }
}

function scheduleHiddenThemesSync() {
  localStorage.setItem(HIDDEN_THEMES_DIRTY_KEY, "1");
  clearTimeout(hiddenThemesSyncTimer);
  hiddenThemesSyncTimer = setTimeout(pushHiddenThemes, 300);
}

async function syncHiddenThemesFromServer() {
  let settings;
  try {
    const res = await fetch(`${THEME_API_BASE}/api/settings`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    settings = await res.json();
  } catch (error) {
    return;
  }
  if (!settings || typeof settings !== "object") return;
  const local = getHiddenThemeIds();
  const dirty = localStorage.getItem(HIDDEN_THEMES_DIRTY_KEY) === "1";
  if (dirty || (!settings.hasHiddenThemes && local.size)) {
    await pushHiddenThemes();
    return;
  }
  if (!Array.isArray(settings.hiddenThemes)) return;
  saveHiddenThemeIds(new Set(settings.hiddenThemes.filter(id => typeof id === "string")));
  renderThemePicker();
  updateThemeManagerAvailability();
}

function getActiveThemeId() {
  const active = document.body.dataset.theme;
  return Object.prototype.hasOwnProperty.call(THEMES, active) ? active : getSavedThemeId();
}

function renderThemePicker() {
  const picker = document.getElementById("theme-picker");
  if (!picker) return;
  picker.style.maxWidth = "200px";
  const activeThemeId = getActiveThemeId();
  const hidden = getHiddenThemeIds();
  const wasActiveHidden = hidden.delete(activeThemeId);
  if (wasActiveHidden) saveHiddenThemeIds(hidden);
  const option = (id, theme) => {
    const element = document.createElement("option");
    element.value = id;
    element.textContent = theme.label;
    return element;
  };
  const entries = Object.entries(THEMES);
  picker.replaceChildren();
  entries.filter(([id, theme]) => theme.group === undefined && !hidden.has(id))
    .forEach(([id, theme]) => picker.appendChild(option(id, theme)));
  THEME_GROUPS.forEach((name, i) => {
    const groupEntries = entries.filter(([id, theme]) => theme.group === i && !hidden.has(id));
    if (!groupEntries.length) return;
    const group = document.createElement("optgroup");
    group.label = name;
    groupEntries.forEach(([id, theme]) => group.appendChild(option(id, theme)));
    picker.appendChild(group);
  });
  const manageOption = document.createElement("option");
  manageOption.value = "manage-themes";
  manageOption.textContent = "⚙ Manage themes…";
  picker.appendChild(manageOption);
  picker.value = activeThemeId;
}

function updateThemeManagerAvailability() {
  const hidden = getHiddenThemeIds();
  const activeThemeId = getActiveThemeId();
  document.querySelectorAll("#theme-manager [data-theme-id]").forEach(checkbox => {
    const id = checkbox.dataset.themeId;
    checkbox.checked = id === "default" || id === activeThemeId || !hidden.has(id);
    checkbox.disabled = id === "default" || id === activeThemeId;
    checkbox.title = id === activeThemeId ? "Currently in use" : id === "default" ? "Default cannot be hidden" : "";
  });
}

function renderThemeManager() {
  const container = document.getElementById("theme-manager-groups");
  if (!container) return;
  const entries = Object.entries(THEMES);
  const renderRow = ([id, theme]) => {
    const row = document.createElement("label");
    row.className = "theme-manager-row";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.dataset.themeId = id;
    checkbox.setAttribute("aria-label", `Show ${theme.label} in theme picker`);
    row.appendChild(checkbox);

    const name = document.createElement("span");
    name.className = "theme-manager-name";
    name.textContent = theme.label;
    row.appendChild(name);

    const swatches = document.createElement("span");
    swatches.className = "theme-manager-swatches";
    swatches.setAttribute("aria-hidden", "true");
    (theme.swatch || []).forEach(color => {
      const swatch = document.createElement("span");
      swatch.className = "theme-manager-swatch";
      swatch.style.backgroundColor = color;
      swatches.appendChild(swatch);
    });
    row.appendChild(swatches);
    return row;
  };
  container.replaceChildren();

  const defaultGroup = document.createElement("fieldset");
  defaultGroup.className = "theme-manager-group";
  const defaultHeading = document.createElement("legend");
  defaultHeading.textContent = "Default";
  defaultGroup.appendChild(defaultHeading);
  defaultGroup.appendChild(renderRow(entries.find(([id]) => id === "default")));
  container.appendChild(defaultGroup);

  THEME_GROUPS.forEach((name, i) => {
    const group = document.createElement("fieldset");
    group.className = "theme-manager-group";
    const heading = document.createElement("legend");
    heading.textContent = name;
    group.appendChild(heading);
    entries.filter(([, theme]) => theme.group === i).forEach(entry => group.appendChild(renderRow(entry)));
    container.appendChild(group);
  });
  updateThemeManagerAvailability();
}

function openThemeManager() {
  const dialog = document.getElementById("theme-manager");
  if (!dialog) return;
  renderThemeManager();
  if (!dialog.open) dialog.showModal();
}

function setThemeVisibility(id, shown) {
  const hidden = getHiddenThemeIds();
  if (shown) hidden.delete(id);
  else if (id !== "default" && id !== getActiveThemeId()) hidden.add(id);
  saveHiddenThemeIds(hidden);
  scheduleHiddenThemesSync();
  renderThemePicker();
  updateThemeManagerAvailability();
}

function initThemePicker() {
  const picker = document.getElementById("theme-picker");
  if (!picker) return;
  renderThemePicker();
  if (picker.dataset.initialized) return;
  picker.dataset.initialized = "true";
  picker.addEventListener("change", () => {
    if (picker.value === "manage-themes") {
      picker.value = getActiveThemeId();
      openThemeManager();
      return;
    }
    applyTheme(picker.value);
  });

  const dialog = document.getElementById("theme-manager");
  if (dialog) {
    dialog.addEventListener("change", event => {
      const checkbox = event.target.closest("[data-theme-id]");
      if (checkbox) setThemeVisibility(checkbox.dataset.themeId, checkbox.checked);
    });
    document.getElementById("theme-manager-show-all")?.addEventListener("click", () => {
      saveHiddenThemeIds(new Set());
      scheduleHiddenThemesSync();
      renderThemePicker();
      updateThemeManagerAvailability();
    });
    document.getElementById("theme-manager-hide-all")?.addEventListener("click", () => {
      const hidden = new Set(Object.keys(THEMES).filter(id => id !== "default" && id !== getActiveThemeId()));
      saveHiddenThemeIds(hidden);
      scheduleHiddenThemesSync();
      renderThemePicker();
      updateThemeManagerAvailability();
    });
    document.getElementById("theme-manager-done")?.addEventListener("click", () => dialog.close());
    document.getElementById("theme-manager-close")?.addEventListener("click", () => dialog.close());
  }
}

window.addEventListener("load", syncHiddenThemesFromServer);
