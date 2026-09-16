import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, AlertTriangle } from "lucide-react";
import { equipes, ApiError } from "@/lib/api";
import { useRefreshBus } from "@/lib/refresh-bus";
import { useAuth } from "@/lib/auth-context";

/**
 * GAP-05 (resolved): "Criar ou entrar numa Equipe" — the spec (section
 * 3.9) only defined the drawer entry point, without the flow. Now real:
 * `POST /equipes` and `POST /convites/:codigo/aceitar`.
 */
export function TeamCreateJoinScreen() {
  const navigate = useNavigate();
  const { notificar } = useRefreshBus();
  const { recarregarPerfil } = useAuth();
  const [modo, setModo] = useState<"criar" | "entrar">("criar");
  const [nome, setNome] = useState("");
  const [codigo, setCodigo] = useState("");
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function criar() {
    setCarregando(true);
    setErro(null);
    try {
      const r = await equipes.criar(nome.trim());
      notificar();
      // `perfil.equipes` (auth context) comes from `/me`, fetched only
      // once at login — without this, the new Team wouldn't show up in
      // the Profile until reloading the whole page.
      await recarregarPerfil();
      navigate(`/equipe/${r.id}`);
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
      navigate("/perfil");
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
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">Nome da Equipe</span>
          <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex: Família" className="ecos-input" autoFocus />
        </label>
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
