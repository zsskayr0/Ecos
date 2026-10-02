import { SeletorEcos } from "@/components/common/SeletorEcos";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronsUp, Clock, Equal, Flag, PanelRightClose, PanelRightOpen } from "lucide-react";
import type { PrioridadeTarefa, TarefaResumo } from "@/lib/api";
import { meioDiaLocal, rotuloHorario, somarDiasISO } from "@/lib/agenda-tempo";
import {
  FILTRO_PADRAO, ROTULO_PRIORIDADE, agruparPorDia, capacidadeDoDia, cargaDoDia, duracaoCurta, entradasDaTarefa, esforcoMin, formatarHoras, situacaoDaCarga, tagsDasTarefas, tarefasSemData,
  type EntradaPlano, type FiltroPlano,
} from "@/lib/agenda-planejamento";
import { useIsDesktop } from "@/lib/use-viewport";
import { MenuSuspenso } from "@/components/common/MenuSuspenso";
import { useArrasteTarefa, useOuvirArrasteTarefa, type TarefaArrastavel } from "@/lib/arraste-tarefa";

const CHAVE_PAINEL = "ecos:agenda:painel-tarefas";

/** Prioridade nunca depende só de cor: cada nível tem ícone, rótulo (para leitor de tela e card) e espessura/cor da borda. */
const PRIORIDADE: Record<PrioridadeTarefa, { Icone: typeof Equal; borda: string; texto: string }> = {
  alta: { Icone: ChevronsUp, borda: "border-l-error", texto: "text-error" },
  media: { Icone: Equal, borda: "border-l-warning", texto: "text-warning" },
  baixa: { Icone: ChevronDown, borda: "border-l-cyan", texto: "text-cyan" },
};

const rotuloDia = (dia: string, opcoes: Intl.DateTimeFormatOptions) => meioDiaLocal(dia).toLocaleDateString("pt-BR", opcoes);
const rotuloCurtoDoDia = (dia: string) => rotuloDia(dia, { weekday: "short", day: "2-digit", month: "2-digit" });
const rotuloLongoDoDia = (dia: string) => rotuloDia(dia, { weekday: "long", day: "numeric", month: "long" });

function arrastavel(t: TarefaResumo): TarefaArrastavel {
  return { id: t.id, titulo: t.titulo, duracaoMin: t.duration_min, prioridade: t.prioridade };
}

/** A escolha salva vale; sem ela o painel abre no desktop (fica ao lado) e fecha no celular (onde disputaria a tela com os dias). */
function lerPainelAberto(padrao: boolean): boolean {
  try {
    const salvo = localStorage.getItem(CHAVE_PAINEL);
    return salvo === null ? padrao : salvo === "aberto";
  } catch { return padrao; }
}

function IconePrioridade({ prioridade, size = 13 }: { prioridade: PrioridadeTarefa; size?: number }) {
  const { Icone, texto } = PRIORIDADE[prioridade];
  return <Icone size={size} strokeWidth={2.5} aria-hidden className={`shrink-0 ${texto}`} />;
}

/** "Mover para…": a alternativa ao arrasto, por teclado e toque. */
function MoverPara({ dias, titulo, aoEscolher, classe = "" }: { dias: string[]; titulo: string; aoEscolher: (dia: string) => void; classe?: string }) {
  return (
    <div className={classe} onPointerDown={(e) => e.stopPropagation()}>
      <MenuSuspenso
        fixo
        valor=""
        ariaLabel={`Mover ${titulo} para`}
        opcoes={dias.map((d) => ({ valor: d, rotulo: rotuloCurtoDoDia(d) }))}
        onChange={aoEscolher}
        classeGatilho="flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-surface-1 px-2.5 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan"
        gatilho={({ aberto }) => <><span>Mover para…</span><ChevronDown size={14} aria-hidden className={`shrink-0 transition-transform duration-200 ${aberto ? "rotate-180" : ""}`} /></>}
      />
    </div>
  );
}

interface AcoesCartao {
  dias: string[];
  onAbrir: (t: TarefaResumo, e: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>) => void;
  onConcluir: (t: TarefaResumo, concluida: boolean) => void;
  onMover: (t: TarefaResumo, dia: string) => void;
}

function CartaoDetalhes({ entrada, posicao, acoes }: { entrada: EntradaPlano; posicao: { left: number; top: number }; acoes: AcoesCartao }) {
  const t = entrada.tarefa;
  const esforco = esforcoMin(t);
  return (
    <div role="group" aria-label={`Detalhes de ${t.titulo}`} data-cartao-detalhes style={{ left: posicao.left, top: posicao.top }} className="ecos-fade-in fixed z-50 w-72 rounded-xl border border-border bg-base p-3 text-left shadow-nav">
      <p className="break-words text-sm font-semibold text-text-primary">{t.titulo}</p>
      <dl className="mt-2 space-y-1 text-xs text-text-secondary">
        <div className="flex items-center gap-1.5"><IconePrioridade prioridade={t.prioridade} /><dt className="sr-only">Prioridade</dt><dd>Prioridade {ROTULO_PRIORIDADE[t.prioridade].toLowerCase()}</dd></div>
        <div className="flex items-center gap-1.5"><Clock size={13} aria-hidden /><dt className="sr-only">Duração</dt><dd>{esforco ? duracaoCurta(esforco) : "Sem estimativa de duração"}</dd></div>
        {t.scheduled_at && entrada.inicioMin !== null && <div className="flex items-center gap-1.5"><Clock size={13} aria-hidden /><dt className="sr-only">Horário</dt><dd>Bloco às {rotuloHorario(entrada.inicioMin)}</dd></div>}
        {t.due_date && <div className="flex items-center gap-1.5"><Flag size={13} aria-hidden className="text-warning" /><dt className="sr-only">Prazo</dt><dd>Prazo {rotuloLongoDoDia(t.due_date)}</dd></div>}
      </dl>
      {(t.tags?.length ?? 0) > 0 && <ul aria-label="Tags" className="mt-2 flex flex-wrap gap-1">{t.tags!.map((tag) => <li key={tag} className="rounded-pill bg-surface-2 px-2 py-0.5 text-xs text-text-secondary">#{tag}</li>)}</ul>}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={(e) => acoes.onAbrir(t, e)} className="rounded-lg bg-steel-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-steel-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan">Abrir</button>
        {entrada.tipo === "prazo" ? <MoverPara dias={acoes.dias} titulo={t.titulo} aoEscolher={(d) => acoes.onMover(t, d)} /> : <span className="text-xs text-text-muted">Tem hora marcada: mova na visão Dia ou Semana.</span>}
      </div>
    </div>
  );
}

function Cartao({ entrada, acoes }: { entrada: EntradaPlano; acoes: AcoesCartao }) {
  const t = entrada.tarefa;
  const { aoPressionarTarefa } = useArrasteTarefa();
  const raiz = useRef<HTMLLIElement>(null);
  const [posicao, setPosicao] = useState<{ left: number; top: number } | null>(null);
  const concluida = t.status === "concluida";
  const esforco = esforcoMin(t);
  const movivel = entrada.tipo === "prazo" && !concluida;

  const abrirCartao = () => {
    const r = raiz.current?.getBoundingClientRect();
    if (!r) return;
    const largura = 288;
    const left = r.right + largura + 8 > window.innerWidth ? Math.max(8, r.left - largura + 2) : r.right - 2;
    setPosicao({ left, top: Math.max(8, Math.min(r.top, window.innerHeight - 240)) });
  };

  // Bloco de tempo: a altura acompanha a duração (sem horas, mas ainda dá para "ver" quem é grande).
  const alturaMin = entrada.tipo === "bloco" ? Math.round(36 + Math.min(esforco ?? 30, 240) * 0.35) : undefined;

  function aoTeclar(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key === "Escape") { setPosicao(null); return; }
    if (!movivel || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
    const destino = somarDiasISO(entrada.dia, e.key === "ArrowLeft" ? -1 : 1);
    if (!acoes.dias.includes(destino)) return;
    e.preventDefault();
    acoes.onMover(t, destino);
  }

  return (
    <li
      ref={raiz}
      onPointerEnter={(e) => { if (e.pointerType !== "touch" && e.buttons === 0) abrirCartao(); }}
      onPointerLeave={() => setPosicao(null)}
      onFocus={abrirCartao}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setPosicao(null); }}
      onPointerDown={() => setPosicao(null)}
      className="relative list-none"
    >
      <div
        data-item={`plano:${entrada.chave}`}
        data-tipo={entrada.tipo}
        data-prioridade={t.prioridade}
        style={alturaMin ? { minHeight: alturaMin } : undefined}
        onPointerDown={movivel ? (e) => { if ((e.target as HTMLElement).closest("[data-acao]")) return; aoPressionarTarefa(e, arrastavel(t)); } : undefined}
        className={`flex items-start gap-1.5 rounded-md border border-border border-l-4 ${PRIORIDADE[t.prioridade].borda} px-1.5 py-1 text-xs transition-colors hover:bg-surface-2 ${entrada.tipo === "bloco" ? "bg-cyan/5" : "bg-surface-1"} ${movivel ? "cursor-grab" : ""} ${concluida ? "opacity-60" : ""}`}
      >
        <input
          type="checkbox"
          data-acao="concluir"
          checked={concluida}
          onChange={(e) => acoes.onConcluir(t, e.target.checked)}
          aria-label={`Concluir ${t.titulo}`}
          className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-steel-500"
        />
        <button
          type="button"
          onClick={(e) => acoes.onAbrir(t, e)}
          onKeyDown={aoTeclar}
          aria-label={`${t.titulo}. Prioridade ${ROTULO_PRIORIDADE[t.prioridade].toLowerCase()}${esforco ? `, ${duracaoCurta(esforco)}` : ""}${entrada.tipo === "prazo" ? ", prazo" : entrada.inicioMin !== null ? `, às ${rotuloHorario(entrada.inicioMin)}` : ""}.${movivel ? " Setas esquerda e direita mudam o prazo de dia." : ""}`}
          className="min-w-0 flex-1 rounded text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan"
        >
          <span className={`line-clamp-2 break-words text-xs font-medium leading-snug text-text-primary ${concluida ? "line-through" : ""}`}>{t.titulo}</span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-text-muted">
            <IconePrioridade prioridade={t.prioridade} />
            <span className="sr-only">Prioridade {ROTULO_PRIORIDADE[t.prioridade].toLowerCase()}</span>
            {entrada.tipo === "prazo" ? <span className="inline-flex items-center gap-0.5"><Flag size={12} aria-hidden className="text-warning" />Prazo</span> : entrada.inicioMin !== null && <span className="inline-flex items-center gap-0.5 font-mono-value"><Clock size={12} aria-hidden />{rotuloHorario(entrada.inicioMin)}</span>}
            {esforco && <span>{duracaoCurta(esforco)}</span>}
            {entrada.comPrazo && <span data-marca-prazo className="inline-flex items-center gap-0.5 text-warning"><Flag size={12} aria-hidden />Prazo hoje</span>}
          </span>
        </button>
      </div>
      {posicao && <CartaoDetalhes entrada={entrada} posicao={posicao} acoes={acoes} />}
    </li>
  );
}

function CargaDoDia({ dia, entradas, capacidadeMin }: { dia: string; entradas: EntradaPlano[]; capacidadeMin: number | null }) {
  const { minutos, semEstimativa } = cargaDoDia(entradas);
  const situacao = situacaoDaCarga(minutos, capacidadeMin);
  const sobre = situacao === "sobrecarregado";
  const texto = capacidadeMin === null ? formatarHoras(minutos) : `${formatarHoras(minutos)} / ${formatarHoras(capacidadeMin)}`;
  const porcentagem = capacidadeMin && capacidadeMin > 0 ? Math.min(100, (minutos / capacidadeMin) * 100) : sobre ? 100 : 0;
  return (
    <div data-carga={dia} data-situacao={situacao} className="w-full text-center">
      <span className={`inline-flex items-center gap-1 text-xs font-semibold ${sobre ? "text-error" : "text-text-secondary"}`}>
        {sobre && <AlertTriangle size={12} aria-hidden />}
        <span>{texto}</span>
        {sobre && <span className="sr-only">: acima da capacidade do dia</span>}
        {situacao === "sem-capacidade" && <span className="sr-only">: sem capacidade configurada na Rotina</span>}
      </span>
      {capacidadeMin !== null && <div aria-hidden className="mx-auto mt-0.5 h-1 w-full max-w-[6rem] overflow-hidden rounded-pill bg-surface-3"><div style={{ width: `${porcentagem}%` }} className={`h-full ${sobre ? "bg-error" : "bg-steel-400"}`} /></div>}
      {semEstimativa > 0 && <p className="text-[12px] leading-tight text-text-muted">+{semEstimativa} sem estimativa</p>}
    </div>
  );
}

function ColunaDia({ dia, hoje, entradas, capacidadeMin, sobre, acoes, aoSelecionarDia, fimDeSemanaLivre }: { dia: string; hoje: string; entradas: EntradaPlano[]; capacidadeMin: number | null; sobre: boolean; acoes: AcoesCartao; aoSelecionarDia: (dia: string, alvo: HTMLElement) => void; fimDeSemanaLivre: boolean }) {
  const d = meioDiaLocal(dia);
  return (
    <section data-dia-plan={dia} aria-label={rotuloLongoDoDia(dia)} className={`flex min-h-[8rem] min-w-0 flex-col rounded-lg border transition-colors duration-200 ${sobre ? "border-cyan/60 bg-cyan/10 ring-1 ring-inset ring-cyan/60" : fimDeSemanaLivre ? "border-border/60 bg-surface-1" : "border-border bg-base"}`}>
      <div data-cabecalho-dia={dia} className="flex flex-col items-center gap-0.5 border-b border-border/60 px-1 py-1.5">
        <button
          type="button"
          aria-label={`Ver tarefas de ${rotuloLongoDoDia(dia)}`}
          onClick={(e) => aoSelecionarDia(dia, e.currentTarget.closest<HTMLElement>("[data-cabecalho-dia]") ?? e.currentTarget)}
          className={`flex h-8 w-8 items-center justify-center rounded-full text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan ${dia === hoje ? "bg-steel-500 font-semibold text-white hover:bg-steel-400" : "text-text-primary hover:bg-surface-3"}`}
        >
          {d.getDate()}
        </button>
        <span className="text-xs font-medium capitalize text-text-muted">{rotuloDia(dia, { weekday: "short" })}</span>
        <CargaDoDia dia={dia} entradas={entradas} capacidadeMin={capacidadeMin} />
      </div>
      <ul aria-label={`Tarefas de ${rotuloLongoDoDia(dia)}`} className="flex flex-1 flex-col gap-1 p-1">
        {entradas.map((e) => <Cartao key={e.chave} entrada={e} acoes={acoes} />)}
        {entradas.length === 0 && <li aria-hidden className="list-none px-1 py-2 text-center text-xs text-text-muted">Livre</li>}
      </ul>
    </section>
  );
}

function PainelSemData({ aberto, aoAlternar, tarefas, todas, dias, acoes, filtro }: { aberto: boolean; aoAlternar: () => void; tarefas: TarefaResumo[]; todas: number; dias: string[]; acoes: AcoesCartao; filtro: FiltroPlano }) {
  const { aoPressionarTarefa } = useArrasteTarefa();
  const filtrando = Boolean(filtro.prioridade || filtro.tag);
  return (
    <aside aria-label="Tarefas sem prazo" className={`flex min-h-0 shrink-0 flex-col overflow-hidden border-t border-border bg-surface-1 transition-[width,max-height] duration-300 ease-out motion-reduce:transition-none lg:border-l lg:border-t-0 ${aberto ? "max-h-64 lg:max-h-none lg:w-72" : "max-h-12 lg:max-h-none lg:w-14"}`}>
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <h2 className={`text-sm font-semibold text-text-primary ${aberto ? "" : "lg:sr-only"}`}>Sem prazo <span className="font-normal text-text-muted">({todas})</span></h2>
        <button type="button" onClick={aoAlternar} aria-expanded={aberto} aria-label={aberto ? "Recolher painel de tarefas sem prazo" : "Abrir painel de tarefas sem prazo"} className="flex h-8 w-8 items-center justify-center rounded-lg text-text-muted hover:bg-surface-2 hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan">
          {aberto ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
        </button>
      </div>
      {aberto && (
        <div className="min-h-0 w-full flex-1 overflow-y-auto px-2 pb-2 lg:w-72">
          <p className="px-1 pb-2 text-xs text-text-muted">Arraste para um dia para definir o prazo, ou use “Mover para…”.</p>
          {tarefas.length === 0 ? (
            <p className="px-1 py-4 text-center text-xs text-text-muted">{filtrando ? "Nenhuma tarefa sem prazo com esses filtros." : "Nenhuma tarefa sem prazo. Tudo planejado!"}</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {tarefas.map((t) => {
                const esforco = esforcoMin(t);
                return (
                  <li key={t.id} data-painel-tarefa={t.id} onPointerDown={(e) => { if ((e.target as HTMLElement).closest("select, button, a")) return; aoPressionarTarefa(e, arrastavel(t)); }} className={`cursor-grab list-none rounded-md border border-border border-l-4 ${PRIORIDADE[t.prioridade].borda} bg-base px-2 py-1.5 text-xs`}>
                    <button type="button" onClick={(e) => acoes.onAbrir(t, e)} className="block w-full rounded text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan">
                      <span className="line-clamp-2 break-words text-xs font-medium text-text-primary">{t.titulo}</span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-text-muted">
                        <IconePrioridade prioridade={t.prioridade} /><span>{ROTULO_PRIORIDADE[t.prioridade]}</span>
                        <span>{esforco ? duracaoCurta(esforco) : "sem estimativa"}</span>
                        {(t.tags ?? []).map((tag) => <span key={tag}>#{tag}</span>)}
                      </span>
                    </button>
                    <MoverPara dias={dias} titulo={t.titulo} aoEscolher={(d) => acoes.onMover(t, d)} classe="mt-1 w-full" />
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </aside>
  );
}

const CLASSE_FILTRO = "h-8 rounded-lg border border-border bg-surface-1 px-2 text-xs text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan";

export interface PlanejamentoQuinzenalProps {
  dias: string[];
  hoje: string;
  rotulo: string;
  /** Botões de período/navegação da Agenda (o mesmo cabeçalho das outras visões). */
  acoes: ReactNode;
  /** Tarefas do período e as sem data (o painel filtra as que não têm prazo nem bloco). */
  tarefas: TarefaResumo[];
  /** Capacidade de produção (min) por dia da semana, 0 = domingo. Vazio quando a Rotina não está configurada. */
  capacidades: ReadonlyMap<number, number>;
  onAbrirTarefa: (t: TarefaResumo, e: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>) => void;
  onConcluir: (t: TarefaResumo, concluida: boolean) => void;
  /** Define o prazo (`due_date`) da tarefa. Nunca mexe no bloco de tempo. */
  onDefinirPrazo: (t: TarefaResumo, dia: string) => void;
  onSelecionarDia: (dia: string, alvo: HTMLElement) => void;
}

/**
 * Quinzenal como visão de PLANEJAMENTO: uma coluna por dia com a carga (soma de `duration_min` contra a capacidade da
 * Rotina) e cards sem horas. O grid de horas continua nas visões de dia, 3 dias e semana.
 */
export function PlanejamentoQuinzenal({ dias, hoje, rotulo, acoes, tarefas, capacidades, onAbrirTarefa, onConcluir, onDefinirPrazo, onSelecionarDia }: PlanejamentoQuinzenalProps) {
  const [filtro, setFiltro] = useState<FiltroPlano>(FILTRO_PADRAO);
  const desktop = useIsDesktop();
  const [painelAberto, setPainelAberto] = useState(() => lerPainelAberto(desktop));
  const [diaSobre, setDiaSobre] = useState<string | null>(null);
  const [aviso, setAviso] = useState("");
  const focoPendente = useRef<string | null>(null);

  const porDia = useMemo(() => agruparPorDia(tarefas, dias, filtro), [tarefas, dias, filtro]);
  const tags = useMemo(() => tagsDasTarefas(tarefas), [tarefas]);
  const semData = useMemo(() => tarefasSemData(tarefas, filtro), [tarefas, filtro]);
  const totalSemData = useMemo(() => tarefasSemData(tarefas, { prioridade: null, tag: null }).length, [tarefas]);
  const concluidasNoPeriodo = useMemo(() => tarefas.filter((t) => t.status === "concluida" && entradasDaTarefa(t).some((e) => dias.includes(e.dia))).length, [tarefas, dias]);

  const alternarPainel = () => setPainelAberto((aberto) => {
    try { localStorage.setItem(CHAVE_PAINEL, aberto ? "fechado" : "aberto"); } catch { /* preferência não salva */ }
    return !aberto;
  });

  // Depois de mover pelo teclado o card reaparece noutra coluna (outro elemento): devolve o foco a ele.
  useLayoutEffect(() => {
    if (!focoPendente.current) return;
    document.querySelector<HTMLElement>(`[data-item="plano:${focoPendente.current}"] button`)?.focus();
    focoPendente.current = null;
  }, [porDia]);

  const mover = (t: TarefaResumo, dia: string) => {
    if (t.due_date === dia) return;
    focoPendente.current = `prazo:${t.id}`;
    onDefinirPrazo(t, dia);
    setAviso(`${t.titulo}: prazo em ${rotuloLongoDoDia(dia)}.`);
  };
  const acoesCartao: AcoesCartao = { dias, onAbrir: onAbrirTarefa, onConcluir, onMover: mover };

  // Uma tarefa arrastada (de um card de prazo ou do painel) sobre um dia: o dia se destaca e, ao soltar, recebe o prazo.
  useOuvirArrasteTarefa((e) => {
    if (e.fase === "cancelar") return setDiaSobre(null);
    const dia = (document.elementsFromPoint?.(e.x, e.y) ?? []).map((el) => el.closest<HTMLElement>("[data-dia-plan]")).find(Boolean)?.dataset.diaPlan ?? null;
    if (e.fase === "mover") return setDiaSobre(dia);
    setDiaSobre(null);
    const tarefa = tarefas.find((t) => t.id === e.tarefa.id);
    if (dia && tarefa) mover(tarefa, dia);
  });

  const semanas = [dias.slice(0, 7), dias.slice(7, 14)].filter((s) => s.length > 0);
  const semanaTemplate = useMemo(() => {
    const semRotina = capacidades.size === 0;
    // Fim de semana sem horário de produção na Rotina fica mais estreito (continua recebendo tarefas).
    return [0, 1, 2, 3, 4, 5, 6].map((d) => (!semRotina && (d === 0 || d === 6) && capacidades.get(d) === 0 ? "minmax(0,0.6fr)" : "minmax(0,1fr)")).join(" ");
  }, [capacidades]);
  const filtrando = filtro.prioridade !== null || filtro.tag !== null;

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-base">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-3 lg:px-5 lg:py-4">
        <div><p className="text-xs font-medium uppercase tracking-[0.12em] text-text-muted">Planejamento</p><h1 className="font-display text-xl text-text-primary lg:text-2xl">{rotulo}</h1></div>
        {acoes}
      </div>

      <div role="group" aria-label="Filtros do planejamento" className="flex flex-wrap items-center gap-2 border-b border-border/60 px-3 py-1.5 lg:px-5">
        <button type="button" aria-pressed={filtro.mostrarConcluidas} onClick={() => setFiltro((f) => ({ ...f, mostrarConcluidas: !f.mostrarConcluidas }))} className={`flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan ${filtro.mostrarConcluidas ? "border-success/50 bg-success/15 text-success" : "border-border bg-surface-1 text-text-secondary hover:bg-surface-2"}`}>
          <CheckCircle2 size={14} aria-hidden />{filtro.mostrarConcluidas ? "Ocultar concluídas" : "Mostrar concluídas"}{!filtro.mostrarConcluidas && concluidasNoPeriodo > 0 && <span className="text-text-muted">({concluidasNoPeriodo})</span>}
        </button>
        <SeletorEcos ariaLabel="Filtrar por prioridade" valor={filtro.prioridade ?? ""} onChange={(v) => setFiltro((f) => ({ ...f, prioridade: (v || null) as PrioridadeTarefa | null }))} classe={CLASSE_FILTRO}
          opcoes={[{ valor: "", rotulo: "Todas as prioridades" }, ...(["alta", "media", "baixa"] as const).map((p) => ({ valor: p as string, rotulo: `Prioridade ${ROTULO_PRIORIDADE[p].toLowerCase()}` }))]} />
        <SeletorEcos ariaLabel="Filtrar por tag" valor={filtro.tag ?? ""} onChange={(v) => setFiltro((f) => ({ ...f, tag: v || null }))} classe={CLASSE_FILTRO}
          opcoes={[{ valor: "", rotulo: "Todas as tags" }, ...tags.map((tag) => ({ valor: tag, rotulo: `#${tag}` }))]} />
        {filtrando && <button type="button" onClick={() => setFiltro((f) => ({ ...f, prioridade: null, tag: null }))} className="h-8 rounded-lg px-2 text-xs text-text-muted underline hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan">Limpar filtros</button>}
      </div>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div data-testid="planejamento-rolagem" className="min-h-0 min-w-0 flex-1 space-y-2 overflow-auto p-2">
          {semanas.map((semana, i) => (
            <div key={semana[0]} style={{ "--colunas": semanaTemplate } as CSSProperties} className="grid grid-cols-1 gap-1.5 md:grid-cols-4 lg:[grid-template-columns:var(--colunas)]" data-semana={i + 1}>
              {semana.map((dia) => {
                const idx = meioDiaLocal(dia).getDay();
                const cap = capacidades.size === 0 ? null : capacidadeDoDia(dia, capacidades);
                return <ColunaDia key={dia} dia={dia} hoje={hoje} entradas={porDia.get(dia) ?? []} capacidadeMin={cap} sobre={diaSobre === dia} acoes={acoesCartao} aoSelecionarDia={onSelecionarDia} fimDeSemanaLivre={(idx === 0 || idx === 6) && cap === 0} />;
              })}
            </div>
          ))}
        </div>
        <PainelSemData aberto={painelAberto} aoAlternar={alternarPainel} tarefas={semData} todas={totalSemData} dias={dias} acoes={acoesCartao} filtro={filtro} />
      </div>
      <p role="status" aria-live="polite" className="sr-only">{aviso}</p>
    </section>
  );
}
