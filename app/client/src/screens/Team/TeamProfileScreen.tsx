import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ChevronLeft, Copy, Rss, UserPlus, AlertTriangle, Pencil, Camera, Loader2 } from "lucide-react";
import { Avatar } from "@/components/common/Avatar";
import { RoleBadge } from "@/components/common/RoleBadge";
import { equipes as equipesApi, ApiError } from "@/lib/api";
import { useAuth, nomeExibicao } from "@/lib/auth-context";
import { useAppUI } from "@/lib/ui-context";
import { corDaEquipe } from "@/lib/team-color";
import { useRefreshBus } from "@/lib/refresh-bus";
import type { Cargo } from "@/lib/types";
import { definirAvatarEquipeLocal, useAvatarEquipe } from "@/lib/team-avatar";
import { prepararFotoPerfil, useFotoPerfil } from "@/lib/profile-avatar";

interface Membro {
  usuario_id: string;
  cargo: string;
  entrou_em: string;
}

/**
 * Team Profile (section 3.7) — real `GET /equipes/:id`. GAP-12: the
 * backend doesn't expose a user directory (`membro_equipe` only stores
 * `usuario_id`/`cargo`, see `routes/equipes.rs::listar_membros`) — with
 * no name/handle for anyone but yourself, other members show up by id
 * (short, mono), never a made-up name.
 */
export function TeamProfileScreen() {
  const { equipeId } = useParams();
  const navigate = useNavigate();
  const { perfil, recarregarPerfil } = useAuth();
  const { setFiltroEquipeId, setEspacoAtivo } = useAppUI();
  const { versao, notificar } = useRefreshBus();
  const [convidarAberto, setConvidarAberto] = useState(false);
  const [codigoConvite, setCodigoConvite] = useState<string | null>(null);
  const [equipe, setEquipe] = useState<{ id: string; nome: string; estatisticas: { notas: number; tarefas: number } } | null>(null);
  const [membros, setMembros] = useState<Membro[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [editando, setEditando] = useState(false);
  const [enviandoFoto, setEnviandoFoto] = useState(false);
  const [novoNome, setNovoNome] = useState("");
  const [confirmandoSaida, setConfirmandoSaida] = useState(false);
  const [saindo, setSaindo] = useState(false);
  const fotoEquipe = useAvatarEquipe(equipeId);

  useEffect(() => {
    if (!equipeId) return;
    Promise.all([equipesApi.obter(equipeId), equipesApi.listarMembros(equipeId)])
      .then(([e, m]) => {
        setEquipe(e);
        setMembros(m);
      })
      .catch((e) => setErro(e instanceof ApiError ? e.message : "Equipe não encontrada."));
  }, [equipeId, versao]);

  async function convidar() {
    if (!equipeId) return;
    setConvidarAberto(true);
    if (codigoConvite) return;
    try {
      const r = await equipesApi.criarConvite(equipeId);
      setCodigoConvite(r.codigo);
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível gerar o convite.");
    }
  }

  async function sairDaEquipe() {
    if (!equipeId) return;
    setSaindo(true);
    setErro(null);
    try {
      await equipesApi.sair(equipeId);
      notificar();
      void recarregarPerfil();
      navigate("/equipes", { replace: true });
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível sair da equipe.");
      setConfirmandoSaida(false);
    } finally {
      setSaindo(false);
    }
  }

  async function salvarNome() {
    if (!equipeId || !novoNome.trim()) return;
    try { await equipesApi.atualizar(equipeId, novoNome.trim()); setEquipe((atual) => atual ? { ...atual, nome: novoNome.trim() } : atual); setEditando(false); }
    catch (e) { setErro(e instanceof ApiError ? e.message : "Não foi possível editar a equipe."); }
  }

  if (erro && !equipe) {
    return (
      <div className="px-4 pt-1">
        <button onClick={() => navigate(-1)} className="mb-4 text-text-muted">
          <ChevronLeft />
        </button>
        <p className="text-sm text-error">{erro}</p>
      </div>
    );
  }

  if (!equipe || !membros) {
    return (
      <div className="px-4 pt-1">
        <button onClick={() => navigate(-1)} className="mb-4 text-text-muted">
          <ChevronLeft />
        </button>
        <p className="py-10 text-center text-sm text-text-muted">Carregando...</p>
      </div>
    );
  }

  const cor = corDaEquipe(equipe.id);
  const meuCargo = membros.find((m) => m.usuario_id === perfil?.id)?.cargo;
  const podeEditarFoto = meuCargo === "dono" || meuCargo === "admin";
  async function trocarFoto(arquivo?: File) {
    if (!arquivo) return;
    setEnviandoFoto(true);
    try { definirAvatarEquipeLocal(equipe!.id, await prepararFotoPerfil(arquivo)); }
    catch (e) { window.alert(e instanceof Error ? e.message : "Não foi possível alterar a foto da equipe."); }
    finally { setEnviandoFoto(false); }
  }

  return (
    <div className="px-4 pt-[calc(env(safe-area-inset-top)+12px)] pb-nav-safe">
      <button onClick={() => navigate(-1)} className="mb-4 flex items-center gap-1 text-sm text-text-muted">
        <ChevronLeft size={18} />
        Voltar
      </button>

      <div className="mb-5 flex flex-col items-center gap-3 text-center">
        <span className="relative">
          <Avatar nome={equipe.nome} corFundo={cor} tamanho={72} url={fotoEquipe} />
          {enviandoFoto && <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50 text-white"><Loader2 size={20} className="animate-spin" /></span>}
          {podeEditarFoto && <label className="absolute -bottom-1 -right-1 flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border border-border bg-surface-1 text-text-secondary shadow-nav hover:text-text-primary" title="Trocar foto da equipe"><Camera size={15} /><span className="sr-only">Trocar foto da equipe</span><input type="file" accept="image/*" className="sr-only" onChange={(e) => { void trocarFoto(e.target.files?.[0]); e.target.value = ""; }} /></label>}
        </span>
        {editando ? <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void salvarNome(); }}><input autoFocus value={novoNome} onChange={(e) => setNovoNome(e.target.value)} className="ecos-input w-48 !rounded-lg !py-2 text-center" /><button className="rounded-lg bg-steel-700 px-3 text-sm font-medium text-white">Salvar</button></form> : <div className="flex items-center gap-2"><h1 className="font-display text-2xl text-text-primary">{equipe.nome}</h1><button aria-label="Editar equipe" onClick={() => { setNovoNome(equipe.nome); setEditando(true); }} className="rounded-lg p-2 text-text-muted hover:bg-surface-2"><Pencil size={16} /></button></div>}
      </div>

      <div className="mb-5 grid grid-cols-2 divide-x divide-border rounded-2xl bg-surface-1 py-3">
        <Stat valor={equipe.estatisticas.notas} label="Notas" />
        <Stat valor={equipe.estatisticas.tarefas} label="Tarefas" />
      </div>

      <div className="mb-6 flex gap-3">
        <button
          onClick={() => {
            setFiltroEquipeId(equipe.id);
            setEspacoAtivo(`equipe:${equipe.id}`);
            navigate("/feed");
          }}
          className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-surface-2 py-3 text-sm font-semibold text-text-primary"
        >
          <Rss size={16} strokeWidth={1.75} />
          Ver tudo
        </button>
        <button onClick={convidar} className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-steel-700 py-3 text-sm font-semibold text-white">
          <UserPlus size={16} strokeWidth={1.75} />
          Convidar
        </button>
      </div>

      {erro && (
        <div className="mb-4 flex items-start gap-2 rounded-2xl border border-error/40 bg-error/10 p-3 text-sm text-error">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" strokeWidth={1.75} />
          {erro}
        </div>
      )}

      {convidarAberto && (
        <div className="mb-6 flex items-center justify-between rounded-2xl border border-border bg-surface-1 px-4 py-3 ecos-fade-in">
          <span className="font-mono-value text-sm text-text-primary">{codigoConvite ?? "Gerando..."}</span>
          {codigoConvite && (
            <button onClick={() => navigator.clipboard?.writeText(codigoConvite)} className="flex items-center gap-1.5 text-xs font-medium text-steel-300">
              <Copy size={13} />
              Copiar
            </button>
          )}
        </div>
      )}

      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Membros</p>
      <div className="flex flex-col gap-1">
        {membros.map((m) => {
          const souEu = m.usuario_id === perfil?.id;
          return (
            <div key={m.usuario_id} className="flex items-center gap-3 rounded-2xl px-1 py-2.5">
              <AvatarMembro usuarioId={m.usuario_id} nome={souEu ? nomeExibicao(perfil!) : m.usuario_id} versao={souEu ? perfil!.avatar_atualizado_em : null} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-medium text-text-primary">
                  {souEu ? nomeExibicao(perfil!) : <span className="font-mono-value text-sm">{m.usuario_id.slice(0, 10)}…</span>}
                </p>
                {souEu && <p className="text-xs text-text-muted">Você</p>}
              </div>
              <RoleBadge cargo={m.cargo as Cargo} />
            </div>
          );
        })}
      </div>

      {meuCargo && (
        <section aria-labelledby="sair-equipe" className="mt-8 rounded-2xl border border-error/30 p-4">
          <h2 id="sair-equipe" className="mb-1 text-sm font-semibold text-error">Sair da equipe</h2>
          <p className="mb-3 text-xs text-text-secondary">
            Você perde o acesso às notas e tarefas desta equipe. O que você criou continua com a equipe, com você como autor original.
          </p>
          {!confirmandoSaida ? (
            <button type="button" onClick={() => setConfirmandoSaida(true)} className="min-h-11 w-full rounded-2xl border border-error/50 text-sm font-semibold text-error">Sair da equipe</button>
          ) : (
            <div className="flex gap-2">
              <button type="button" disabled={saindo} onClick={() => setConfirmandoSaida(false)} className="min-h-11 flex-1 rounded-2xl bg-surface-2 text-sm font-medium text-text-primary disabled:opacity-40">Cancelar</button>
              <button type="button" disabled={saindo} onClick={() => void sairDaEquipe()} className="min-h-11 flex-1 rounded-2xl bg-error text-sm font-semibold text-white disabled:opacity-40">{saindo ? "Saindo…" : "Confirmar saída"}</button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function Stat({ valor, label }: { valor: number; label: string }) {
  return (
    <div className="flex flex-col items-center">
      <p className="font-mono-value text-lg font-semibold text-text-primary">{valor}</p>
      <p className="text-xs text-text-muted">{label}</p>
    </div>
  );
}

function AvatarMembro({ usuarioId, nome, versao }: { usuarioId: string; nome: string; versao: number | null }) {
  const { url } = useFotoPerfil(usuarioId, versao);
  return <Avatar nome={nome} tamanho={38} url={url} />;
}
