import { CalendarClock } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { Tarefa } from "@/lib/types";
import { formatDuracao } from "@/lib/format";
import { Avatar } from "@/components/common/Avatar";

/**
 * Card de Tarefa no Feed (seção 3.1) — visualmente distinto: leve tint
 * cyan, borda sutil, rótulo "Encaixada na sua agenda".
 */
export function TaskCard({ tarefa }: { tarefa: Tarefa }) {
  const navigate = useNavigate();
  const hora = tarefa.scheduledAt
    ? new Date(tarefa.scheduledAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <button
      onClick={() => navigate(`/tarefa/${tarefa.id}`)}
      className="flex w-full flex-col gap-2 rounded-card border border-cyan/25 bg-cyan/[0.06] p-4 text-left"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 rounded-pill bg-cyan/15 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-cyan">
          <CalendarClock size={12} strokeWidth={2} />
          {tarefa.encaixadaNaAgenda ? "Encaixada na sua agenda" : "Sem horário definido"}
        </span>
        {hora && <span className="font-mono-value text-xs text-text-secondary">{hora}</span>}
      </div>

      <p className="font-body text-[15px] font-semibold leading-snug text-text-primary">{tarefa.titulo}</p>
      {tarefa.durationMin > 0 && <p className="text-sm text-text-muted">{formatDuracao(tarefa.durationMin)} reservados na Agenda</p>}

      {tarefa.origemEquipe && (
        <div className="mt-1 flex items-center gap-2">
          <Avatar nome={tarefa.origemEquipe.nome} corFundo={tarefa.origemEquipe.cor} tamanho={18} />
          <span className="text-xs text-text-muted">{tarefa.origemEquipe.nome}</span>
        </div>
      )}
    </button>
  );
}
