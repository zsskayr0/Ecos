import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, CalendarPlus, Clock, MapPin, Save, Sun, Trash2, X, AlignLeft, ChevronDown, Repeat } from "lucide-react";
import { DatePicker } from "@/components/common/DatePicker";
import { TimePicker } from "@/components/common/TimePicker";
import { PaletaCores } from "@/components/common/PaletaCores";
import { formatDuracao } from "@/lib/format";
import { paraTriplete } from "@/lib/cor";
import type { EventoLocal, Repeticao } from "@/lib/eventos-locais";

const COR_PADRAO = "#0891B2";
const CLASSE_RESERVA = "bg-cyan/20 text-cyan";

const DURACOES = [15, 30, 45, 60, 90, 120, 180];
const DIA_MIN = 24 * 60;
const HORA_PADRAO_MIN = 9 * 60;

const dois = (n: number) => String(n).padStart(2, "0");
const paraHHMM = (min: number) => `${dois(Math.floor(min / 60))}:${dois(min % 60)}`;
const paraMin = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };

export type DadosEvento = Pick<EventoLocal, "titulo" | "inicio" | "cor" | "minutos" | "duracaoMin" | "local" | "descricao" | "repete" | "corHex">;

interface Props {
  /** Dia que abre selecionado (criação). */
  dia: Date;
  /** Presente = edição: o formulário abre preenchido e ganha "Excluir". */
  evento?: EventoLocal;
  /** Eventos já existentes, para avisar de choque de horário. */
  eventos: EventoLocal[];
  passoMin?: number;
  onFechar: () => void;
  onSalvar: (dados: DadosEvento) => void;
  onExcluir?: () => void;
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
const diaDaSemana = (iso: string) => new Date(`${iso}T12:00:00`).getDay();

/** "Toda semana às segundas e quartas, até 30 de novembro" — a frase que resume a regra, escrita conforme se edita. */
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

/**
 * Criar/editar evento da Agenda: título, dia, dia inteiro ou horário (início, fim e duração ligados entre si), cor,
 * local e descrição, com prévia ao vivo e aviso de choque de horário. Eventos ainda vivem só na sessão (sem backend).
 */
export function EditorEvento({ dia, evento, eventos, passoMin = 15, onFechar, onSalvar, onExcluir }: Props) {
  const edicao = !!evento;
  const [titulo, setTitulo] = useState(evento?.titulo ?? "");
  const [data, setData] = useState(evento?.inicio ?? isoDoDia(dia));
  const [diaInteiro, setDiaInteiro] = useState(evento ? evento.minutos === null : false);
  const [inicio, setInicio] = useState(evento?.minutos ?? HORA_PADRAO_MIN);
  const [duracao, setDuracao] = useState(evento?.duracaoMin ?? 60);
  const [cor, setCor] = useState<string>(evento?.corHex ?? COR_PADRAO);
  const [local, setLocal] = useState(evento?.local ?? "");
  const [descricao, setDescricao] = useState(evento?.descricao ?? "");
  const [repete, setRepete] = useState<Repeticao | null>(evento?.repete ?? null);
  const [saindo, setSaindo] = useState(false);
  const [confirmaExcluir, setConfirmaExcluir] = useState(false);
  const [tremer, setTremer] = useState(0);
  const campoTitulo = useRef<HTMLInputElement>(null);

  const fim = Math.min(DIA_MIN, inicio + duracao);
  const acento = paraTriplete(cor);

  const conflitos = useMemo(() => {
    if (diaInteiro) return [];
    return eventos.filter((e) => e.id !== evento?.id && e.inicio === data && e.minutos !== null && e.minutos < fim && e.minutos + e.duracaoMin > inicio);
  }, [eventos, evento?.id, data, diaInteiro, inicio, fim]);

  const escolherFrequencia = (freq: Repeticao["freq"]) => setRepete((r) => ({ freq, intervalo: r?.intervalo ?? 1, diasSemana: r?.diasSemana.length ? r.diasSemana : [diaDaSemana(data)], fim: r?.fim ?? { tipo: "nunca" } }));
  const ajustar = (parcial: Partial<Repeticao>) => setRepete((r) => (r ? { ...r, ...parcial } : r));
  const alternarDia = (d: number) => setRepete((r) => {
    if (!r) return r;
    const tem = r.diasSemana.includes(d);
    return tem && r.diasSemana.length === 1 ? r : { ...r, diasSemana: tem ? r.diasSemana.filter((x) => x !== d) : [...r.diasSemana, d] };
  });
  const unidade = repete ? FREQUENCIAS.find((f) => f.valor === repete.freq)!.unidade : ["", ""];

  function fechar() {
    if (saindo) return;
    setSaindo(true);
    window.setTimeout(onFechar, 160);
  }
  function mudarInicio(min: number) {
    const novo = Math.max(0, Math.min(DIA_MIN - passoMin, min));
    setInicio(novo);
    setDuracao((d) => Math.min(d, DIA_MIN - novo));
  }
  function mudarFim(min: number) { setDuracao(Math.max(passoMin, min - inicio)); }
  function salvar() {
    if (!titulo.trim()) { setTremer((n) => n + 1); campoTitulo.current?.focus(); return; }
    onSalvar({ titulo: titulo.trim(), inicio: data, cor: evento?.cor ?? CLASSE_RESERVA, corHex: cor, minutos: diaInteiro ? null : inicio, duracaoMin: diaInteiro ? 60 : duracao, local: local.trim() || undefined, descricao: descricao.trim() || undefined, repete: repete ?? undefined });
  }

  useEffect(() => {
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape") fechar(); };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  });

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
            <p className="text-xs font-medium uppercase tracking-wide text-text-muted">{edicao ? "Editar evento" : "Novo evento"}</p>
            <div style={{ backgroundColor: `${cor}33`, color: `color-mix(in srgb, ${cor} 70%, var(--ecos-text-primary))` }} className="mt-2 flex max-w-full items-center gap-2 rounded-lg px-3 py-1.5 transition-colors duration-300">
              <span className="truncate text-sm font-semibold">{titulo.trim() || "Sem título"}</span>
              <span className="shrink-0 font-mono-value text-xs opacity-80">{diaInteiro ? "Dia inteiro" : `${paraHHMM(inicio)}–${paraHHMM(fim)}`}</span>
              {repete && <Repeat size={13} className="ecos-pop shrink-0 opacity-80" aria-label="Repete" />}
            </div>
            <p className="mt-1.5 text-xs capitalize text-text-muted">{rotuloData(data)}</p>
          </div>
          <button type="button" onClick={fechar} aria-label="Fechar" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-2 hover:text-text-primary"><X size={17} /></button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-5 lg:overflow-visible">
          <div className="ecos-cascata mb-5" style={{ ["--i" as string]: 0 }}>
            <input
              key={tremer}
              ref={campoTitulo}
              autoFocus
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              placeholder="Ex.: Reunião de planejamento"
              aria-label="Título"
              className={`ecos-input w-full text-lg font-medium ${tremer ? "ecos-tremer border-error" : ""}`}
            />
          </div>

          <div className="grid gap-5 lg:grid-cols-2 lg:gap-x-10">
          <div className="space-y-5">
          <Secao i={1} icone={<Clock size={13} />} rotulo="Quando">
            <div className="flex flex-wrap items-center gap-2">
              <DatePicker value={data} onChange={setData} accent="cyan" className="w-44" />
              <button type="button" role="switch" aria-checked={diaInteiro} onClick={() => setDiaInteiro((v) => !v)} className={`flex h-10 items-center gap-2 rounded-xl px-3 text-sm transition-all active:scale-95 ${diaInteiro ? "bg-cyan font-semibold text-black" : "bg-surface-2 text-text-secondary hover:bg-surface-3"}`}>
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
                    <button key={d} type="button" aria-pressed={duracao === d} onClick={() => setDuracao(Math.min(d, DIA_MIN - inicio))} className={`rounded-pill px-3 py-1 text-xs font-medium transition-all active:scale-95 ${duracao === d ? "bg-cyan text-black" : "bg-surface-2 text-text-secondary hover:bg-surface-3"}`}>{formatDuracao(d)}</button>
                  ))}
                </div>
              </div>
            </div>
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
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Frequência">
              <button type="button" aria-pressed={!repete} onClick={() => setRepete(null)} className={`rounded-pill px-3 py-1 text-xs font-medium transition-all active:scale-95 ${!repete ? "bg-cyan text-black" : "bg-surface-2 text-text-secondary hover:bg-surface-3"}`}>Não repete</button>
              {FREQUENCIAS.map((f) => <button key={f.valor} type="button" aria-pressed={repete?.freq === f.valor} onClick={() => escolherFrequencia(f.valor)} className={`rounded-pill px-3 py-1 text-xs font-medium transition-all active:scale-95 ${repete?.freq === f.valor ? "bg-cyan text-black" : "bg-surface-2 text-text-secondary hover:bg-surface-3"}`}>{f.rotulo}</button>)}
            </div>
            <div className="ecos-colapsa" data-aberto={!!repete}>
              <div>
                {repete && (
                  <div className="mt-3 space-y-3 rounded-xl border border-border bg-surface-1 p-3">
                    <div className="flex flex-wrap items-center gap-2 text-sm text-text-secondary">
                      A cada
                      <input type="number" min={1} max={99} value={repete.intervalo} aria-label="Intervalo" style={{ width: "4rem" }} onChange={(e) => ajustar({ intervalo: Math.max(1, Math.min(99, Number(e.target.value) || 1)) })} className="ecos-input text-center" />
                      <span>{repete.intervalo === 1 ? unidade[0] : unidade[1]}</span>
                    </div>
                    <div className="ecos-colapsa" data-aberto={repete.freq === "semana"}>
                      <div>
                        <div className="flex gap-1.5" role="group" aria-label="Dias da semana">
                          {DIAS_SEMANA.map((d) => <button key={d.i} type="button" aria-pressed={repete.diasSemana.includes(d.i)} aria-label={d.nome} title={d.nome} onClick={() => alternarDia(d.i)} className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold transition-all hover:scale-110 active:scale-90 ${repete.diasSemana.includes(d.i) ? "bg-cyan text-black" : "bg-surface-2 text-text-secondary hover:bg-surface-3"}`}>{d.letra}</button>)}
                        </div>
                      </div>
                    </div>
                    <div>
                      <p className="mb-1.5 text-xs text-text-muted">Termina</p>
                      <div className="flex flex-wrap items-center gap-2">
                        {(["nunca", "data", "vezes"] as const).map((t) => (
                          <button key={t} type="button" aria-pressed={repete.fim.tipo === t} onClick={() => ajustar({ fim: t === "nunca" ? { tipo: "nunca" } : t === "data" ? { tipo: "data", data: repete.fim.tipo === "data" ? repete.fim.data : data } : { tipo: "vezes", vezes: repete.fim.tipo === "vezes" ? repete.fim.vezes : 10 } })} className={`rounded-pill px-3 py-1 text-xs font-medium transition-all active:scale-95 ${repete.fim.tipo === t ? "bg-cyan text-black" : "bg-surface-2 text-text-secondary hover:bg-surface-3"}`}>{t === "nunca" ? "Nunca" : t === "data" ? "Em uma data" : "Após N vezes"}</button>
                        ))}
                        {repete.fim.tipo === "data" && <DatePicker value={repete.fim.data} onChange={(d) => ajustar({ fim: { tipo: "data", data: d } })} accent="cyan" className="ecos-pop w-44" />}
                        {repete.fim.tipo === "vezes" && <input type="number" min={1} max={999} value={repete.fim.vezes} aria-label="Número de ocorrências" style={{ width: "5rem" }} onChange={(e) => ajustar({ fim: { tipo: "vezes", vezes: Math.max(1, Math.min(999, Number(e.target.value) || 1)) } })} className="ecos-input ecos-pop text-center" />}
                      </div>
                    </div>
                    <p role="status" className="flex items-start gap-2 text-xs text-text-primary"><Repeat size={13} className="mt-0.5 shrink-0 text-cyan" /><span>{resumoRepeticao(repete, data)}</span></p>
                    <p className="text-[11px] text-text-muted">Prévia de design: a regra é guardada no evento, mas as ocorrências ainda não aparecem na grade.</p>
                  </div>
                )}
              </div>
            </div>
          </Secao>

          </div>
          <div className="space-y-5">
          <Secao i={3} icone={<span className="h-2.5 w-2.5 rounded-full transition-colors duration-300" style={{ backgroundColor: cor }} />} rotulo="Cor">
            <SeletorCor valor={cor} onChange={setCor} />
          </Secao>

          <Secao i={4} icone={<MapPin size={13} />} rotulo="Local">
            <input value={local} onChange={(e) => setLocal(e.target.value)} placeholder="Sala, endereço ou link" aria-label="Local" className="ecos-input w-full" />
          </Secao>

          <Secao i={5} icone={<AlignLeft size={13} />} rotulo="Descrição">
            <textarea value={descricao} onChange={(e) => setDescricao(e.target.value)} rows={5} placeholder="Pauta, contexto, o que levar…" aria-label="Descrição" className="ecos-input w-full resize-none" />
          </Secao>

          </div>
          </div>

          <p className="ecos-cascata mt-5 rounded-lg border border-border bg-surface-1 p-3 text-xs text-text-muted" style={{ ["--i" as string]: 6 }}>Eventos ficam só nesta sessão até a integração do backend.</p>
        </div>

        <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border bg-base px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:rounded-b-2xl lg:pb-3">
          {edicao && onExcluir && (
            confirmaExcluir
              ? <span className="ecos-pop flex items-center gap-2"><button type="button" onClick={onExcluir} className="flex items-center gap-1.5 rounded-lg bg-error px-3 py-2 text-sm font-medium text-white hover:opacity-90"><Trash2 size={15} />Confirmar exclusão</button><button type="button" onClick={() => setConfirmaExcluir(false)} className="rounded-lg px-2 py-2 text-sm text-text-secondary hover:bg-surface-2">Não</button></span>
              : <button type="button" onClick={() => setConfirmaExcluir(true)} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-error transition-colors hover:bg-error/10"><Trash2 size={15} />Excluir</button>
          )}
          <span className="ml-auto hidden text-[11px] text-text-muted sm:inline">Ctrl+Enter salva · Esc fecha</span>
          <button type="button" onClick={fechar} className="rounded-lg px-3 py-2 text-sm text-text-secondary transition-colors hover:bg-surface-2">Cancelar</button>
          <button type="submit" className="group flex items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-3 py-2 text-sm font-medium text-text-secondary transition-all hover:bg-surface-2 hover:text-text-primary active:scale-95">{edicao ? <Save size={16} className="transition-transform duration-500 group-hover:rotate-12 group-active:rotate-[360deg]" /> : <CalendarPlus size={16} className="transition-transform duration-500 ease-out group-hover:rotate-12 group-active:rotate-[360deg] group-active:duration-700" />}{edicao ? "Salvar evento" : "Criar evento"}</button>
        </footer>
      </form>
    </div>
  );
}
