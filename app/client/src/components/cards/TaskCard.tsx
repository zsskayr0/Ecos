import { Flame, Folder, Tag } from "lucide-react";
import { useAbrirDocumento } from "@/lib/documento-popup";
import type { Tarefa } from "@/lib/types";
import { Avatar } from "@/components/common/Avatar";
import { TempoEdicao } from "@/components/common/TempoEdicao";

/** Priority isn't just informational on this card — it's the "bid" that
 * decided how prominently the ranking job surfaced this Tarefa in the Feed
 * to begin with (`ecos_core::ranking::boost_tarefa_prioridade`); Alta gets
 * a visibly stronger treatment so the card's weight matches that. */
const BORDA_POR_PRIORIDADE = { baixa: "border-cyan/15", media: "border-cyan/25", alta: "border-error/40" } as const;
const FUNDO_POR_PRIORIDADE = { baixa: "bg-cyan/[0.04]", media: "bg-cyan/[0.06]", alta: "bg-error/[0.06]" } as const;

/**
 * Tarefa card in the Feed (section 3.1) — visually distinct: a light cyan
 * tint, a subtle border, and the organizational context needed to scan it
 * outside the Agenda: its folder and a compact sample of tags. Time belongs
 * to the Agenda, where it can be read in chronological context.
 */
export function TaskCard({ tarefa }: { tarefa: Tarefa }) {
  const abrirDocumento = useAbrirDocumento();
  const tags = tarefa.tags ?? [];
  const pasta = tarefa.pasta?.split("/").filter(Boolean).pop();

  return (
    <button
      onClick={(e) => abrirDocumento(`/tarefa/${tarefa.id}`, e)}
      className={`flex w-full flex-col gap-2 rounded-card border p-4 text-left ${BORDA_POR_PRIORIDADE[tarefa.prioridade]} ${FUNDO_POR_PRIORIDADE[tarefa.prioridade]}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
          <Folder size={13} strokeWidth={1.8} className="shrink-0 text-steel-300" />
          <span className="truncate">{pasta ?? "Sem pasta"}</span>
        </span>
        <span className="flex items-center gap-2">
          {tarefa.prioridade === "alta" && (
            <span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-error">
              <Flame size={12} strokeWidth={2} />
              Alta
            </span>
          )}
        </span>
      </div>

      <p className="font-body text-[15px] font-semibold leading-snug text-text-primary">{tarefa.titulo}</p>
      {tags.length > 0 && (
        <div className="flex min-w-0 items-center gap-1 overflow-hidden">
          <Tag size={12} strokeWidth={1.75} className="shrink-0 text-text-muted" />
          {tags.slice(0, 2).map((tag) => <span key={tag} className="shrink-0 rounded-md bg-surface-3 px-1.5 py-0.5 text-[11px] text-text-secondary">#{tag}</span>)}
          {tags.length > 2 && <span className="shrink-0 text-[11px] text-text-muted">+{tags.length - 2}</span>}
        </div>
      )}

      <div className="mt-1 flex items-center gap-2">
        <Avatar nome={tarefa.dono.nome} corFundo={tarefa.origemEquipe?.cor} tamanho={18} />
        <span className="text-xs text-text-muted">
          {tarefa.dono.nome}
          {tarefa.origemEquipe && ` · ${tarefa.origemEquipe.nome}`}
          {tarefa.atualizadoEm && <> · <TempoEdicao iso={tarefa.atualizadoEm} /></>}
        </span>
      </div>
    </button>
  );
}
