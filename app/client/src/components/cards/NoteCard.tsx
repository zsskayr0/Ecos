import { useAbrirDocumento } from "@/lib/documento-popup";
import type { Nota } from "@/lib/types";
import { MOTIVO_CLASSES, MOTIVO_LABEL } from "@/lib/format";
import { TempoEdicao } from "@/components/common/TempoEdicao";
import { Avatar } from "@/components/common/Avatar";
import { MarkdownPreview } from "@/lib/markdown-mini";
import { useEffect, useMemo, useState } from "react";
import { FolderInput, Paperclip, SquareArrowOutUpRight } from "lucide-react";
import { anexosDaNota } from "@/lib/note-media";
import { alternarChecklist, cortarCorpo, primeiroLink } from "@/lib/checklist";
import { notas } from "@/lib/api";
import { useRefreshBus } from "@/lib/refresh-bus";
import { BotaoAcao, CLASSE_BARRA, AvisoCortado, CartaoLink, ItemMenu, MenuAcao, PastaChip, TagsChips, type PastaOpcao } from "./feed-comum";

const MAX_MINIATURAS = 3;

/**
 * Nota no Feed — a tela de "revisar o que entrou": preview em Markdown, pasta/tags/link/miniaturas de
 * relance, ações no hover e expansão no lugar (lê a nota inteira e marca checklist sem sair do feed).
 * A borda esquerda colorida é o motivo do ranking (o rótulo virou tooltip; "Órfã" parecia erro).
 */
export function NoteCard({ nota, pastas = [] }: { nota: Nota; pastas?: PastaOpcao[] }) {
  const abrirDocumento = useAbrirDocumento();
  const { notificar } = useRefreshBus();
  const cores = MOTIVO_CLASSES[nota.motivoRanking];
  const [expandido, setExpandido] = useState(false);
  const [corpo, setCorpo] = useState(nota.corpo || nota.preview || "");
  const [pasta, setPasta] = useState(nota.pastaId);
  const [menuPasta, setMenuPasta] = useState(false);
  const [imagensComErro, setImagensComErro] = useState<Set<string>>(new Set());
  useEffect(() => { setCorpo(nota.corpo || nota.preview || ""); }, [nota.corpo, nota.preview]);
  useEffect(() => { setPasta(nota.pastaId); }, [nota.pastaId]);

  const anexos = useMemo(() => anexosDaNota(corpo, nota.id), [corpo, nota.id]);
  const imagens = anexos.filter((a) => a.imagem && !imagensComErro.has(a.url));
  const arquivos = anexos.filter((a) => !a.imagem);
  const link = useMemo(() => primeiroLink(corpo), [corpo]);
  const corpoSemAnexos = useMemo(() => anexos.reduce((t, a) => t.replace(a.referencia, ""), corpo).trim(), [anexos, corpo]);
  const longo = corpoSemAnexos.length > 240 || corpoSemAnexos.split("\n").length > 4;

  const corte = useMemo(() => cortarCorpo(corpo), [corpo]);
  const temMais = longo || imagens.length > 1 || /\[[ xX]\]/.test(corpo);

  async function alternar(indice: number) {
    const anterior = corpo;
    const novo = alternarChecklist(corpo, indice);
    setCorpo(novo);
    try { await notas.atualizar(nota.id, { corpo: novo }); notificar(); } catch { setCorpo(anterior); }
  }
  async function mover(caminho: string | null) {
    const anterior = pasta;
    setPasta(caminho); setMenuPasta(false);
    try { await notas.atualizar(nota.id, { pasta: caminho ?? "" }); notificar(); } catch { setPasta(anterior); }
  }
  const abrir = (e: React.MouseEvent) => abrirDocumento(`/notas/nota/${nota.id}`, e);

  return (
    <article
      title={MOTIVO_LABEL[nota.motivoRanking]}
      className={`group/cartao flex w-full min-w-0 flex-col gap-2 rounded-card border-l-4 bg-surface-1 p-4 text-left ${cores.border}`}
    >
      <div className="flex min-h-7 items-center justify-between gap-2">
        <PastaChip caminho={pasta} />
        <div className={`relative ${CLASSE_BARRA}`}>
          <BotaoAcao titulo="Mover para pasta" onClick={() => setMenuPasta((v) => !v)} ativo={menuPasta}><FolderInput size={15} /></BotaoAcao>
          <MenuAcao aberto={menuPasta} onFechar={() => setMenuPasta(false)}>
            <ItemMenu onClick={() => void mover(null)} ativo={!pasta}>Sem pasta</ItemMenu>
            {pastas.map((p) => <ItemMenu key={p.caminho} onClick={() => void mover(p.caminho)} ativo={pasta === p.caminho}>{p.nome}</ItemMenu>)}
          </MenuAcao>
          <BotaoAcao titulo="Abrir nota" onClick={() => abrirDocumento(`/notas/nota/${nota.id}`)}><SquareArrowOutUpRight size={15} /></BotaoAcao>
        </div>
      </div>

      <button type="button" onClick={(e) => { e.stopPropagation(); abrir(e); }} className="w-fit max-w-full text-left font-body text-[15px] font-semibold leading-snug text-text-primary hover:underline">{nota.titulo}</button>

      {corpoSemAnexos && (expandido
        ? <div className="text-sm leading-relaxed text-text-secondary"><MarkdownPreview corpo={corte.texto} itemId={nota.id} aoAlternarChecklist={(i) => void alternar(i)} />{corte.cortado && <AvisoCortado onAbrir={() => abrirDocumento(`/notas/nota/${nota.id}`)} tipo="nota" />}</div>
        : <div className={`relative overflow-hidden text-sm leading-snug text-text-secondary ${longo ? "max-h-[6.5rem] [mask-image:linear-gradient(to_bottom,black_65%,transparent)]" : ""}`}><MarkdownPreview corpo={corpoSemAnexos.slice(0, 700)} itemId={nota.id} /></div>)}

      {temMais && <button type="button" onClick={() => setExpandido((v) => !v)} className="w-fit text-sm font-medium text-steel-300 hover:underline">{expandido ? "Mostrar menos" : "Mostrar mais"}</button>}

      {!expandido && imagens.length > 0 && (
        <div className={`grid gap-1.5 ${imagens.length === 1 ? "grid-cols-1" : "grid-cols-3"}`}>
          {imagens.slice(0, MAX_MINIATURAS).map((img, i) => (
            <div key={img.url} className="relative overflow-hidden rounded-xl">
              <img src={img.url} alt={img.nome} loading="lazy" onError={() => setImagensComErro((s) => new Set(s).add(img.url))} className={`w-full object-cover ${imagens.length === 1 ? "max-h-52" : "h-24"}`} />
              {i === MAX_MINIATURAS - 1 && imagens.length > MAX_MINIATURAS && <span className="absolute inset-0 flex items-center justify-center bg-black/50 text-sm font-semibold text-white">+{imagens.length - MAX_MINIATURAS}</span>}
            </div>
          ))}
        </div>
      )}
      {arquivos.map((a, i) => <span key={`${a.url}-${i}`} className="flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-2"><Paperclip size={14} className="shrink-0 text-text-muted" /><span className="flex-1 truncate text-xs text-text-secondary">{a.nome}</span><span className="text-[10px] font-medium text-text-muted">{a.tipo}</span></span>)}
      {link && <CartaoLink link={link} />}

      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="flex min-w-0 items-center gap-2">
          <Avatar nome={nota.dono.nome} corFundo={nota.origemEquipe?.cor} tamanho={18} />
          <span className="truncate text-xs text-text-muted">
            {nota.dono.nome}
            {nota.origemEquipe && ` · ${nota.origemEquipe.nome}`}
            {nota.atualizadoEm && <> · <TempoEdicao iso={nota.atualizadoEm} /></>}
          </span>
        </span>
        <TagsChips tags={nota.tags} />
      </div>
    </article>
  );
}
