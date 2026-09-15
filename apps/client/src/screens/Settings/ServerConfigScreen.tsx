import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, AlertTriangle, CheckCircle2 } from "lucide-react";
import { obterServidorBaseUrl, definirServidorBaseUrl, estaNoTauri } from "@/lib/server-config";
import { ApiError, auth } from "@/lib/api";

/**
 * Where the compiled app finds `ecos-app` — user feedback: "deixa
 * configurável no próprio app" (instead of baking one address in at build
 * time). Only the Tauri shell truly needs this; the browser build always
 * has a working relative default (`/api/v1`), so this screen doubles as
 * the first-run gate for Tauri (see `App.tsx`) and a normal Settings item
 * everywhere else.
 */
export function ServerConfigScreen({ primeiraVez }: { primeiraVez?: boolean } = {}) {
  const navigate = useNavigate();
  const [url, setUrl] = useState(obterServidorBaseUrl() ?? "");
  const [testando, setTestando] = useState(false);
  const [resultado, setResultado] = useState<"ok" | "erro" | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function testarEEntrar() {
    setTestando(true);
    setErro(null);
    setResultado(null);
    const limpa = url.trim().replace(/\/+$/, "");
    definirServidorBaseUrl(limpa || null);
    try {
      // `/me` exige sessão — um 401 já prova que o servidor respondeu
      // (é isso que importa aqui), só um erro de rede/CORS é falha real.
      await auth.perfil().catch((e) => {
        if (e instanceof ApiError) return;
        throw e;
      });
      setResultado("ok");
      if (primeiraVez) {
        // Recarrega pra o AuthGate reavaliar do zero com a base nova —
        // mais simples e confiável que replicar aqui a lógica de
        // `AuthProvider.recarregarPerfil()`.
        window.location.reload();
      }
    } catch {
      setResultado("erro");
      setErro("Não consegui falar com esse endereço. Confira se o ecos-app está rodando e acessível dessa rede.");
    } finally {
      setTestando(false);
    }
  }

  return (
    <div className="px-4 pt-[calc(env(safe-area-inset-top)+12px)] pb-nav-safe">
      <div className="mb-5 flex items-center gap-2">
        {!primeiraVez && (
          <button onClick={() => navigate(-1)} className="text-text-muted">
            <ChevronLeft size={22} />
          </button>
        )}
        <h1 className="font-display text-xl text-text-primary">Servidor</h1>
      </div>

      <p className="mb-6 text-sm leading-snug text-text-muted">
        {estaNoTauri()
          ? "O Ecos roda local-first: esse app fala direto com o ecos-app rodando no seu computador (ou onde você hospedar). Aponte pro endereço certo — geralmente o IP do PC na sua rede, na porta 7023."
          : "Deixe em branco pra usar o servidor padrão desta página. Só mexa aqui se você sabe que precisa apontar pra outro ecos-app."}
      </p>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">Endereço</span>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="http://192.168.0.5:7023"
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          className="ecos-input font-mono-value"
        />
      </label>

      {resultado === "ok" && (
        <div className="mt-4 flex items-start gap-2 rounded-2xl border border-success/40 bg-success/10 p-3 text-sm text-success">
          <CheckCircle2 size={16} className="mt-0.5 shrink-0" strokeWidth={1.75} />
          Conectado. {primeiraVez ? "Abrindo o Ecos..." : "Endereço salvo."}
        </div>
      )}
      {resultado === "erro" && erro && (
        <div className="mt-4 flex items-start gap-2 rounded-2xl border border-error/40 bg-error/10 p-3 text-sm text-error">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" strokeWidth={1.75} />
          {erro}
        </div>
      )}

      <button
        onClick={testarEEntrar}
        disabled={testando || (!url.trim() && estaNoTauri())}
        className="mt-6 w-full rounded-2xl bg-steel-700 py-3.5 text-center font-body text-[15px] font-semibold text-white disabled:opacity-40"
      >
        {testando ? "Testando..." : primeiraVez ? "Conectar" : "Salvar"}
      </button>

      {!primeiraVez && url && (
        <button
          onClick={() => {
            definirServidorBaseUrl(null);
            setUrl("");
            setResultado(null);
          }}
          className="mt-3 w-full rounded-2xl bg-surface-2 py-3 text-center text-sm font-medium text-text-secondary"
        >
          Voltar pro padrão
        </button>
      )}
    </div>
  );
}
