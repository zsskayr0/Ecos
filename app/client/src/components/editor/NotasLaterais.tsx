import { useEffect, useMemo, useRef, useState } from "react";
import { EVENTO_IR_NOTA, pedidoNota, bibliografiaFormatada, bibliotecaDoCorpo, chavesCitadas, extrairNotas } from "@/lib/notas-rodape";

/** Notas `[^n]` e bibliografia `[@chave]` da nota, no menu lateral (o corpo não ganha rodapé). */
export function NotasLaterais({ corpo, aoPedirAbrir }: { corpo: string; aoPedirAbrir?: () => void }) {
  const notas = useMemo(() => extrairNotas(corpo), [corpo]);
  const refs = useMemo(() => {
    const bib = new Map(bibliotecaDoCorpo(corpo).map((r) => [r.chave, r]));
    return chavesCitadas(corpo).map((chave) => ({ chave, r: bib.get(chave) }));
  }, [corpo]);
  const raiz = useRef<HTMLDivElement>(null);
  const [destaque, setDestaque] = useState<string | null>(null);

  useEffect(() => {
    const ir = (e: Event | null) => {
      const rotulo = e ? (e as CustomEvent<{ rotulo: string }>).detail.rotulo : pedidoNota!.rotulo;
      if (e) aoPedirAbrir?.();
      // Espera o painel abrir antes de rolar.
      requestAnimationFrame(() => {
        const el = raiz.current?.querySelector<HTMLElement>(`[data-item="${CSS.escape(rotulo)}"]`);
        el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
        setDestaque(rotulo);
        window.setTimeout(() => setDestaque((d) => (d === rotulo ? null : d)), 1600);
      });
    };
    if (pedidoNota && Date.now() - pedidoNota.em < 800) ir(null);
    window.addEventListener(EVENTO_IR_NOTA, ir);
    return () => window.removeEventListener(EVENTO_IR_NOTA, ir);
  }, [aoPedirAbrir]);

  if (!notas.length && !refs.length) return null;
  const item = (id: string) => `rounded-lg px-2 py-1 transition-colors ${destaque === id ? "bg-steel-500/25" : ""}`;
  return (
    <div ref={raiz} className="space-y-5">
      {notas.length > 0 && (
        <section aria-label="Notas" className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-text-muted">Notas</h2>
          <ol className="space-y-1 text-sm text-text-secondary">
            {notas.map((n) => (
              <li key={n.rotulo} data-item={n.rotulo} className={`flex gap-2 ${item(n.rotulo)}`}>
                <span className="shrink-0 font-semibold text-steel-300">{n.numero}</span>
                <span className="min-w-0 [overflow-wrap:anywhere]">{n.texto || <em className="text-text-muted">Sem texto — escreva [^{n.rotulo}]: …</em>}</span>
              </li>
            ))}
          </ol>
        </section>
      )}
      {refs.length > 0 && (
        <section aria-label="Referências" className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-text-muted">Referências</h2>
          <ul className="space-y-1 text-sm text-text-secondary">
            {refs.map(({ chave, r }) => (
              <li key={chave} data-item={`@${chave}`} className={`[overflow-wrap:anywhere] ${item(`@${chave}`)}`}>
                {r ? bibliografiaFormatada(r) : <span className="text-text-muted">@{chave} — não encontrada nos blocos bibtex</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
