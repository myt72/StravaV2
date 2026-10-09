import { useEffect, useState } from "react";
import { readStored, writeStored } from "./storage.js";
import * as matrixRain from "./matrixRain.js";

/**
 * Theme registry. Adding a theme = one entry here + one [data-theme="id"] block in theme.css.
 * supportsMode: theme honors the Light/Dark toggle. decor: { start, stop } for background effects.
 */
export const THEMES = [
  { id: "default", label: "Default", supportsMode: true },
  { id: "matrix", label: "90s Cyber-Thriller (Matrix / Hackers)", supportsMode: false, decor: matrixRain }
];

const themeById = id => THEMES.find(t => t.id === id) || THEMES[0];

function initialColorMode() {
  const saved = readStored("colorMode", null);
  if (saved === "light" || saved === "dark") return saved;
  const legacy = readStored("theme", null);
  if (legacy === "light" || legacy === "dark") return legacy;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function initialThemeId() {
  const saved = readStored("themeId", null);
  if (THEMES.some(t => t.id === saved)) return saved;
  return readStored("theme", null) === "matrix" ? "matrix" : "default";
}

export function useTheme() {
  const [themeId, setThemeId] = useState(initialThemeId);
  const [colorMode, setColorMode] = useState(initialColorMode);
  const theme = themeById(themeId);

  useEffect(() => { writeStored("themeId", themeId); }, [themeId]);
  useEffect(() => { writeStored("colorMode", colorMode); }, [colorMode]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme.supportsMode ? colorMode : theme.id;
  }, [theme, colorMode]);
  useEffect(() => {
    if (!theme.decor) return undefined;
    theme.decor.start();
    return () => theme.decor.stop();
  }, [theme]);

  const toggleColorMode = () => setColorMode(m => (m === "dark" ? "light" : "dark"));
  return { themeId, setThemeId, colorMode, toggleColorMode, theme };
}
