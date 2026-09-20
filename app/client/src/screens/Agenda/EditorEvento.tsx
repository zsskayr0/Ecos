import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, CalendarPlus, Clock, Cloud, Link2, Lock, MapPin, Save, Sun, Tag, Trash2, X, AlignLeft, ChevronDown, Repeat } from "lucide-react";
import { DatePicker } from "@/components/common/DatePicker";
import { TimePicker } from "@/components/common/TimePicker";
import { PaletaCores } from "@/components/common/PaletaCores";
import { formatDuracao } from "@/lib/format";
import { paraTriplete } from "@/lib/cor";
import type { CategoriaEvento, EventoVinculo } from "@/lib/api";
import type { EventoLocal, Repeticao } from "@/lib/eventos-locais";
import { lerRrule } from "@/lib/recorrencia";
import { SeletorVinculos } from "../Eventos/SeletorVinculos";

/** Cor de quem não tem cor própria nem categoria (o ciano da marca). */
const COR_PADRAO = "#0891B2";

const DURACOES = [15, 30, 45, 60, 90, 120, 180];
const DIA_MIN = 24 * 60;
const HORA_PADRAO_MIN = 9 * 60;

const dois = (n: number) => String(n).padStart(2, "0");
const paraHHMM = (min: number) => `${dois(Math.floor(min / 60))}:${dois(min % 60)}`;
const paraMin = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };

/** O que o editor devolve ao salvar. `cor` é a cor PRÓPRIA (`null` = vale a da categoria); só do Ecos. */
export interface DadosEvento {
  titulo: string;
  /** Dia LOCAL (`YYYY-MM-DD`). */
  dia: string;
  /** Minuto do dia em que começa; `null` = dia inteiro. */
  minutos: number | null;
  duracaoMin: number;
  cor: string | null;
  local?: string;
  descricao?: string;
  categoriaId: string | null;
  /** `true` = só no Ecos; `false` = sincronizado com o Google Calendar. */
  privado: boolean;
  tarefas: EventoVinculo[];
  notas: EventoVinculo[];
}

/**
 * - `evento`: evento comum, tudo editável.
 * - `ocorrencia`: uma só ocorrência de uma série (só quando, local e descrição; a série continua igual).
 * - `serie-google`: a série em si é do Google: aqui só cor, categoria e vínculos (que são do Ecos).
 */
export type ModoEditor = "evento" | "ocorrencia" | "serie-google";

/** Evento existente, como o editor o mostra. */
export interface EventoEditavel {
  id: string;
  titulo: string;
  dia: string;
  minutos: number | null;
  duracaoMin: number;
  /** Cor própria; `null` = a da categoria (ou a padrão). */
  cor: string | null;
  local: string;
  descricao: string;
  categoriaId: string | null;
  privado: boolean;
  /** Já existe no Google (mudar para privado o apaga de lá). */
  origemGoogle: boolean;
  tarefas: EventoVinculo[];
  notas: EventoVinculo[];
  /** RRULE da série a que pertence (ou que ele é). */
  rrule: string | null;
  /** Passa de um dia: o horário não cabe neste editor (vem do Google). */
  multiDia: boolean;
  modo: ModoEditor;
}

interface Props {
  /** Dia que abre selecionado (criação). */
  dia: Date;
  /** Presente = edição: o formulário abre preenchido e ganha "Excluir". */
  evento?: EventoEditavel;
  categorias: CategoriaEvento[];
  /** Itens da Agenda no período, para avisar de choque de horário. */
  eventos?: EventoLocal[];
  passoMin?: number;
  onFechar: () => void;
  /** Se falhar (lança), a mensagem aparece no rodapé e o editor continua aberto. */
  onSalvar: (dados: DadosEvento) => Promise<void> | void;
  onExcluir?: () => Promise<void> | void;
  onGerenciarCategorias?: () => void;
}

const isoDoDia = (d: Date) => `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`;
const rotuloData = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });

const FREQUENCIAS: { valor: Repeticao["freq"]; rotulo: string; unidade: [string, string]; todo: string }[] = [
  { valor: "dia", rotulo: "Todo dia", unidade: ["dia", "dias"], todo: "todo dia" },
  { valor: "semana", rotulo: "Toda semana", unidade: ["semana", "semanas"], todo: "toda semana" },
  { valor: "mes", rotulo: "Todo mês", unidade: ["mês", "meses"], todo: "todo mês" },
  { valor: "ano", rotulo: "Todo ano", unidade: ["ano", "anos"], todo: "todo ano" },
];
const DIAS_SEMANA = [{ i: 0, letra: "D", nome: "domingo" }, { i: 1, letra: "S", nome: "segunda" }, { i: 2, letra: "T", nome: "terça" }, { i: 3, letra: "Q", nome: "quarta" }, { i: 4, letra: "Q", nome: "quinta" }, { i: 5, letra: "S", nome: "sexta" }, { i: 6, letra: "S", nome: "sábado" }];

/** "Toda semana às segundas e quartas, até 30 de novembro" — a frase que resume a regra. */
function resumoRepeticao(r: Repeticao, dataInicio: string): string {
  const f = FREQUENCIAS.find((x) => x.valor === r.freq)!;
  let frase = r.intervalo > 1 ? `A cada ${r.intervalo} ${f.unidade[1]}` : f.todo.replace(/^./, (c) => c.toUpperCase());
  if (r.freq === "semana" && r.diasSemana.length) {
    const nomes = [...r.diasSemana].sort((a, b) => a - b).map((d) => `${DIAS_SEMANA[d].nome}s`);
    frase += ` às ${nomes.length > 1 ? `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}` : nomes[0]}`;
  }
  if (r.freq === "mes") frase += `, dia ${Number(dataInicio.slice(8, 10))}`;
  if (r.freq === "ano") frase += `, em ${new Date(`${dataInicio}T12:00:00`).toLocaleDateString("pt-BR", { day: "numeric", month: "long" })}`;
  if (r.fim.tipo === "data") frase += `, até ${new Date(`${r.fim.data}T12:00:00`).toLocaleDateString("pt-BR", { day: "numeric", month: "long", year: "numeric" })}`;
  if (r.fim.tipo === "vezes") frase += `, ${r.fim.vezes} ${r.fim.vezes === 1 ? "vez" : "vezes"}`;
  return frase;
}

/** RRULE do Google -> a estrutura que o resumo em português entende. `null` = regra que não sabemos descrever. */
function repeticaoDaRrule(rrule: string): Repeticao | null {
  const r = lerRrule(rrule);
  if (!r) return null;
  const freq = ({ DAILY: "dia", WEEKLY: "semana", MONTHLY: "mes", YEARLY: "ano" } as const)[r.freq];
  const fim: Repeticao["fim"] = r.count !== null ? { tipo: "vezes", vezes: r.count } : r.ate ? { tipo: "data", data: isoDoDia(r.ate) } : { tipo: "nunca" };
  return { freq, intervalo: r.intervalo, diasSemana: r.diasSemana, fim };
}

/** Cor em popup: o botão mostra a cor atual e abre a paleta completa (a mesma das equipes). */
function SeletorCor({ valor, onChange }: { valor: string; onChange: (cor: string) => void }) {
  const [aberto, setAberto] = useState(false);
  const raiz = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => { if (!raiz.current?.contains(e.target as Node)) setAberto(false); };
    // No document (antes do window do editor): Esc fecha só o popup, não a janela inteira.
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setAberto(false); } };
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", tecla);
    return () => { document.removeEventListener("mousedown", fora); document.removeEventListener("keydown", tecla); };
  }, [aberto]);
  return (
    <div ref={raiz} className="relative w-fit">
      <button type="button" aria-haspopup="dialog" aria-expanded={aberto} onClick={() => setAberto((v) => !v)} className="flex h-10 items-center gap-3 rounded-xl bg-surface-2 pl-2 pr-3 text-sm text-text-primary transition-all hover:bg-surface-3 active:scale-95">
        <span className="h-6 w-6 rounded-full border-2 border-white/60 shadow-sm transition-colors duration-300" style={{ backgroundColor: valor }} />
        <span className="font-mono-value text-xs uppercase text-text-secondary">{valor}</span>
        <ChevronDown size={14} className={`text-text-muted transition-transform duration-200 ${aberto ? "rotate-180" : ""}`} />
      </button>
      {aberto && (
        <div role="dialog" aria-label="Escolher cor" className="ecos-fade-in absolute left-0 top-full z-40 mt-2 w-[16.5rem] rounded-2xl border border-border bg-surface-1 p-3 shadow-xl">
          <PaletaCores valor={valor} onChange={onChange} />
          <button type="button" onClick={() => setAberto(false)} className="mt-2 w-full rounded-lg bg-surface-2 py-1.5 text-xs font-medium text-text-primary transition-colors hover:bg-surface-3">Pronto</button>
        </div>
      )}
    </div>
  );
}

function Secao({ i, icone, rotulo, children }: { i: number; icone: ReactNode; rotulo: string; children: ReactNode }) {
  return (
    <div className="ecos-cascata relative" style={{ ["--i" as string]: i, zIndex: 20 - i }}>
      <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-text-muted">{icone}{rotulo}</p>
      {children}
    </div>
  );
}

const CHIP = "rounded-pill px-3 py-1 text-xs font-medium transition-all active:scale-95";
const chip = (ligado: boolean) => `${CHIP} ${ligado ? "bg-cyan text-black" : "bg-surface-2 text-text-secondary hover:bg-surface-3"}`;

/**
 * Criar/editar evento: título, dia, dia inteiro ou horário (início, fim e duração ligados entre si), repetição (só leitura:
 * séries vêm do Google), cor, categoria, onde o evento fica (só no Ecos ou no Google Calendar), local, descrição e vínculos
 * com Tarefas e Notas — com prévia ao vivo e aviso de choque de horário.
 */
export function EditorEvento({ dia, evento, categorias, eventos = [], passoMin = 15, onFechar, onSalvar, onExcluir, onGerenciarCategorias }: Props) {
  const edicao = !!evento;
  const modo: ModoEditor = evento?.modo ?? "evento";
  const emOcorrencia = modo === "ocorrencia";
  const serieDoGoogle = modo === "serie-google";
  const multiDia = !!evento?.multiDia;
  const [titulo, setTitulo] = useState(evento?.titulo ?? "");
  const [data, setData] = useState(evento?.dia ?? isoDoDia(dia));
  const [diaInteiro, setDiaInteiro] = useState(evento ? evento.minutos === null : false);
  const [inicio, setInicio] = useState(evento?.minutos ?? HORA_PADRAO_MIN);
  const [duracao, setDuracao] = useState(evento?.duracaoMin ?? 60);
  const [corPropria, setCorPropria] = useState<string | null>(evento?.cor ?? null);
  const [categoriaId, setCategoriaId] = useState<string | null>(evento?.categoriaId ?? null);
  const [privado, setPrivado] = useState(evento?.privado ?? true);
  const [local, setLocal] = useState(evento?.local ?? "");
  const [descricao, setDescricao] = useState(evento?.descricao ?? "");
  const [vinculos, setVinculos] = useState<{ tarefas: EventoVinculo[]; notas: EventoVinculo[] }>({ tarefas: evento?.tarefas ?? [], notas: evento?.notas ?? [] });
  const [saindo, setSaindo] = useState(false);
  const [confirmaExcluir, setConfirmaExcluir] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [tremer, setTremer] = useState(0);
  const campoTitulo = useRef<HTMLInputElement>(null);

  const repeticao = useMemo(() => (evento?.rrule ? repeticaoDaRrule(evento.rrule) : null), [evento?.rrule]);
  const fim = Math.min(DIA_MIN, inicio + duracao);
  // A cor do evento: a própria, senão a da categoria, senão a padrão. Trocar de categoria muda a cor enquanto não há uma própria.
  const corDaCategoria = categorias.find((c) => c.id === categoriaId)?.cor;
  const cor = corPropria ?? corDaCategoria ?? COR_PADRAO;
  const acento = paraTriplete(cor);

  const travaQuando = serieDoGoogle || multiDia;
  const travaTexto = serieDoGoogle;

  const conflitos = useMemo(() => {
    if (diaInteiro || travaQuando) return [];
    return eventos.filter((e) => e.servidorId !== evento?.id && e.inicio === data && e.minutos !== null && e.minutos < fim && e.minutos + e.duracaoMin > inicio);
  }, [eventos, evento?.id, data, diaInteiro, inicio, fim, travaQuando]);

  function fechar() {
    if (saindo || ocupado) return;
    setSaindo(true);
    window.setTimeout(onFechar, 160);
  }
  function mudarInicio(min: number) {
    const novo = Math.max(0, Math.min(DIA_MIN - passoMin, min));
    setInicio(novo);
    setDuracao((d) => Math.min(d, DIA_MIN - novo));
  }
  function mudarFim(min: number) { setDuracao(Math.max(passoMin, min - inicio)); }

  async function executar(acao: () => Promise<void> | void) {
    setOcupado(true);
    setErro(null);
    try { await acao(); }
    catch (e) { setErro(e instanceof Error && e.message ? e.message : "Não foi possível concluir. Tente novamente."); setConfirmaExcluir(false); }
    finally { setOcupado(false); }
  }
  function salvar() {
    if (ocupado) return;
    if (!titulo.trim()) { setTremer((n) => n + 1); campoTitulo.current?.focus(); return; }
    void executar(() => onSalvar({
      titulo: titulo.trim(), dia: data, minutos: diaInteiro ? null : inicio, duracaoMin: diaInteiro ? 60 : duracao, cor: corPropria,
      local: local.trim() || undefined, descricao: descricao.trim() || undefined, categoriaId, privado, tarefas: vinculos.tarefas, notas: vinculos.notas,
    }));
  }

  useEffect(() => {
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape") fechar(); };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  });

  const rotuloModo = emOcorrencia ? "Editar esta ocorrência" : edicao ? "Editar evento" : "Novo evento";
  const podeExcluir = edicao && !!onExcluir && !serieDoGoogle;

  return (
    <div className={`${saindo ? "ecos-backdrop-out" : "ecos-backdrop-in"} fixed inset-0 z-50 flex bg-black/40 lg:absolute lg:z-30 lg:items-center lg:justify-center lg:overflow-y-auto lg:p-6 lg:backdrop-blur-[2px]`} onMouseDown={(e) => { if (e.target === e.currentTarget) fechar(); }}>
      <form
        onSubmit={(e) => { e.preventDefault(); salvar(); }}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); salvar(); } }}
        style={{ ["--ecos-cyan-rgb" as string]: acento.rgb, ["--ev-contraste" as string]: acento.contraste }}
        className={`${saindo ? "ecos-modal-out" : "ecos-modal-in"} ecos-acento-evento flex h-full w-full flex-col bg-base lg:my-auto lg:h-auto lg:max-w-5xl lg:rounded-2xl lg:border lg:border-border lg:shadow-nav`}
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-border bg-surface-1 px-5 py-4 pt-[max(1rem,env(safe-area-inset-top))] lg:rounded-t-2xl lg:pt-4">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-text-muted">{rotuloModo}</p>
            <div style={{ backgroundColor: `${cor}33`, color: `color-mix(in srgb, ${cor} 70%, var(--ecos-text-primary))` }} className="mt-2 flex max-w-full items-center gap-2 rounded-lg px-3 py-1.5 transition-colors duration-300">
              <span className="truncate text-sm font-semibold">{titulo.trim() || "Sem título"}</span>
              <span className="shrink-0 font-mono-value text-xs opacity-80">{diaInteiro ? "Dia inteiro" : `${paraHHMM(inicio)}–${paraHHMM(fim)}`}</span>
              {evento?.rrule && <Repeat size={13} className="ecos-pop shrink-0 opacity-80" aria-label="Repete" />}
              {!emOcorrencia && (privado ? <Lock size={12} className="shrink-0 opacity-70" aria-label="Só no Ecos" /> : <Cloud size={13} className="shrink-0 opacity-80" aria-label="Google Calendar" />)}
            </div>
            <p className="mt-1.5 text-xs capitalize text-text-muted">{rotuloData(data)}</p>
          </div>
          <button type="button" onClick={fechar} aria-label="Fechar" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-2 hover:text-text-primary"><X size={17} /></button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-5 lg:overflow-visible">
          {emOcorrencia && <p className="ecos-cascata mb-4 flex items-center gap-2 rounded-lg border border-border bg-surface-1 p-3 text-xs text-text-muted" style={{ ["--i" as string]: 0 }}><Repeat size={13} className="shrink-0 text-cyan" />Só esta ocorrência muda. As outras da série continuam como estão.</p>}
          {serieDoGoogle && <p className="ecos-cascata mb-4 flex items-start gap-2 rounded-lg border border-border bg-surface-1 p-3 text-xs text-text-muted" style={{ ["--i" as string]: 0 }}><Repeat size={13} className="mt-0.5 shrink-0 text-cyan" />Esta série é gerenciada no Google Calendar. Aqui você muda a cor, a categoria e os vínculos; para mudar uma ocorrência, clique nela na Agenda.</p>}
          {multiDia && !serieDoGoogle && !emOcorrencia && <p className="ecos-cascata mb-4 flex items-start gap-2 rounded-lg border border-border bg-surface-1 p-3 text-xs text-text-muted" style={{ ["--i" as string]: 0 }}><Clock size={13} className="mt-0.5 shrink-0 text-cyan" />Evento de vários dias: as datas e o horário só se mudam no Google Calendar.</p>}

          <div className="ecos-cascata mb-5" style={{ ["--i" as string]: 0 }}>
            <input
              key={tremer}
              ref={campoTitulo}
              autoFocus
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              disabled={travaTexto}
              placeholder="Ex.: Reunião de planejamento"
              aria-label="Título"
              className={`ecos-input w-full text-lg font-medium ${tremer ? "ecos-tremer border-error" : ""}`}
            />
          </div>

          <div className="grid gap-5 lg:grid-cols-2 lg:gap-x-10">
          <div className="space-y-5">
          <Secao i={1} icone={<Clock size={13} />} rotulo="Quando">
            <fieldset disabled={travaQuando} className="m-0 min-w-0 border-0 p-0">
              <div className="flex flex-wrap items-center gap-2">
                <DatePicker value={data} onChange={setData} accent="cyan" className="w-44" />
                <button type="button" role="switch" aria-checked={diaInteiro} disabled={emOcorrencia} onClick={() => setDiaInteiro((v) => !v)} className={`flex h-10 items-center gap-2 rounded-xl px-3 text-sm transition-all active:scale-95 disabled:opacity-60 ${diaInteiro ? "bg-cyan font-semibold text-black" : "bg-surface-2 text-text-secondary hover:bg-surface-3"}`}>
                  <Sun size={15} />Dia inteiro
                </button>
              </div>
              <div className="ecos-colapsa" data-aberto={!diaInteiro}>
                <div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <TimePicker value={paraHHMM(inicio)} onChange={(v) => mudarInicio(paraMin(v))} passo={passoMin} ariaLabel="Início" className="w-28" />
                    <span className="text-text-muted">→</span>
                    <TimePicker value={paraHHMM(fim)} onChange={(v) => mudarFim(paraMin(v))} passo={passoMin} ariaLabel="Fim" className="w-28" />
                    <span className="ml-1 font-mono-value text-sm text-text-muted">{formatDuracao(fim - inicio)}</span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Duração">
                    {DURACOES.map((d) => (
                      <button key={d} type="button" aria-pressed={duracao === d} onClick={() => setDuracao(Math.min(d, DIA_MIN - inicio))} className={chip(duracao === d)}>{formatDuracao(d)}</button>
                    ))}
                  </div>
                </div>
              </div>
            </fieldset>
            <div className="ecos-colapsa" data-aberto={conflitos.length > 0}>
              <div>
                <p role="status" className="mt-3 flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 p-3 text-xs text-text-primary">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warning" />
                  <span>Choca com {conflitos.map((c) => `${c.titulo} (${paraHHMM(c.minutos ?? 0)})`).join(", ")}.</span>
                </p>
              </div>
            </div>
          </Secao>

          <Secao i={2} icone={<Repeat size={13} />} rotulo="Repetir">
            {evento?.rrule ? (
              <div className="rounded-xl border border-border bg-surface-1 p-3">
                <p role="status" className="flex items-start gap-2 text-sm text-text-primary"><Repeat size={14} className="mt-0.5 shrink-0 text-cyan" /><span>{repeticao ? resumoRepeticao(repeticao, data) : "Repete com uma regra personalizada"}</span></p>
                <p className="mt-2 text-[11px] text-text-muted">A repetição é gerenciada no Google Calendar.</p>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Frequência">
                  <button type="button" aria-pressed disabled className={`${chip(true)} cursor-default`}>Não repete</button>
                  {FREQUENCIAS.map((f) => <button key={f.valor} type="button" aria-pressed={false} disabled className={`${chip(false)} cursor-not-allowed opacity-50`}>{f.rotulo}</button>)}
                </div>
                <p className="mt-2 text-[11px] text-text-muted">Eventos que se repetem são criados no Google Calendar e chegam aqui sozinhos; cada ocorrência se edita separadamente.</p>
              </>
            )}
          </Secao>

          {!emOcorrencia && (
            <Secao i={3} icone={privado ? <Lock size={13} /> : <Cloud size={13} />} rotulo="Sincronização">
              <fieldset disabled={serieDoGoogle} className="m-0 min-w-0 border-0 p-0">
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Onde este evento fica">
                  <button type="button" aria-pressed={privado} onClick={() => setPrivado(true)} className={`${chip(privado)} flex items-center gap-1.5 disabled:opacity-60`}><Lock size={12} />Só no Ecos</button>
                  <button type="button" aria-pressed={!privado} onClick={() => setPrivado(false)} className={`${chip(!privado)} flex items-center gap-1.5 disabled:opacity-60`}><Cloud size={12} />Google Calendar</button>
                </div>
              </fieldset>
              <p className={`mt-2 text-[11px] ${privado && evento?.origemGoogle ? "text-warning" : "text-text-muted"}`}>
                {privado
                  ? evento?.origemGoogle ? "Ao salvar, o evento é apagado do Google Calendar e continua só no Ecos." : "Não sai deste servidor, nem quando o Google Calendar está conectado."
                  : evento?.origemGoogle ? "Sincronizado com o Google Calendar: o que você mudar aqui vai para lá." : "Vai para o Google Calendar assim que você salvar (com a conta conectada)."}
              </p>
            </Secao>
          )}

          </div>
          <div className="space-y-5">
          {!emOcorrencia && (
            <Secao i={4} icone={<span className="h-2.5 w-2.5 rounded-full transition-colors duration-300" style={{ backgroundColor: cor }} />} rotulo="Cor">
              <SeletorCor valor={cor} onChange={setCorPropria} />
              {corPropria && corDaCategoria && <button type="button" onClick={() => setCorPropria(null)} className="mt-2 text-[11px] text-text-muted underline decoration-dotted underline-offset-2 transition-colors hover:text-text-primary">Voltar à cor da categoria</button>}
            </Secao>
          )}

          {!emOcorrencia && (
            <Secao i={5} icone={<Tag size={13} />} rotulo="Categoria">
              <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Categoria">
                <button type="button" aria-pressed={!categoriaId} onClick={() => setCategoriaId(null)} className={chip(!categoriaId)}>Sem categoria</button>
                {categorias.map((c) => (
                  <button key={c.id} type="button" aria-pressed={categoriaId === c.id} onClick={() => setCategoriaId(c.id)} className={`${chip(categoriaId === c.id)} flex items-center gap-1.5`}>
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: c.cor }} />{c.nome}
                  </button>
                ))}
                {onGerenciarCategorias && <button type="button" onClick={onGerenciarCategorias} className={`${CHIP} text-text-muted hover:bg-surface-2 hover:text-text-primary`}>{categorias.length ? "Gerenciar" : "+ Criar categoria"}</button>}
              </div>
              <p className="mt-2 text-[11px] text-text-muted">Serve para somar quanto tempo vai em reuniões, foco, estudos…</p>
            </Secao>
          )}

          <Secao i={6} icone={<MapPin size={13} />} rotulo="Local">
            <input value={local} onChange={(e) => setLocal(e.target.value)} disabled={travaTexto} placeholder="Sala, endereço ou link" aria-label="Local" className="ecos-input w-full" />
          </Secao>

          <Secao i={7} icone={<AlignLeft size={13} />} rotulo="Descrição">
            <textarea value={descricao} onChange={(e) => setDescricao(e.target.value)} disabled={travaTexto} rows={5} placeholder="Pauta, contexto, o que levar…" aria-label="Descrição" className="ecos-input w-full resize-none" />
          </Secao>

          {!emOcorrencia && (
            <Secao i={8} icone={<Link2 size={13} />} rotulo="Vínculos">
              <SeletorVinculos tarefas={vinculos.tarefas} notas={vinculos.notas} onChange={setVinculos} />
              <p className="mt-2 text-[11px] text-text-muted">Liga o evento a Tarefas e Notas. Ficam só no Ecos: nunca vão ao Google.</p>
            </Secao>
          )}

          </div>
          </div>
        </div>

        <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border bg-base px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:rounded-b-2xl lg:pb-3">
          {erro && <p role="alert" className="w-full text-sm text-error">{erro}</p>}
          {podeExcluir && (
            confirmaExcluir
              ? <span className="ecos-pop flex items-center gap-2"><button type="button" disabled={ocupado} onClick={() => void executar(onExcluir!)} className="flex items-center gap-1.5 rounded-lg bg-error px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"><Trash2 size={15} />{emOcorrencia ? "Cancelar só esta ocorrência" : "Confirmar exclusão"}</button><button type="button" onClick={() => setConfirmaExcluir(false)} className="rounded-lg px-2 py-2 text-sm text-text-secondary hover:bg-surface-2">Não</button></span>
              : <button type="button" onClick={() => setConfirmaExcluir(true)} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-error transition-colors hover:bg-error/10"><Trash2 size={15} />{emOcorrencia ? "Cancelar ocorrência" : "Excluir"}</button>
          )}
          <span className="ml-auto hidden text-[11px] text-text-muted sm:inline">Ctrl+Enter salva · Esc fecha</span>
          <button type="button" onClick={fechar} className="rounded-lg px-3 py-2 text-sm text-text-secondary transition-colors hover:bg-surface-2">Cancelar</button>
          <button type="submit" disabled={ocupado} className="group flex items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-3 py-2 text-sm font-medium text-text-secondary transition-all hover:bg-surface-2 hover:text-text-primary active:scale-95 disabled:opacity-60">{edicao ? <Save size={16} className="transition-transform duration-500 group-hover:rotate-12 group-active:rotate-[360deg]" /> : <CalendarPlus size={16} className="transition-transform duration-500 ease-out group-hover:rotate-12 group-active:rotate-[360deg] group-active:duration-700" />}{ocupado ? "Salvando..." : emOcorrencia ? "Salvar ocorrência" : edicao ? "Salvar evento" : "Criar evento"}</button>
        </footer>
      </form>
    </div>
  );
}
