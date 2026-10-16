/* Severance (Lumon) decor: fixed background canvas with a sparse "Macrodata Refinement" field of small
   digits that drift slowly, occasionally swell in a nervous cluster, rarely get "refined" into a box,
   plus a very faint scan hairline. Quiet and observational. Tunables are the constants below.
   Lower DIGIT_ALPHA and/or OPACITY to make the field quieter. */
const FRAME_MS = 1000 / 24;          // ~24 fps cap
const KEY = "strava:severanceFx";
const OPACITY = 0.9;                 // canvas opacity (lower = quieter field)
const SPACING = 56;                  // px between digits (both axes)
const DIGIT_SIZE = 16;               // digit font size in px
const MAX_DIGITS = 1400;             // hard cap on draw ops per frame
const DIGIT_RGB = "63,110,88";       // muted grey-green
const DIGIT_ALPHA = 0.36;            // base digit alpha (decoration only; lower = quieter field)
const CLUSTER_GAP_MS = [6000, 20000];// random gap between "anxious" clusters
const CLUSTER_MS = 1500;             // cluster swell/jitter duration
const REFINE_GAP_MS = [10000, 20000];// random gap between refinement events
const REFINE_MS = 6000;              // refinement event duration
const SWEEP_MS = 10000;              // period of the faint scan hairline
const SWEEP_ALPHA = 0.1;
const LINE_RGB = "63,110,88";

let canvas = null, ctx = null, toggle = null, raf = 0, resizeTimer = 0, last = 0;
let pref = null;
let w = 0, h = 0, clock = 0, digits = [], cluster = null, refine = null, nextCluster = 0, nextRefine = 0;

const rand = (a, b) => a + Math.random() * (b - a);
const rgba = (c, a) => "rgba(" + c + "," + Math.max(0, Math.min(1, a)).toFixed(3) + ")";

function readPref() {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored === "on" || stored === "off") return stored;
  } catch { /* storage unavailable */ }
  return null;
}

/* Animated by default. An explicit saved choice always wins; prefers-reduced-motion is not
   consulted when the user has never chosen (matches tronGrid.js and glitchFx.js). */
function animated() {
  return pref !== "off";
}

function buildDigits() {
  digits = [];
  const cols = Math.ceil(w / SPACING) + 1, rows = Math.ceil(h / SPACING) + 1;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols && digits.length < MAX_DIGITS; c++) {
      digits.push({
        c, r, x: c * SPACING + SPACING / 2, y: r * SPACING + SPACING / 2, ch: String(Math.floor(Math.random() * 10)),
        px: rand(0, 6.28), py: rand(0, 6.28), sx: rand(0.0003, 0.0008), sy: rand(0.0003, 0.0008), gone: 0
      });
    }
  }
}

function pickBox(cols, rows) {
  const bw = Math.min(cols, 3 + Math.floor(Math.random() * 3)), bh = Math.min(rows, 2 + Math.floor(Math.random() * 3));
  const c0 = Math.floor(Math.random() * Math.max(1, cols - bw)), r0 = Math.floor(Math.random() * Math.max(1, rows - bh));
  return { c0, r0, bw, bh };
}

function update(dt) {
  clock += dt * 1000;
  const cols = Math.ceil(w / SPACING) + 1, rows = Math.ceil(h / SPACING) + 1;
  if (!cluster && clock >= nextCluster) {
    const b = pickBox(cols, rows);
    cluster = { c: b.c0, r: b.r0, rad: 1 + Math.random() * 1.5, age: 0 };
  }
  if (cluster) {
    cluster.age += dt * 1000;
    if (cluster.age > CLUSTER_MS) { cluster = null; nextCluster = clock + rand(CLUSTER_GAP_MS[0], CLUSTER_GAP_MS[1]); }
  }
  if (!refine && clock >= nextRefine) {
    refine = { ...pickBox(cols, rows), age: 0 };
  }
  if (refine) {
    refine.age += dt * 1000;
    if (refine.age > REFINE_MS) { refine = null; nextRefine = clock + rand(REFINE_GAP_MS[0], REFINE_GAP_MS[1]); }
  }
}

function inRefine(d) {
  return refine && d.c >= refine.c0 && d.c < refine.c0 + refine.bw && d.r >= refine.r0 && d.r < refine.r0 + refine.bh;
}

function draw() {
  if (!ctx) return;
  ctx.clearRect(0, 0, w, h);
  ctx.font = DIGIT_SIZE + "px \"Helvetica Neue\", Helvetica, Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const move = animated();
  let bx = 0, by = 0, bw = 0, bh = 0, p = 0;
  if (refine) {
    bx = refine.c0 * SPACING; by = refine.r0 * SPACING; bw = refine.bw * SPACING; bh = refine.bh * SPACING;
    p = refine.age / REFINE_MS; // 0..1
  }
  for (const d of digits) {
    let x = d.x, y = d.y, a = DIGIT_ALPHA, size = 1;
    if (move) {
      x += Math.sin(clock * d.sx + d.px) * 1.5;
      y += Math.sin(clock * d.sy + d.py) * 1.5;
      if (cluster) {
        const dist = Math.hypot(d.c - cluster.c, d.r - cluster.r);
        if (dist <= cluster.rad) {
          const k = Math.sin(Math.PI * Math.min(1, cluster.age / CLUSTER_MS));
          size = 1 + 0.35 * k;
          x += Math.sin(clock * 0.03 + d.px) * 1.2 * k;
          y += Math.cos(clock * 0.03 + d.py) * 1.2 * k;
          a = DIGIT_ALPHA * (1 + 0.5 * k);
        }
      }
      if (inRefine(d)) {
        const slide = Math.min(1, p / 0.7);
        x += (bx + bw / 2 - x) * slide * 0.8;
        y += (by + bh / 2 - y) * slide * 0.8;
        a = DIGIT_ALPHA * (1 - slide);
      }
    }
    if (a <= 0.005) continue;
    ctx.fillStyle = rgba(DIGIT_RGB, a);
    if (size !== 1) ctx.font = DIGIT_SIZE * size + "px \"Helvetica Neue\", Helvetica, Arial, sans-serif";
    ctx.fillText(d.ch, x, y);
    if (size !== 1) ctx.font = DIGIT_SIZE + "px \"Helvetica Neue\", Helvetica, Arial, sans-serif";
  }
  if (move && refine) {
    const box = p < 0.7 ? 1 : Math.max(0, 1 - (p - 0.7) / 0.3);
    ctx.strokeStyle = rgba(LINE_RGB, 0.6 * box);
    ctx.lineWidth = 1;
    ctx.strokeRect(bx + 0.5, by + 0.5, bw, bh);
  }
  if (move) {
    const y = ((clock % SWEEP_MS) / SWEEP_MS) * h;
    ctx.fillStyle = rgba(LINE_RGB, SWEEP_ALPHA);
    ctx.fillRect(0, y, w, 1);
  }
}

function setup() {
  w = canvas.width = Math.max(1, window.innerWidth);
  h = canvas.height = Math.max(1, window.innerHeight);
  clock = 0; cluster = null; refine = null;
  nextCluster = rand(CLUSTER_GAP_MS[0], CLUSTER_GAP_MS[1]);
  nextRefine = rand(REFINE_GAP_MS[0], REFINE_GAP_MS[1]);
  buildDigits();
  draw();
}

function frame(now) {
  raf = 0;
  if (!canvas || !canvas.isConnected) { stop(); return; }
  raf = requestAnimationFrame(frame);
  if (now - last < FRAME_MS) return;
  const dt = Math.min(0.1, (now - last) / 1000 || FRAME_MS / 1000);
  last = now;
  update(dt);
  draw();
}

function play() {
  if (!raf && animated() && !document.hidden && canvas) { last = 0; raf = requestAnimationFrame(frame); }
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
  toggle.textContent = "Severance: " + (on ? "animated" : "static");
  toggle.setAttribute("aria-pressed", on ? "true" : "false");
  toggle.title = "Toggle Severance animation";
  document.documentElement.dataset.severanceMotion = on ? "animated" : "static";
}

function refresh() {
  pause();
  if (canvas) { setup(); play(); }
  updateToggle();
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
  canvas.style.cssText = "position:fixed;inset:0;width:100%;height:100%;z-index:-1;pointer-events:none;opacity:" + OPACITY + ";";
  document.body.prepend(canvas);
  ctx = canvas.getContext("2d");
  toggle = document.createElement("button");
  toggle.type = "button";
  toggle.setAttribute("data-theme-decor", "");
  toggle.className = "severance-fx-toggle";
  toggle.addEventListener("click", onToggle);
  document.body.appendChild(toggle);
  pref = readPref();
  setup();
  updateToggle();
  window.addEventListener("resize", onResize);
  document.addEventListener("visibilitychange", onVisibility);
  play();
}

export function stop() {
  pause();
  clearTimeout(resizeTimer);
  window.removeEventListener("resize", onResize);
  document.removeEventListener("visibilitychange", onVisibility);
  if (toggle) { toggle.removeEventListener("click", onToggle); toggle.remove(); }
  if (canvas) canvas.remove();
  if (typeof document !== "undefined") delete document.documentElement.dataset.severanceMotion;
  canvas = ctx = toggle = null;
  digits = []; cluster = null; refine = null;
}
