import { CalendarClock, Flame } from "lucide-react";
import { useAbrirDocumento } from "@/lib/documento-popup";
import type { Tarefa } from "@/lib/types";
import { formatDuracao } from "@/lib/format";
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
 * tint, a subtle border, an "Encaixada na sua agenda" label.
 */
export function TaskCard({ tarefa }: { tarefa: Tarefa }) {
  const abrirDocumento = useAbrirDocumento();
  const hora = tarefa.scheduledAt
    ? new Date(tarefa.scheduledAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <button
      onClick={(e) => abrirDocumento(`/tarefa/${tarefa.id}`, e)}
      className={`flex w-full flex-col gap-2 rounded-card border p-4 text-left ${BORDA_POR_PRIORIDADE[tarefa.prioridade]} ${FUNDO_POR_PRIORIDADE[tarefa.prioridade]}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 rounded-pill bg-cyan/15 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-cyan">
          <CalendarClock size={12} strokeWidth={2} />
          {tarefa.encaixadaNaAgenda ? "Encaixada na sua agenda" : "Sem horário definido"}
        </span>
        <span className="flex items-center gap-2">
          {tarefa.prioridade === "alta" && (
            <span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-error">
              <Flame size={12} strokeWidth={2} />
              Alta
            </span>
          )}
          {hora && <span className="font-mono-value text-xs text-text-secondary">{hora}</span>}
        </span>
      </div>

      <p className="font-body text-[15px] font-semibold leading-snug text-text-primary">{tarefa.titulo}</p>
      {tarefa.durationMin > 0 && <p className="text-sm text-text-muted">{formatDuracao(tarefa.durationMin)} reservados na Agenda</p>}

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
