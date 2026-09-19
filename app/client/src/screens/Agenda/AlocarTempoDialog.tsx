import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpDown, CalendarClock, CalendarDays, Folder, Search, Timer, X } from "lucide-react";
import { ApiError, tarefas as tarefasApi, type TarefaResumo } from "@/lib/api";
import { MINUTOS_DIA, dataLocalISO, duracaoParaAlocar, rotuloHorario, type Posicao } from "@/lib/agenda-tempo";
import type { TarefaArrastavel } from "@/lib/arraste-tarefa";
import { DatePicker } from "@/components/common/DatePicker";
import { TimePicker } from "@/components/common/TimePicker";
import { MenuSuspenso, type OpcaoMenu } from "@/components/common/MenuSuspenso";
import { estiloAcento, useCorDoEspaco } from "@/lib/cor";

const DURACOES_RAPIDAS = [15, 30, 45, 60, 90, 120];
const fmtDuracao = (min: number) => (min >= 60 ? `${Math.floor(min / 60)}h${min % 60 ? `${min % 60}` : ""}` : `${min}min`);
const COR_PRIORIDADE: Record<string, string> = { alta: "bg-error", media: "bg-warning", baixa: "bg-[#06B6D4]" };
const ROTULO_PRIORIDADE: Record<string, string> = { alta: "Alta", media: "Média", baixa: "Baixa" };
const PESO_PRIORIDADE: Record<string, number> = { alta: 0, media: 1, baixa: 2 };
const SEM_PASTA = "Sem pasta";

type FiltroPrioridade = "todas" | "alta" | "media" | "baixa";
type Ordem = "pasta" | "prioridade" | "duracao" | "prazo" | "titulo";

const ORDENS: OpcaoMenu<Ordem>[] = [
  { valor: "pasta", rotulo: "Por pasta" },
  { valor: "prioridade", rotulo: "Prioridade" },
  { valor: "prazo", rotulo: "Prazo" },
  { valor: "duracao", rotulo: "Duração" },
  { valor: "titulo", rotulo: "Título" },
];
const FILTROS_PRIORIDADE: { valor: FiltroPrioridade; rotulo: string }[] = [
  { valor: "todas", rotulo: "Todas" }, { valor: "alta", rotulo: "Alta" }, { valor: "media", rotulo: "Média" }, { valor: "baixa", rotulo: "Baixa" },
];

const nomeDaPasta = (t: TarefaResumo) => t.pasta?.split("/").filter(Boolean).pop() ?? SEM_PASTA;
const prazoCurto = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "");

/** Hoje, no horário atual arredondado PARA CIMA ao encaixe (nunca vai para o dia seguinte). */
function inicioPadrao(encaixe: number) {
  const agora = new Date();
  const passo = Math.max(1, encaixe);
  const total = Math.min(Math.ceil((agora.getHours() * 60 + agora.getMinutes()) / passo) * passo, MINUTOS_DIA - passo);
  return { dia: dataLocalISO(agora), horario: rotuloHorario(total) };
}

/**
 * Alternativa por formulário a arrastar uma Tarefa para o calendário. No desktop: à esquerda quando e quanto tempo
 * (com o resumo da escolha), à direita as tarefas numa mini lista com busca, filtros (prioridade, pasta) e ordenação.
 * No celular é tela inteira. Faz exatamente o mesmo que o arrasto — cria um bloco de tempo e NÃO mexe na data da Tarefa.
 */
export function AlocarTempoDialog({ encaixe, onFechar, onAlocar }: { encaixe: number; onFechar: () => void; onAlocar: (tarefa: TarefaArrastavel, destino: Posicao) => void }) {
  const corEquipe = useCorDoEspaco();
  const inicial = useMemo(() => inicioPadrao(encaixe), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [lista, setLista] = useState<TarefaResumo[] | null>(null);
  const [falhou, setFalhou] = useState<string | null>(null);
  const [tarefaId, setTarefaId] = useState("");
  const [busca, setBusca] = useState("");
  const [prioridadeFiltro, setPrioridadeFiltro] = useState<FiltroPrioridade>("todas");
  const [pastaFiltro, setPastaFiltro] = useState("todas");
  const [ordem, setOrdem] = useState<Ordem>("pasta");
  const [data, setData] = useState(inicial.dia);
  const [inicio, setInicio] = useState(inicial.horario);
  const [duracao, setDuracao] = useState("");
  const [duracaoMexida, setDuracaoMexida] = useState(false);
  const campoBusca = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let vivo = true;
    tarefasApi.listar({ status: "pendente", limit: 200 })
      .then((r) => { if (vivo) { setLista(r.items); if (r.items[0]) setTarefaId(r.items[0].id); } })
      .catch((e) => { if (vivo) { setLista([]); setFalhou(e instanceof ApiError ? e.message : "Não foi possível carregar as tarefas."); } });
    return () => { vivo = false; };
  }, []);
  useEffect(() => { if (lista) campoBusca.current?.focus(); }, [lista]);

  const tarefa = lista?.find((t) => t.id === tarefaId) ?? null;
  // A duração acompanha a estimativa da Tarefa escolhida, até a pessoa digitar a dela.
  useEffect(() => {
    if (tarefa && !duracaoMexida) setDuracao(String(duracaoParaAlocar(tarefa.duration_min)));
  }, [tarefa, duracaoMexida]);

  const opcoesPasta = useMemo<OpcaoMenu<string>[]>(() => {
    const nomes = [...new Set((lista ?? []).map(nomeDaPasta))].sort((a, b) => (a === SEM_PASTA ? 1 : b === SEM_PASTA ? -1 : a.localeCompare(b, "pt-BR")));
    return [{ valor: "todas", rotulo: "Todas as pastas" }, ...nomes.map((n) => ({ valor: n, rotulo: n }))];
  }, [lista]);

  const filtradas = useMemo(() => {
    const termo = busca.trim().toLocaleLowerCase("pt-BR");
    return (lista ?? []).filter((t) => (!termo || t.titulo.toLocaleLowerCase("pt-BR").includes(termo)) && (prioridadeFiltro === "todas" || t.prioridade === prioridadeFiltro) && (pastaFiltro === "todas" || nomeDaPasta(t) === pastaFiltro));
  }, [lista, busca, prioridadeFiltro, pastaFiltro]);

  // Por pasta: categorias (pasta da tarefa), "Sem pasta" por último. Nas outras ordens, uma lista só.
  const grupos = useMemo(() => {
    if (ordem === "pasta") {
      const mapa = new Map<string, TarefaResumo[]>();
      for (const t of filtradas) mapa.set(nomeDaPasta(t), [...(mapa.get(nomeDaPasta(t)) ?? []), t]);
      return [...mapa.entries()].sort(([a], [b]) => (a === SEM_PASTA ? 1 : b === SEM_PASTA ? -1 : a.localeCompare(b, "pt-BR")));
    }
    const comparar: Record<Exclude<Ordem, "pasta">, (a: TarefaResumo, b: TarefaResumo) => number> = {
      prioridade: (a, b) => (PESO_PRIORIDADE[a.prioridade] ?? 9) - (PESO_PRIORIDADE[b.prioridade] ?? 9) || a.titulo.localeCompare(b.titulo, "pt-BR"),
      prazo: (a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999") || a.titulo.localeCompare(b.titulo, "pt-BR"),
      duracao: (a, b) => (b.duration_min ?? 0) - (a.duration_min ?? 0) || a.titulo.localeCompare(b.titulo, "pt-BR"),
      titulo: (a, b) => a.titulo.localeCompare(b.titulo, "pt-BR"),
    };
    return [["", [...filtradas].sort(comparar[ordem])] as [string, TarefaResumo[]]];
  }, [filtradas, ordem]);

  const filtrando = !!busca.trim() || prioridadeFiltro !== "todas" || pastaFiltro !== "todas";
  const limpar = () => { setBusca(""); setPrioridadeFiltro("todas"); setPastaFiltro("todas"); };

  const m = /^(\d{1,2}):(\d{2})$/.exec(inicio);
  const minutos = m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
  const duracaoNum = Number(duracao);
  const erro = !tarefa ? "Escolha uma tarefa." : !/^\d{4}-\d{2}-\d{2}$/.test(data) ? "Escolha uma data." : !(minutos >= 0 && minutos < MINUTOS_DIA) ? "Informe um horário válido." : !Number.isInteger(duracaoNum) || duracaoNum < 1 || duracaoNum > MINUTOS_DIA ? "A duração deve ser de 1 a 1440 minutos." : null;
  const fim = !erro ? rotuloHorario(minutos + duracaoNum) : null;

  return (
    <div className="ecos-backdrop-in fixed inset-0 z-[120] flex bg-black/40 lg:items-center lg:justify-center lg:p-6 lg:backdrop-blur-[2px]" role="presentation" onPointerDown={(e) => { if (e.target === e.currentTarget) onFechar(); }}>
      <form
        noValidate
        role="dialog"
        aria-modal="true"
        aria-label="Alocar tempo para uma tarefa"
        onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onFechar(); } }}
        onSubmit={(e) => {
          e.preventDefault();
          if (erro || !tarefa) return;
          onAlocar({ id: tarefa.id, titulo: tarefa.titulo, duracaoMin: tarefa.duration_min, prioridade: tarefa.prioridade }, { dia: data, inicioMin: minutos, duracaoMin: duracaoNum });
        }}
        style={estiloAcento(corEquipe)}
        className="ecos-modal-in ecos-acento-evento flex h-full w-full flex-col bg-base lg:h-auto lg:max-h-[min(42rem,calc(100vh-3rem))] lg:max-w-4xl lg:rounded-2xl lg:border lg:border-border lg:shadow-nav"
      >
        <header className="flex shrink-0 items-center justify-between border-b border-border bg-surface-1 px-5 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] lg:rounded-t-2xl lg:pt-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-cyan/15 text-cyan"><CalendarClock size={18} /></span>
            <div className="min-w-0">
              <p className="text-[11px] font-medium uppercase tracking-wide text-text-muted">Calendário</p>
              <h2 className="font-display text-base text-text-primary">Alocar tempo</h2>
            </div>
          </div>
          <button type="button" onClick={onFechar} aria-label="Fechar" className="flex h-8 w-8 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-2"><X size={16} /></button>
        </header>

        <div className="grid min-h-0 flex-1 gap-6 overflow-y-auto p-5 lg:grid-cols-[1fr_1.2fr]">
          {/* Quando e quanto tempo (esquerda no desktop; depois da lista no celular) */}
          <div className="order-2 space-y-5 lg:order-1">
            {tarefa && (
              <div className="ecos-cascata rounded-xl border border-cyan/30 bg-cyan/10 p-3" style={{ ["--i" as string]: 0 }}>
                <p className="flex items-center gap-2 text-sm font-medium text-text-primary"><span className={`h-2 w-2 shrink-0 rounded-full ${COR_PRIORIDADE[tarefa.prioridade] ?? "bg-border"}`} /><span className="truncate">{tarefa.titulo}</span></p>
                <p className="mt-1 font-mono-value text-xs capitalize text-text-secondary">{new Date(`${data}T12:00:00`).toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })}{fim ? ` · ${inicio} – ${fim}` : ""}</p>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-text-muted">Dia</p>
                <DatePicker accent="cyan" value={data} onChange={setData} className="[&>button]:w-full [&>div]:!left-0 [&>div]:!translate-x-0" />
              </div>
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-text-muted">Início</p>
                <TimePicker ariaLabel="Início" value={inicio} onChange={setInicio} passo={encaixe} />
              </div>
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-text-muted">
                <label htmlFor="alocar-duracao" className="flex items-center gap-1.5"><Timer size={12} />Tempo (min)</label>
                {fim && <span className="font-mono-value normal-case tracking-normal text-cyan">{inicio} – {fim}</span>}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {DURACOES_RAPIDAS.map((d) => (
                  <button key={d} type="button" aria-pressed={duracaoNum === d} onClick={() => { setDuracao(String(d)); setDuracaoMexida(true); }}
                    className={`rounded-full px-2.5 py-1 text-xs transition-all active:scale-95 ${duracaoNum === d ? "bg-cyan font-semibold text-black" : "bg-surface-2 text-text-secondary hover:bg-surface-2/70"}`}>{fmtDuracao(d)}</button>
                ))}
                <input id="alocar-duracao" type="number" min={1} max={MINUTOS_DIA} step={encaixe} value={duracao} onChange={(e) => { setDuracao(e.target.value); setDuracaoMexida(true); }} style={{ width: "5rem" }} className="ecos-input ml-auto" />
              </div>
            </div>

            <p className="text-xs text-text-muted">Isto reserva tempo no calendário. A data da tarefa não é alterada.</p>
            {(erro && lista && lista.length > 0) && <p role="alert" className="text-sm text-error">{erro}</p>}
            {falhou && <p role="alert" className="text-sm text-error">{falhou}</p>}
          </div>

          {/* Tarefas: mini lista com busca, filtros e ordenação (direita no desktop; primeiro no celular) */}
          <div className="order-1 flex min-h-0 flex-col lg:order-2">
            {lista === null ? <p className="text-sm text-text-muted">Carregando tarefas…</p> : lista.length === 0 ? <p className="text-sm text-text-muted">Não há tarefas pendentes para alocar.</p> : (
              <section aria-label="Tarefa" className="flex min-h-0 flex-1 flex-col">
                <div className="mb-1.5 flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Tarefa</p>
                  <p className="text-[11px] text-text-muted" aria-live="polite">{filtradas.length === lista.length ? `${lista.length} pendentes` : `${filtradas.length} de ${lista.length}`}</p>
                </div>
                <label className="relative block">
                  <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                  <input ref={campoBusca} type="search" aria-label="Buscar tarefa" placeholder="Buscar tarefa…" value={busca} onChange={(e) => setBusca(e.target.value)} className="ecos-input w-full pl-9" />
                </label>
                <div className="mt-2 flex flex-wrap items-center gap-1.5" role="group" aria-label="Filtros">
                  {FILTROS_PRIORIDADE.map((f) => (
                    <button key={f.valor} type="button" aria-pressed={prioridadeFiltro === f.valor} onClick={() => setPrioridadeFiltro(f.valor)}
                      className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs transition-all active:scale-95 ${prioridadeFiltro === f.valor ? "bg-cyan font-semibold text-black" : "bg-surface-2 text-text-secondary hover:bg-surface-3"}`}>
                      {f.valor !== "todas" && <span className={`h-1.5 w-1.5 rounded-full ${COR_PRIORIDADE[f.valor]}`} />}{f.rotulo}
                    </button>
                  ))}
                  <span className="ml-auto flex items-center gap-1.5">
                    <MenuSuspenso ariaLabel="Filtrar por pasta" valor={pastaFiltro} opcoes={opcoesPasta} onChange={setPastaFiltro} alinhar="dir" corAtiva={pastaFiltro !== "todas" ? "rgb(var(--ecos-cyan-rgb))" : null}
                      classeGatilho="flex h-7 items-center gap-1.5 rounded-full bg-surface-2 px-2.5 text-xs text-text-secondary transition-all hover:bg-surface-3 active:scale-95"
                      gatilho={({ atual }) => <><Folder size={12} /><span className="max-w-[7rem] truncate">{atual?.rotulo ?? "Pasta"}</span></>} />
                    <MenuSuspenso ariaLabel="Ordenar tarefas" valor={ordem} opcoes={ORDENS} onChange={setOrdem} alinhar="dir"
                      classeGatilho="flex h-7 items-center gap-1.5 rounded-full bg-surface-2 px-2.5 text-xs text-text-secondary transition-all hover:bg-surface-3 active:scale-95"
                      gatilho={({ atual }) => <><ArrowUpDown size={12} />{atual?.rotulo}</>} />
                  </span>
                </div>
                <div role="listbox" aria-label="Tarefas pendentes" className="mt-2 max-h-72 min-h-0 flex-1 space-y-3 overflow-y-auto rounded-xl border border-border bg-surface-1 p-1.5 lg:max-h-[26rem]">
                  {filtradas.length === 0 && (
                    <p className="px-2 py-4 text-center text-sm text-text-muted">Nenhuma tarefa encontrada.{filtrando && <> <button type="button" onClick={limpar} className="font-medium text-cyan hover:underline">Limpar filtros</button></>}</p>
                  )}
                  {grupos.map(([nome, itens]) => (
                    <div key={nome || "todas"} role="group" aria-label={nome || "Tarefas"}>
                      {nome && <p className="px-2 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-wide text-text-muted">{nome}</p>}
                      {itens.map((t) => {
                        const ativo = t.id === tarefaId;
                        return (
                          <button key={t.id} type="button" role="option" aria-selected={ativo} aria-label={t.titulo}
                            onClick={() => { setTarefaId(t.id); setDuracaoMexida(false); }}
                            className={`flex w-full items-center gap-2 rounded-lg border-l-2 px-2 py-1.5 text-left text-sm transition-colors ${ativo ? "border-cyan bg-cyan/15 text-text-primary" : "border-transparent text-text-secondary hover:bg-surface-2"}`}>
                            <span title={`Prioridade ${ROTULO_PRIORIDADE[t.prioridade] ?? t.prioridade}`} className={`h-2 w-2 shrink-0 rounded-full ${COR_PRIORIDADE[t.prioridade] ?? "bg-border"}`} />
                            <span className="min-w-0 flex-1 truncate">{t.titulo}</span>
                            {ordem !== "pasta" && <span className="hidden shrink-0 items-center gap-1 text-[10px] text-text-muted sm:flex"><Folder size={10} />{nomeDaPasta(t)}</span>}
                            {t.due_date && <span className="flex shrink-0 items-center gap-1 text-[10px] text-text-muted"><CalendarDays size={10} />{prazoCurto(t.due_date)}</span>}
                            {t.duration_min ? <span className="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 font-mono-value text-[10px] text-text-muted">{fmtDuracao(t.duration_min)}</span> : null}
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        </div>

        <footer className="flex shrink-0 justify-end gap-2 border-t border-border bg-base px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:rounded-b-2xl lg:pb-3">
          <button type="button" onClick={onFechar} className="rounded-lg px-3 py-2 text-sm text-text-secondary transition-colors hover:bg-surface-2">Cancelar</button>
          <button type="submit" disabled={!!erro} className="rounded-lg bg-steel-600 px-5 py-2 text-sm font-medium text-white transition-all hover:bg-steel-500 active:scale-95 disabled:opacity-40">Alocar</button>
        </footer>
      </form>
    </div>
  );
}
