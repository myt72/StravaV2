import { useCallback, useEffect, useState } from "react";

const PREFIX = "stravaV2:";

export function readStored(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function writeStored(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* storage unavailable (private mode / quota); ignore */
  }
}

/** useState persisted to localStorage. */
export function usePersistentState(key, initial) {
  const [value, setValue] = useState(() => readStored(key, initial));
  useEffect(() => writeStored(key, value), [key, value]);
  return [value, setValue];
}

export function readSession(key, fallback) {
  try {
    const raw = sessionStorage.getItem(PREFIX + key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function writeSession(key, value) {
  try {
    sessionStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* storage unavailable (private mode / quota); ignore */
  }
}

/** useState persisted for the current browser tab's session. */
export function useSessionState(key, initial) {
  const [value, setValue] = useState(() => readSession(key, initial));
  useEffect(() => writeSession(key, value), [key, value]);
  return [value, setValue];
}

export function useToggleSet(key) {
  const [list, setList] = usePersistentState(key, []);
  const has = useCallback(id => list.includes(id), [list]);
  const toggle = useCallback(
    id => setList(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])),
    [setList]
  );
  return [list, has, toggle, setList];
}
