import { SkeletonEventos } from "@/components/common/SkeletonTelas";
import { SeletorEcos } from "@/components/common/SeletorEcos";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { CalendarClock, CalendarDays, ChevronLeft, Clock, ChevronRight, Cloud, ListChecks, Lock, Plus, Repeat, StickyNote, Tags } from "lucide-react";
import { useIsMobile } from "@/lib/use-viewport";
import { MenuSuspenso, TOM } from "@/components/common/MenuSuspenso";
import { eventos, type CategoriaEvento, type Evento } from "@/lib/api";
import { EmptyState } from "@/components/common/EmptyState";
import { useRefreshBus } from "@/lib/refresh-bus";
import { expandirOcorrencias, type EventoOcorrencia } from "@/lib/eventos-agenda";
import { agruparPorDia, deslocarAncora, formatarDuracao, intervaloDoPeriodo, type Periodo } from "@/lib/eventos";
import { CategoriasDialog } from "./CategoriasDialog";
import { useEspacoFiltro } from "@/lib/use-espaco-filtro";
import { EventoDialog } from "./EventoDialog";
import { TempoPorCategoria } from "./TempoPorCategoria";

import { mensagemDeErro } from "@/lib/erros";
const COR_SEM_CATEGORIA = "#64748B";
type Aba = "lista" | "tempo";

const horaLocal = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
const rotuloDia = (dia: string) => new Date(`${dia}T12:00:00`).toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });

/** Último item do filtro: abre o gerenciador de categorias em vez de filtrar. */
const GERENCIAR = "__gerenciar__";

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
  const [editando, setEditando] = useState<{ id: string | null; ocorrencia?: string | null } | null>(null);
  // Vindo da Agenda: `?evento=<id>` (e `&ocorrencia=` numa série) abre o evento direto, e o endereço volta ao normal.
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    const id = params.get("evento");
    if (!id) return;
    setEditando({ id, ocorrencia: params.get("ocorrencia") });
    setParams({}, { replace: true });
  }, [params, setParams]);
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
      .catch((e) => { if (ativo) { setLista([]); setErro(mensagemDeErro(e, "Não foi possível carregar os eventos. Tente novamente.")); } });
    return () => { ativo = false; };
  }, [deIso, ateIso, filtroCategoria, versao, recarga, espaco]);

  const aoAlterar = useCallback(() => { setRecarga((n) => n + 1); notificar(); }, [notificar]);
  const grupos = useMemo(() => agruparPorDia(expandirOcorrencias(lista ?? [], de, ate)), [lista, de, ate]);

  const mobile = useIsMobile();
  const opcoesFiltro = [{ valor: "", rotulo: "Categorias" }, { valor: "sem", rotulo: "Sem categoria" }, ...categorias.map((c) => ({ valor: c.id, rotulo: c.nome })), { valor: GERENCIAR, rotulo: "Gerenciar categorias…" }] as const;
  const aoEscolherFiltro = (v: string) => (v === GERENCIAR ? setGerenciando(true) : setFiltroCategoria(v));
  return (
    <div className="px-4 pt-1 pb-nav-safe">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl text-text-primary">Eventos</h1>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {mobile && aba === "lista" && (
            <MenuSuspenso fixo ariaLabel="Filtrar por categoria" alinhar="dir" valor={filtroCategoria} opcoes={opcoesFiltro} onChange={aoEscolherFiltro} corAtiva={filtroCategoria ? TOM.aco : null}
              classeGatilho="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-surface-1 text-text-secondary transition-all active:scale-95"
              gatilho={() => <Tags size={17} />} />
          )}
          <button type="button" onClick={() => setEditando({ id: null })} aria-label="Novo evento" title="Novo evento" className="flex h-10 items-center gap-1.5 rounded-xl bg-cyan px-3 text-sm font-semibold text-black"><Plus size={16} /><span className="hidden sm:inline">Novo</span></button>
        </div>
      </div>

      <p className="text-xs font-medium uppercase tracking-[0.12em] text-text-muted">Período</p>
      <h2 className="mb-3 font-display text-xl capitalize text-text-primary">{rotuloPeriodo(periodo, de, ate)}</h2>
      <div className="no-scrollbar mb-4 flex flex-nowrap items-center gap-1.5 overflow-x-auto sm:gap-2">
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <button type="button" onClick={() => setAncora((a) => deslocarAncora(periodo, a, -1))} aria-label="Período anterior" className="group flex h-9 w-8 items-center justify-center rounded-lg border sm:w-9 border-border bg-surface-1 text-text-muted transition-all hover:bg-surface-2 hover:text-text-primary active:scale-95"><ChevronLeft size={18} className="transition-transform duration-300 ease-out group-hover:-translate-x-1 group-active:-translate-x-2.5 group-active:duration-500" /></button>
          <MenuSuspenso ariaLabel="Escolher período" valor={periodo} opcoes={[{ valor: "semana", rotulo: "Semanal" }, { valor: "mes", rotulo: "Mensal" }]} onChange={setPeriodo} corAtiva={TOM.aco}
            classeGatilho="group flex h-9 items-center gap-2 rounded-lg border border-border bg-surface-1 px-2.5 sm:px-3 text-sm font-medium text-text-secondary transition-all hover:bg-surface-2 hover:text-text-primary active:scale-95"
            gatilho={() => <><CalendarDays size={16} className="transition-transform duration-300 ease-out group-hover:-rotate-12 group-hover:scale-125 group-active:rotate-[360deg] group-active:scale-90 group-active:duration-700" /><span>{periodo === "mes" ? "Mensal" : "Semanal"}</span></>} />
          <button type="button" onClick={() => setAncora((a) => deslocarAncora(periodo, a, 1))} aria-label="Próximo período" className="group flex h-9 w-8 items-center justify-center rounded-lg border sm:w-9 border-border bg-surface-1 text-text-muted transition-all hover:bg-surface-2 hover:text-text-primary active:scale-95"><ChevronRight size={18} className="transition-transform duration-300 ease-out group-hover:translate-x-1 group-active:translate-x-2.5 group-active:duration-500" /></button>
          <button type="button" onClick={() => setAncora(new Date())} className="rounded-lg border border-border bg-surface-1 px-2.5 py-2 text-sm font-medium text-text-secondary transition-colors sm:px-3 hover:bg-surface-2 hover:text-text-primary">Hoje</button>
        </div>
        {/* No modo Tempo o filtro some e este espaço cresce: as abas deslizam até a borda direita. */}
        <div aria-hidden className="min-w-0" style={{ flexGrow: aba === "tempo" ? 1 : 0, flexBasis: 0, transition: "flex-grow 320ms cubic-bezier(0.4, 0, 0.2, 1)" }} />
        <div role="tablist" aria-label="Visão" className="grid h-9 shrink-0 grid-cols-2 rounded-lg border border-border bg-surface-1 p-0.5">
          {(["lista", "tempo"] as const).map((a) => (
            <button key={a} type="button" role="tab" title={a === "lista" ? "Agenda" : "Tempo"} aria-label={a === "lista" ? "Agenda" : "Tempo"} aria-selected={aba === a} onClick={() => setAba(a)} className={`rounded-md flex items-center justify-center px-2.5 text-sm sm:px-3 font-medium transition-all active:scale-95 ${aba === a ? "bg-steel-700 text-on-steel" : "text-text-muted hover:bg-surface-2 hover:text-text-primary"}`}>{a === "lista" ? <ListChecks size={16} /> : <Clock size={16} />}</button>
          ))}
        </div>
        {!mobile && (
        <div className="shrink-0 overflow-hidden" aria-hidden={aba !== "lista"} {...({ inert: aba !== "lista" ? "" : undefined } as object)} style={{ maxWidth: aba === "lista" ? 160 : 0, opacity: aba === "lista" ? 1 : 0, transition: "max-width 320ms cubic-bezier(0.4, 0, 0.2, 1), opacity 200ms ease-out" }}>
          <SeletorEcos valor={filtroCategoria} onChange={aoEscolherFiltro} ariaLabel="Filtrar por categoria" alinhar="dir" classe="h-9 max-w-[9.5rem] shrink-0 truncate rounded-lg border border-border bg-surface-1 px-3 text-sm font-medium text-text-secondary outline-none transition-all hover:bg-surface-2 hover:text-text-primary active:scale-95"
            opcoes={opcoesFiltro} />
        </div>
        )}
      </div>

      {erro && <p role="alert" className="mb-4 text-sm text-error">{erro}</p>}

      {aba === "tempo"
        ? <TempoPorCategoria de={de} ate={ate} versao={versao + recarga} espaco={espaco} onEscolherCategoria={(id) => { setFiltroCategoria(id ?? "sem"); setAba("lista"); }} />
        : lista === null
          ? <SkeletonEventos rotulo="Carregando eventos…" />
          : grupos.length === 0 && !erro
            ? <EmptyState icon={CalendarClock} title="Nenhum evento neste período." subtitle="Crie um evento privado (só no Ecos) ou sincronizado com o Google Calendar." action={<button type="button" onClick={() => setEditando({ id: null })} className="rounded-xl bg-cyan px-4 py-2 text-sm font-semibold text-black">Novo evento</button>} />
            : <div className="flex flex-col gap-6">
              {grupos.map((g) => (
                <section key={g.dia} aria-label={rotuloDia(g.dia)}>
                  <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">{rotuloDia(g.dia)}</h2>
                  <ul className="flex flex-col gap-2">
                    {g.eventos.map((e) => <LinhaEvento key={`${e.id}|${e.inicio}`} evento={e} onAbrir={() => setEditando({ id: e.id, ocorrencia: e.ocorrencia })} onTarefa={(id) => navigate(`/tarefa/${id}`)} onNota={(id) => navigate(`/notas/nota/${id}`)} />)}
                  </ul>
                </section>
              ))}
            </div>}

      <EventoDialog aberto={editando !== null} eventoId={editando?.id ?? null} ocorrencia={editando?.ocorrencia ?? null} categorias={categorias} onFechar={() => setEditando(null)} onSalvo={() => { setEditando(null); aoAlterar(); }} onCategoriasAlteradas={aoAlterar} />
      <CategoriasDialog aberto={gerenciando} categorias={categorias} onFechar={() => setGerenciando(false)} onAlterado={aoAlterar} />
    </div>
  );
}

function LinhaEvento({ evento: e, onAbrir, onTarefa, onNota }: { evento: EventoOcorrencia; onAbrir: () => void; onTarefa: (id: string) => void; onNota: (id: string) => void }) {
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
