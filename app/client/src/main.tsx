import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/common/ErrorBoundary";
import { aplicarTemaInicial } from "./lib/theme";
import { aplicarPreferenciasAplicativo } from "./lib/preferencias-aplicativo";
import "./styles/global.css";

aplicarTemaInicial();
aplicarPreferenciasAplicativo();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
