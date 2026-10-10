import { useCallback, useEffect, useRef, useState } from "react";
import { BIKE_MAX_BYTES, bikeImageRequest } from "../lib/api.js";
import { filenameOf, focusPosition, useAppData } from "../context/AppData.jsx";

const SLIDESHOW_MS = 4000;
const HEIC_LIB_URL = `${import.meta.env.BASE_URL}vendor/heic2any.min.js`;
let heicLibPromise = null;

const isHeicFile = file => /^image\/(heic|heif)(-sequence)?$/i.test(file.type || "") || /\.(heic|heif)$/i.test(file.name || "");
const clamp01 = n => Math.min(1, Math.max(0, n));

/** Full prefs object `{ cover, focus }` with filenames missing from `names` pruned. */
function buildPrefs(cover, focus, names) {
  const keep = new Set(names);
  const out = { cover: cover && keep.has(cover) ? cover : null, focus: {} };
  Object.keys(focus || {}).forEach(n => { if (keep.has(n)) out.focus[n] = focus[n]; });
  return out;
}

function loadHeicLib() {
  if (window.heic2any) return Promise.resolve(window.heic2any);
  if (!heicLibPromise) {
    heicLibPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = HEIC_LIB_URL;
      script.onload = () => (window.heic2any ? resolve(window.heic2any) : reject(new Error("HEIC converter unavailable")));
      script.onerror = () => reject(new Error("Could not load HEIC converter"));
      document.head.appendChild(script);
    }).catch(err => {
      heicLibPromise = null;
      throw err;
    });
  }
  return heicLibPromise;
}

async function convertHeicToJpeg(file) {
  const heic2any = await loadHeicLib();
  const result = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.9 });
  const blob = Array.isArray(result) ? result[0] : result;
  if (!blob) throw new Error("Empty conversion result");
  return new File([blob], file.name.replace(/\.[^.]*$/, "") + ".jpg", { type: "image/jpeg" });
}

/** Modal photo gallery with slideshow, add / replace / remove. Uses /api/bike-images exactly like V1. */
export default function PhotoGallery({ gid, name, urls, startIndex = 0, onImagesChange, onClose }) {
  const { bikePhotoPrefs, setBikePhotoPrefs, getCoverPhoto } = useAppData();
  const dialogRef = useRef(null);
  const editorRef = useRef(null);
  const addRef = useRef(null);
  const replaceRef = useRef(null);
  const [index, setIndex] = useState(startIndex);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [focusDraft, setFocusDraft] = useState(null);

  const count = urls.length;
  const safeIndex = Math.min(index, Math.max(0, count - 1));
  const url = urls[safeIndex];
  const names = urls.map(filenameOf);
  const prefs = bikePhotoPrefs[gid] || {};
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const isCover = count > 0 && getCoverPhoto(gid).url === url;
  const savedFocus = url ? prefs.focus?.[filenameOf(url)] : null;
  const focusMode = focusDraft !== null;

  useEffect(() => {
    const d = dialogRef.current;
    if (d && !d.open) d.showModal();
  }, []);

  useEffect(() => { setLoading(true); }, [url]);
  useEffect(() => { if (focusDraft) editorRef.current?.focus(); }, [focusDraft !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  const savePrefs = (cover, focus, list) => setBikePhotoPrefs(gid, buildPrefs(cover, focus, list));

  function setAsCover() {
    if (!url || count < 2 || isCover) return;
    savePrefs(filenameOf(url), prefs.focus, names);
  }

  function startFocus() {
    if (!url) return;
    setPlaying(false);
    setFocusDraft(savedFocus ? { x: savedFocus.x, y: savedFocus.y } : { x: 0.5, y: 0.5 });
  }

  function saveFocus() {
    if (!focusDraft || !url) return;
    const point = { x: Number(clamp01(focusDraft.x).toFixed(4)), y: Number(clamp01(focusDraft.y).toFixed(4)) };
    savePrefs(prefs.cover, { ...prefs.focus, [filenameOf(url)]: point }, names);
    setFocusDraft(null);
  }

  function placeFromPointer(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    setFocusDraft({ x: clamp01((e.clientX - rect.left) / rect.width), y: clamp01((e.clientY - rect.top) / rect.height) });
  }

  function onEditorKey(e) {
    if (e.target !== e.currentTarget) return;
    const stepBy = e.shiftKey ? 0.05 : 0.01;
    const move = { ArrowLeft: [-stepBy, 0], ArrowRight: [stepBy, 0], ArrowUp: [0, -stepBy], ArrowDown: [0, stepBy] }[e.key];
    if (move) {
      e.preventDefault();
      setFocusDraft(d => ({ x: clamp01(d.x + move[0]), y: clamp01(d.y + move[1]) }));
    } else if (e.key === "Enter") {
      e.preventDefault();
      saveFocus();
    }
  }

  const step = useCallback((delta, fromTimer) => {
    if (count < 2) return;
    if (!fromTimer) setPlaying(false);
    setIndex(i => (Math.min(i, count - 1) + delta + count) % count);
  }, [count]);

  useEffect(() => {
    if (!playing || count < 2) return undefined;
    const t = setInterval(() => step(1, true), SLIDESHOW_MS);
    return () => clearInterval(t);
  }, [playing, count, step]);

  useEffect(() => { if (count < 2) setPlaying(false); }, [count]);

  const apply = (method, filename, file) =>
    bikeImageRequest(method, gid, filename, file).then(data => {
      onImagesChange(gid, data.images);
      return data;
    });

  async function send(method, filename, file, progress) {
    let upload = file;
    if (isHeicFile(file)) {
      setStatus(`${progress}Converting HEIC: ${file.name}...`);
      try {
        upload = await convertHeicToJpeg(file);
      } catch (err) {
        console.warn("HEIC conversion failed", err);
        return { error: `Couldn't convert ${file.name}` };
      }
    }
    if (upload.size > BIKE_MAX_BYTES) return { error: `${file.name} is larger than 15 MB${upload !== file ? " after conversion" : ""}` };
    setStatus(`${progress}Uploading ${file.name}...`);
    try {
      return { data: await apply(method, filename, upload) };
    } catch (err) {
      return { error: `${file.name}: ${err.message}` };
    }
  }

  async function addFiles(files) {
    if (busy) return;
    const images = Array.from(files || []).filter(f => (f.type || "").startsWith("image/") || isHeicFile(f));
    if (!images.length) return setStatus("Please choose image files.");
    setPlaying(false);
    setBusy(true);
    const errors = [];
    try {
      for (let i = 0; i < images.length; i++) {
        const { error, data } = await send("POST", null, images[i], `Uploading ${i + 1} of ${images.length}: `);
        if (error) errors.push(error);
        else setIndex(data.images.length - 1);
      }
    } finally {
      setBusy(false);
    }
    setStatus(errors.join("; "));
  }

  async function replaceFile(file) {
    if (!file || !url || busy) return;
    setPlaying(false);
    setBusy(true);
    let message = "";
    const oldName = filenameOf(url);
    const oldNames = names;
    try {
      const { error, data } = await send("PUT", oldName, file, "Replacing: ");
      message = error || "";
      if (data) {
        const newNames = data.images.map(filenameOf);
        const newName = newNames.find(n => !oldNames.includes(n));
        const current = prefsRef.current;
        if (newName && newName !== oldName && (current.cover === oldName || current.focus?.[oldName])) {
          const focus = { ...current.focus };
          if (focus[oldName]) { focus[newName] = focus[oldName]; delete focus[oldName]; }
          savePrefs(current.cover === oldName ? newName : current.cover, focus, newNames);
        } else if (current.cover || Object.keys(current.focus || {}).length) {
          savePrefs(current.cover, current.focus, newNames);
        }
      }
    } finally {
      setBusy(false);
    }
    setStatus(message);
  }

  async function remove() {
    if (!url || !window.confirm("Remove this photo?")) return;
    setPlaying(false);
    try {
      const data = await apply("DELETE", filenameOf(url));
      const current = prefsRef.current;
      if (current.cover || Object.keys(current.focus || {}).length) savePrefs(current.cover, current.focus, data.images.map(filenameOf));
      setStatus("");
    } catch (err) {
      setStatus(err.message);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className={`gallery ${dragging ? "dragging" : ""}`}
      aria-labelledby="gallery-title"
      aria-busy={busy}
      onClose={onClose}
      onCancel={e => { if (focusMode) { e.preventDefault(); setFocusDraft(null); } }}
      onClick={e => { if (e.target === dialogRef.current) dialogRef.current.close(); }}
      onKeyDown={e => {
        if (focusMode) return;
        if (e.key === "ArrowLeft") step(-1);
        else if (e.key === "ArrowRight") step(1);
      }}
      onDragOver={e => { e.preventDefault(); setDragging(true); }}
      onDragLeave={e => { if (e.target === dialogRef.current) setDragging(false); }}
      onDrop={e => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }}
    >
      <div className="dialog-body">
        <div className="card-head" style={{ margin: 0 }}>
          <h2 id="gallery-title">{name}</h2>
          <button type="button" className="btn sm" onClick={() => dialogRef.current.close()}>Close</button>
        </div>

        {focusMode ? (
          <div className="focus-editor">
            <div
              ref={editorRef}
              className="focus-area"
              tabIndex={0}
              role="group"
              aria-label="Focus point editor. Click or drag on the photo, or use arrow keys to move the marker. Enter saves, Escape cancels."
              onKeyDown={onEditorKey}
              onPointerDown={e => { e.currentTarget.setPointerCapture?.(e.pointerId); placeFromPointer(e); }}
              onPointerMove={e => { if (e.buttons) placeFromPointer(e); }}
            >
              <img src={url} alt="" draggable={false} />
              <span className="focus-marker" style={{ left: `${focusDraft.x * 100}%`, top: `${focusDraft.y * 100}%` }} aria-hidden="true" />
            </div>
            <div className="focus-preview">
              <span className="small muted">Garage card preview (16:9)</span>
              <div className="bike-thumb"><img src={url} alt="" style={{ objectPosition: focusPosition(focusDraft) }} /></div>
              <span className="small muted" aria-live="polite">{Math.round(focusDraft.x * 100)}% / {Math.round(focusDraft.y * 100)}%</span>
            </div>
          </div>
        ) : (
        <div className="gallery-stage">
          {count > 0 ? (
            <span className="gallery-img-wrap">
              <img
                src={url}
                alt={`${name} photo ${safeIndex + 1} of ${count}`}
                className={loading ? "loading" : ""}
                onLoad={() => setLoading(false)}
                onError={() => { setLoading(false); setStatus("Could not load this photo."); }}
                onClick={() => step(1)}
              />
              {savedFocus && <span className="focus-marker subtle" style={{ left: `${savedFocus.x * 100}%`, top: `${savedFocus.y * 100}%` }} aria-hidden="true" />}
            </span>
          ) : (
            <p style={{ color: "#fff", padding: 24 }}>No photos yet. Add some below, or drop image files here.</p>
          )}
          {count > 1 && (
            <>
              <button type="button" className="gallery-nav prev" aria-label="Previous photo" onClick={() => step(-1)}>‹</button>
              <button type="button" className="gallery-nav next" aria-label="Next photo" onClick={() => step(1)}>›</button>
              <span className="gallery-counter">{safeIndex + 1} / {count}</span>
            </>
          )}
          {isCover && <span className="cover-badge">★ Cover</span>}
        </div>
        )}

        {focusMode ? (
          <div className="toolbar">
            <button type="button" className="btn primary" onClick={saveFocus}>Save focus</button>
            <button type="button" className="btn" onClick={() => setFocusDraft({ x: 0.5, y: 0.5 })}>Reset to centre</button>
            <button type="button" className="btn" onClick={() => setFocusDraft(null)}>Cancel</button>
          </div>
        ) : (
        <div className="toolbar">
          <button type="button" className="btn primary" disabled={busy} onClick={() => addRef.current.click()}>Add photos</button>
          {count > 0 && <button type="button" className="btn" disabled={busy} onClick={() => replaceRef.current.click()}>Replace</button>}
          {count > 0 && <button type="button" className="btn danger" disabled={busy} onClick={remove}>Remove</button>}
          {count > 1 && !isCover && <button type="button" className="btn" disabled={busy} onClick={setAsCover}>Set as cover</button>}
          {count > 0 && <button type="button" className="btn" disabled={busy} onClick={startFocus}>Set focus</button>}
          {count > 1 && (
            <button type="button" className="btn" aria-pressed={playing} onClick={() => setPlaying(p => !p)}>
              {playing ? "Pause" : "Slideshow"}
            </button>
          )}
        </div>
        )}
        <p className="small muted" role="status" aria-live="polite" style={{ minHeight: "1.3em" }}>{status}</p>
        <input ref={addRef} type="file" accept="image/*,.heic,.heif" multiple hidden
          onChange={e => { addFiles(e.target.files); e.target.value = ""; }} />
        <input ref={replaceRef} type="file" accept="image/*,.heic,.heif" hidden
          onChange={e => { replaceFile(e.target.files[0]); e.target.value = ""; }} />
      </div>
    </dialog>
  );
}
