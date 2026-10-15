/* Glitch / Datamosh decor: low-res background canvas driven by randomized "variants"
   (tear bands, vertical tears, pixel-sort streaks, macroblock smear, region duplication,
   channel split, scan roll) plus scanlines. Tunables are the constants below. */
const FRAME_MS = 1000 / 24;          // ~24 fps cap
const SCALE = 4;                     // canvas is 1/SCALE of the viewport
const KEY = "strava:glitchFx";
const OPACITY = 0.8;                 // canvas opacity (was 0.5)
const BASE = "#06060a";
const COLORS = ["0,255,255", "255,0,200", "170,255,0"];
const GHOST_PX = 3;                  // RGB-offset ghost distance (canvas px)
const MAX_BANDS = 7, MAX_BLOCKS = 20, MAX_STREAKS = 12, MAX_VTEARS = 8, MAX_OPS = 60;
const BURST_MS = [120, 1200];        // burst duration range
const GAP_MS = [800, 9000];          // gap between bursts
const DOUBLE_P = 0.15, DOUBLE_GAP_MS = [400, 600]; // rapid double-burst (keeps <= ~3 flashes/s)
const QUIET_P = 0.12, QUIET_EXTRA_MS = [5000, 12000]; // occasional long quiet period
const MIN_HOLD_MS = 350;             // pattern changes at most ~3 times per second

let canvas = null, ctx = null, toggle = null, raf = 0, resizeTimer = 0, last = 0;
let motionQuery = null, systemReduced = false, pref = null;
let burstUntil = 0, nextBurst = 0, patternAt = 0, pattern = null, burstVariants = null, burstK = 1;

const rand = (a, b) => a + Math.random() * (b - a);
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const chance = p => Math.random() < p;
const rgba = (c, a) => "rgba(" + c + "," + Math.max(0, Math.min(1, a)).toFixed(3) + ")";
const count = (max, k) => Math.max(1, Math.round(rand(1, max) * k));

function readPref() {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored === "on" || stored === "off") return stored;
  } catch { /* storage unavailable */ }
  return null;
}

/* Animated by default. An explicit user choice (saved in localStorage) always wins; with no
   saved choice the effect runs even when the OS prefers reduced motion (systemReduced is
   tracked but is not used to disable it). */
function animated() {
  if (pref === "off") return false;
  return true;
}

// Each variant returns drawable ops. Order matters: copy-based variants come last so they copy finished pixels.
const VARIANTS = [
  { name: "tear", make(w, h, k) {
    return Array.from({ length: count(MAX_BANDS, k) }, () => ({
      t: "band", y: rand(0, h), h: rand(2, Math.max(3, h / 10)), dx: rand(-w / 8, w / 8), c: pick(COLORS), a: 0.22 * k + 0.08
    }));
  } },
  { name: "vtear", make(w, h, k) {
    return Array.from({ length: count(MAX_VTEARS, k) }, () => ({
      t: "vtear", x: rand(0, w), w: rand(2, 6), y: rand(0, h * 0.6), l: rand(h / 6, h / 2), dy: rand(-h / 8, h / 8), c: pick(COLORS), a: 0.22 * k + 0.08
    }));
  } },
  { name: "sort", make(w, h, k) {
    return Array.from({ length: count(MAX_STREAKS, k) }, () => ({
      t: "streak", x: Math.floor(rand(0, w / 2)) * 2, y: rand(0, h), len: rand(h / 8, h / 2.5), dir: chance(0.3) ? -1 : 1, c: pick(COLORS), a: 0.32 * k + 0.1
    }));
  } },
  { name: "smear", make(w, h, k) {
    const grid = 8;
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1]];
    const ops = Array.from({ length: count(MAX_BLOCKS, k) }, () => {
      const d = pick(dirs);
      return {
        t: "smear", x: Math.floor(rand(0, w / grid)) * grid, y: Math.floor(rand(0, h / grid)) * grid, s: grid * Math.floor(rand(1, 3)),
        dx: d[0] * grid / 2, dy: d[1] * grid / 2, n: Math.floor(rand(3, 7)), c: pick(COLORS), a: 0.28 * k + 0.1
      };
    });
    if (chance(0.5)) ops.push({ t: "stuck", x: rand(0, w * 0.8), y: rand(0, h * 0.8), w: rand(w / 14, w / 5), h: rand(h / 16, h / 6), c: pick(COLORS), a: 0.2 * k + 0.06 });
    return ops;
  } },
  { name: "split", make(w, h, k) {
    return Array.from({ length: Math.round(rand(1, 3)) }, () => ({
      t: "split", x: rand(0, w), y: chance(0.5) ? 0 : rand(0, h * 0.6), l: chance(0.5) ? h : rand(h / 8, h / 3), a: 0.35 * k + 0.1
    }));
  } },
  { name: "dup", make(w, h, k) {
    return Array.from({ length: Math.round(rand(1, 2 + k)) }, () => {
      const sw = rand(w / 10, w / 3), sh = rand(h / 12, h / 4);
      return { t: "dup", sx: rand(0, w - sw), sy: rand(0, h - sh), sw, sh, ox: rand(-w / 6, w / 6), oy: rand(-h / 8, h / 8), a: 0.55 + 0.3 * k };
    });
  } },
  { name: "roll", make(w, h, k) {
    return [{ t: "roll", y: rand(0, h * 0.7), h: rand(h / 16, h / 4), off: rand(h / 20, h / 6) * (chance(0.5) ? 1 : -1), c: pick(COLORS), a: 0.12 * k + 0.05 }];
  } }
];

function pickVariants() {
  const n = 1 + Math.floor(rand(0, 3));
  const chosen = new Set();
  while (chosen.size < n) chosen.add(pick(VARIANTS));
  return VARIANTS.filter(v => chosen.has(v));
}

function makePattern(variants, k) {
  const w = canvas.width, h = canvas.height;
  const ops = [];
  for (const v of variants) ops.push(...v.make(w, h, k));
  return ops.slice(0, MAX_OPS);
}

const DRAW = {
  band(o, w) {
    ctx.fillStyle = rgba(o.c, o.a);
    ctx.fillRect(o.dx, o.y, w, o.h);
    ctx.fillStyle = rgba("255,0,200", o.a * 0.8);
    ctx.fillRect(o.dx + GHOST_PX, o.y, w, o.h);
    ctx.fillStyle = rgba("0,255,255", o.a * 0.8);
    ctx.fillRect(o.dx - GHOST_PX, o.y, w, o.h);
  },
  vtear(o) {
    ctx.fillStyle = rgba(o.c, o.a);
    ctx.fillRect(o.x, o.y + o.dy, o.w, o.l);
    ctx.fillStyle = rgba("255,0,200", o.a * 0.8);
    ctx.fillRect(o.x + GHOST_PX, o.y + o.dy, o.w, o.l);
    ctx.fillStyle = rgba("0,255,255", o.a * 0.8);
    ctx.fillRect(o.x - GHOST_PX, o.y + o.dy, o.w, o.l);
  },
  streak(o) {
    const seg = 6, step = o.len / seg;
    for (let i = 0; i < seg; i++) {
      ctx.fillStyle = rgba(o.c, o.a * (1 - i / seg));
      ctx.fillRect(o.x, o.dir > 0 ? o.y + i * step : o.y - (i + 1) * step, 2, step);
    }
  },
  smear(o) {
    for (let i = 0; i < o.n; i++) {
      ctx.fillStyle = rgba(o.c, o.a * (1 - i / o.n));
      ctx.fillRect(o.x + o.dx * i, o.y + o.dy * i, o.s, o.s);
    }
  },
  stuck(o) {
    ctx.fillStyle = rgba(o.c, o.a);
    ctx.fillRect(o.x, o.y, o.w, o.h);
    ctx.fillStyle = rgba(o.c, o.a * 2);
    ctx.fillRect(o.x, o.y, o.w, 1);
  },
  split(o) {
    ctx.fillStyle = rgba("0,255,255", o.a);
    ctx.fillRect(o.x, o.y, 1, o.l);
    ctx.fillStyle = rgba("255,0,200", o.a);
    ctx.fillRect(o.x + GHOST_PX, o.y, 1, o.l);
  },
  dup(o) {
    ctx.globalAlpha = o.a;
    ctx.drawImage(canvas, o.sx, o.sy, o.sw, o.sh, o.sx + o.ox, o.sy + o.oy, o.sw, o.sh);
    ctx.globalAlpha = 1;
  },
  roll(o, w) {
    ctx.drawImage(canvas, 0, o.y, w, o.h, 0, o.y + o.off, w, o.h);
    ctx.fillStyle = rgba(o.c, o.a);
    ctx.fillRect(0, o.y + o.off, w, o.h);
  }
};

function drawGlitch(ops) {
  const w = canvas.width;
  for (const o of ops) DRAW[o.t](o, w);
}

function draw(withGlitch) {
  ctx.fillStyle = BASE;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "rgba(255,255,255,0.025)";
  for (let y = 0; y < canvas.height; y += 3) ctx.fillRect(0, y, canvas.width, 1);
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = "rgba(255,255,255," + rand(0.02, 0.06).toFixed(3) + ")";
    ctx.fillRect(Math.floor(rand(0, canvas.width)), Math.floor(rand(0, canvas.height)), 1, 1);
  }
  if (withGlitch && pattern) drawGlitch(pattern);
}

function scheduleBurst(now) {
  burstUntil = now + rand(BURST_MS[0], BURST_MS[1]);
  burstVariants = pickVariants();
  burstK = rand(0.55, 1);
  let gap = rand(GAP_MS[0], GAP_MS[1]);
  const r = Math.random();
  if (r < DOUBLE_P) gap = rand(DOUBLE_GAP_MS[0], DOUBLE_GAP_MS[1]);
  else if (r > 1 - QUIET_P) gap += rand(QUIET_EXTRA_MS[0], QUIET_EXTRA_MS[1]);
  nextBurst = burstUntil + gap;
  patternAt = 0;
}

function setup() {
  canvas.width = Math.max(1, Math.ceil(window.innerWidth / SCALE));
  canvas.height = Math.max(1, Math.ceil(window.innerHeight / SCALE));
  pattern = makePattern(pickVariants(), 0.7);
  draw(!animated());
}

function frame(now) {
  raf = 0;
  if (!canvas || !canvas.isConnected) { stop(); return; }
  raf = requestAnimationFrame(frame);
  if (now - last < FRAME_MS) return;
  last = now;
  if (now >= nextBurst && now >= burstUntil) {
    scheduleBurst(now);
  }
  const active = now < burstUntil;
  if (active && now - patternAt >= MIN_HOLD_MS) {
    pattern = makePattern(burstVariants, burstK);
    patternAt = now;
  }
  draw(active);
}

function play() {
  if (!raf && animated() && !document.hidden && canvas) raf = requestAnimationFrame(frame);
}

function pause() {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
}

function onVisibility() { if (document.hidden) pause(); else play(); }

function onResize() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (canvas) { setup(); play(); } }, 150);
}

function updateToggle() {
  if (!toggle) return;
  const on = animated();
  toggle.textContent = "Glitch: " + (on ? "animated" : "static");
  toggle.setAttribute("aria-pressed", on ? "true" : "false");
  toggle.title = "Toggle Glitch animation";
  document.documentElement.dataset.glitchMotion = on ? "animated" : "static";
}

function refresh() {
  pause();
  if (canvas) { draw(!animated()); play(); }
  updateToggle();
}

function onMotionChange() {
  systemReduced = motionQuery.matches;
  refresh();
}

function onToggle() {
  pref = animated() ? "off" : "on";
  try { localStorage.setItem(KEY, pref); } catch { /* ignore */ }
  refresh();
}

export function start() {
  stop();
  canvas = document.createElement("canvas");
  canvas.setAttribute("data-theme-decor", "");
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.cssText = "position:fixed;inset:0;width:100%;height:100%;z-index:-1;pointer-events:none;image-rendering:pixelated;opacity:" + OPACITY + ";";
  document.body.prepend(canvas);
  ctx = canvas.getContext("2d");
  toggle = document.createElement("button");
  toggle.type = "button";
  toggle.setAttribute("data-theme-decor", "");
  toggle.className = "glitch-fx-toggle";
  toggle.addEventListener("click", onToggle);
  document.body.appendChild(toggle);
  motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  systemReduced = motionQuery.matches;
  pref = readPref();
  burstUntil = 0;
  nextBurst = 0;
  setup();
  updateToggle();
  window.addEventListener("resize", onResize);
  document.addEventListener("visibilitychange", onVisibility);
  motionQuery.addEventListener("change", onMotionChange);
  play();
}

export function stop() {
  pause();
  clearTimeout(resizeTimer);
  window.removeEventListener("resize", onResize);
  document.removeEventListener("visibilitychange", onVisibility);
  if (motionQuery) {
    motionQuery.removeEventListener("change", onMotionChange);
    motionQuery = null;
  }
  if (toggle) { toggle.removeEventListener("click", onToggle); toggle.remove(); }
  if (canvas) canvas.remove();
  if (typeof document !== "undefined") delete document.documentElement.dataset.glitchMotion;
  canvas = ctx = toggle = null;
}
