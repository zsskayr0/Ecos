import { useEffect, useRef, useState } from "react";
import { movimentoReduzido } from "@/lib/movimento";

const DURACAO_MS = 1100;
/** Sobe rápido no começo e assenta devagar no valor final, como um contador de saldo. */
const easeOutExpo = (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));

/**
 * Número que sobe (ou desce) como um só, do valor que estava até o novo: o número inteiro conta junto, com o mesmo formato
 * (milhares, vírgula) em todos os quadros. Na primeira exibição conta desde o zero. Trocar o valor no meio da contagem
 * parte do que está na tela. Com "Reduzir movimento" ligado, mostra o valor direto. O valor final fica no texto para
 * leitores de tela.
 */
export function NumeroAnimado({ valor, className = "", formatar = (n: number) => n.toLocaleString("pt-BR") }: { valor: number; className?: string; formatar?: (n: number) => string }) {
  const alvo = Number.isFinite(valor) ? valor : 0;
  const [exibido, setExibido] = useState(0);
  const atual = useRef(0);
  useEffect(() => {
    if (movimentoReduzido()) { atual.current = alvo; setExibido(alvo); return; }
    const origem = atual.current;
    const inicio = performance.now();
    let quadro = 0;
    function passo(agora: number) {
      const t = Math.min(1, (agora - inicio) / DURACAO_MS);
      atual.current = origem + (alvo - origem) * easeOutExpo(t);
      setExibido(t >= 1 ? alvo : Math.round(atual.current));
      if (t < 1) quadro = window.requestAnimationFrame(passo);
    }
    quadro = window.requestAnimationFrame(passo);
    return () => window.cancelAnimationFrame(quadro);
  }, [alvo]);
  return (
    <span className={`whitespace-pre tabular-nums ${className}`} style={{ fontVariantNumeric: "tabular-nums" }}>
      <span className="sr-only">{formatar(alvo)}</span>
      <span aria-hidden>{formatar(exibido)}</span>
    </span>
  );
}
