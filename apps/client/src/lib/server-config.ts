/**
 * Configurable backend address (user feedback: "deixa configurável no
 * próprio app") — the browser/dev build talks to `ecos-app` via a relative
 * `/api/v1` path (Vite's dev proxy, or same-origin in production serving),
 * but the compiled Tauri shell (desktop or Android) has no such thing:
 * "localhost" from inside the app's own WebView is the phone/PC itself,
 * never wherever `ecos-app` actually runs. So the native build needs a
 * real, user-entered origin instead — persisted locally, editable from
 * Configurações without recompiling.
 */

const CHAVE = "ecos:servidor_base_url";

export function obterServidorBaseUrl(): string | null {
  try {
    return localStorage.getItem(CHAVE);
  } catch {
    return null;
  }
}

export function definirServidorBaseUrl(url: string | null): void {
  try {
    if (url && url.trim()) {
      localStorage.setItem(CHAVE, url.trim().replace(/\/+$/, ""));
    } else {
      localStorage.removeItem(CHAVE);
    }
  } catch {
    // Private window / blocked storage — the setting just won't persist across restarts.
  }
}

/** Base used by every `fetch()` in `lib/api.ts`. */
export function apiBase(): string {
  const custom = obterServidorBaseUrl();
  return custom ? `${custom}/api/v1` : "/api/v1";
}

/** True inside the compiled Tauri shell (desktop or Android) — false in
 * the plain browser (dev server or a browser-hosted production build). */
export function estaNoTauri(): boolean {
  return typeof window !== "undefined" && ("isTauri" in window ? Boolean((window as { isTauri?: boolean }).isTauri) : "__TAURI_INTERNALS__" in window);
}

/** Only the Tauri shell truly needs this configured before anything else
 * works — the browser build always has a sensible relative default. */
export function precisaConfigurarServidor(): boolean {
  return estaNoTauri() && !obterServidorBaseUrl();
}
