import { useEffect, useState } from "react";
import { readStored, writeStored } from "./storage.js";

export const THEMES = ["light", "dark"];

function initialTheme() {
  const saved = readStored("theme", null);
  if (THEMES.includes(saved)) return saved;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function useTheme() {
  const [theme, setTheme] = useState(initialTheme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    writeStored("theme", theme);
  }, [theme]);
  const toggle = () => setTheme(t => (t === "dark" ? "light" : "dark"));
  return [theme, toggle];
}
