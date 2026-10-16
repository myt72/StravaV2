/* TRON (1982 Grid) decor: fixed background canvas with a perspective grid floor scrolling toward the
   viewer, light-cycle trails that turn only at 90 degrees and derez into segments, data pulses along
   grid lines and a rare drifting identity disc. Tunables are the constants below. */
const FRAME_MS = 1000 / 30;          // ~30 fps cap
const KEY = "strava:tronFx";
const TRAIL_CORE_ALPHA = 0.75;       // max trail core alpha (glow is 0.2x of it)
const OPACITY = 0.9;                 // canvas opacity
const HORIZON = 0.42;                // horizon height as a fraction of the viewport
const GRID_SPEED = 0.35;             // grid rows scrolled toward the viewer per second
const ROWS = 18;                     // horizontal grid lines
const COLS = 14;                     // vertical grid lines on each side of centre
const MAX_TRAILS = 4;                // number of simultaneous light cycles
const SPAWN_GAP_MS = [1200, 5000];   // random gap between spawns
const TRAIL_SPEED = [2.5, 5];        // grid cells per second
const TRAIL_LEN = [10, 26];          // path length in grid cells before derezzing
const MAX_VERTS = 10;                // vertices kept per trail
const RED_P = 0.2;                   // chance a trail is laser red
const DEREZ_MS = 700, FADE_CELLS = 9;
const MAX_PULSES = 3, PULSE_GAP_MS = [2500, 8000];
const DISC_GAP_MS = [25000, 60000], DISC_MS = 14000;
const CYAN = "0,240,255", BLUE = "0,59,111", RED = "255,0,60";

let canvas = null, ctx = null, toggle = null, raf = 0, resizeTimer = 0, last = 0;
let pref = null;
let w = 0, h = 0, scroll = 0, clock = 0;
let trails = [], pulses = [], disc = null, nextTrail = 0, nextPulse = 0, nextDisc = 0;

const rand = (a, b) => a + Math.random() * (b - a);
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const rgba = (c, a) => "rgba(" + c + "," + Math.max(0, Math.min(1, a)).toFixed(3) + ")";

function readPref() {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored === "on" || stored === "off") return stored;
  } catch { /* storage unavailable */ }
  return null;
}

/* Animated by default. An explicit saved choice always wins; prefers-reduced-motion is not
   consulted when the user has never chosen (matches glitchFx.js). */
function animated() {
  return pref !== "off";
}

// Floor space: u = lateral grid column, z = depth in rows (0 = horizon, ROWS = viewer).
const depth = z => { const t = z / ROWS; return t * t; };
function project(u, wz) {
  const z = wz + scroll;
  const d = depth(z), hy = h * HORIZON;
  return { x: w / 2 + u * (w / (COLS * 1.6)) * d * 2.2, y: hy + (h - hy) * d, z, d };
}

function spawnTrail() {
  const horizontal = Math.random() < 0.5;
  const speed = rand(TRAIL_SPEED[0], TRAIL_SPEED[1]);
  const t = {
    verts: [], u: Math.round(rand(-COLS + 3, COLS - 3)), z: Math.round(rand(4, ROWS - 3)) - scroll,
    dir: horizontal ? [Math.random() < 0.5 ? 1 : -1, 0] : [0, Math.random() < 0.5 ? 1 : -1],
    speed, left: rand(TRAIL_LEN[0], TRAIL_LEN[1]), straight: rand(3, 8), c: Math.random() < RED_P ? RED : CYAN,
    state: "run", age: 0, shards: null
  };
  t.z = Math.round(t.z);
  t.verts.push({ u: t.u, z: t.z });
  trails.push(t);
}

function turn(t) {
  t.dir = t.dir[0] ? [0, Math.random() < 0.5 ? 1 : -1] : [Math.random() < 0.5 ? 1 : -1, 0];
  t.straight = rand(3, 8);
  t.verts.push({ u: t.u, z: t.z });
  if (t.verts.length > MAX_VERTS) t.verts.shift();
}

function derez(t) {
  t.state = "derez";
  t.age = 0;
  const pts = t.verts.concat([{ u: t.u, z: t.z }]);
  t.shards = [];
  for (let i = 0; i < pts.length - 1 && t.shards.length < 24; i++) {
    const n = 2;
    for (let k = 0; k < n; k++) {
      const a = k / n, b = (k + 1) / n;
      t.shards.push({
        u1: pts[i].u + (pts[i + 1].u - pts[i].u) * a, z1: pts[i].z + (pts[i + 1].z - pts[i].z) * a,
        u2: pts[i].u + (pts[i + 1].u - pts[i].u) * b, z2: pts[i].z + (pts[i + 1].z - pts[i].z) * b,
        du: rand(-0.6, 0.6), dz: rand(-0.6, 0.6)
      });
    }
  }
}

function update(dt) {
  clock += dt * 1000;
  scroll += GRID_SPEED * dt;
  if (scroll >= 1) { scroll -= 1; for (const t of trails) { for (const v of t.verts) v.z -= 1; t.z -= 1; if (t.shards) for (const s of t.shards) { s.z1 -= 1; s.z2 -= 1; } } for (const p of pulses) p.z -= 1; }
  if (clock >= nextTrail && trails.length < MAX_TRAILS) {
    spawnTrail();
    nextTrail = clock + rand(SPAWN_GAP_MS[0], SPAWN_GAP_MS[1]);
  }
  for (const t of trails) {
    if (t.state === "derez") { t.age += dt * 1000; continue; }
    const step = t.speed * dt;
    t.u += t.dir[0] * step;
    t.z += t.dir[1] * step;
    t.left -= step;
    t.straight -= step;
    if (t.u < -COLS || t.u > COLS || t.z < 1 || t.z + scroll > ROWS + 1) { derez(t); continue; }
    if (t.straight <= 0) { t.u = Math.round(t.u); t.z = Math.round(t.z); turn(t); }
    if (t.left <= 0) derez(t);
  }
  trails = trails.filter(t => t.state !== "derez" || t.age < DEREZ_MS);
  if (clock >= nextPulse && pulses.length < MAX_PULSES) {
    pulses.push(Math.random() < 0.5
      ? { vertical: true, u: Math.round(rand(-COLS, COLS)), z: 0, len: rand(2, 4), v: rand(4, 7) }
      : { vertical: false, u: -COLS, z: Math.round(rand(3, ROWS)) - 0, len: rand(2, 4), v: rand(8, 14) * (Math.random() < 0.5 ? 1 : -1) });
    if (!pulses[pulses.length - 1].vertical && pulses[pulses.length - 1].v < 0) pulses[pulses.length - 1].u = COLS;
    nextPulse = clock + rand(PULSE_GAP_MS[0], PULSE_GAP_MS[1]);
  }
  for (const p of pulses) { if (p.vertical) p.z += p.v * dt; else p.u += p.v * dt; }
  pulses = pulses.filter(p => (p.vertical ? p.z < ROWS + 1 : p.u > -COLS - 4 && p.u < COLS + 4));
  if (!disc && clock >= nextDisc) disc = { age: 0, x: rand(0.2, 0.8), r: rand(14, 24) };
  if (disc) {
    disc.age += dt * 1000;
    if (disc.age > DISC_MS) { disc = null; nextDisc = clock + rand(DISC_GAP_MS[0], DISC_GAP_MS[1]); }
  }
}

function line(x1, y1, x2, y2, c, a, wd) {
  ctx.strokeStyle = rgba(c, a);
  ctx.lineWidth = wd;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function drawGrid() {
  const hy = h * HORIZON;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, w, h);
  // faint fog glow at the horizon (stacked translucent bands, no gradients)
  for (let i = 0; i < 6; i++) {
    ctx.fillStyle = rgba(BLUE, 0.07);
    ctx.fillRect(0, hy - i * 7, w, i * 7 + 6);
  }
  ctx.fillStyle = rgba(CYAN, 0.35);
  ctx.fillRect(0, hy, w, 1);
  const off = scroll;
  for (let k = 0; k <= ROWS; k++) {
    const z = k + off;
    if (z <= 0 || z > ROWS) continue;
    const y = hy + (h - hy) * depth(z);
    line(0, y, w, y, CYAN, 0.1 + 0.4 * depth(z), 1);
  }
  const span = w / (COLS * 1.6) * 2.2;
  for (let i = -COLS; i <= COLS; i++) {
    line(w / 2, hy, w / 2 + i * span, h, CYAN, i === 0 ? 0.45 : 0.3, 1);
  }
}

function trailPoints(t) {
  const pts = t.verts.map(v => project(v.u, v.z));
  pts.push(project(t.u, t.z));
  return pts;
}

function drawTrail(t) {
  if (t.state === "derez") {
    const k = 1 - t.age / DEREZ_MS;
    for (const s of t.shards) {
      const e = t.age / DEREZ_MS;
      const a = project(s.u1 + s.du * e, s.z1 + s.dz * e), b = project(s.u2 + s.du * e, s.z2 + s.dz * e);
      line(a.x, a.y, b.x, b.y, t.c, 0.7 * k, 2);
    }
    return;
  }
  const pts = trailPoints(t);
  let cells = 0;
  for (let i = pts.length - 1; i > 0; i--) {
    const a = pts[i], b = pts[i - 1];
    const lenCells = Math.abs((t.verts[i - 1] ? t.verts[i - 1].u : 0) - (i === pts.length - 1 ? t.u : t.verts[i].u)) +
      Math.abs((t.verts[i - 1] ? t.verts[i - 1].z : 0) - (i === pts.length - 1 ? t.z : t.verts[i].z));
    const fade = Math.max(0.08, 1 - cells / FADE_CELLS);
    cells += lenCells;
    if (a.z <= 0 && b.z <= 0) continue;
    line(a.x, a.y, b.x, b.y, t.c, TRAIL_CORE_ALPHA * 0.2 * fade, 7);
    line(a.x, a.y, b.x, b.y, t.c, TRAIL_CORE_ALPHA * fade, 2);
  }
  const hd = pts[pts.length - 1];
  ctx.fillStyle = rgba("230,249,255", 0.95);
  ctx.fillRect(hd.x - 2, hd.y - 2, 4, 4);
}

function drawPulses() {
  for (const p of pulses) {
    const a = p.vertical ? project(p.u, p.z - p.len) : project(p.u, p.z - scroll);
    const b = p.vertical ? project(p.u, p.z) : project(p.u - Math.sign(p.v) * p.len, p.z - scroll);
    if (a.z <= 0 || b.z <= 0) continue;
    line(a.x, a.y, b.x, b.y, "230,249,255", 0.55, 2);
  }
}

function drawDisc() {
  if (!disc) return;
  const k = disc.age / DISC_MS, hy = h * HORIZON;
  const cx = w * disc.x + k * w * 0.1, cy = hy * (0.45 + 0.1 * Math.sin(k * 6));
  const fade = Math.sin(Math.PI * k) * 0.6, rot = k * Math.PI * 6, r = disc.r;
  ctx.lineWidth = 2;
  ctx.strokeStyle = rgba(CYAN, fade);
  ctx.beginPath();
  ctx.ellipse(cx, cy, r, r * 0.45, 0, rot, rot + Math.PI * 1.6);
  ctx.stroke();
  ctx.strokeStyle = rgba(CYAN, fade * 0.5);
  ctx.beginPath();
  ctx.ellipse(cx, cy, r * 0.55, r * 0.25, 0, -rot, -rot + Math.PI * 1.3);
  ctx.stroke();
}

function draw() {
  if (!ctx) return;
  drawGrid();
  for (const t of trails) drawTrail(t);
  drawPulses();
  drawDisc();
}

function setup() {
  w = canvas.width = Math.max(1, window.innerWidth);
  h = canvas.height = Math.max(1, window.innerHeight);
  scroll = 0; clock = 0; trails = []; pulses = []; disc = null;
  nextTrail = 0; nextPulse = 3000; nextDisc = rand(DISC_GAP_MS[0] / 2, DISC_GAP_MS[1] / 2);
  if (!animated()) {
    for (let i = 0; i < 60; i++) update(0.1);
    trails = trails.filter(t => t.state !== "derez");
  }
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
  toggle.textContent = "Tron: " + (on ? "animated" : "static");
  toggle.setAttribute("aria-pressed", on ? "true" : "false");
  toggle.title = "Toggle Tron animation";
  document.documentElement.dataset.tronMotion = on ? "animated" : "static";
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
  toggle.className = "tron-fx-toggle";
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
  if (typeof document !== "undefined") delete document.documentElement.dataset.tronMotion;
  canvas = ctx = toggle = null;
  trails = []; pulses = []; disc = null;
}
