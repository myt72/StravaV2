"use strict";

/** Decode a Google-encoded polyline (precision 5 by default) into [[lat, lng], ...]. */
function decodePolyline(encoded, precision = 5) {
  if (typeof encoded !== "string" || !encoded) return [];
  const factor = Math.pow(10, precision);
  const points = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  const readValue = () => {
    let result = 0;
    let shift = 0;
    let byte;
    do {
      if (index >= encoded.length) return null;
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };

  while (index < encoded.length) {
    const dLat = readValue();
    const dLng = readValue();
    if (dLat === null || dLng === null) break;
    lat += dLat;
    lng += dLng;
    points.push([lat / factor, lng / factor]);
  }
  return points;
}

/** Encode [[lat, lng], ...] as a Google polyline (used by tests and tooling). */
function encodePolyline(points, precision = 5) {
  const factor = Math.pow(10, precision);
  let prevLat = 0;
  let prevLng = 0;
  let out = "";
  const write = value => {
    let v = value < 0 ? ~(value << 1) : value << 1;
    while (v >= 0x20) {
      out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
      v >>= 5;
    }
    out += String.fromCharCode(v + 63);
  };
  for (const [lat, lng] of points) {
    const la = Math.round(lat * factor);
    const ln = Math.round(lng * factor);
    write(la - prevLat);
    write(ln - prevLng);
    prevLat = la;
    prevLng = ln;
  }
  return out;
}

module.exports = { decodePolyline, encodePolyline };
