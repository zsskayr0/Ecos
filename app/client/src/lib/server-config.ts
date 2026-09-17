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

/** Real bug found testing on a real device: a user typing just
 * `192.168.1.5:7023` (no `http://`) produced a value that `fetch()`
 * resolves as a *relative path* against the app's own origin instead of
 * an absolute URL — every request silently landed back on the Tauri
 * WebView's own `index.html` (SPA fallback, real `200`) instead of ever
 * reaching `ecos-app`, and nothing in `req()` treated that as an error
 * (see the fix there) — the failure was invisible until something tried
 * to use the "empty" data and crashed. Assuming `http://` when no scheme
 * is given closes the gap at the source. */
function normalizarUrl(bruta: string): string {
  const semBarraFinal = bruta.trim().replace(/\/+$/, "");
  return /^https?:\/\//i.test(semBarraFinal) ? semBarraFinal : `http://${semBarraFinal}`;
}

export function definirServidorBaseUrl(url: string | null): void {
  try {
    if (url && url.trim()) {
      localStorage.setItem(CHAVE, normalizarUrl(url));
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

/** Real bug: the Tauri WebView's own origin (`tauri://localhost` /
 * `http://tauri.localhost`) is never the same as wherever `ecos-app`
 * runs — a `SameSite=Strict` session cookie (section 5.1) is simply never
 * sent on that cross-origin request, CORS or not (`allow_credentials`
 * only decides whether the *response* is readable, not whether the
 * *cookie* goes out). The browser build never needs this: same-origin
 * cookies work exactly as designed there. */
// Nunca persista access tokens no WebView. O desktop mantém o refresh token
// no Credential Manager e repõe este valor efêmero após abrir o app.
let accessTokenEmMemoria: string | null = null;

export function obterAccessToken(): string | null {
  return accessTokenEmMemoria;
}

export function definirAccessToken(token: string | null): void {
  accessTokenEmMemoria = token;
}
