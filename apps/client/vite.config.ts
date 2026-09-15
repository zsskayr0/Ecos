import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Ecos client — see ecos-arquitetura-tecnica.md section 10 (Tauri/React client).
// Fixed port and HMR tuned to Tauri's requirements (the Rust shell
// process points at this port in dev, see src-tauri/tauri.conf.json).
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
    // Dev-only: `ecos-app` deliberately doesn't configure CORS (serves
    // API+front from the same origin in production, see
    // security_headers.rs). In dev, the front end runs on Vite (its own
    // port) — the proxy makes the browser see everything as same-origin,
    // session cookie included (section 5.1).
    // Explicit IPv4, not "localhost": on machines running Docker
    // Desktop/WSL2, "localhost" can resolve to `::1` first and land on a
    // completely different service listening there by coincidence
    // (happened in this very development session — see the note in the
    // README).
    proxy: {
      "/api": { target: "http://127.0.0.1:7023", changeOrigin: true },
      "/health": { target: "http://127.0.0.1:7023", changeOrigin: true },
    },
  },
  envPrefix: ["VITE_", "TAURI_"],
});
