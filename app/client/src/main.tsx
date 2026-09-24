import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/common/ErrorBoundary";
import { aplicarTemaInicial } from "./lib/theme";
import { aplicarPreferenciasAplicativo } from "./lib/preferencias-aplicativo";
import "./styles/global.css";

aplicarTemaInicial();
aplicarPreferenciasAplicativo();

// No navegador, mantém o shell e os arquivos já usados disponíveis quando a rede some.
// O Tauri já empacota esses arquivos no aplicativo e não precisa de Service Worker.
if (import.meta.env.PROD && "serviceWorker" in navigator && (location.protocol === "http:" || location.protocol === "https:")) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  });
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
