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
// Igual ao CACHE_SHELL de public/sw.js: sobe junto com ele sempre que o comportamento do Service Worker mudar.
const CACHE_SW_ATUAL = "ecos-shell-v3";
if (import.meta.env.PROD && "serviceWorker" in navigator && (location.protocol === "http:" || location.protocol === "https:")) {
  window.addEventListener("load", () => {
    void (async () => {
      // Um perfil pode ter um Service Worker de versão anterior ativo (cache com outro nome). Ele atende os pedidos com
      // código velho e nem sempre é substituído sozinho: remove-o e os caches dele e recarrega uma vez (a marca na
      // sessão impede laço). O IndexedDB (fila offline, cache de respostas) e os rascunhos não são tocados.
      const chaves = "caches" in window ? await caches.keys() : [];
      const velho = chaves.some((c) => c.startsWith("ecos-shell-") && c !== CACHE_SW_ATUAL);
      let jaLimpou = false;
      try { jaLimpou = sessionStorage.getItem("ecos:sw-limpo") === "1"; } catch { /* sem sessionStorage */ }
      if (velho && !jaLimpou) {
        try { sessionStorage.setItem("ecos:sw-limpo", "1"); } catch { /* idem */ }
        const registros = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registros.map((r) => r.unregister()));
        await Promise.all(chaves.filter((c) => c.startsWith("ecos-shell-")).map((c) => caches.delete(c)));
        location.reload();
        return;
      }
      await navigator.serviceWorker.register("/sw.js");
    })().catch(() => undefined);
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
