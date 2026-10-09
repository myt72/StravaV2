import { useCallback, useEffect, useState } from "react";

/** Minimal hash router: "#/garage/b123?x=1" -> { segments: ["garage","b123"], params }. */
function parseHash() {
  const raw = window.location.hash.replace(/^#/, "") || "/overview";
  const [path, query = ""] = raw.split("?");
  const segments = path.split("/").filter(Boolean).map(decodeURIComponent);
  return { segments, params: Object.fromEntries(new URLSearchParams(query)) };
}

export function buildHref(path, params) {
  const clean = Object.entries(params || {}).filter(([, v]) => v !== undefined && v !== null && v !== "");
  const query = clean.length ? `?${new URLSearchParams(clean).toString()}` : "";
  return `#${path}${query}`;
}

export function navigate(path, params) {
  window.location.hash = buildHref(path, params).slice(1);
}

export function useRoute() {
  const [route, setRoute] = useState(parseHash);
  useEffect(() => {
    const onChange = () => setRoute(parseHash());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  const replaceParams = useCallback(params => {
    const { segments } = parseHash();
    const href = buildHref("/" + segments.map(encodeURIComponent).join("/"), params);
    window.history.replaceState(null, "", href);
    setRoute(parseHash());
  }, []);
  return { ...route, replaceParams };
}
