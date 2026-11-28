import { useEffect, useState } from "react";
import { Activity, CalendarDays, Check, ChevronLeft, ChevronRight, Flag, ListChecks, Receipt, Wallet, type LucideIcon } from "lucide-react";
import { deslocamentoDoMes, cabecalhoDaSemana } from "@/lib/formato-data";
import { TIPOS_AGENDA, type FiltrosAgenda, type TipoAgenda } from "@/lib/filtros-agenda";

/** Símbolo de cada calendário: é ele que aparece na lista; no hover vira a caixinha de marcar. */
const SIMBOLO: Record<TipoAgenda, LucideIcon> = { eventos: CalendarDays, tarefas: ListChecks, prazos: Flag, contas: Receipt, lancamentos: Wallet, atividade: Activity };

const paraISO = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const nomeMes = (d: Date) => { const n = d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }); return n.charAt(0).toUpperCase() + n.slice(1); };

export interface BarraLateralAgendaProps {
  /** Mês que o mini calendário abre: o da grade (é onde há dados para os pontinhos, hoje e o dia selecionado). */
  mesInicial: Date;
  hoje: string;
  diaFoco: string | null;
  /** Período que a grade grande mostra: vira uma faixa no mini calendário. */
  periodo?: { de: string; ate: string };
  /** Cores dos tipos que cada dia tem (só dos dias carregados). */
  marcas: Map<string, string[]>;
  onSelecionar: (dia: Date) => void;
  /** Avisa o mês que o mini calendário está mostrando (a Agenda carrega os pontinhos dele). */
  onMudarMes?: (mes: Date) => void;
  filtros: FiltrosAgenda;
  onAlternar: (tipo: TipoAgenda) => void;
}

/** Coluna fina da Agenda híbrida: o mês inteiro em miniatura (para navegar) e "Meus calendários" (legenda + filtro). */
export function BarraLateralAgenda({ mesInicial, hoje, diaFoco, periodo, marcas, onSelecionar, onMudarMes, filtros, onAlternar }: BarraLateralAgendaProps) {
  const [mes, setMes] = useState(() => new Date(mesInicial.getFullYear(), mesInicial.getMonth(), 1));
  const chaveInicial = `${mesInicial.getFullYear()}-${mesInicial.getMonth()}`;
  useEffect(() => { setMes(new Date(mesInicial.getFullYear(), mesInicial.getMonth(), 1)); }, [chaveInicial]);
  const chaveMes = `${mes.getFullYear()}-${mes.getMonth()}`;
  useEffect(() => { onMudarMes?.(mes); }, [chaveMes]);

  const offset = deslocamentoDoMes(mes);
  const total = new Date(mes.getFullYear(), mes.getMonth() + 1, 0).getDate();
  const celulas = Math.ceil((offset + total) / 7) * 7;
  const mudar = (d: number) => setMes((m) => new Date(m.getFullYear(), m.getMonth() + d, 1));

  return <aside aria-label="Calendários" className="flex min-h-0 flex-col gap-5 overflow-y-auto pr-1">
    <section aria-label="Mini calendário">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="truncate whitespace-nowrap text-sm font-semibold text-text-primary">{nomeMes(mes)}</h2>
        <div className="flex">
          <button type="button" onClick={() => mudar(-1)} aria-label="Mês anterior" className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted hover:bg-surface-2 hover:text-text-primary"><ChevronLeft size={15} /></button>
          <button type="button" onClick={() => mudar(1)} aria-label="Próximo mês" className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted hover:bg-surface-2 hover:text-text-primary"><ChevronRight size={15} /></button>
        </div>
      </div>
      <div className="grid grid-cols-7 text-center">
        {cabecalhoDaSemana().map((l, i) => <span key={i} className="pb-1 text-[10px] font-medium uppercase text-text-muted">{l}</span>)}
        {Array.from({ length: celulas }, (_, i) => {
          const n = i - offset + 1;
          if (n < 1 || n > total) return <span key={i} />;
          const data = new Date(mes.getFullYear(), mes.getMonth(), n);
          const iso = paraISO(data);
          const ehHoje = iso === hoje;
          const foco = iso === diaFoco;
          const noPeriodo = !!periodo && iso >= periodo.de && iso <= periodo.ate && periodo.de !== periodo.ate;
          const cores = marcas.get(iso) ?? [];
          return <span key={i} className={`relative flex h-9 items-center justify-center ${noPeriodo ? "bg-cyan/10" : ""}`}>
            <button type="button" data-mini-dia={iso} onClick={() => onSelecionar(data)} aria-label={data.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })} aria-current={foco ? "date" : undefined}
              className={`flex h-7 w-7 items-center justify-center rounded-full text-[11px] tabular-nums transition-colors ${ehHoje ? "bg-steel-500 font-semibold text-white" : foco ? "font-semibold text-text-primary ring-2 ring-steel-400" : "text-text-secondary hover:bg-surface-2"}`}>{n}</button>
            {cores.length > 0 && <span aria-hidden data-marcas={cores.length} className="pointer-events-none absolute bottom-0 flex gap-[2px]">{cores.slice(0, 3).map((c, k) => <i key={k} className="h-[5px] w-[5px] rounded-full" style={{ backgroundColor: c }} />)}</span>}
          </span>;
        })}
      </div>
    </section>

    <section aria-label="Meus calendários">
      <h2 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-text-muted">Meus calendários</h2>
      <ul className="flex flex-col">
        {TIPOS_AGENDA.map(({ tipo, rotulo, cor }) => { const Simbolo = SIMBOLO[tipo]; return <li key={tipo}>
          <button type="button" role="checkbox" aria-checked={filtros[tipo]} onClick={() => onAlternar(tipo)}
            className="group/cal flex h-8 w-full items-center gap-2.5 rounded-lg px-1.5 text-left text-sm text-text-secondary transition-colors duration-200 hover:bg-surface-2 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan/60">
            <span aria-hidden className="relative h-4 w-4 shrink-0">
              {/* Em repouso: o símbolo do calendário, na cor dele (apagado quando desligado). */}
              <Simbolo size={16} strokeWidth={2} style={{ color: cor }}
                className={`absolute inset-0 transition-all duration-200 ease-out group-hover/cal:scale-50 group-hover/cal:opacity-0 group-focus-visible/cal:scale-50 group-focus-visible/cal:opacity-0 ${filtros[tipo] ? "opacity-100" : "opacity-35"}`} />
              {/* No hover: a caixinha do Ecos, que entra crescendo; o visto desenha quando está ligado. */}
              <span className="absolute inset-0 flex scale-50 items-center justify-center rounded-[5px] border-[1.5px] opacity-0 transition-all duration-200 ease-out group-hover/cal:scale-100 group-hover/cal:opacity-100 group-focus-visible/cal:scale-100 group-focus-visible/cal:opacity-100"
                style={filtros[tipo] ? { backgroundColor: cor, borderColor: cor } : { borderColor: cor }}>
                <Check size={11} strokeWidth={3.25} className={`text-base transition-all duration-200 ease-out ${filtros[tipo] ? "scale-100 opacity-100" : "scale-0 opacity-0"}`} />
              </span>
            </span>
            <span className={`transition-opacity duration-200 ${filtros[tipo] ? "" : "opacity-50 line-through decoration-text-muted/40"}`}>{rotulo}</span>
          </button>
        </li>; })}
      </ul>
    </section>
  </aside>;
}
