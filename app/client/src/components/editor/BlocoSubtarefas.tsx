import { createContext, useContext, useState } from "react";
import { ListChecks, Maximize2, Plus } from "lucide-react";
import type { SubtarefaInput } from "@/lib/api";
import { BLOCO_PADRAO, adicionarNoBloco } from "./SubtarefasTela";

/** Subtarefas da tarefa aberta, para os blocos `::: subtarefas` do corpo. Ausente = o bloco só mostra o nome. */
export interface SubtarefasCorpo {
  subtarefas: SubtarefaInput[];
  onChange?: (subtarefas: SubtarefaInput[]) => void;
  onAbrirTodas?: () => void;
}

export const SubtarefasCorpoContext = createContext<SubtarefasCorpo | null>(null);

/** Bloco de subtarefas desenhado no lugar do marcador: itens do bloco, contador, marcar e adicionar. */
/** `noEditor`: desenhado dentro do EditorVivo (a caixa ocupa a linha do marcador). */
export function BlocoSubtarefas({ bloco, noEditor = false }: { bloco: string | null; noEditor?: boolean }) {
  const ctx = useContext(SubtarefasCorpoContext);
  const [novo, setNovo] = useState("");
  const lista = ctx?.subtarefas ?? [];
  const itens = lista.map((item, indice) => ({ item, indice })).filter(({ item }) => (item.bloco?.trim() || null) === bloco);
  const feitas = itens.filter(({ item }) => item.concluida).length;
  const nome = bloco ?? BLOCO_PADRAO;
  const editavel = !!ctx?.onChange;

  function alternar(indice: number) { ctx?.onChange?.(lista.map((s, i) => (i === indice ? { ...s, concluida: !s.concluida } : s))); }
  function adicionar() {
    const t = novo.trim();
    if (!t || !ctx?.onChange) return;
    ctx.onChange(adicionarNoBloco(lista, bloco, t));
    setNovo("");
  }

  return (
    <section aria-label={`Subtarefas: ${nome}`} data-bloco-subtarefas={bloco ?? ""} data-no-editor={noEditor || undefined} onClick={(e) => e.stopPropagation()}
      className="not-prose my-1.5 rounded-xl border border-border bg-surface-1 px-3.5 pb-1.5 pt-2.5 [font-size:inherit]">
      <header className="flex items-center gap-2">
        <ListChecks size={13} aria-hidden className="shrink-0 text-text-muted" />
        <span className="min-w-0 truncate text-xs font-semibold uppercase tracking-wide text-text-muted">{nome}</span>
        {itens.length > 0 && <span className="text-[11px] text-text-muted">{feitas}/{itens.length}</span>}
        {ctx?.onAbrirTodas && <button type="button" onClick={ctx.onAbrirTodas} aria-label="Ver todas as subtarefas" title="Ver todas as subtarefas"
          className="ml-auto flex h-7 w-7 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-2 hover:text-text-primary"><Maximize2 size={13} /></button>}
      </header>
      {itens.length > 0 && <div className="relative mb-1 mt-2 h-1 rounded-full bg-surface-3" aria-hidden><i className="absolute inset-y-0 left-0 rounded-full bg-steel-400/70 transition-[width] duration-300 ease-out motion-reduce:transition-none" style={{ width: `${(feitas / itens.length) * 100}%` }} /></div>}
      {itens.length > 0
        ? <ul>
          {itens.map(({ item, indice }) => (
            <li key={item.id ?? `novo-${indice}`}>
              <label className={`flex min-h-8 items-start gap-2.5 py-1 leading-snug ${editavel ? "cursor-pointer" : ""}`}>
                <input type="checkbox" checked={item.concluida} disabled={!editavel} onChange={() => alternar(indice)} className="mt-[0.2em] h-[15px] w-[15px] shrink-0 cursor-pointer accent-steel-500 disabled:cursor-default" />
                <span className={`min-w-0 break-words ${item.concluida ? "text-text-secondary line-through" : "text-text-primary"}`}>{item.titulo}</span>
              </label>
            </li>
          ))}
        </ul>
        : <p className="py-1.5 text-sm text-text-muted">Nenhuma subtarefa neste bloco ainda.</p>}
      {editavel && <div className="flex items-center gap-2.5">
        <Plus size={15} className="shrink-0 text-text-muted" aria-hidden />
        <input value={novo} onChange={(e) => setNovo(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); adicionar(); } }}
          placeholder="Adicionar subtarefa" aria-label={`Adicionar subtarefa em ${nome}`}
          className="min-h-8 min-w-0 flex-1 bg-transparent text-text-primary placeholder:text-text-muted focus-visible:outline-none" />
      </div>}
    </section>
  );
}
