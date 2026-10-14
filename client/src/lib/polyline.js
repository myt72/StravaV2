/** Decode a Google-encoded polyline (precision 5) into [[lat, lng], ...]. */
export function decodePolyline(encoded) {
  if (typeof encoded !== "string" || !encoded) return [];
  const points = [];
  let index = 0, lat = 0, lng = 0;
  const read = () => {
    let result = 0, shift = 0, byte;
    do {
      if (index >= encoded.length) return null;
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (index < encoded.length) {
    const dLat = read();
    const dLng = read();
    if (dLat === null || dLng === null) break;
    lat += dLat;
    lng += dLng;
    points.push([lat / 1e5, lng / 1e5]);
  }
  return points;
}

/** SVG path data (viewBox 0 0 size size, y flipped, aspect preserved) for an encoded polyline. */
export function polylineToSvgPath(encoded, size = 48, pad = 3, maxPoints = 60) {
  const pts = decodePolyline(encoded);
  if (pts.length < 2) return "";
  const step = Math.max(1, Math.ceil(pts.length / maxPoints));
  const sampled = pts.filter((_, i) => i % step === 0 || i === pts.length - 1);
  const midLat = (Math.min(...sampled.map(p => p[0])) + Math.max(...sampled.map(p => p[0]))) / 2;
  const cos = Math.cos((midLat * Math.PI) / 180);
  const xy = sampled.map(([la, lo]) => [lo * cos, la]);
  const xs = xy.map(p => p[0]), ys = xy.map(p => p[1]);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  const span = Math.max(Math.max(...xs) - minX, Math.max(...ys) - minY) || 1;
  const scale = (size - pad * 2) / span;
  const offX = (size - (Math.max(...xs) - minX) * scale) / 2;
  const offY = (size - (Math.max(...ys) - minY) * scale) / 2;
  return xy.map(([x, y], i) => `${i ? "L" : "M"}${(offX + (x - minX) * scale).toFixed(1)} ${(size - (offY + (y - minY) * scale)).toFixed(1)}`).join("");
}
