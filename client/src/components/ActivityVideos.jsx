import { useEffect, useRef, useState } from "react";
import { fetchActivityVideos } from "../lib/activityVideos.js";
import { Card } from "./ui.jsx";

function VideoCard({ video }) {
  const [flipped, setFlipped] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);
  const coverRef = useRef(null);
  const videoRef = useRef(null);
  const wasFlipped = useRef(false);

  function showCover() {
    setFlipped(false);
    setVideoFailed(false);
  }

  useEffect(() => {
    if (flipped) videoRef.current?.focus();
    else if (wasFlipped.current) coverRef.current?.focus();
    wasFlipped.current = flipped;
  }, [flipped]);

  return (
    <div className="activity-video-scene">
      <div className={`activity-video-card${flipped ? " flipped" : ""}`}>
        <div className="activity-video-face activity-video-front" aria-hidden={flipped}>
          <button ref={coverRef} type="button" className="activity-video-cover" tabIndex={flipped ? -1 : 0}
            aria-label={`Play ${video.title}`} onClick={() => setFlipped(true)}>
            {!imageFailed
              ? <img src={video.imageUrl} alt="" onError={() => setImageFailed(true)} />
              : <span className="activity-video-missing">Cover image not found</span>}
            <span className="activity-video-play" aria-hidden="true">▶</span>
          </button>
        </div>
        <div className="activity-video-face activity-video-back">
          {flipped && (
            <>
              <video ref={videoRef} src={video.url} controls autoPlay playsInline tabIndex={-1}
                onError={() => setVideoFailed(true)}>
                Your browser does not support video playback.
              </video>
              {videoFailed && <p role="alert">Could not play this video. Check that the MP4 exists in public/videos and is supported by your browser.</p>}
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
          <VideoCard key={index} video={video} />
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
