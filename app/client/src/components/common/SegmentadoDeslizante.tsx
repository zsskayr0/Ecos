import { useRef, type KeyboardEvent } from "react";

/**
 * Segmentado com o realce que desliza entre as opções (o mesmo movimento do seletor de tema). As células têm largura igual,
 * então o realce anda em múltiplos exatos da própria largura, sem ultrapassar as bordas. Setas movem a escolha.
 * `variante="numerico"` usa a fonte de valores (percentuais); `"texto"` é a versão maior, para rótulos como "30 dias".
 */
export function SegmentadoDeslizante<T extends string | number>({ valor, opcoes, onChange, label, rotuloDe, variante = "numerico" }: { valor: T; opcoes: readonly T[]; onChange: (v: T) => void; label: string; rotuloDe?: (v: T) => string; variante?: "numerico" | "texto" }) {
  const indice = Math.max(0, opcoes.indexOf(valor));
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const texto = variante === "texto";
  function aoTeclar(e: KeyboardEvent<HTMLDivElement>) {
    const passo = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!passo) return;
    e.preventDefault();
    const proximo = (indice + passo + opcoes.length) % opcoes.length;
    onChange(opcoes[proximo]);
    refs.current[proximo]?.focus();
  }
  return (
    <div role="radiogroup" aria-label={label} onKeyDown={aoTeclar} className={`relative grid shrink-0 overflow-hidden border border-border bg-surface-2 p-1 ${texto ? "rounded-xl" : "rounded-lg"}`} style={{ gridTemplateColumns: `repeat(${opcoes.length}, minmax(${texto ? "4.75rem" : "3.25rem"}, 1fr))` }}>
      <span aria-hidden className={`absolute inset-y-1 left-1 border border-border bg-surface-3 shadow-sm transition-transform duration-500 ease-[cubic-bezier(.22,1,.36,1)] ${texto ? "rounded-lg" : "rounded-md"}`} style={{ width: `calc((100% - 0.5rem) / ${opcoes.length})`, transform: `translateX(${indice * 100}%)` }} />
      {opcoes.map((o, i) => (
        <button key={String(o)} ref={(el) => { refs.current[i] = el; }} type="button" role="radio" aria-checked={o === valor} tabIndex={o === valor ? 0 : -1} onClick={() => onChange(o)}
          className={`relative z-10 flex items-center justify-center whitespace-nowrap font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-steel-400 ${texto ? "h-9 rounded-lg px-3 text-sm" : "h-8 rounded-md px-2.5 font-mono-value text-xs"} ${o === valor ? "text-text-primary" : "text-text-muted hover:text-text-secondary"}`}>
          {rotuloDe ? rotuloDe(o) : String(o)}
        </button>
      ))}
    </div>
  );
}
