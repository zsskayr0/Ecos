import { Search, SearchX, X } from "lucide-react";
import type { Resultado } from "./indice-busca";
import type { Aba } from "./ConfiguracoesLayout";

/** Campo da busca das configurações. Enter abre o primeiro resultado; Esc limpa. */
export function CampoBusca({ valor, onChange, aoConfirmar, className = "" }: { valor: string; onChange: (v: string) => void; aoConfirmar: () => void; className?: string }) {
  return (
    <div className={`relative ${className}`}>
      <Search size={15} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
      <input type="search" value={valor} onChange={(e) => onChange(e.target.value)} placeholder="Buscar configuração" aria-label="Buscar nas configurações" autoComplete="off" spellCheck={false}
        onKeyDown={(e) => { if (e.key === "Enter") aoConfirmar(); else if (e.key === "Escape" && valor) { e.stopPropagation(); onChange(""); } }}
        className="h-10 w-full rounded-xl border border-border bg-surface-2 pl-9 pr-9 text-sm text-text-primary placeholder:text-text-muted focus:border-steel-400 focus:outline-none [&::-webkit-search-cancel-button]:hidden" />
      {valor && <button type="button" aria-label="Limpar busca" onClick={() => onChange("")} className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-text-muted hover:bg-surface-3 hover:text-text-primary"><X size={14} /></button>}
    </div>
  );
}

/** Lista de opções encontradas: o nome da opção e, embaixo, em que grupo e aba ela mora. */
export function ResultadosBusca({ resultados, aoAbrir, espacoso = false }: { resultados: Resultado<Aba>[]; aoAbrir: (r: Resultado<Aba>) => void; espacoso?: boolean }) {
  if (!resultados.length) {
    return (
      <div role="status" className="flex flex-col items-center gap-2 px-3 py-8 text-center text-sm text-text-muted">
        <SearchX size={22} strokeWidth={1.5} aria-hidden />
        Nada encontrado. Tente outra palavra, como “tema”, “pasta” ou “fuso”.
      </div>
    );
  }
  return (
    <ul aria-label="Resultados da busca" className={espacoso ? "flex flex-col overflow-hidden rounded-2xl bg-surface-1" : "flex flex-col gap-0.5"}>
      {resultados.map((r) => (
        <li key={r.chave} className={espacoso ? "border-b border-border/60 last:border-0" : ""}>
          <button type="button" onClick={() => aoAbrir(r)} className={`flex w-full items-center gap-2.5 text-left transition-colors hover:bg-surface-2 ${espacoso ? "px-4 py-3" : "rounded-md px-3 py-1.5"}`}>
            <r.aba.Icone size={espacoso ? 18 : 16} strokeWidth={1.75} aria-hidden className="shrink-0 text-text-secondary" />
            <span className="min-w-0 flex-1">
              <span className={`block truncate text-text-primary ${espacoso ? "text-[15px]" : "text-sm"}`}>{r.titulo}</span>
              <span className="block truncate text-xs text-text-muted">{r.onde}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
