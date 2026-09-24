import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, AlertTriangle, CheckCircle2 } from "lucide-react";
import { obterServidorBaseUrl, definirServidorBaseUrl, estaNoTauri } from "@/lib/server-config";
import { auth } from "@/lib/api";
import { SincronizacaoBackup } from "./SincronizacaoBackup";

/**
 * Where the compiled app finds `ecos-app` — user feedback: "deixa
 * configurável no próprio app" (instead of baking one address in at build
 * time). Only the Tauri shell truly needs this; the browser build always
 * has a working relative default (`/api/v1`). The first-run version of
 * this decision now has its own guided flow (`ConectarServidorScreen`,
 * reachable before login) — this screen is the plain "edit it later" form
 * for Configurações → Servidor.
 */
export function ServerConfigScreen() {
  const navigate = useNavigate();
  const enderecoInicial = obterServidorBaseUrl();
  const [url, setUrl] = useState(enderecoInicial ?? "");
  const [enderecoPersonalizado, setEnderecoPersonalizado] = useState(Boolean(enderecoInicial));
  const [testando, setTestando] = useState(false);
  const [resultado, setResultado] = useState<"ok" | "erro" | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function testarEEntrar() {
    setTestando(true);
    setErro(null);
    setResultado(null);
    const anterior = obterServidorBaseUrl();
    definirServidorBaseUrl(url.trim() || null);
    try {
      await auth.testarConexao();
      setResultado("ok");
      setEnderecoPersonalizado(Boolean(url.trim()));
    } catch {
      definirServidorBaseUrl(anterior);
      setResultado("erro");
      setErro("Não consegui falar com esse endereço. O servidor anterior foi mantido; corrija o endereço e tente novamente.");
      setEnderecoPersonalizado(Boolean(anterior));
    } finally {
      setTestando(false);
    }
  }

  return (
    <div className="px-4 pt-[calc(env(safe-area-inset-top)+12px)] pb-nav-safe">
      <div className="mb-5 flex items-center gap-2">
        <button data-voltar onClick={() => navigate(-1)} className="text-text-muted">
          <ChevronLeft size={22} />
        </button>
        <h1 className="font-display text-xl text-text-primary">Servidor</h1>
      </div>

      <p className="mb-6 text-sm leading-snug text-text-muted">
        {estaNoTauri()
          ? "O Ecos roda local-first: esse app fala direto com o ecos-app rodando no seu computador (ou onde você hospedar). Aponte pro endereço certo — geralmente o IP do PC na sua rede, na porta 7023."
          : "Deixe em branco pra usar o servidor padrão desta página. Só mexa aqui se você sabe que precisa apontar pra outro ecos-app."}
      </p>

      <div className="flex items-end gap-3">
      <label className="flex min-w-0 flex-1 flex-col gap-1.5">
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
        <button
          onClick={testarEEntrar}
          disabled={testando || (!url.trim() && estaNoTauri())}
          className="flex h-[42px] shrink-0 items-center justify-center rounded-2xl bg-surface-2 px-6 text-sm font-semibold text-text-primary hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-surface-2"
        >
          {testando ? "Testando..." : "Testar e salvar"}
        </button>
      </div>

      {resultado === "ok" && (
        <div role="status" className="mt-4 flex items-start gap-2 rounded-2xl border border-success/40 bg-success/10 p-3 text-sm text-success">
          <CheckCircle2 size={16} className="mt-0.5 shrink-0" strokeWidth={1.75} />
          Conectado. Endereço salvo.
        </div>
      )}
      {resultado === "erro" && erro && (
        <div role="alert" className="mt-4 flex items-start gap-2 rounded-2xl border border-error/40 bg-error/10 p-3 text-sm text-error">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" strokeWidth={1.75} />
          {erro}
        </div>
      )}


      {enderecoPersonalizado && (
        <button
          onClick={() => {
            definirServidorBaseUrl(null);
            setUrl("");
            setResultado(null);
            setEnderecoPersonalizado(false);
          }}
          className="mt-3 rounded-2xl bg-surface-2 px-6 py-3 text-sm font-semibold text-text-primary hover:bg-surface-3"
        >
          Voltar ao padrão
        </button>
      )}

      <SincronizacaoBackup />
    </div>
  );
}
