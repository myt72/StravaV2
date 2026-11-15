import { useEffect, useRef, useState } from "react";
import { fetchActivityVideos } from "../lib/activityVideos.js";
import { Card } from "./ui.jsx";

function VideoDialog({ video, onClose }) {
  const dialog = useRef(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    dialog.current.showModal();
  }, []);

  return (
    <dialog ref={dialog} className="activity-video-dialog" aria-labelledby="activity-video-title"
      onClose={onClose} onClick={e => { if (e.target === dialog.current) dialog.current.close(); }}>
      <div className="dialog-body">
        <div className="card-head">
          <h2 id="activity-video-title">{video.title}</h2>
          <button type="button" className="btn sm" onClick={() => dialog.current.close()}>Close</button>
        </div>
        <video src={video.url} controls autoPlay playsInline onError={() => setFailed(true)}>
          Your browser does not support video playback.
        </video>
        {failed && <p role="alert">Could not play this video. Check that the MP4 exists in public/videos and is supported by your browser.</p>}
      </div>
    </dialog>
  );
}

export default function ActivityVideos() {
  const [items, setItems] = useState([]);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null);

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
  return (
    <Card title="Activity videos">
      {error && <p role="alert">{error}</p>}
      {items.length > 0 && (
        <ul className="activity-video-list">
          {items.map((video, index) => (
            <li key={`${video.url}-${index}`}>
              <button type="button" className="cell-link" aria-haspopup="dialog"
                onClick={() => setSelected(video)}>{video.title}</button>
            </li>
          ))}
        </ul>
      )}
      {selected && <VideoDialog video={selected} onClose={() => setSelected(null)} />}
    </Card>
  );
}
