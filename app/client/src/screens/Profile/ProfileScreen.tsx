import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarClock, ChevronLeft, ChevronRight, Pencil, FileText, ListChecks, Type, AlignLeft, CalendarDays, ShieldCheck, Plus, Trash2, X } from "lucide-react";
import { Avatar } from "@/components/common/Avatar";
import { RoleBadge } from "@/components/common/RoleBadge";
import { useAuth, nomeExibicao } from "@/lib/auth-context";
import { corDaEquipe } from "@/lib/team-color";
import { fotoPerfil } from "@/lib/profile-avatar";
import type { Cargo } from "@/lib/types";
import { equipes as equipesApi, notas, tarefas } from "@/lib/api";
import { useMinhasEquipes } from "@/lib/use-minhas-equipes";
import { useRefreshBus } from "@/lib/refresh-bus";

/**
 * Personal Profile — same visual structure as a Team's profile (section
 * 3.8). `usuario.nome` (migração 0004) is the real display name when set;
 * falls back to `nome_usuario` (login) for accounts created before it
 * existed (see `app/server/src/auth/mod.rs::perfil`).
 */
export function ProfileScreen() {
  const navigate = useNavigate();
  const { perfil } = useAuth();
  const { equipes } = useMinhasEquipes();
  const { notificar } = useRefreshBus();
  const [novaEquipe, setNovaEquipe] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [dialogoEquipe, setDialogoEquipe] = useState<{ tipo: "editar" | "excluir"; id: string; nome: string } | null>(null);
  const [metricas, setMetricas] = useState<{ notas: number; tarefas: number; palavras: number; caracteres: number; primeiraNota: string | null }>({ notas: 0, tarefas: 0, palavras: 0, caracteres: 0, primeiraNota: null });
  useEffect(() => { let vivo = true; Promise.all([notas.listar({ limit: 500 }), tarefas.listar({ limit: 500 })]).then(([paginaNotas, paginaTarefas]) => { if (!vivo) return; const texto = paginaNotas.items.map((nota) => `${nota.titulo} ${nota.corpo}`).join(" "); const primeira = paginaNotas.items.map((nota) => nota.criado_em).sort()[0] ?? null; setMetricas({ notas: paginaNotas.items.length, tarefas: paginaTarefas.items.length, palavras: texto.trim() ? texto.trim().split(/\s+/).length : 0, caracteres: texto.length, primeiraNota: primeira }); }).catch(() => undefined); return () => { vivo = false; }; }, []);
  async function criarEquipe() { if (!novaEquipe.trim()) return; setOcupado(true); try { await equipesApi.criar(novaEquipe.trim()); setNovaEquipe(""); notificar(); } finally { setOcupado(false); } }
  async function salvarDialogo(nome: string) { if (!dialogoEquipe) return; setOcupado(true); try { if (dialogoEquipe.tipo === "editar") await equipesApi.atualizar(dialogoEquipe.id, nome); else await equipesApi.excluir(dialogoEquipe.id); notificar(); setDialogoEquipe(null); } finally { setOcupado(false); } }

  if (!perfil) return null;

  return (
    <div className="px-4 pt-[calc(env(safe-area-inset-top)+12px)] pb-nav-safe">
      <div className="mb-4 flex items-center justify-between">
        <button onClick={() => navigate(-1)} className="flex items-center gap-1 text-sm text-text-muted">
          <ChevronLeft size={18} />
          Voltar
        </button>
        <button onClick={() => navigate("/perfil/editar")} className="flex items-center gap-1.5 text-sm text-steel-300">
          <Pencil size={14} />
          Editar
        </button>
      </div>

      <div className="mb-6 flex flex-col items-center gap-3 text-center">
        <Avatar nome={nomeExibicao(perfil)} tamanho={72} url={fotoPerfil(perfil.id)} />
        <div>
          <h1 className="font-display text-2xl text-text-primary">{nomeExibicao(perfil)}</h1>
          <p className="text-sm text-text-muted">@{perfil.nome_usuario} · Identidade local desta instância</p>
        </div>
      </div>

      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Rotina</p>
      <button onClick={() => navigate("/perfil/rotina")} className="mb-6 flex w-full items-center gap-3 rounded-2xl border border-border bg-surface-1 p-4 text-left">
        <CalendarClock size={22} strokeWidth={1.75} className="shrink-0 text-steel-300" />
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-medium text-text-primary">Ajustar rotina</p>
          <p className="text-xs text-text-muted">Sono, trabalho, refeições e horário de produção — a Agenda usa isso para calcular o seu dia.</p>
        </div>
        <ChevronRight size={18} className="shrink-0 text-text-muted" />
      </button>

      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Seu espaço</p>
      <div className="grid grid-cols-2 overflow-hidden rounded-2xl border border-border bg-surface-1"><Metrica Icon={FileText} rotulo="Notas" valor={metricas.notas.toLocaleString("pt-BR")} /><Metrica Icon={ListChecks} rotulo="Tarefas" valor={metricas.tarefas.toLocaleString("pt-BR")} /><Metrica Icon={Type} rotulo="Palavras escritas" valor={metricas.palavras.toLocaleString("pt-BR")} /><Metrica Icon={AlignLeft} rotulo="Caracteres" valor={metricas.caracteres.toLocaleString("pt-BR")} /><div className="col-span-2 flex items-center gap-3 border-t border-border px-4 py-3"><CalendarDays size={19} className="text-steel-300" /><span className="min-w-0"><span className="block text-xs text-text-muted">Primeira nota</span><span className="text-sm font-medium text-text-primary">{metricas.primeiraNota ? new Date(metricas.primeiraNota).toLocaleDateString("pt-BR", { dateStyle: "long" }) : "Ainda não há notas"}</span></span></div></div>

    </div>
  );
}

function Metrica({ Icon, rotulo, valor }: { Icon: typeof FileText; rotulo: string; valor: string }) { return <div className="flex min-w-0 items-center gap-3 border-b border-r border-border p-4 even:border-r-0"><Icon size={19} className="shrink-0 text-steel-300" /><span className="min-w-0"><span className="block truncate text-lg font-semibold text-text-primary">{valor}</span><span className="block truncate text-xs text-text-muted">{rotulo}</span></span></div>; }

function DialogoEquipe({ dialogo, ocupado, onFechar, onConfirmar }: { dialogo: { tipo: "editar" | "excluir"; id: string; nome: string }; ocupado: boolean; onFechar: () => void; onConfirmar: (nome: string) => Promise<void> }) {
  const [nome, setNome] = useState(dialogo.nome);
  const excluir = dialogo.tipo === "excluir";
  const valido = excluir ? nome === dialogo.nome : !!nome.trim() && nome.trim() !== dialogo.nome;
  return <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/45 p-5" role="presentation" onPointerDown={(e) => { if (e.target === e.currentTarget) onFechar(); }}><form onSubmit={(e) => { e.preventDefault(); if (valido) void onConfirmar(nome.trim()); }} className="ecos-fade-in w-full max-w-md overflow-hidden rounded-2xl border border-border bg-base shadow-nav"><header className="flex items-center justify-between border-b border-border bg-surface-1 px-5 py-4"><div><p className={`text-xs font-semibold uppercase tracking-wide ${excluir ? "text-error" : "text-steel-300"}`}>{excluir ? "Ação irreversível" : "Equipe"}</p><h2 className="font-display text-xl text-text-primary">{excluir ? "Excluir equipe" : "Renomear equipe"}</h2></div><button type="button" onClick={onFechar} className="rounded-lg p-2 text-text-muted hover:bg-surface-2"><X size={17} /></button></header><div className="space-y-4 p-5">{excluir ? <p className="text-sm leading-relaxed text-text-secondary">Para excluir <strong className="text-text-primary">{dialogo.nome}</strong>, digite o nome completo da equipe abaixo.</p> : <p className="text-sm text-text-secondary">Escolha um novo nome para esta equipe.</p>}<label className="block text-sm font-medium text-text-secondary">{excluir ? "Confirmação" : "Nome da equipe"}<input autoFocus value={nome} onChange={(e) => setNome(e.target.value)} className="ecos-input mt-1.5 w-full" /></label></div><footer className="flex justify-end gap-2 border-t border-border px-5 py-3"><button type="button" onClick={onFechar} className="rounded-lg px-3 py-2 text-sm text-text-secondary hover:bg-surface-2">Cancelar</button><button disabled={!valido || ocupado} className={`rounded-lg px-3 py-2 text-sm font-medium text-white disabled:opacity-40 ${excluir ? "bg-error hover:bg-error/80" : "bg-steel-600 hover:bg-steel-500"}`}>{ocupado ? "Salvando…" : excluir ? "Excluir equipe" : "Salvar alteração"}</button></footer></form></div>;
}
