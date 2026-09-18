import { useAbrirDocumento } from "@/lib/documento-popup";
import type { Nota } from "@/lib/types";
import { MOTIVO_CLASSES, MOTIVO_LABEL } from "@/lib/format";
import { TempoEdicao } from "@/components/common/TempoEdicao";
import { Avatar } from "@/components/common/Avatar";
import { useState } from "react";
import { Paperclip } from "lucide-react";
import { anexosDaNota, previewDaNota } from "@/lib/note-media";

/**
 * Nota card (section 3.1) — colored left border = dominant ranking motive,
 * motive tag, relative timestamp, preview, origin avatar/name in the
 * footer when it's from a Team.
 */
export function NoteCard({ nota }: { nota: Nota }) {
  const abrirDocumento = useAbrirDocumento();
  const cores = MOTIVO_CLASSES[nota.motivoRanking];
  const anexos = anexosDaNota(nota.corpo ?? "", nota.id);
  const imagem = anexos.find((a) => a.imagem);
  const [imagemComErro, setImagemComErro] = useState<string | null>(null);
  const preview = nota.corpo ? previewDaNota(nota.corpo, nota.id) : nota.preview;

  return (
    <button
      onClick={(e) => abrirDocumento(`/notas/nota/${nota.id}`, e)}
      className={`flex w-full flex-col gap-2 rounded-card border-l-4 bg-surface-1 p-4 text-left ${cores.border}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className={`rounded-pill px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${cores.text} ${cores.bg}`}>
          {MOTIVO_LABEL[nota.motivoRanking]}
          {nota.motivoRanking === "orfa" && nota.diasOrfa ? ` · ${nota.diasOrfa}d` : ""}
        </span>
      </div>

      <p className="font-body text-[15px] font-semibold leading-snug text-text-primary">{nota.titulo}</p>
      {preview && <p className="line-clamp-2 text-sm leading-snug text-text-secondary">{preview}</p>}
      {imagem && imagem.url !== imagemComErro && <img src={imagem.url} alt={imagem.nome} loading="lazy" onError={() => setImagemComErro(imagem.url)} className="h-44 w-full rounded-xl object-cover" />}
      {anexos.filter((a) => !a.imagem).map((a, i) => <span key={`${a.url}-${i}`} className="flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-2"><Paperclip size={14} className="shrink-0 text-text-muted" /><span className="flex-1 truncate text-xs text-text-secondary">{a.nome}</span><span className="text-[10px] font-medium text-text-muted">{a.tipo}</span></span>)}

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
          {nota.atualizadoEm && <> · <TempoEdicao iso={nota.atualizadoEm} /></>}
        </span>
      </div>
    </button>
  );
}
