import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarClock, ChevronLeft, ChevronRight, Cloud, ListChecks, Lock, Plus, Repeat, StickyNote, Tags } from "lucide-react";
import { ApiError, eventos, type CategoriaEvento, type Evento } from "@/lib/api";
import { EmptyState } from "@/components/common/EmptyState";
import { useRefreshBus } from "@/lib/refresh-bus";
import { agruparPorDia, deslocarAncora, formatarDuracao, intervaloDoPeriodo, type Periodo } from "@/lib/eventos";
import { CategoriasDialog } from "./CategoriasDialog";
import { useEspacoFiltro } from "@/lib/use-espaco-filtro";
import { EventoDialog } from "./EventoDialog";
import { TempoPorCategoria } from "./TempoPorCategoria";

const COR_SEM_CATEGORIA = "#64748B";
type Aba = "lista" | "tempo";

const horaLocal = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
const rotuloDia = (dia: string) => new Date(`${dia}T12:00:00`).toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });

function rotuloPeriodo(periodo: Periodo, de: Date, ate: Date): string {
  if (periodo === "mes") return de.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  const fim = new Date(ate.getTime() - 86_400_000);
  const curto = (d: Date) => d.toLocaleDateString("pt-BR", { day: "numeric", month: "short" });
  return `${curto(de)} – ${curto(fim)}`;
}

function horarioDoEvento(e: Evento): string {
  if (e.dia_inteiro) return "Dia inteiro";
  const minutos = Math.round((new Date(e.fim).getTime() - new Date(e.inicio).getTime()) / 60_000);
  return `${horaLocal(e.inicio)} – ${horaLocal(e.fim)} · ${formatarDuracao(minutos)}`;
}

/** Aba de Eventos: agenda por período (semana/mês), tempo gasto por categoria e categorias. Eventos privados ficam só no Ecos. */
export function EventosScreen() {
  const { versao, notificar } = useRefreshBus();
  const espaco = useEspacoFiltro();
  const navigate = useNavigate();
  const [aba, setAba] = useState<Aba>("lista");
  const [periodo, setPeriodo] = useState<Periodo>("semana");
  const [ancora, setAncora] = useState(() => new Date());
  const [filtroCategoria, setFiltroCategoria] = useState<string>("");
  const [lista, setLista] = useState<Evento[] | null>(null);
  const [categorias, setCategorias] = useState<CategoriaEvento[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [editando, setEditando] = useState<{ id: string | null } | null>(null);
  const [gerenciando, setGerenciando] = useState(false);
  const [recarga, setRecarga] = useState(0);

  const { de, ate } = useMemo(() => intervaloDoPeriodo(periodo, ancora), [periodo, ancora]);
  const deIso = de.toISOString();
  const ateIso = ate.toISOString();

  useEffect(() => {
    eventos.categorias.listar({ espaco }).then(setCategorias).catch(() => setCategorias([]));
  }, [versao, recarga, espaco]);

  useEffect(() => {
    let ativo = true;
    setLista(null);
    eventos.listar({ de: deIso, ate: ateIso, categoria: filtroCategoria || undefined, espaco })
      .then((itens) => { if (ativo) { setLista(itens); setErro(null); } })
      .catch((e) => { if (ativo) { setLista([]); setErro(e instanceof ApiError ? e.message : "Não foi possível carregar os eventos. Tente novamente."); } });
    return () => { ativo = false; };
  }, [deIso, ateIso, filtroCategoria, versao, recarga, espaco]);

  const aoAlterar = useCallback(() => { setRecarga((n) => n + 1); notificar(); }, [notificar]);
  const grupos = useMemo(() => agruparPorDia(lista ?? []), [lista]);

  return (
    <div className="px-4 pt-1 pb-nav-safe">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl text-text-primary">Eventos</h1>
          <p className="text-sm text-text-muted">Reuniões, compromissos e o tempo que vão levando.</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button type="button" onClick={() => setGerenciando(true)} className="flex h-10 items-center gap-1.5 rounded-xl bg-surface-2 px-3 text-sm font-medium text-text-primary hover:bg-surface-3"><Tags size={16} />Categorias</button>
          <button type="button" onClick={() => setEditando({ id: null })} className="flex h-10 items-center gap-1.5 rounded-xl bg-cyan px-3 text-sm font-semibold text-black"><Plus size={16} />Novo</button>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div role="tablist" aria-label="Visão" className="grid grid-cols-2 rounded-xl bg-surface-2 p-0.5">
          {(["lista", "tempo"] as const).map((a) => (
            <button key={a} type="button" role="tab" aria-selected={aba === a} onClick={() => setAba(a)} className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${aba === a ? "bg-surface-1 text-text-primary shadow-sm" : "text-text-muted hover:text-text-secondary"}`}>{a === "lista" ? "Agenda" : "Tempo"}</button>
          ))}
        </div>
        <div role="group" aria-label="Período" className="grid grid-cols-2 rounded-xl bg-surface-2 p-0.5">
          {(["semana", "mes"] as const).map((p) => (
            <button key={p} type="button" aria-pressed={periodo === p} onClick={() => setPeriodo(p)} className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${periodo === p ? "bg-surface-1 font-medium text-text-primary shadow-sm" : "text-text-muted hover:text-text-secondary"}`}>{p === "semana" ? "Semana" : "Mês"}</button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setAncora((a) => deslocarAncora(periodo, a, -1))} aria-label="Período anterior" className="rounded-lg p-2 text-text-secondary hover:bg-surface-2"><ChevronLeft size={18} /></button>
          <button type="button" onClick={() => setAncora(new Date())} className="min-w-36 rounded-lg px-2 py-1.5 text-center text-sm font-medium capitalize text-text-primary hover:bg-surface-2">{rotuloPeriodo(periodo, de, ate)}</button>
          <button type="button" onClick={() => setAncora((a) => deslocarAncora(periodo, a, 1))} aria-label="Próximo período" className="rounded-lg p-2 text-text-secondary hover:bg-surface-2"><ChevronRight size={18} /></button>
        </div>
        {aba === "lista" && (
          <select value={filtroCategoria} onChange={(e) => setFiltroCategoria(e.target.value)} aria-label="Filtrar por categoria" className="h-9 rounded-xl bg-surface-2 px-3 text-sm text-text-primary outline-none focus:ring-2 focus:ring-cyan/50">
            <option value="">Todas as categorias</option>
            <option value="sem">Sem categoria</option>
            {categorias.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
        )}
      </div>

      {erro && <p role="alert" className="mb-4 text-sm text-error">{erro}</p>}

      {aba === "tempo"
        ? <TempoPorCategoria de={de} ate={ate} versao={versao + recarga} espaco={espaco} onEscolherCategoria={(id) => { setFiltroCategoria(id ?? "sem"); setAba("lista"); }} />
        : lista === null
          ? <p className="py-10 text-center text-sm text-text-muted">Carregando eventos...</p>
          : grupos.length === 0 && !erro
            ? <EmptyState icon={CalendarClock} title="Nenhum evento neste período." subtitle="Crie um evento privado (só no Ecos) ou sincronizado com o Google Calendar." action={<button type="button" onClick={() => setEditando({ id: null })} className="rounded-xl bg-cyan px-4 py-2 text-sm font-semibold text-black">Novo evento</button>} />
            : <div className="flex flex-col gap-6">
              {grupos.map((g) => (
                <section key={g.dia} aria-label={rotuloDia(g.dia)}>
                  <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">{rotuloDia(g.dia)}</h2>
                  <ul className="flex flex-col gap-2">
                    {g.eventos.map((e) => <LinhaEvento key={e.id} evento={e} onAbrir={() => setEditando({ id: e.id })} onTarefa={(id) => navigate(`/tarefa/${id}`)} onNota={(id) => navigate(`/notas/nota/${id}`)} />)}
                  </ul>
                </section>
              ))}
            </div>}

      <EventoDialog aberto={editando !== null} eventoId={editando?.id ?? null} categorias={categorias} onFechar={() => setEditando(null)} onSalvo={() => { setEditando(null); aoAlterar(); }} onCategoriasAlteradas={aoAlterar} />
      <CategoriasDialog aberto={gerenciando} categorias={categorias} onFechar={() => setGerenciando(false)} onAlterado={aoAlterar} />
    </div>
  );
}

function LinhaEvento({ evento: e, onAbrir, onTarefa, onNota }: { evento: Evento; onAbrir: () => void; onTarefa: (id: string) => void; onNota: (id: string) => void }) {
  const cor = e.cor ?? e.categoria?.cor ?? COR_SEM_CATEGORIA;
  return (
    <li className="flex overflow-hidden rounded-2xl border border-border bg-surface-1">
      <span aria-hidden className="w-1.5 shrink-0" style={{ backgroundColor: cor }} />
      <div className="min-w-0 flex-1 p-3">
        <button type="button" onClick={onAbrir} className="block w-full text-left" aria-label={`Abrir evento ${e.titulo}`}>
          <p className="truncate text-sm font-medium text-text-primary">{e.titulo}</p>
          <p className="mt-0.5 text-xs text-text-muted">{horarioDoEvento(e)}{e.local ? ` · ${e.local}` : ""}</p>
        </button>
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
          {e.categoria && <span className="rounded-full px-2 py-0.5 font-medium text-white" style={{ backgroundColor: cor }}>{e.categoria.nome}</span>}
          <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-text-secondary">
            {e.visibilidade === "privado" ? <><Lock size={11} />Privado</> : <><Cloud size={11} />{e.origem_google ? "Google" : "Google (aguardando envio)"}{e.origem_google && e.sync_pendente ? " · alteração pendente" : ""}</>}
          </span>
          {e.rrule && <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-text-secondary"><Repeat size={11} />Série</span>}
          {e.tarefas.map((t) => <button key={`t-${t.id}`} type="button" onClick={() => onTarefa(t.id)} className="inline-flex max-w-40 items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-text-secondary hover:bg-surface-3"><ListChecks size={11} className="shrink-0" /><span className="truncate">{t.titulo}</span></button>)}
          {e.notas.map((n) => <button key={`n-${n.id}`} type="button" onClick={() => onNota(n.id)} className="inline-flex max-w-40 items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-text-secondary hover:bg-surface-3"><StickyNote size={11} className="shrink-0" /><span className="truncate">{n.titulo}</span></button>)}
        </div>
      </div>
    </li>
  );
}
