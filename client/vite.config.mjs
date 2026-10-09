import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const API_TARGET = "http://localhost:5001";

export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === "build" ? "/dashboard/" : "/",
  build: { outDir: "dist", emptyOutDir: true },
  server: {
    port: 5173,
    proxy: {
      "/api": API_TARGET,
      "/auth": API_TARGET,
      "/exchange_token": API_TARGET,
      "/dashboard": API_TARGET
    }
  }
}));
