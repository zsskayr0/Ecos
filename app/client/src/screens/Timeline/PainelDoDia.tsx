import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, CalendarDays, FilePen, FilePlus2, type LucideIcon } from "lucide-react";
import { rotina as rotinaApi, tarefas } from "@/lib/api";
import { formatMoeda } from "@/lib/format";
import type { ResumoDia } from "@/lib/timeline";

type Capacidade = Awaited<ReturnType<typeof tarefas.capacidade>>;

const fmtDuracao = (min: number) => (min >= 60 ? `${Math.floor(min / 60)}h${min % 60 ? ` ${min % 60}min` : ""}` : `${min}min`);
const fmtHoje = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "numeric", month: "long" });

/** Capacidade de hoje e se a pessoa tem rotina. Os dois são complemento: falhar só esconde a parte do tempo. */
function useCapacidadeDeHoje(hoje: string, versao: number) {
  const [capacidade, setCapacidade] = useState<Capacidade | null>(null);
  const [temRotina, setTemRotina] = useState<boolean | null>(null);
  useEffect(() => {
    let ativo = true;
    tarefas.capacidade(hoje, -new Date().getTimezoneOffset()).then((c) => { if (ativo) setCapacidade(c); }).catch(() => { if (ativo) setCapacidade(null); });
    rotinaApi.listar().then((b) => { if (ativo) setTemRotina(b.length > 0); }).catch(() => { if (ativo) setTemRotina(null); });
    return () => { ativo = false; };
  }, [hoje, versao]);
  return { capacidade, temRotina };
}

/** Anel de progresso com preenchimento animado. */
function Anel({ fracao, children }: { fracao: number; children: ReactNode }) {
  const raio = 30;
  const circ = 2 * Math.PI * raio;
  const f = Math.min(1, Math.max(0, fracao));
  return <div className="relative h-[76px] w-[76px] shrink-0">
    <svg viewBox="0 0 76 76" className="h-full w-full -rotate-90" aria-hidden>
      <circle cx="38" cy="38" r={raio} fill="none" strokeWidth="6" className="stroke-surface-2" />
      <circle cx="38" cy="38" r={raio} fill="none" strokeWidth="6" strokeLinecap="round" className="stroke-cyan transition-[stroke-dashoffset] duration-1000 ease-[cubic-bezier(.22,1,.36,1)]" strokeDasharray={circ} strokeDashoffset={circ * (1 - f)} />
    </svg>
    <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>
  </div>;
}

function Linha({ icone: I, rotulo, valor, tom = "neutro" }: { icone: LucideIcon; rotulo: string; valor: ReactNode; tom?: "neutro" | "alerta" | "entrada" | "saida" }) {
  const cor = { neutro: "text-text-secondary", alerta: "text-error", entrada: "text-success", saida: "text-error" }[tom];
  return <li className="flex items-center gap-2.5 py-1.5 text-sm">
    <I size={15} aria-hidden className={`shrink-0 ${tom === "neutro" ? "text-text-muted" : cor}`} />
    <span className={`flex-1 ${tom === "alerta" ? "text-error" : "text-text-secondary"}`}>{rotulo}</span>
    <span className={`font-mono-value tabular-nums ${tom === "neutro" ? "text-text-primary" : cor}`}>{valor}</span>
  </li>;
}

/**
 * Painel ao lado da Timeline: como está hoje. O anel mostra as tarefas concluídas; a frase, o tempo livre e os
 * atrasos; abaixo, só o que aconteceu de fato (métricas zeradas não aparecem).
 */
export function PainelDoDia({ hoje, versao, resumo }: { hoje: string; versao: number; resumo: ResumoDia }) {
  const navigate = useNavigate();
  const { capacidade, temRotina } = useCapacidadeDeHoje(hoje, versao);
  const livre = capacidade ? Math.max(0, capacidade.disponivel_producao_total_min ?? capacidade.disponivel_producao_min) : null;
  const total = Math.max(resumo.programadas, resumo.concluidas);
  const extenso = fmtHoje.format(new Date(`${hoje}T12:00:00`));
  const titulo = extenso[0].toUpperCase() + extenso.slice(1);

  const frase = [
    livre !== null && (capacidade?.estourado ? "Acima da capacidade" : `${fmtDuracao(livre)} livres`),
    resumo.atrasadas > 0 && `${resumo.atrasadas} atrasada${resumo.atrasadas === 1 ? "" : "s"}`,
  ].filter(Boolean).join(" · ");

  const linhas: ReactNode[] = [];
  if (resumo.atrasadas > 0) linhas.push(<Linha key="atr" icone={AlertTriangle} rotulo="Atrasadas" valor={resumo.atrasadas} tom="alerta" />);
  if (resumo.eventos > 0) linhas.push(<Linha key="ev" icone={CalendarDays} rotulo="Eventos" valor={resumo.eventos} />);
  if (resumo.notasCriadas > 0) linhas.push(<Linha key="nc" icone={FilePlus2} rotulo="Notas criadas" valor={resumo.notasCriadas} />);
  if (resumo.notasEditadas > 0) linhas.push(<Linha key="ne" icone={FilePen} rotulo="Notas editadas" valor={resumo.notasEditadas} />);
  if (resumo.entradasCentavos > 0) linhas.push(<Linha key="en" icone={ArrowDownLeft} rotulo="Entradas" valor={`+${formatMoeda(resumo.entradasCentavos)}`} tom="entrada" />);
  if (resumo.saidasCentavos > 0) linhas.push(<Linha key="sa" icone={ArrowUpRight} rotulo="Saídas" valor={`−${formatMoeda(resumo.saidasCentavos)}`} tom="saida" />);

  return <aside aria-label="Resumo de hoje" className="ecos-timeline-item overflow-hidden rounded-2xl border border-border bg-surface-1">
    <div className="flex items-center gap-4 p-4">
      <Anel fracao={total ? resumo.concluidas / total : 0}>
        <span className="font-display text-xl leading-none text-text-primary tabular-nums">{resumo.concluidas}</span>
        <span className="mt-0.5 text-[10px] text-text-muted">de {total}</span>
      </Anel>
      <div className="min-w-0">
        <p className="text-sm font-medium text-text-primary">{titulo}</p>
        <p className="mt-0.5 text-xs text-text-muted">{total === 0 ? "Nenhuma tarefa marcada" : `${resumo.concluidas} de ${total} tarefa${total === 1 ? "" : "s"} concluída${resumo.concluidas === 1 ? "" : "s"}`}</p>
        {frase && <p className={`mt-1.5 text-xs ${capacidade?.estourado || resumo.atrasadas > 0 ? "text-error/90" : "text-text-secondary"}`}>{frase}</p>}
      </div>
    </div>

    {capacidade && livre !== null && <div className="px-4 pb-3">
      <div className="h-1 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-label="Tempo planejado sobre a capacidade" aria-valuemin={0} aria-valuemax={100}
        aria-valuenow={Math.round(Math.min(1, capacidade.consumido_tarefas_min / Math.max(1, capacidade.consumido_tarefas_min + livre)) * 100)}>
        <div className={`h-full rounded-full transition-[width] duration-1000 ease-[cubic-bezier(.22,1,.36,1)] ${capacidade.estourado ? "bg-error" : "bg-cyan/70"}`} style={{ width: `${Math.min(1, capacidade.consumido_tarefas_min / Math.max(1, capacidade.consumido_tarefas_min + livre)) * 100}%` }} />
      </div>
      {capacidade.consumido_tarefas_min > 0 && <p className="mt-1.5 text-[11px] text-text-muted">{fmtDuracao(capacidade.consumido_tarefas_min)} planejados em tarefas</p>}
    </div>}
    {temRotina === false && <button type="button" onClick={() => navigate("/perfil/rotina")} className="mx-4 mb-3 text-xs text-steel-300 hover:underline">Configurar rotina para ver o tempo livre</button>}

    {linhas.length > 0 && <ul className="border-t border-border px-4 py-1.5">{linhas}</ul>}
  </aside>;
}
