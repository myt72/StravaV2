/* Matrix rain: framework-free port of V1 public/themes/matrix-thriller.js. */
const GLYPHS = (() => {
  let g = "";
  for (let c = 0xff66; c <= 0xff9d; c++) g += String.fromCharCode(c);
  return g + "0123456789:.=*+-<>|";
})();
const FRAME_MS = 1000 / 35;
const MAX_DPR = 2;
const SPACING = 15;
const MIN_TRAIL = 12, MAX_TRAIL = 30;
const KEY = "strava:matrixRain";
const OPACITY = 0.65;

let canvas = null, ctx = null, toggle = null, raf = 0, resizeTimer = 0, last = 0;
let cols = [], size = 15, rows = 0, motionQuery = null, systemReduced = false, pref = null;

const glyph = () => GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
const dpr = () => Math.min(window.devicePixelRatio || 1, MAX_DPR);
const rand = (a, b) => a + Math.random() * (b - a);

function readPref() {
  let v = null;
  try {
    const q = new URLSearchParams(window.location.search).get("rain");
    if (q === "on" || q === "off") {
      localStorage.setItem(KEY, q);
      v = q;
    } else {
      const stored = localStorage.getItem(KEY);
      if (stored === "on" || stored === "off") v = stored;
    }
  } catch { /* storage unavailable */ }
  return v;
}

function animated() {
  if (pref === "on") return true;
  if (pref === "off") return false;
  return !systemReduced;
}

function newColumn(initial) {
  const len = MIN_TRAIL + Math.floor(Math.random() * (MAX_TRAIL - MIN_TRAIL + 1));
  return {
    y: initial ? rand(-len, rows + len) : rand(-len * 2, 0),
    speed: rand(0.25, 0.9),
    acc: 0,
    glyphs: Array.from({ length: len }, glyph)
  };
}

function setup() {
  const ratio = dpr();
  canvas.width = Math.ceil(window.innerWidth * ratio);
  canvas.height = Math.ceil(window.innerHeight * ratio);
  size = Math.round(SPACING * ratio);
  rows = Math.ceil(canvas.height / size);
  const n = Math.ceil(canvas.width / size);
  cols = Array.from({ length: n }, () => newColumn(true));
  draw();
}

function trailColor(i, len) {
  if (i === 0) return "#e8fff0";
  if (i === 1) return "#9dffb5";
  const t = (i - 1) / len;
  if (t < 0.3) return "#00ff41";
  return "rgba(0,255,65," + Math.max(0.08, 0.85 * (1 - (t - 0.3) / 0.7)).toFixed(3) + ")";
}

function draw() {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = size + "px monospace";
  ctx.textBaseline = "top";
  for (let i = 0; i < cols.length; i++) {
    const c = cols[i];
    const head = Math.floor(c.y);
    const len = c.glyphs.length;
    for (let j = 0; j < len; j++) {
      const row = head - j;
      if (row < 0 || row > rows) continue;
      ctx.fillStyle = trailColor(j, len);
      ctx.fillText(c.glyphs[j], i * size, row * size);
    }
  }
}

function frame(now) {
  raf = 0;
  if (!canvas || !canvas.isConnected) { stop(); return; }
  raf = requestAnimationFrame(frame);
  if (now - last < FRAME_MS) return;
  last = now;
  for (let i = 0; i < cols.length; i++) {
    const c = cols[i];
    c.acc += c.speed;
    while (c.acc >= 1) {
      c.acc -= 1;
      c.y++;
      c.glyphs.unshift(glyph());
      c.glyphs.pop();
    }
    if (Math.random() < 0.08) c.glyphs[Math.floor(Math.random() * c.glyphs.length)] = glyph();
    if (c.y - c.glyphs.length > rows && Math.random() > 0.95) cols[i] = newColumn(false);
  }
  draw();
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
  toggle.textContent = "Rain: " + (on ? "animated" : "static");
  toggle.setAttribute("aria-pressed", on ? "true" : "false");
  toggle.title = "Toggle Matrix rain animation";
}

function refresh() {
  pause();
  if (canvas) { draw(); play(); }
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
  canvas.style.cssText = "position:fixed;inset:0;width:100%;height:100%;z-index:-1;pointer-events:none;opacity:" + OPACITY + ";";
  document.body.prepend(canvas);
  ctx = canvas.getContext("2d");
  toggle = document.createElement("button");
  toggle.type = "button";
  toggle.setAttribute("data-theme-decor", "");
  toggle.className = "matrix-rain-toggle";
  toggle.addEventListener("click", onToggle);
  document.body.appendChild(toggle);
  motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  systemReduced = motionQuery.matches;
  pref = readPref();
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
  canvas = ctx = toggle = null;
}
