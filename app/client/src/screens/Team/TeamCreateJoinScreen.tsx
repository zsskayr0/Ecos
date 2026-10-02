import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ChevronLeft, AlertTriangle, ScanLine } from "lucide-react";
import { equipes, ApiError } from "@/lib/api";
import { useRefreshBus } from "@/lib/refresh-bus";
import { useAuth } from "@/lib/auth-context";
import { TIPOS_DE_EQUIPE, type TipoEquipe } from "@/lib/tipo-equipe";

/**
 * GAP-05 (resolved): "Criar ou entrar numa Equipe" — the spec (section
 * 3.9) only defined the drawer entry point, without the flow. Now real:
 * `POST /equipes` and `POST /convites/:codigo/aceitar`.
 */
export function TeamCreateJoinScreen() {
  const navigate = useNavigate();
  const dentro = useLocation().pathname.startsWith("/configuracoes");
  const baseEquipe = dentro ? "/configuracoes/equipes" : "/equipe";
  const { notificar } = useRefreshBus();
  const { recarregarPerfil } = useAuth();
  const [modo, setModo] = useState<"criar" | "entrar">("criar");
  const [nome, setNome] = useState("");
  const [tipo, setTipo] = useState<TipoEquipe>("pessoal");
  const [codigo, setCodigo] = useState("");
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function criar() {
    setCarregando(true);
    setErro(null);
    try {
      const r = await equipes.criar(nome.trim(), tipo);
      notificar();
      // `perfil.equipes` (auth context) comes from `/me`, fetched only
      // once at login — without this, the new Team wouldn't show up in
      // the Profile until reloading the whole page.
      await recarregarPerfil();
      navigate(`${baseEquipe}/${r.id}`);
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível criar a Equipe.");
    } finally {
      setCarregando(false);
    }
  }

  async function entrar() {
    setCarregando(true);
    setErro(null);
    try {
      await equipes.aceitarConvite(codigo.trim().toUpperCase());
      notificar();
      await recarregarPerfil();
      navigate(dentro ? "/configuracoes/equipes" : "/perfil");
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Código inválido ou expirado.");
    } finally {
      setCarregando(false);
    }
  }

  return (
    <div className="px-4 pt-1">
      <button onClick={() => navigate(-1)} className="mb-6 flex items-center gap-1 text-sm text-text-muted">
        <ChevronLeft size={18} />
        Cancelar
      </button>

      <h1 className="mb-6 font-display text-2xl text-text-primary">Criar ou entrar numa Equipe</h1>

      <div className="mb-6 flex rounded-pill bg-surface-2 p-1">
        <button onClick={() => setModo("criar")} className={`flex-1 rounded-pill py-2 text-sm font-medium ${modo === "criar" ? "bg-surface-3 text-text-primary" : "text-text-muted"}`}>
          Criar
        </button>
        <button onClick={() => setModo("entrar")} className={`flex-1 rounded-pill py-2 text-sm font-medium ${modo === "entrar" ? "bg-surface-3 text-text-primary" : "text-text-muted"}`}>
          Entrar com código
        </button>
      </div>

      {modo === "criar" ? (
        <div className="flex flex-col gap-5">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">Nome da Equipe</span>
            <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex: Família" className="ecos-input" autoFocus />
          </label>
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-text-muted">Tipo</legend>
            {TIPOS_DE_EQUIPE.map((t) => (
              <label key={t.valor} className={`flex cursor-pointer flex-col rounded-2xl border px-4 py-3 ${tipo === t.valor ? "border-steel-700 bg-surface-2" : "border-border bg-surface-1"}`}>
                <span className="flex items-center gap-2 text-sm font-medium text-text-primary">
                  <input type="radio" name="tipo-equipe" checked={tipo === t.valor} onChange={() => setTipo(t.valor)} />
                  {t.rotulo}
                </span>
                <span className="mt-0.5 pl-6 text-xs text-text-muted">{t.descricao}</span>
              </label>
            ))}
          </fieldset>
        </div>
      ) : (
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">Código de convite</span>
          <input
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
            placeholder="Ex: A1B2C3D4"
            className="ecos-input font-mono-value uppercase"
            autoFocus
          />
        </label>
      )}
      {modo === "entrar" && (
        <button type="button" onClick={() => navigate(`${baseEquipe}/escanear`)} className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl bg-surface-2 py-3 text-sm font-semibold text-text-primary">
          <ScanLine size={16} strokeWidth={1.75} />
          Escanear QR code
        </button>
      )}

      {erro && (
        <div className="mt-4 flex items-start gap-2 rounded-2xl border border-error/40 bg-error/10 p-3 text-sm text-error">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" strokeWidth={1.75} />
          {erro}
        </div>
      )}

      <button
        onClick={modo === "criar" ? criar : entrar}
        disabled={carregando || (modo === "criar" ? !nome.trim() : !codigo.trim())}
        className="mt-6 w-full rounded-2xl bg-steel-700 py-3.5 text-center font-body text-[15px] font-semibold text-white disabled:opacity-40"
      >
        {carregando ? "Um momento..." : modo === "criar" ? "Criar Equipe" : "Entrar na Equipe"}
      </button>
    </div>
  );
}
