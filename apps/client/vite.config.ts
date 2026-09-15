import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Ecos client — ver ecos-arquitetura-tecnica.md seção 10 (cliente Tauri/React).
// Porta fixa e HMR ajustados às exigências do Tauri (o processo Rust do
// shell aponta pra essa porta em dev, ver src-tauri/tauri.conf.json).
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
    // Dev-only: `ecos-app` não configura CORS de propósito (serve API+front
    // do mesmo domínio em produção, ver security_headers.rs). Em dev, o
    // front roda no Vite (porta própria) — o proxy faz o browser enxergar
    // tudo como same-origin, cookie de sessão incluso (seção 5.1).
    // IPv4 explícito, não "localhost": em máquinas com Docker Desktop/WSL2
    // rodando, "localhost" pode resolver primeiro pro `::1` e cair num
    // serviço completamente diferente escutando ali por acaso (aconteceu
    // nesta própria sessão de desenvolvimento — ver nota no README).
    proxy: {
      "/api": { target: "http://127.0.0.1:7023", changeOrigin: true },
      "/health": { target: "http://127.0.0.1:7023", changeOrigin: true },
    },
  },
  envPrefix: ["VITE_", "TAURI_"],
});
