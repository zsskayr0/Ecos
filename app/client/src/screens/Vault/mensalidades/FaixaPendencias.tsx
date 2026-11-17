import { ArrowRight, TriangleAlert } from "lucide-react";
import { formatMoeda } from "@/lib/format";
import "./mensalidades.css";

/** Faixa do Painel do Cofre: reajustes de mensalidade esperando decisão, com a perda estimada, e o caminho até a seção. */
export function FaixaPendencias({ resumo, onAbrir }: { resumo: { ciclos: number; perdaCentavos: number; atrasados: number }; onAbrir: () => void }) {
  if (resumo.ciclos <= 0) return null;
  return (
    <div role="status" className="mens-faixa" data-tom={resumo.atrasados > 0 ? "atrasado" : "avisar"}>
      <TriangleAlert size={18} aria-hidden />
      <p>
        <b>{resumo.ciclos === 1 ? "1 reajuste de mensalidade esperando sua decisão" : `${resumo.ciclos} reajustes de mensalidade esperando sua decisão`}</b>
        {resumo.atrasados > 0
          ? <span>{resumo.atrasados === 1 ? "1 aviso já passou do prazo." : `${resumo.atrasados} avisos já passaram do prazo.`}{resumo.perdaCentavos > 0 && <> Perda estimada se avisar hoje: <strong className="cofre-mono">{formatMoeda(resumo.perdaCentavos)}</strong>.</>}</span>
          : <span>Avise os residentes dentro do prazo para o novo valor valer no aniversário.</span>}
      </p>
      <button type="button" className="cofre-solid" onClick={onAbrir}>Ver mensalidades<ArrowRight size={14} aria-hidden /></button>
    </div>
  );
}
