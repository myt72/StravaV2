import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { fetchActivityVideos, isPortableTouchDevice, listenForCoverSwipes, requestVideoFullscreen } from "../lib/activityVideos.js";
import { Card } from "./ui.jsx";

function VideoCard({ video, onSwipe }) {
  const [flipped, setFlipped] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);
  const [fullscreenFailed, setFullscreenFailed] = useState(false);
  const coverRef = useRef(null);
  const videoRef = useRef(null);
  const wasFlipped = useRef(false);

  function showCover() {
    const player = videoRef.current;
    player.pause();
    if (player.readyState > 0) player.currentTime = 0;
    setFlipped(false);
    setVideoFailed(false);
    setFullscreenFailed(false);
  }

  function showVideo() {
    // Fullscreen must be requested synchronously from the user's tap.
    flushSync(() => setFlipped(true));
    const player = videoRef.current;
    player.play().catch(() => setVideoFailed(true));
    if (isPortableTouchDevice(navigator)) {
      requestVideoFullscreen(player, document, navigator.userAgent).catch(() => setFullscreenFailed(true));
    }
  }

  useEffect(() => {
    if (flipped) videoRef.current?.focus();
    else if (wasFlipped.current) coverRef.current?.focus();
    wasFlipped.current = flipped;
  }, [flipped]);

  useEffect(() => {
    if (onSwipe) return listenForCoverSwipes(coverRef.current, onSwipe);
  }, [onSwipe]);

  return (
    <div className="activity-video-scene">
      <div className={`activity-video-card${flipped ? " flipped" : ""}`}>
        <div className="activity-video-face activity-video-front" aria-hidden={flipped}>
          <button ref={coverRef} type="button" className="activity-video-cover" tabIndex={flipped ? -1 : 0}
            aria-label={`Play ${video.title}`} onClick={showVideo}>
            {!imageFailed
              ? <img src={video.imageUrl} alt="" onError={() => setImageFailed(true)} />
              : <span className="activity-video-missing">Cover image not found</span>}
            <span className="activity-video-play" aria-hidden="true">▶</span>
          </button>
        </div>
        <div className="activity-video-face activity-video-back" aria-hidden={!flipped}>
          <video ref={videoRef} src={video.url} controls={flipped} preload="metadata" playsInline tabIndex={-1}
            onError={() => setVideoFailed(true)}>
            Your browser does not support video playback.
          </video>
          {flipped && (
            <>
              {videoFailed && <p role="alert">Could not play this video. Check that the MP4 exists in public/videos and is supported by your browser.</p>}
              {fullscreenFailed && <p role="status">Fullscreen unavailable. Use the player controls to enlarge the video.</p>}
              <button type="button" className="btn sm" onClick={showCover}>
                Back to cover
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ActivityVideos() {
  const [items, setItems] = useState([]);
  const [error, setError] = useState("");
  const [index, setIndex] = useState(0);

  useEffect(() => {
    let live = true;
    fetchActivityVideos().then(list => {
      if (live) setItems(list);
    }).catch(err => {
      if (live) setError(err.message);
    });
    return () => { live = false; };
  }, []);

  if (!items.length && !error) return null;
  const video = items[index];
  return (
    <Card title="Activity videos">
      {error && <p role="alert">{error}</p>}
      {video && (
        <div className="activity-video-carousel" role="region" aria-roledescription="carousel" aria-label="Activity videos">
          <div className="activity-video-heading">
            <h3>{video.title}</h3>
            <span className="muted small" aria-live="polite">{index + 1} of {items.length}</span>
          </div>
          <VideoCard key={index} video={video}
            onSwipe={items.length > 1 ? direction => setIndex(current => (current + direction + items.length) % items.length) : null} />
          {items.length > 1 && (
            <div className="activity-video-navigation">
              <button type="button" className="btn sm" aria-label="Previous video"
                onClick={() => setIndex((index + items.length - 1) % items.length)}>Previous</button>
              <button type="button" className="btn sm" aria-label="Next video"
                onClick={() => setIndex((index + 1) % items.length)}>Next</button>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
