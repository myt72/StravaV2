/* Glitch / Datamosh decor: low-res background canvas (tear bands, macroblocks, pixel-sort streaks, scanlines). */
const FRAME_MS = 1000 / 24;
const SCALE = 4;
const KEY = "strava:glitchFx";
const OPACITY = 0.5;
const BASE = "#06060a";
const COLORS = ["0,255,255", "255,0,200", "170,255,0"];
const MAX_BANDS = 5, MAX_BLOCKS = 14, MAX_STREAKS = 8;
const MIN_HOLD_MS = 350; // pattern changes at most ~3 times per second

let canvas = null, ctx = null, toggle = null, raf = 0, resizeTimer = 0, last = 0;
let motionQuery = null, systemReduced = false, pref = null;
let burstUntil = 0, nextBurst = 0, patternAt = 0, pattern = null;

const rand = (a, b) => a + Math.random() * (b - a);
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

function readPref() {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored === "on" || stored === "off") return stored;
  } catch { /* storage unavailable */ }
  return null;
}

function animated() {
  if (pref === "on") return true;
  if (pref === "off") return false;
  return !systemReduced;
}

function makePattern() {
  const w = canvas.width, h = canvas.height;
  const bands = Array.from({ length: Math.floor(rand(1, MAX_BANDS + 1)) }, () => ({
    y: rand(0, h), h: rand(2, Math.max(3, h / 12)), dx: rand(-w / 10, w / 10), c: pick(COLORS)
  }));
  const grid = 8;
  const blocks = Array.from({ length: Math.floor(rand(2, MAX_BLOCKS + 1)) }, () => ({
    x: Math.floor(rand(0, w / grid)) * grid, y: Math.floor(rand(0, h / grid)) * grid,
    s: grid * Math.floor(rand(1, 3)), c: pick(COLORS), a: rand(0.1, 0.3), smear: Math.floor(rand(2, 5)) * grid
  }));
  const streaks = Array.from({ length: Math.floor(rand(1, MAX_STREAKS + 1)) }, () => ({
    x: rand(0, w), y: rand(0, h), len: rand(h / 10, h / 3), c: pick(COLORS)
  }));
  return { bands, blocks, streaks };
}

function drawGlitch(p) {
  const w = canvas.width;
  for (const b of p.bands) {
    ctx.fillStyle = "rgba(" + b.c + ",0.1)";
    ctx.fillRect(b.dx, b.y, w, b.h);
    ctx.fillStyle = "rgba(255,0,200,0.08)";
    ctx.fillRect(b.dx + 2, b.y, w, b.h);
    ctx.fillStyle = "rgba(0,255,255,0.08)";
    ctx.fillRect(b.dx - 2, b.y, w, b.h);
  }
  for (const k of p.blocks) {
    ctx.fillStyle = "rgba(" + k.c + "," + k.a + ")";
    ctx.fillRect(k.x, k.y, k.s, k.s);
    ctx.fillStyle = "rgba(" + k.c + "," + (k.a / 2.5) + ")";
    ctx.fillRect(k.x + k.s, k.y, k.smear, k.s);
  }
  for (const s of p.streaks) {
    ctx.fillStyle = "rgba(" + s.c + ",0.18)";
    ctx.fillRect(s.x, s.y, 1, s.len);
  }
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

function setup() {
  canvas.width = Math.max(1, Math.ceil(window.innerWidth / SCALE));
  canvas.height = Math.max(1, Math.ceil(window.innerHeight / SCALE));
  pattern = makePattern();
  draw(!animated());
}

function frame(now) {
  raf = 0;
  if (!canvas || !canvas.isConnected) { stop(); return; }
  raf = requestAnimationFrame(frame);
  if (now - last < FRAME_MS) return;
  last = now;
  if (now >= nextBurst && now >= burstUntil) {
    burstUntil = now + rand(250, 700);
    nextBurst = burstUntil + rand(2500, 7000);
    patternAt = 0;
  }
  const active = now < burstUntil;
  if (active && now - patternAt >= MIN_HOLD_MS) {
    pattern = makePattern();
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
