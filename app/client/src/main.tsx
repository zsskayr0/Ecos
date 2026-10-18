import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/common/ErrorBoundary";
import { acompanharTemaDoSistema, aplicarTemaInicial } from "./lib/theme";
import { aplicarPreferenciasAplicativo } from "./lib/preferencias-aplicativo";
import "./styles/global.css";

aplicarTemaInicial();
acompanharTemaDoSistema();
aplicarPreferenciasAplicativo();

// No navegador, mantém o shell e os arquivos já usados disponíveis quando a rede some.
// O Tauri já empacota esses arquivos no aplicativo e não precisa de Service Worker.
if (import.meta.env.PROD && "serviceWorker" in navigator && (location.protocol === "http:" || location.protocol === "https:")) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  });
}

// Fora do build de produção (por exemplo `vite` em localhost:1420) não pode haver Service Worker: um registrado numa
// visita anterior (build de produção na mesma origem) continuava servindo módulos velhos e deixava telas em
// carregamento para sempre. Desregistra e apaga o cache dele; se ele controlava a página, recarrega uma vez.
if (!import.meta.env.PROD && "serviceWorker" in navigator && (location.protocol === "http:" || location.protocol === "https:")) {
  void navigator.serviceWorker.getRegistrations().then(async (registros) => {
    if (registros.length === 0) return;
    const controlada = navigator.serviceWorker.controller !== null;
    await Promise.all(registros.map((r) => r.unregister()));
    if ("caches" in window) {
      const chaves = await caches.keys();
      await Promise.all(chaves.filter((c) => c.startsWith("ecos-shell-")).map((c) => caches.delete(c)));
    }
    if (controlada) location.reload();
  }).catch(() => undefined);
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
