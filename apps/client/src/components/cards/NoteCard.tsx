import { useNavigate } from "react-router-dom";
import type { Nota } from "@/lib/types";
import { formatTempoRelativo, MOTIVO_CLASSES, MOTIVO_LABEL } from "@/lib/format";
import { Avatar } from "@/components/common/Avatar";

/**
 * Nota card (section 3.1) — colored left border = dominant ranking motive,
 * motive tag, relative timestamp, preview, origin avatar/name in the
 * footer when it's from a Team.
 */
export function NoteCard({ nota }: { nota: Nota }) {
  const navigate = useNavigate();
  const cores = MOTIVO_CLASSES[nota.motivoRanking];

  return (
    <button
      onClick={() => navigate(`/notas/nota/${nota.id}`)}
      className={`flex w-full flex-col gap-2 rounded-card border-l-4 bg-surface-1 p-4 text-left ${cores.border}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className={`rounded-pill px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${cores.text} ${cores.bg}`}>
          {MOTIVO_LABEL[nota.motivoRanking]}
          {nota.motivoRanking === "orfa" && nota.diasOrfa ? ` · ${nota.diasOrfa}d` : ""}
        </span>
        <span className="shrink-0 text-xs text-text-muted">{formatTempoRelativo(nota.atualizadoEm)}</span>
      </div>

      <p className="font-body text-[15px] font-semibold leading-snug text-text-primary">{nota.titulo}</p>
      <p className="line-clamp-2 text-sm leading-snug text-text-secondary">{nota.preview}</p>

      {/* User feedback: "abaixo de cada card... deve ter a foto de perfil
          e o nome do dono daquele item" — the individual author always
          shows; the Team badge (when there is one) rides along next to it
          rather than replacing it, since they answer different questions
          ("quem" vs. "em qual Equipe"). */}
      <div className="mt-1 flex items-center gap-2">
        <Avatar nome={nota.dono.nome} corFundo={nota.origemEquipe?.cor} tamanho={18} />
        <span className="text-xs text-text-muted">
          {nota.dono.nome}
          {nota.origemEquipe && ` · ${nota.origemEquipe.nome}`}
        </span>
      </div>
    </button>
  );
}
