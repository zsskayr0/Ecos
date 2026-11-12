import { useEffect, useState, type ReactNode } from "react";

/**
 * Recolhe/expande o conteúdo animando a largura (barra horizontal) ou a altura (barra na lateral),
 * em vez de sumir e aparecer: o conteúdo desliza para dentro do ponto de onde sai. Fechado, fica inerte.
 */
export function Colapso({ aberto, vertical, children, duracao = 320 }: { aberto: boolean; vertical: boolean; children: ReactNode; duracao?: number }) {
  // Só recorta durante a animação; assentado e aberto, deixa as abas do seletor transbordarem.
  const [assentado, setAssentado] = useState(aberto);
  useEffect(() => {
    setAssentado(false);
    const t = window.setTimeout(() => setAssentado(true), duracao + 40);
    return () => window.clearTimeout(t);
  }, [aberto, duracao]);
  const eixo = vertical ? "gridTemplateRows" : "gridTemplateColumns";
  const tempo = `${duracao}ms cubic-bezier(0.2, 0.9, 0.25, 1)`;
  return (
    <div aria-hidden={!aberto || undefined} className="grid min-h-0 min-w-0 motion-reduce:!transition-none"
      style={{ [eixo]: aberto ? "1fr" : "0fr", opacity: aberto ? 1 : 0, transition: `${vertical ? "grid-template-rows" : "grid-template-columns"} ${tempo}, opacity ${duracao * 0.7}ms ease` }}>
      <div className={`min-h-0 min-w-0 ${aberto && assentado ? "" : "overflow-hidden"}`} {...(aberto ? {} : ({ inert: "" } as object))}>{children}</div>
    </div>
  );
}
