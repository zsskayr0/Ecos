import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CalendarDays, CheckCircle2, ChevronDown, Clock, Hourglass, LayoutDashboard, ListChecks, Lock, Cloud, Repeat, Wallet, X } from "lucide-react";
import type { EventoLocal } from "@/lib/eventos-locais";
import type { TarefaResumo } from "@/lib/api";
import { formatDuracao, formatMoeda } from "@/lib/format";

interface Capacidade {
  disponivel_producao_min: number;
  consumido_tarefas_min: number;
  consumido_eventos_externos_min: number;
  disponivel_producao_total_min?: number;
  total_dia_min?: number;
  consumido_rotina_min?: number;
  tempo_livre_min?: number;
  estourado: boolean;
}
type Aba = "resumo" | "eventos" | "tarefas" | "lancamentos" | "tempo";

export interface DiaMaximizadoProps {
  dia: Date;
  hoje: boolean;
  eventosDoDia: EventoLocal[];
  tarefasDoDia: TarefaResumo[] | null;
  concluidasDoDia: TarefaResumo[];
  capacidade: Capacidade | null;
  semRotina: boolean;
  onAjustarRotina: () => void;
  onAbrirEvento: (e: EventoLocal) => void;
  abrirDocumento: (path: string, e?: MouseEvent<HTMLElement>) => void;
  onFechar: () => void;
}

const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const porHorario = (a: EventoLocal, b: EventoLocal) => (a.minutos ?? -1) - (b.minutos ?? -1) || a.titulo.localeCompare(b.titulo, "pt-BR");
const reduzido = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Número que "corre" até o valor novo (some com movimento reduzido). */
function useContagem(alvo: number, duracao = 650) {
  const [valor, setValor] = useState(reduzido() ? alvo : 0);
  const atual = useRef(valor);
  useEffect(() => {
    if (reduzido()) { atual.current = alvo; setValor(alvo); return; }
    const de = atual.current;
    const inicio = performance.now();
    let quadro = 0;
    const passo = (t: number) => {
      const p = Math.min(1, (t - inicio) / duracao);
      const v = de + (alvo - de) * (1 - Math.pow(1 - p, 3));
      atual.current = v;
      setValor(v);
      if (p < 1) quadro = requestAnimationFrame(passo);
    };
    quadro = requestAnimationFrame(passo);
    return () => cancelAnimationFrame(quadro);
  }, [alvo, duracao]);
  return valor;
}

const moeda = (centavos: number) => `${centavos < 0 ? "−" : centavos > 0 ? "+" : ""}${formatMoeda(Math.abs(Math.round(centavos)))}`;

function Cartao({ icone, rotulo, children, detalhe, i, tom = "text-text-primary", aoClicar }: { icone: ReactNode; rotulo: string; children: ReactNode; detalhe?: string; i: number; tom?: string; aoClicar?: () => void }) {
  return (
    <div style={{ ["--i" as string]: i }} onClick={aoClicar} role={aoClicar ? "button" : undefined} tabIndex={aoClicar ? 0 : undefined} onKeyDown={aoClicar ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); aoClicar(); } } : undefined} className={`ecos-cascata group rounded-2xl border border-border bg-surface-1 p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-steel-400/50 hover:shadow-nav ${aoClicar ? "cursor-pointer active:scale-[0.98]" : ""}`}>
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-text-muted"><span className="transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-6">{icone}</span>{rotulo}</div>
      <div className={`mt-2 text-2xl font-semibold tabular-nums ${tom}`}>{children}</div>
      {detalhe && <p className="mt-0.5 text-xs text-text-muted">{detalhe}</p>}
    </div>
  );
}

/** Barra que cresce de 0 até a porcentagem assim que aparece. */
function Barra({ pct, cor, montado }: { pct: number; cor: string; montado: boolean }) {
  return <div className="h-2 overflow-hidden rounded-full bg-surface-3"><div className={`h-full rounded-full ${cor} transition-[width] duration-700 ease-out`} style={{ width: montado ? `${Math.min(100, Math.max(0, pct))}%` : "0%" }} /></div>;
}

function Vazio({ icone, texto }: { icone: ReactNode; texto: string }) {
  return <div className="ecos-fade-in flex flex-col items-center justify-center gap-2 py-16 text-text-muted"><span className="opacity-60">{icone}</span><p className="text-sm">{texto}</p></div>;
}

export function DiaMaximizado({ dia, hoje, eventosDoDia, tarefasDoDia, concluidasDoDia, capacidade, semRotina, onAjustarRotina, onAbrirEvento, abrirDocumento, onFechar }: DiaMaximizadoProps) {
  const [aba, setAba] = useState<Aba>("resumo");
  const [montado, setMontado] = useState(false);
  const [saindo, setSaindo] = useState(false);
  const [concluidasAbertas, setConcluidasAbertas] = useState(false);
  const abasRef = useRef<HTMLDivElement>(null);
  const [indicador, setIndicador] = useState<{ left: number; width: number } | null>(null);

  const eventos = useMemo(() => eventosDoDia.filter((e) => !e.transacaoId).sort(porHorario), [eventosDoDia]);
  const lancamentos = useMemo(() => eventosDoDia.filter((e) => !!e.transacaoId).sort((a, b) => a.titulo.localeCompare(b.titulo, "pt-BR")), [eventosDoDia]);
  const tarefas = useMemo(() => [...(tarefasDoDia ?? [])].sort((a, b) => (a.scheduled_at ?? "9").localeCompare(b.scheduled_at ?? "9")), [tarefasDoDia]);
  const saldo = lancamentos.reduce((s, l) => s + (l.valorCentavos ?? 0), 0);
  const entradas = lancamentos.reduce((s, l) => s + Math.max(0, l.valorCentavos ?? 0), 0);
  const saidas = lancamentos.reduce((s, l) => s + Math.min(0, l.valorCentavos ?? 0), 0);
  const saldoAnimado = useContagem(saldo);
  const livre = capacidade ? (capacidade.disponivel_producao_total_min ?? capacidade.disponivel_producao_min) : null;

  const titulo = dia.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" });
  const abas: { id: Aba; rotulo: string; icone: ReactNode; n?: number }[] = [
    { id: "resumo", rotulo: "Resumo", icone: <LayoutDashboard size={15} /> },
    { id: "eventos", rotulo: "Eventos", icone: <CalendarDays size={15} />, n: eventos.length },
    { id: "tarefas", rotulo: "Tarefas", icone: <ListChecks size={15} />, n: tarefas.length },
    { id: "lancamentos", rotulo: "Lançamentos", icone: <Wallet size={15} />, n: lancamentos.length },
    { id: "tempo", rotulo: "Tempo", icone: <Hourglass size={15} /> },
  ];

  useEffect(() => { const q = requestAnimationFrame(() => setMontado(true)); return () => cancelAnimationFrame(q); }, []);
  useEffect(() => { setMontado(false); const q = requestAnimationFrame(() => setMontado(true)); return () => cancelAnimationFrame(q); }, [aba]);

  useLayoutEffect(() => {
    const el = abasRef.current?.querySelector<HTMLElement>(`[data-aba="${aba}"]`);
    if (el) setIndicador({ left: el.offsetLeft, width: el.offsetWidth });
  }, [aba, eventos.length, tarefas.length, lancamentos.length]);

  const fechar = () => {
    if (reduzido()) return onFechar();
    setSaindo(true);
    setTimeout(onFechar, 160);
  };
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); fechar(); }
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        if ((e.target as HTMLElement).closest("input, textarea, select")) return;
        const i = abas.findIndex((a) => a.id === aba);
        setAba(abas[(i + (e.key === "ArrowRight" ? 1 : abas.length - 1)) % abas.length].id);
      }
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aba, abas.length]);

  const proximos = [...eventos.filter((e) => e.minutos !== null)].slice(0, 3);

  const linhaEvento = (e: EventoLocal, i: number) => {
    const lanc = !!e.transacaoId;
    const horario = e.legenda ?? (e.minutos === null ? "Dia inteiro" : `${hhmm(e.minutos)} – ${hhmm(Math.min(1440, e.minutos + e.duracaoMin))} · ${formatDuracao(e.duracaoMin)}`);
    return (
      <li key={e.id} style={{ ["--i" as string]: i }} className="ecos-cascata">
        <button type="button" onClick={() => onAbrirEvento(e)} aria-label={`Abrir ${lanc ? "lançamento" : "evento"} ${e.titulo}`} className="group flex w-full items-stretch overflow-hidden rounded-2xl border border-border bg-surface-1 text-left transition-all duration-200 hover:-translate-y-0.5 hover:bg-surface-2 hover:shadow-nav active:scale-[0.99]">
          <span aria-hidden className="w-1.5 shrink-0 transition-[width] duration-200 group-hover:w-2.5" style={{ backgroundColor: e.corHex ?? "#0891B2" }} />
          <div className="min-w-0 flex-1 px-4 py-3">
            <p className={`truncate text-[15px] font-medium text-text-primary ${lanc ? "fonte-cofre" : ""}`}>{e.titulo}</p>
            <p className={`text-xs text-text-muted ${lanc ? "fonte-cofre" : "font-mono-value"}`}>{horario}{e.local ? ` · ${e.local}` : ""}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2 pr-4 text-text-muted">
            {e.ocorrencia && <Repeat size={14} aria-label="Repete" />}
            {e.visibilidade === "google" ? <Cloud size={14} aria-label="Google Calendar" /> : <Lock size={13} aria-label="Só no Ecos" />}
          </div>
        </button>
      </li>
    );
  };

  const linhaTarefa = (t: TarefaResumo, i: number) => {
    const hora = t.scheduled_at ? new Date(t.scheduled_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "sem horário";
    return (
      <li key={t.id} style={{ ["--i" as string]: i }} className="ecos-cascata">
        <button type="button" onClick={(e) => abrirDocumento(`/tarefa/${t.id}`, e)} className={`flex w-full items-center gap-3 rounded-2xl border-l-4 bg-surface-1 p-3.5 text-left transition-all duration-200 hover:-translate-y-0.5 hover:bg-surface-2 hover:shadow-nav active:scale-[0.99] ${t.prioridade === "alta" ? "border-error" : "border-cyan"}`}>
          <ListChecks size={18} strokeWidth={1.75} className="shrink-0 text-cyan" />
          <div className="min-w-0 flex-1"><p className="truncate text-[15px] font-medium text-text-primary">{t.titulo}</p><p className="font-mono-value text-xs text-text-muted">{hora}{t.duration_min ? ` · ${formatDuracao(t.duration_min)}` : ""}</p></div>
        </button>
      </li>
    );
  };

  const corpo = (() => {
    if (aba === "eventos") return eventos.length ? <ul className="flex flex-col gap-2.5">{eventos.map(linhaEvento)}</ul> : <Vazio icone={<CalendarDays size={32} />} texto="Nenhum evento neste dia." />;
    if (aba === "lancamentos") return lancamentos.length ? (
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-3 gap-3">
          <Cartao i={0} icone={<Wallet size={14} />} rotulo="Entradas" tom="text-success"><span className="fonte-cofre">{moeda(entradas)}</span></Cartao>
          <Cartao i={1} icone={<Wallet size={14} />} rotulo="Saídas" tom="text-error"><span className="fonte-cofre">{moeda(saidas)}</span></Cartao>
          <Cartao i={2} icone={<Wallet size={14} />} rotulo="Saldo" tom={saldo < 0 ? "text-error" : "text-success"}><span className="fonte-cofre">{moeda(saldoAnimado)}</span></Cartao>
        </div>
        <ul className="flex flex-col gap-2.5">{lancamentos.map((l, i) => linhaEvento(l, i + 3))}</ul>
      </div>
    ) : <Vazio icone={<Wallet size={32} />} texto="Nenhum lançamento neste dia." />;
    if (aba === "tarefas") return (
      <div className="flex flex-col gap-5">
        {tarefas.length ? <ul className="flex flex-col gap-2.5">{tarefas.map(linhaTarefa)}</ul> : <Vazio icone={<ListChecks size={32} />} texto="Nenhuma tarefa pendente neste dia." />}
        {concluidasDoDia.length > 0 && (
          <section aria-label="Concluídas neste dia" className="ecos-cascata" style={{ ["--i" as string]: tarefas.length + 1 }}>
            <button type="button" onClick={() => setConcluidasAbertas((v) => !v)} aria-expanded={concluidasAbertas} aria-controls="dia-concluidas" className="group flex w-full items-center gap-2 rounded-xl border border-success/25 bg-success/10 px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-success transition-all duration-200 hover:bg-success/15 active:scale-[0.99]">
              <CheckCircle2 size={14} aria-hidden className={`transition-transform duration-300 ${concluidasAbertas ? "scale-110 rotate-[360deg]" : "group-hover:scale-110"}`} />
              Concluídos · {concluidasDoDia.length}
              <ChevronDown size={14} aria-hidden className={`ml-auto transition-transform duration-300 ease-out ${concluidasAbertas ? "rotate-180" : ""}`} />
            </button>
            <div id="dia-concluidas" className="ecos-colapsa" data-aberto={concluidasAbertas} aria-hidden={!concluidasAbertas}>
              <div>
                <ul className="flex flex-col gap-1.5 pt-2">
                  {[...concluidasDoDia].sort((a, b) => (a.concluida_em ?? "").localeCompare(b.concluida_em ?? "")).map((t, i) => (
                    <li key={t.id} style={{ transitionDelay: concluidasAbertas ? `${i * 50 + 80}ms` : "0ms" }} className={`transition-all duration-300 ease-out ${concluidasAbertas ? "translate-y-0 opacity-100" : "-translate-y-2 opacity-0"}`}>
                      <button type="button" tabIndex={concluidasAbertas ? 0 : -1} onClick={(e) => abrirDocumento(`/tarefa/${t.id}`, e)} className="group flex w-full items-center gap-3 rounded-xl border-l-4 border-success/60 bg-surface-1 px-3.5 py-2.5 text-left transition-all duration-200 hover:translate-x-0.5 hover:bg-surface-2 active:scale-[0.99]">
                        <CheckCircle2 size={17} strokeWidth={2} className="shrink-0 text-success transition-transform duration-300 group-hover:scale-125" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm text-text-muted line-through decoration-success/60">{t.titulo}</span>
                          <span className="font-mono-value text-[11px] text-text-muted/80">{t.concluida_em ? `concluída às ${new Date(t.concluida_em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` : "concluída"}{t.duration_min ? ` · ${formatDuracao(t.duration_min)}` : ""}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </section>
        )}
      </div>
    );
    if (aba === "tempo") {
      if (!capacidade) return <Vazio icone={<Hourglass size={32} />} texto={semRotina ? "Conte sua rotina para ver o tempo disponível." : "Sem dados de tempo para este dia."} />;
      const total = Math.max(1, capacidade.total_dia_min ?? 1440);
      const fatias = [
        { rotulo: "Rotina", min: capacidade.consumido_rotina_min ?? 0, cor: "bg-steel-500" },
        { rotulo: "Eventos", min: capacidade.consumido_eventos_externos_min, cor: "bg-violet" },
        { rotulo: "Tarefas", min: capacidade.consumido_tarefas_min, cor: "bg-cyan" },
        { rotulo: "Livre", min: capacidade.tempo_livre_min ?? capacidade.disponivel_producao_min, cor: "bg-success" },
      ];
      return (
        <div className="flex flex-col gap-5">
          {semRotina && <button type="button" onClick={onAjustarRotina} className="rounded-xl border border-steel-400/40 bg-steel-700/15 p-3 text-left text-sm text-text-primary transition-colors hover:bg-steel-700/25">Você ainda não contou sobre a sua rotina. <span className="font-semibold text-steel-300">Ajustar rotina</span></button>}
          {capacidade.estourado && <p className="rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm text-text-primary">As tarefas somam {formatDuracao(capacidade.consumido_tarefas_min)}, mais do que o dia comporta de produção.</p>}
          <div className="ecos-cascata overflow-hidden rounded-2xl border border-border bg-surface-1 p-4" style={{ ["--i" as string]: 0 }}>
            <p className="mb-3 text-xs font-medium uppercase tracking-wide text-text-muted">Como o dia se divide · {formatDuracao(total)}</p>
            <div className="flex h-3 overflow-hidden rounded-full bg-surface-3">
              {fatias.map((f) => <div key={f.rotulo} title={`${f.rotulo}: ${formatDuracao(f.min)}`} className={`${f.cor} h-full transition-[width] duration-700 ease-out`} style={{ width: montado ? `${(f.min / total) * 100}%` : "0%" }} />)}
            </div>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2">
            {fatias.map((f, i) => (
              <li key={f.rotulo} style={{ ["--i" as string]: i + 1 }} className="ecos-cascata rounded-2xl border border-border bg-surface-1 p-4">
                <div className="mb-2 flex items-baseline justify-between"><span className="flex items-center gap-2 text-sm text-text-primary"><i className={`h-2.5 w-2.5 rounded-full ${f.cor}`} />{f.rotulo}</span><span className="font-mono-value text-sm text-text-secondary">{formatDuracao(f.min)}</span></div>
                <Barra pct={(f.min / total) * 100} cor={f.cor} montado={montado} />
              </li>
            ))}
          </ul>
        </div>
      );
    }
    // Resumo
    return (
      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Cartao i={0} icone={<CalendarDays size={14} />} rotulo="Eventos" detalhe={proximos[0] ? `Próximo às ${hhmm(proximos[0].minutos as number)}` : "Sem horário marcado"}>{eventos.length}</Cartao>
          <Cartao i={1} icone={<ListChecks size={14} />} rotulo="Tarefas" detalhe={concluidasDoDia.length ? `${concluidasDoDia.length} concluída${concluidasDoDia.length === 1 ? "" : "s"} · ver` : "Nenhuma concluída"} aoClicar={concluidasDoDia.length ? () => { setConcluidasAbertas(true); setAba("tarefas"); } : undefined}>{tarefas.length}</Cartao>
          <Cartao i={2} icone={<Wallet size={14} />} rotulo="Lançamentos" detalhe={`${lancamentos.length} no dia`} tom={saldo < 0 ? "text-error" : saldo > 0 ? "text-success" : "text-text-primary"}><span className="fonte-cofre">{moeda(saldoAnimado)}</span></Cartao>
          <Cartao i={3} icone={<Clock size={14} />} rotulo="Tempo livre" detalhe={livre !== null ? "para produzir" : "sem rotina"}>{capacidade ? formatDuracao(Math.max(0, capacidade.tempo_livre_min ?? capacidade.disponivel_producao_min)) : "—"}</Cartao>
        </div>
        {capacidade && (
          <div style={{ ["--i" as string]: 4 }} className="ecos-cascata rounded-2xl border border-border bg-surface-1 p-4">
            <div className="mb-2 flex items-baseline justify-between text-xs text-text-muted"><span className="font-medium uppercase tracking-wide">Carga do dia</span><span className="font-mono-value">{formatDuracao(capacidade.consumido_tarefas_min)} de {formatDuracao(Math.max(0, livre ?? 0) + capacidade.consumido_tarefas_min)}</span></div>
            <Barra pct={capacidade.estourado ? 100 : (capacidade.consumido_tarefas_min / Math.max(1, (livre ?? 0) + capacidade.consumido_tarefas_min)) * 100} cor={capacidade.estourado ? "bg-error" : "bg-cyan"} montado={montado} />
          </div>
        )}
        <div className="grid gap-5 lg:grid-cols-2">
          <section aria-label="Eventos do dia"><h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-text-muted">Eventos</h3>{eventos.length ? <ul className="flex flex-col gap-2.5">{eventos.slice(0, 4).map((e, i) => linhaEvento(e, i + 5))}</ul> : <p className="text-sm text-text-muted">Nada marcado.</p>}</section>
          <section aria-label="Tarefas do dia"><h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-text-muted">Tarefas</h3>{tarefas.length ? <ul className="flex flex-col gap-2.5">{tarefas.slice(0, 4).map((t, i) => linhaTarefa(t, i + 5))}</ul> : <p className="text-sm text-text-muted">Nada pendente.</p>}</section>
        </div>
      </div>
    );
  })();

  return createPortal(
    <div className={`fixed inset-0 z-[45] flex items-center justify-center p-4 ${saindo ? "opacity-0 transition-opacity duration-150" : "ecos-backdrop-in"}`} style={{ backgroundColor: "rgb(0 0 0 / 0.55)", backdropFilter: "blur(4px)" }} onMouseDown={(e) => { if (e.target === e.currentTarget) fechar(); }}>
      <section role="dialog" aria-modal="true" aria-label={`Hoje, ${titulo}`} className={`flex h-[min(86vh,820px)] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-border bg-base shadow-nav ${saindo ? "scale-95 opacity-0 transition-all duration-150" : "ecos-modal-in"}`}>
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-border bg-surface-1 px-5 pt-4">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-medium uppercase tracking-wide text-text-muted">{hoje ? "Hoje" : "Agenda"}</p>
            <h2 className="truncate font-display text-xl capitalize text-text-primary">{titulo}</h2>
            <div ref={abasRef} role="tablist" aria-label="Seções do dia" className="relative mt-3 flex gap-1 overflow-x-auto">
              {abas.map((a) => (
                <button key={a.id} data-aba={a.id} role="tab" type="button" aria-selected={aba === a.id} onClick={() => setAba(a.id)} className={`flex shrink-0 items-center gap-1.5 rounded-t-lg px-3.5 py-2.5 text-sm transition-colors duration-200 ${aba === a.id ? "text-text-primary" : "text-text-muted hover:bg-surface-2 hover:text-text-secondary"}`}>
                  <span className={`transition-transform duration-300 ${aba === a.id ? "scale-110" : ""}`}>{a.icone}</span>{a.rotulo}
                  {a.n !== undefined && a.n > 0 && <span className="rounded-pill bg-surface-3 px-1.5 text-[11px] tabular-nums text-text-secondary">{a.n}</span>}
                </button>
              ))}
              {indicador && <span aria-hidden className="pointer-events-none absolute bottom-0 h-0.5 rounded-full bg-steel-400 transition-[left,width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]" style={{ left: indicador.left, width: indicador.width }} />}
            </div>
          </div>
          <button type="button" onClick={fechar} aria-label="Fechar" title="Fechar (Esc)" className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-text-muted transition-all hover:rotate-90 hover:bg-surface-2 hover:text-text-primary"><X size={18} /></button>
        </header>
        <div key={aba} role="tabpanel" className="ecos-fade-in min-h-0 flex-1 overflow-y-auto p-5">{corpo}</div>
      </section>
    </div>,
    document.body,
  );
}
