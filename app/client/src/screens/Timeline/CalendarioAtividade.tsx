import { ChevronLeft, ChevronRight } from "lucide-react";
import { dataLocalISO } from "@/lib/agenda-tempo";
import { cabecalhoDaSemana, deslocamentoDoMes } from "@/lib/formato-data";
import { nivelDeIntensidade } from "@/lib/timeline";

const NIVEIS = ["bg-surface-2/70", "bg-cyan/20", "bg-cyan/40", "bg-cyan/60", "bg-cyan/85"] as const;
const fmtMes = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" });

/**
 * Mês com a intensidade de cada dia (programado + feito), como um mapa de contribuições. Clicar leva ao dia na
 * Timeline. O mês inteiro é buscado ao trocar de mês (`intensidade` nula = ainda carregando).
 */
export function CalendarioAtividade({ hoje, mes, intensidade, onMudarMes, onIrPara }: {
  hoje: string; mes: string; intensidade: Map<string, number> | null; onMudarMes: (mes: string) => void; onIrPara: (dia: string) => void;
}) {
  const [ano, m] = mes.split("-").map(Number);
  const primeiro = new Date(ano, m - 1, 1, 12);
  const totalDias = new Date(ano, m, 0).getDate();
  const vazios = deslocamentoDoMes(primeiro);
  const dias = Array.from({ length: totalDias }, (_, i) => dataLocalISO(new Date(ano, m - 1, i + 1, 12)));
  const maximo = Math.max(0, ...dias.map((d) => intensidade?.get(d) ?? 0));
  const mover = (passo: number) => onMudarMes(dataLocalISO(new Date(ano, m - 1 + passo, 1, 12)).slice(0, 7));
  const extenso = fmtMes.format(primeiro);
  const titulo = extenso[0].toUpperCase() + extenso.slice(1);

  return <section aria-label="Calendário de atividade" className="ecos-timeline-item rounded-2xl border border-border bg-surface-1 p-4">
    <header className="mb-3 flex items-center gap-1">
      <h2 className="flex-1 text-sm font-medium text-text-primary">{titulo}</h2>
      <button type="button" aria-label="Mês anterior" onClick={() => mover(-1)} className="flex h-7 w-7 items-center justify-center rounded-lg text-text-muted hover:bg-surface-2 hover:text-text-primary"><ChevronLeft size={15} /></button>
      <button type="button" aria-label="Próximo mês" onClick={() => mover(1)} className="flex h-7 w-7 items-center justify-center rounded-lg text-text-muted hover:bg-surface-2 hover:text-text-primary"><ChevronRight size={15} /></button>
    </header>
    <div aria-busy={intensidade === null} className={`grid grid-cols-7 gap-1 text-center transition-opacity duration-300 ${intensidade === null ? "animate-pulse opacity-60" : ""}`}>
      {cabecalhoDaSemana().map((d, i) => <span key={i} aria-hidden className="pb-1 text-[10px] font-medium text-text-muted">{d}</span>)}
      {Array.from({ length: vazios }, (_, i) => <span key={`v${i}`} />)}
      {dias.map((dia) => {
        const qtd = intensidade?.get(dia);
        const nivel = nivelDeIntensidade(qtd ?? 0, maximo);
        const ehHoje = dia === hoje;
        return <button key={dia} type="button" onClick={() => onIrPara(dia)} aria-label={`${Number(dia.slice(8))} — ${qtd ?? 0} ${qtd === 1 ? "item" : "itens"}`} aria-current={ehHoje ? "date" : undefined}
          className={`flex aspect-square items-center justify-center rounded-md text-[11px] tabular-nums transition-[transform,background-color] duration-200 hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan/70 ${NIVEIS[nivel]} ${nivel >= 3 ? "font-medium text-surface-1" : "text-text-secondary"} ${ehHoje ? "ring-1 ring-cyan" : ""}`}>
          {Number(dia.slice(8))}
        </button>;
      })}
    </div>
    <div aria-hidden className="mt-3 flex items-center justify-end gap-1 text-[10px] text-text-muted">
      <span className="mr-1">menos</span>{NIVEIS.map((c) => <span key={c} className={`h-2.5 w-2.5 rounded-sm ${c}`} />)}<span className="ml-1">mais</span>
    </div>
  </section>;
}
