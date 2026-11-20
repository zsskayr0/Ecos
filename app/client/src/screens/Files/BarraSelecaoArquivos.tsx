import { useEffect, useRef, useState, type ReactNode } from "react";
import { Archive, ArchiveRestore, CalendarDays, Check, CheckCheck, Download, FileDown, ExternalLink, Flag, FolderInput, RotateCcw, Tag, Trash2, Users, X } from "lucide-react";
import { BarraSelecao } from "@/components/common/BarraSelecao";
import { GradeMes } from "@/components/common/GradeMes";
import { tagsApi } from "@/lib/api";
import { useMinhasEquipes } from "@/lib/use-minhas-equipes";
import type { AcoesEmLote, Prioridade } from "./acoes-em-lote";

export type PainelBarra = "tags" | "equipe" | "prioridade" | "prazo" | null;

const PRIORIDADES: { valor: Prioridade; rotulo: string }[] = [{ valor: "baixa", rotulo: "Baixa" }, { valor: "media", rotulo: "Média" }, { valor: "alta", rotulo: "Alta" }];
const BOTAO = "flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] text-text-secondary transition-colors hover:bg-surface-3 hover:text-text-primary disabled:opacity-40";
const ITEM = "flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-left text-[13px] text-text-primary hover:bg-surface-3";

interface Props {
  /** Quantos itens (pastas incluídas) estão marcados. */
  total: number;
  espaco: string;
  acoes: AcoesEmLote;
  /** Painel aberto: controlado de fora para o menu de botão direito poder abri-lo. */
  painel: PainelBarra;
  aoMudarPainel: (painel: PainelBarra) => void;
  temArquivos: boolean;
  aoAbrirEmGuias: () => void;
  aoMover: () => void;
  aoExcluir: () => void;
  aoLimpar: () => void;
}

function Painel({ aberto, aoFechar, children }: { aberto: boolean; aoFechar: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: PointerEvent) => { if (!ref.current?.parentElement?.contains(e.target as Node)) aoFechar(); };
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); aoFechar(); } };
    document.addEventListener("pointerdown", fora, true);
    document.addEventListener("keydown", tecla, true);
    return () => { document.removeEventListener("pointerdown", fora, true); document.removeEventListener("keydown", tecla, true); };
  }, [aberto, aoFechar]);
  if (!aberto) return null;
  return <div ref={ref} className="ecos-fade-in absolute bottom-full left-1/2 z-10 mb-2 min-w-44 -translate-x-1/2 rounded-xl border border-border bg-surface-2 p-1.5 shadow-nav">{children}</div>;
}

/** Barra flutuante da seleção na tela Arquivos; cada grupo só aparece quando a seleção tem o tipo de item a que se aplica. */
export function BarraSelecaoArquivos({ total, espaco, acoes, painel, aoMudarPainel, temArquivos, aoAbrirEmGuias, aoMover, aoExcluir, aoLimpar }: Props) {
  const { equipes } = useMinhasEquipes();
  const [novaTag, setNovaTag] = useState("");
  const [sugestoes, setSugestoes] = useState<string[]>([]);
  const { ocupado, tarefasSel, notasSel, documentos, todasConcluidas, tagsDaSelecao } = acoes;

  useEffect(() => {
    if (painel !== "tags") return;
    void tagsApi.listar(espaco).then((l) => setSugestoes(l.map((t) => t.tag))).catch(() => setSugestoes([]));
  }, [painel, espaco]);

  const alternar = (p: Exclude<PainelBarra, null>) => aoMudarPainel(painel === p ? null : p);
  const fechar = () => aoMudarPainel(null);
  const filtro = novaTag.trim().replace(/^#/, "").toLowerCase();

  return (
    <BarraSelecao aberta={total > 0} rotulo="Ações para itens selecionados">
      <span className="px-2.5 text-[13px] font-medium text-text-primary">{total} {total === 1 ? "selecionado" : "selecionados"}</span>
      {temArquivos && <button type="button" onClick={aoAbrirEmGuias} className={BOTAO} title="Abre cada item em uma guia, sem sair desta"><ExternalLink size={14} />Abrir em guias</button>}

      {tarefasSel.length > 0 && <>
        <button type="button" disabled={ocupado} onClick={() => void acoes.concluirOuReabrir()} className={BOTAO}>
          {todasConcluidas ? <RotateCcw size={14} /> : <Check size={14} />}{todasConcluidas ? "Reabrir" : "Concluir"}
        </button>
        <div className="relative">
          <button type="button" onClick={() => alternar("prioridade")} aria-expanded={painel === "prioridade"} className={BOTAO}><Flag size={14} />Prioridade</button>
          <Painel aberto={painel === "prioridade"} aoFechar={fechar}>
            {PRIORIDADES.map((p) => <button key={p.valor} type="button" className={ITEM} onClick={() => void acoes.prioridade(p.valor)}>{p.rotulo}</button>)}
          </Painel>
        </div>
        <div className="relative">
          <button type="button" onClick={() => alternar("prazo")} aria-expanded={painel === "prazo"} className={BOTAO}><CalendarDays size={14} />Prazo</button>
          <Painel aberto={painel === "prazo"} aoFechar={fechar}>
            <div className="w-64 p-1">
              <GradeMes valor="" onSelecionar={(iso) => void acoes.prazo(iso)} />
              <button type="button" className={`${ITEM} mt-1 text-text-muted`} onClick={() => void acoes.prazo(null)}>Sem prazo</button>
            </div>
          </Painel>
        </div>
        {acoes.todasArquivadas
          ? <button type="button" disabled={ocupado} onClick={() => void acoes.desarquivar()} className={BOTAO}><ArchiveRestore size={14} />Desarquivar</button>
          : <button type="button" disabled={ocupado} onClick={() => void acoes.arquivar()} className={BOTAO}><Archive size={14} />Arquivar</button>}
      </>}

      {notasSel.length > 0 && <button type="button" disabled={ocupado} onClick={() => void acoes.revisar()} className={BOTAO}><CheckCheck size={14} />Revisada</button>}

      {documentos.length > 0 && <>
        <div className="relative">
          <button type="button" onClick={() => alternar("tags")} aria-expanded={painel === "tags"} className={BOTAO}><Tag size={14} />Tags</button>
          <Painel aberto={painel === "tags"} aoFechar={fechar}>
            <div className="w-64 space-y-2 p-1">
              <input autoFocus value={novaTag} onChange={(e) => setNovaTag(e.target.value)} placeholder="Adicionar tag e Enter" aria-label="Adicionar tag" className="ecos-campo h-8 w-full rounded-lg border border-border bg-surface-1 px-2.5 text-[13px] text-text-primary"
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); const t = novaTag; setNovaTag(""); void acoes.adicionarTag(t); } }} />
              {filtro && sugestoes.filter((s) => s.includes(filtro) && !tagsDaSelecao.has(s)).slice(0, 5).map((s) => (
                <button key={s} type="button" className={ITEM} onClick={() => { setNovaTag(""); void acoes.adicionarTag(s); }}>#{s}</button>
              ))}
              {tagsDaSelecao.size > 0 && <div className="border-t border-border pt-2">
                <p className="px-1 pb-1 text-[11px] uppercase tracking-wide text-text-muted">Remover de todos</p>
                <div className="flex flex-wrap gap-1">
                  {[...tagsDaSelecao.keys()].map((t) => <button key={t} type="button" onClick={() => void acoes.removerTag(t)} className="flex items-center gap-1 rounded-md bg-surface-3 px-2 py-1 text-xs text-text-secondary hover:text-error">#{t}<X size={11} /></button>)}
                </div>
              </div>}
            </div>
          </Painel>
        </div>
        <div className="relative">
          <button type="button" onClick={() => alternar("equipe")} aria-expanded={painel === "equipe"} className={BOTAO}><Users size={14} />Equipe</button>
          <Painel aberto={painel === "equipe"} aoFechar={fechar}>
            {[{ id: "pessoal", nome: "Pessoal" }, ...equipes.map((e) => ({ id: `equipe:${e.id}`, nome: e.nome }))].map((o) => (
              <button key={o.id} type="button" className={ITEM} onClick={() => void acoes.mudarEquipe(o.id)}>{o.nome}</button>
            ))}
          </Painel>
        </div>
      </>}

      {documentos.length > 0 && <button type="button" disabled={ocupado} onClick={() => void acoes.exportarPdf()} className={BOTAO} title="Baixa um PDF com as notas e tarefas marcadas"><FileDown size={14} />Exportar PDF</button>}
      {temArquivos && <button type="button" disabled={ocupado} onClick={() => void acoes.baixar()} className={BOTAO}><Download size={14} />Baixar</button>}
      <button type="button" onClick={aoMover} className={BOTAO}><FolderInput size={14} />Mover</button>
      <button type="button" onClick={aoExcluir} className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] text-error hover:bg-error/10"><Trash2 size={14} />Excluir</button>
      <button type="button" onClick={aoLimpar} aria-label="Limpar seleção" title="Limpar seleção (Esc)" className="flex h-8 w-8 items-center justify-center rounded-lg text-text-muted hover:bg-surface-3 hover:text-text-primary"><X size={15} /></button>
    </BarraSelecao>
  );
}
