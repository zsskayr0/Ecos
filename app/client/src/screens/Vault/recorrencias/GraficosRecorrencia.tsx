import { formatMoeda } from "@/lib/format";
import type { TotalDoBalde } from "./ocorrencias";

const dataBR = (iso: string) => iso.split("-").reverse().join("/");

/** Cada dia (ou mês) vira uma célula; quanto mais despesa prevista, mais forte a cor. */
export function MapaDeIntensidade({ totais, colunas }: { totais: TotalDoBalde[]; colunas?: number }) {
  const maior = Math.max(0, ...totais.map((t) => t.saidas));
  const topo = totais.find((t) => t.saidas === maior && maior > 0);
  const resumo = topo ? `Maior despesa prevista: ${formatMoeda(topo.saidas)} em ${dataBR(topo.de)}.` : "Nenhuma despesa prevista no período.";
  return (
    <div className="cofre-rec-heat" role="img" aria-label={`Intensidade de despesas recorrentes. ${resumo}`}
      style={colunas ? { gridTemplateColumns: `repeat(${colunas}, minmax(0, 1fr))` } : { gridAutoFlow: "column", gridAutoColumns: "minmax(26px, 1fr)" }}>
      {totais.map((t) => {
        const forca = maior > 0 && t.saidas > 0 ? 0.18 + 0.82 * Math.pow(t.saidas / maior, 0.65) : 0;
        return (
          <span key={t.de} className="cofre-rec-heat-cell" data-vazio={forca === 0 || undefined}
            title={t.saidas > 0 ? `${dataBR(t.de)} · ${formatMoeda(t.saidas)}` : `${dataBR(t.de)} · sem despesas`}
            style={forca > 0 ? { background: `color-mix(in srgb, var(--cofre-expense) ${Math.round(forca * 100)}%, var(--panel-elevated))` } : undefined}>
            {!colunas && <small>{t.rotulo}</small>}
          </span>
        );
      })}
    </div>
  );
}

/** Receitas e despesas previstas em cada dia (ou mês) do período. */
export function BarrasPorPeriodo({ totais }: { totais: TotalDoBalde[] }) {
  const maior = Math.max(1, ...totais.flatMap((t) => [t.entradas, t.saidas]));
  const passo = totais.length > 16 ? 4 : 1;
  const altura = (v: number) => (v > 0 ? `${Math.max(4, (v / maior) * 100)}%` : "0%");
  const entradas = totais.reduce((s, t) => s + t.entradas, 0);
  const saidas = totais.reduce((s, t) => s + t.saidas, 0);
  return (
    <div className="cofre-rec-bars" role="img" aria-label={`Por período: receitas ${formatMoeda(entradas)} e despesas ${formatMoeda(saidas)}.`}>
      {totais.map((t, i) => (
        <div key={t.de} className="cofre-rec-bars-grupo" title={`${dataBR(t.de)} · receitas ${formatMoeda(t.entradas)} · despesas ${formatMoeda(t.saidas)}`}>
          <div className="cofre-rec-bars-colunas">
            <i data-tipo="entrada" style={{ height: altura(t.entradas) }} />
            <i data-tipo="saida" style={{ height: altura(t.saidas) }} />
          </div>
          <small aria-hidden="true">{i % passo === 0 ? t.rotulo : ""}</small>
        </div>
      ))}
    </div>
  );
}
