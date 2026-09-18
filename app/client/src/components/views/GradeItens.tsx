import { useState, type MouseEvent } from "react";
import { CalendarClock, CheckCircle2, Circle, Clock, Folder, StickyNote } from "lucide-react";
import { Avatar } from "@/components/common/Avatar";
import { TempoEdicao } from "@/components/common/TempoEdicao";
import { useAbrirDocumento } from "@/lib/documento-popup";
import { formatDuracao } from "@/lib/format";
import { anexosDaNota, previewDaNota } from "@/lib/note-media";
import type { FeedItem, Nota, Tarefa } from "@/lib/types";
import { CLASSE_PRIORIDADE, ROTULO_PRIORIDADE, caminhoDoItem, nomeDaPasta, pastaDoItem, prazoDaTarefa, tagsDoItem } from "./util";

const BLOCO =
  "group flex h-56 min-w-0 flex-col gap-2 overflow-hidden rounded-xl border border-border bg-surface-1 p-4 text-left transition-colors hover:border-steel-500/60 hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-steel-400";

function Tags({ item }: { item: FeedItem }) {
  const tags = tagsDoItem(item);
  if (!tags.length) return null;
  return (
    <span className="flex min-w-0 items-center gap-1 overflow-hidden">
      {tags.slice(0, 3).map((t) => (
        <span key={t} className="shrink-0 rounded-md bg-surface-3 px-1.5 py-0.5 text-[11px] text-text-secondary">#{t}</span>
      ))}
      {tags.length > 3 && <span className="shrink-0 text-[11px] text-text-muted">+{tags.length - 3}</span>}
    </span>
  );
}

function Rodape({ item }: { item: FeedItem }) {
  return (
    <span className="mt-auto flex items-center justify-between gap-2 pt-1 text-xs text-text-muted">
      {item.atualizadoEm ? <TempoEdicao iso={item.atualizadoEm} className="truncate" /> : <span />}
      <Avatar nome={item.dono.nome} corFundo={item.origemEquipe?.cor} tamanho={18} />
    </span>
  );
}

function CabecalhoPasta({ item, Icone }: { item: FeedItem; Icone: typeof Folder }) {
  const pasta = pastaDoItem(item);
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-text-muted">
      <Icone size={12} strokeWidth={1.75} className="shrink-0 text-steel-300" />
      <span className="truncate">{pasta ? nomeDaPasta(pasta) : item.tipo === "nota" ? "Nota" : "Tarefa"}</span>
    </span>
  );
}

function BlocoNota({ nota }: { nota: Nota }) {
  const abrir = useAbrirDocumento();
  const [erroImagem, setErroImagem] = useState<string | null>(null);
  const imagem = anexosDaNota(nota.corpo ?? "", nota.id).find((a) => a.imagem);
  const capa = imagem && imagem.url !== erroImagem ? imagem : null;
  const preview = nota.corpo ? previewDaNota(nota.corpo, nota.id) : nota.preview;

  return (
    <button type="button" onClick={(e) => abrir(caminhoDoItem(nota), e)} className={BLOCO}>
      {capa && <img src={capa.url} alt="" loading="lazy" onError={() => setErroImagem(capa.url)} className="-mx-4 -mt-4 mb-1 h-24 w-[calc(100%+2rem)] max-w-none shrink-0 object-cover" />}
      <CabecalhoPasta item={nota} Icone={pastaDoItem(nota) ? Folder : StickyNote} />
      <p className="line-clamp-2 font-body text-[15px] font-semibold leading-snug text-text-primary">{nota.titulo || "Sem título"}</p>
      {preview && <p className={`${capa ? "line-clamp-2" : "line-clamp-4"} text-sm leading-snug text-text-secondary`}>{preview}</p>}
      <Tags item={nota} />
      <Rodape item={nota} />
    </button>
  );
}

function BlocoTarefa({ tarefa }: { tarefa: Tarefa }) {
  const abrir = useAbrirDocumento();
  const concluida = tarefa.status === "concluida";
  const prazo = prazoDaTarefa(tarefa);

  return (
    <button type="button" onClick={(e) => abrir(caminhoDoItem(tarefa), e)} className={BLOCO}>
      <span className="flex items-center justify-between gap-2">
        <CabecalhoPasta item={tarefa} Icone={pastaDoItem(tarefa) ? Folder : CheckCircle2} />
        <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-medium ${CLASSE_PRIORIDADE[tarefa.prioridade]}`}>{ROTULO_PRIORIDADE[tarefa.prioridade]}</span>
      </span>
      <span className="flex items-start gap-2">
        {concluida ? <CheckCircle2 size={16} strokeWidth={1.75} className="mt-0.5 shrink-0 text-success" /> : <Circle size={16} strokeWidth={1.75} className="mt-0.5 shrink-0 text-text-muted" />}
        <span className={`line-clamp-3 font-body text-[15px] font-semibold leading-snug ${concluida ? "text-text-muted line-through" : "text-text-primary"}`}>{tarefa.titulo || "Sem título"}</span>
      </span>
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-secondary">
        {prazo && <span className="flex items-center gap-1"><CalendarClock size={12} strokeWidth={1.75} className="text-cyan" />{prazo.texto}</span>}
        {tarefa.durationMin > 0 && <span className="flex items-center gap-1"><Clock size={12} strokeWidth={1.75} className="text-text-muted" />{formatDuracao(tarefa.durationMin)}</span>}
      </span>
      <Tags item={tarefa} />
      <Rodape item={tarefa} />
    </button>
  );
}

/** Visualização em grade: blocos de tamanho igual, tantos por linha quantos couberem — como uma galeria do Notion. */
export function GradeItens({ itens, selecionados = new Set(), onSelecionar }: { itens: FeedItem[]; selecionados?: Set<string>; onSelecionar?: (event: MouseEvent, item: FeedItem, ordem: FeedItem[]) => boolean }) {
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))" }}>
      {itens.map((item) => <div key={`${item.tipo}-${item.id}`} onClickCapture={(e) => { onSelecionar?.(e, item, itens); }} className={selecionados.has(`${item.tipo}:${item.id}`) ? "rounded-xl ring-2 ring-steel-400 ring-offset-2 ring-offset-base" : ""}>{item.tipo === "nota" ? <BlocoNota nota={item} /> : <BlocoTarefa tarefa={item} />}</div>)}
    </div>
  );
}
