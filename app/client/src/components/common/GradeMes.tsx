import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cabecalhoDaSemana, deslocamentoDoMes } from "@/lib/formato-data";

export const dataParaISO = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export function isoParaData(iso: string): Date {
  const [ano, mes, dia] = iso.split("-").map(Number);
  return new Date(ano, mes - 1, dia);
}

interface Props {
  /** Dia escolhido (`YYYY-MM-DD`) ou vazio. */
  valor: string;
  onSelecionar: (iso: string) => void;
  /** Classes do dia escolhido e do dia de hoje (cada contexto tem o seu acento). */
  classeSelecionado?: string;
  classeHoje?: string;
  /** Alvos de toque de 44px (celular). */
  grande?: boolean;
}

/**
 * Grade de um mês com navegação: a única do app, usada pelo `DatePicker` e pelo seletor de data e horário da tarefa.
 * Marca hoje e o dia escolhido. Teclado: setas andam pelos dias (atravessando o mês), PageUp/PageDown trocam o mês.
 */
export function GradeMes({ valor, onSelecionar, classeSelecionado = "bg-steel-500 font-semibold text-white", classeHoje = "border border-steel-400 text-text-primary", grande = false }: Props) {
  const [referencia, setReferencia] = useState(() => (valor ? isoParaData(valor) : new Date()));
  const grade = useRef<HTMLDivElement>(null);
  /** Dia que deve receber o foco depois do próximo desenho (navegação por teclado). */
  const focoPendente = useRef<string | null>(null);
  const ano = referencia.getFullYear();
  const mes = referencia.getMonth();
  const offset = deslocamentoDoMes(new Date(ano, mes, 1));
  const totalDias = new Date(ano, mes + 1, 0).getDate();
  const hoje = dataParaISO(new Date());
  const nomeCompleto = referencia.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  const nomeMes = nomeCompleto.charAt(0).toUpperCase() + nomeCompleto.slice(1);
  // Quem recebe o Tab: o dia escolhido, senão hoje, senão o dia 1 (só um dia fica na ordem de tabulação).
  const noMes = (iso: string) => !!iso && isoParaData(iso).getFullYear() === ano && isoParaData(iso).getMonth() === mes;
  const tabulavel = noMes(valor) ? valor : noMes(hoje) ? hoje : dataParaISO(new Date(ano, mes, 1));

  useEffect(() => {
    if (!focoPendente.current) return;
    grade.current?.querySelector<HTMLElement>(`[data-dia="${focoPendente.current}"]`)?.focus();
    focoPendente.current = null;
  });

  const trocarMes = (delta: number) => setReferencia((r) => new Date(r.getFullYear(), r.getMonth() + delta, 1));

  function aoTeclar(e: React.KeyboardEvent, iso: string) {
    const passo = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    const atual = isoParaData(iso);
    let alvo: Date | null = null;
    if (passo) alvo = new Date(atual.getFullYear(), atual.getMonth(), atual.getDate() + passo);
    else if (e.key === "PageUp" || e.key === "PageDown") {
      const delta = e.key === "PageUp" ? -1 : 1;
      const ultimo = new Date(atual.getFullYear(), atual.getMonth() + delta + 1, 0).getDate();
      alvo = new Date(atual.getFullYear(), atual.getMonth() + delta, Math.min(atual.getDate(), ultimo));
    }
    if (!alvo) return;
    e.preventDefault();
    focoPendente.current = dataParaISO(alvo);
    setReferencia(new Date(alvo.getFullYear(), alvo.getMonth(), 1));
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <button type="button" onClick={() => trocarMes(-1)} aria-label="Mês anterior" className={`flex ${grande ? "h-11 w-11" : "h-8 w-8"} items-center justify-center rounded-lg text-text-secondary hover:bg-surface-2 hover:text-text-primary`}>
          <ChevronLeft size={grande ? 20 : 16} />
        </button>
        <p aria-live="polite" className={`${grande ? "text-base" : "text-sm"} font-semibold text-text-primary`}>{nomeMes}</p>
        <button type="button" onClick={() => trocarMes(1)} aria-label="Próximo mês" className={`flex ${grande ? "h-11 w-11" : "h-8 w-8"} items-center justify-center rounded-lg text-text-secondary hover:bg-surface-2 hover:text-text-primary`}>
          <ChevronRight size={grande ? 20 : 16} />
        </button>
      </div>
      <div ref={grade} className="grid grid-cols-7 gap-y-0.5">
        {cabecalhoDaSemana().map((d, i) => (
          <div key={i} aria-hidden className={`pb-1 text-center ${grande ? "text-xs" : "text-[11px]"} font-medium text-text-muted`}>{d}</div>
        ))}
        {Array.from({ length: offset }).map((_, i) => <div key={`vazio-${i}`} />)}
        {Array.from({ length: totalDias }, (_, i) => i + 1).map((dia) => {
          const iso = dataParaISO(new Date(ano, mes, dia));
          const escolhido = valor === iso;
          const ehHoje = iso === hoje;
          return (
            <button
              key={dia}
              type="button"
              data-dia={iso}
              tabIndex={iso === tabulavel ? 0 : -1}
              aria-pressed={escolhido}
              aria-current={ehHoje ? "date" : undefined}
              onClick={() => onSelecionar(iso)}
              onKeyDown={(e) => aoTeclar(e, iso)}
              className={`mx-auto flex ${grande ? "h-11 w-11 text-sm" : "h-8 w-8 text-xs"} items-center justify-center rounded-full transition-colors ${
                escolhido ? classeSelecionado : ehHoje ? classeHoje : "text-text-secondary hover:bg-surface-2 hover:text-text-primary"
              }`}
            >
              {dia}
            </button>
          );
        })}
      </div>
    </div>
  );
}
