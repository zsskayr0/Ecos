import type { GrupoAtalhos } from "@/lib/atalhos";

/** Grupos de atalhos em cartões (Configurações › Atalhos de teclado e Central de ajuda). */
export function ListaAtalhos({ grupos, ancora }: { grupos: GrupoAtalhos[]; /** Âncora de busca das Configurações. */ ancora?: (acao: string) => string }) {
  return <>
    {grupos.map(({ titulo, onde, atalhos }) => (
      <section key={titulo} className="mt-6 first:mt-0">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">{titulo}{onde && <span className="ml-2 font-normal normal-case tracking-normal">{onde}</span>}</p>
        <div className="rounded-2xl border border-border bg-surface-1 p-2">
          {atalhos.map(({ teclas, acao }) => (
            <div key={`${teclas.join("+")}-${acao}`} data-config={ancora?.(acao)} className="flex min-h-11 items-center justify-between gap-4 rounded-lg px-3 py-2 hover:bg-surface-2">
              <span className="text-sm text-text-secondary">{acao}</span>
              <span className="flex shrink-0 items-center gap-1">{teclas.map((t, i) => <kbd key={i} className="rounded border border-border bg-surface-3 px-1.5 py-0.5 font-mono-value text-[11px] text-text-primary">{t}</kbd>)}</span>
            </div>
          ))}
        </div>
      </section>
    ))}
  </>;
}
