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
const CHAVE_ULTIMO = "ecos:ultimo_servidor_base_url";

/** Último endereço que respondeu como um Ecos: sugerido de novo se a pessoa voltar à tela de conexão. */
export function obterUltimoServidor(): string | null {
  try { return localStorage.getItem(CHAVE_ULTIMO); } catch { return null; }
}

export function lembrarUltimoServidor(url: string): void {
  try { localStorage.setItem(CHAVE_ULTIMO, normalizarUrl(url)); } catch { /* sem armazenamento */ }
}

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
  if (!token) { tokenMidia = null; return; }
  if (estaNoTauri()) void renovarTokenMidia();
}

// --- Leitura de mídia no app nativo -------------------------------------------------------------
// `<img src>` e `<a href>` não mandam `Authorization`, e o cookie de sessão (SameSite=Strict) não acompanha pedidos do
// WebView do Tauri para o servidor. Por isso as URLs de arquivo levam `?mt=<token curto>` (vale só para GET de arquivo,
// ~10 min). No navegador o cookie de mesma origem basta e nada muda.
let tokenMidia: string | null = null;
let renovando: Promise<void> | null = null;
let temporizador: ReturnType<typeof setTimeout> | null = null;
const RENOVAR_ANTES_MS = 2 * 60 * 1000;

export function renovarTokenMidia(): Promise<void> {
  if (renovando) return renovando;
  const access = accessTokenEmMemoria;
  if (!access || !estaNoTauri()) return Promise.resolve();
  renovando = (async () => {
    try {
      const resp = await fetch(`${apiBase()}/media/token`, { headers: { Authorization: `Bearer ${access}` } });
      if (!resp.ok) return;
      const dados = (await resp.json()) as { token?: string; expira_em_s?: number };
      if (!dados.token) return;
      tokenMidia = dados.token;
      if (temporizador) clearTimeout(temporizador);
      temporizador = setTimeout(() => { void renovarTokenMidia(); }, Math.max(30_000, (dados.expira_em_s ?? 600) * 1000 - RENOVAR_ANTES_MS));
    } catch { /* sem rede: o próximo erro de imagem tenta de novo */ }
  })().finally(() => { renovando = null; });
  return renovando;
}

const ROTA_DE_ARQUIVO = /\/api\/v1\/(?:media\/arquivo\/|arquivos\/conteudo|(?:notas|tarefas)\/[^/?#]+\/anexos\/)/;

/** Acrescenta (ou troca) o token de leitura numa URL de arquivo; fora do app nativo devolve a URL como está. */
export function comTokenMidia(url: string): string {
  if (!tokenMidia || !estaNoTauri() || !ROTA_DE_ARQUIVO.test(url)) return url;
  const [base, ancora = ""] = url.split("#");
  const limpa = base.replace(/([?&])mt=[^&]*&?/, "$1").replace(/[?&]$/, "");
  return `${limpa}${limpa.includes("?") ? "&" : "?"}mt=${tokenMidia}${ancora ? `#${ancora}` : ""}`;
}

// Imagem que carregou antes do token existir, ou com ele vencido (rolagem preguiçosa): tenta uma vez com o token atual.
// Links de arquivo ganham o token novo no momento do clique.
if (typeof document !== "undefined") {
  document.addEventListener("error", (e) => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement) || !ROTA_DE_ARQUIVO.test(img.src) || img.dataset.mtTentou === "1") return;
    img.dataset.mtTentou = "1";
    void renovarTokenMidia().then(() => { const novo = comTokenMidia(img.src); if (novo !== img.src) img.src = novo; });
  }, true);
  const atualizarLink = (e: Event) => {
    const a = e.target instanceof Element ? e.target.closest("a") : null;
    if (a && ROTA_DE_ARQUIVO.test(a.href)) { const novo = comTokenMidia(a.href); if (novo !== a.href) a.href = novo; }
  };
  document.addEventListener("pointerdown", atualizarLink, true);
  document.addEventListener("click", atualizarLink, true);
}
