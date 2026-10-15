const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

function makeEl(tag) {
  return {
    tag, attrs: {}, children: [], listeners: {}, style: {}, isConnected: true, className: "",
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k]; },
    addEventListener(t, f) { this.listeners[t] = f; },
    removeEventListener(t) { delete this.listeners[t]; },
    remove() { this.isConnected = false; },
    getContext() { return new Proxy({}, { get: () => () => {}, set: () => true }); }
  };
}

test("theme registry lists the glitch theme", () => {
  const src = fs.readFileSync(path.join(__dirname, "../client/src/lib/theme.js"), "utf8");
  assert.match(src, /id: "glitch", label: "Glitch \/ Datamosh", supportsMode: false, decor: glitchFx/);
  const css = fs.readFileSync(path.join(__dirname, "../client/src/styles/theme.css"), "utf8");
  assert.match(css, /:root\[data-theme="glitch"\] \{/);
});

async function run(saved) {
  const body = { prepended: [], appended: [], prepend(e) { this.prepended.push(e); }, appendChild(e) { this.appended.push(e); } };
  global.document = {
    body, hidden: false, documentElement: { dataset: {} },
    createElement: makeEl, addEventListener() {}, removeEventListener() {}
  };
  global.window = {
    innerWidth: 800, innerHeight: 600, addEventListener() {}, removeEventListener() {},
    matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} })
  };
  global.localStorage = { getItem: () => saved, setItem() {} };
  global.requestAnimationFrame = () => 1;
  global.cancelAnimationFrame = () => {};
  const code = fs.readFileSync(path.join(__dirname, "../client/src/lib/glitchFx.js"), "utf8");
  const fx = await import("data:text/javascript;base64," + Buffer.from(code).toString("base64"));
  fx.start();
  return { fx, body };
}

test("glitchFx start() creates canvas + toggle and stop() removes them", async () => {
  const { fx, body } = await run(null);
  const canvas = body.prepended[0], toggle = body.appended[0];
  assert.equal(canvas.getAttribute("aria-hidden"), "true");
  assert.equal(canvas.getAttribute("data-theme-decor"), "");
  assert.match(canvas.style.cssText, /z-index:-1/);
  assert.match(canvas.style.cssText, /pointer-events:none/);
  assert.equal(toggle.className, "glitch-fx-toggle");
  assert.equal(toggle.getAttribute("aria-pressed"), "true"); // animated by default, even with reduced motion
  assert.equal(toggle.textContent, "Glitch: animated");
  assert.equal(document.documentElement.dataset.glitchMotion, "animated");
  fx.stop();
  assert.equal(canvas.isConnected, false);
  assert.equal(toggle.isConnected, false);
  assert.equal(document.documentElement.dataset.glitchMotion, undefined);
});

test("glitchFx saved 'off' wins over the animated default", async () => {
  const { fx, body } = await run("off");
  const toggle = body.appended[0];
  assert.equal(toggle.getAttribute("aria-pressed"), "false");
  assert.equal(toggle.textContent, "Glitch: static");
  assert.equal(document.documentElement.dataset.glitchMotion, "static");
  fx.stop();
  assert.equal(toggle.isConnected, false);
});
