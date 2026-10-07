import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import { formatMoeda } from "@/lib/format";

/**
 * Faixa do Modo Slide: setas para andar pelos lançamentos da lista (na ordem e com os filtros da tela de Transações),
 * contador com barra de progresso e, quando há alterações não salvas, a pergunta do que fazer antes de seguir.
 */
export function BarraSlide({ posicao, total, onAnterior, onProximo, sujo, salvoTick, pendente, onSalvarEIr, onDescartarEIr, onFicar, salvando, batida, faltaPagar }: {
  /** Soma das despesas previstas da lista (centavos); aparece no lugar da dica de teclado. */
  faltaPagar: number;
  /** Posição (1 a `total`) do lançamento aberto na lista; `null` quando ele não está na lista atual. */
  posicao: number | null;
  total: number;
  onAnterior: () => void;
  onProximo: () => void;
  sujo: boolean;
  /** Muda a cada gravação: reinicia a animação de "Salvo". */
  salvoTick: number;
  /** Direção que a pessoa tentou seguir com alterações não salvas. */
  pendente: 1 | -1 | null;
  onSalvarEIr: () => void;
  onDescartarEIr: () => void;
  onFicar: () => void;
  salvando: boolean;
  /** Muda quando se tenta passar do fim/início: a seta sacode. */
  batida: { tick: number; dir: 1 | -1 } | null;
}) {
  const naLista = posicao !== null;
  const tem = naLista && total > 0;
  const progresso = tem ? (posicao! / total) * 100 : 0;
  return <div className="cofre-slide-bar" role="group" aria-label="Modo Slide" data-modo-slide-barra>
    <div className="cofre-slide-bar-miolo">
      <button type="button" key={`a${batida?.dir === -1 ? batida.tick : 0}`} className="cofre-slide-seta" data-batida={batida?.dir === -1 || undefined} aria-label="Lançamento anterior" title="Anterior (←)" disabled={!tem || posicao === 1} onClick={onAnterior}><ChevronLeft size={18} /></button>
      <div className="cofre-slide-centro" aria-live="polite">
        {pendente ? <div className="cofre-slide-pergunta" role="alert">
          <span>Há alterações não salvas.</span>
          <div>
            <button type="button" className="primario" disabled={salvando} onClick={onSalvarEIr}>Salvar e {pendente === 1 ? "avançar" : "voltar"}</button>
            <button type="button" onClick={onDescartarEIr}>Descartar</button>
            <button type="button" onClick={onFicar}>Ficar</button>
          </div>
        </div> : <>
          <div className="cofre-slide-contador">
            {tem ? <><b key={posicao} className="cofre-slide-numero">{posicao}</b><span>de {total}</span></> : <span className="cofre-slide-fora">Fora da lista atual</span>}
          </div>
          <div className="cofre-slide-trilha" aria-hidden><i style={{ width: `${progresso}%` }} /></div>
          <small className="cofre-slide-estado" data-sujo={sujo || undefined}>
            {sujo ? "Alterações não salvas" : salvoTick > 0 ? <span key={salvoTick} className="cofre-slide-salvo"><Check size={11} />Salvo</span> : faltaPagar > 0 ? <span className="cofre-slide-falta" title="Despesas previstas da lista atual">Falta pagar <b>{formatMoeda(faltaPagar)}</b></span> : "← → para navegar"}
          </small>
        </>}
      </div>
      <button type="button" key={`p${batida?.dir === 1 ? batida.tick : 0}`} className="cofre-slide-seta" data-batida={batida?.dir === 1 || undefined} aria-label="Próximo lançamento" title="Próximo (→)" disabled={!tem || posicao === total} onClick={onProximo}><ChevronRight size={18} /></button>
    </div>
  </div>;
}
