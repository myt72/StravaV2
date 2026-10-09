import { useCallback, useEffect, useRef, useState } from "react";
import { BIKE_MAX_BYTES, bikeImageRequest } from "../lib/api.js";

const SLIDESHOW_MS = 4000;
const HEIC_LIB_URL = `${import.meta.env.BASE_URL}vendor/heic2any.min.js`;
let heicLibPromise = null;

const isHeicFile = file => /^image\/(heic|heif)(-sequence)?$/i.test(file.type || "") || /\.(heic|heif)$/i.test(file.name || "");
const filenameOf = url => String(url).split("?")[0].split("/").pop();

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
  const dialogRef = useRef(null);
  const addRef = useRef(null);
  const replaceRef = useRef(null);
  const [index, setIndex] = useState(startIndex);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [dragging, setDragging] = useState(false);

  const count = urls.length;
  const safeIndex = Math.min(index, Math.max(0, count - 1));
  const url = urls[safeIndex];

  useEffect(() => {
    const d = dialogRef.current;
    if (d && !d.open) d.showModal();
  }, []);

  useEffect(() => { setLoading(true); }, [url]);

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
    try {
      message = (await send("PUT", filenameOf(url), file, "Replacing: ")).error || "";
    } finally {
      setBusy(false);
    }
    setStatus(message);
  }

  async function remove() {
    if (!url || !window.confirm("Remove this photo?")) return;
    setPlaying(false);
    try {
      await apply("DELETE", filenameOf(url));
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
      onClick={e => { if (e.target === dialogRef.current) dialogRef.current.close(); }}
      onKeyDown={e => {
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

        <div className="gallery-stage">
          {count > 0 ? (
            <img
              src={url}
              alt={`${name} photo ${safeIndex + 1} of ${count}`}
              className={loading ? "loading" : ""}
              onLoad={() => setLoading(false)}
              onError={() => { setLoading(false); setStatus("Could not load this photo."); }}
              onClick={() => step(1)}
            />
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
        </div>

        <div className="toolbar">
          <button type="button" className="btn primary" disabled={busy} onClick={() => addRef.current.click()}>Add photos</button>
          {count > 0 && <button type="button" className="btn" disabled={busy} onClick={() => replaceRef.current.click()}>Replace</button>}
          {count > 0 && <button type="button" className="btn danger" disabled={busy} onClick={remove}>Remove</button>}
          {count > 1 && (
            <button type="button" className="btn" aria-pressed={playing} onClick={() => setPlaying(p => !p)}>
              {playing ? "Pause" : "Slideshow"}
            </button>
          )}
        </div>
        <p className="small muted" role="status" aria-live="polite" style={{ minHeight: "1.3em" }}>{status}</p>
        <input ref={addRef} type="file" accept="image/*,.heic,.heif" multiple hidden
          onChange={e => { addFiles(e.target.files); e.target.value = ""; }} />
        <input ref={replaceRef} type="file" accept="image/*,.heic,.heif" hidden
          onChange={e => { replaceFile(e.target.files[0]); e.target.value = ""; }} />
      </div>
    </dialog>
  );
}
