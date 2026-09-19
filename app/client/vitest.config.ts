import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Testes do client (npm test). Config à parte de `vite.config.ts` de propósito: o `tsc -b` deixa um `vite.config.js`
// compilado ao lado, que o Vite carregaria antes do `.ts`.
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    css: false,
    // Fuso fixo (UTC-3, sem horário de verão hoje): os testes de horário não podem depender da máquina de quem roda.
    env: { TZ: "America/Sao_Paulo" },
  },
});
