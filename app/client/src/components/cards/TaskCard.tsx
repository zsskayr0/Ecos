import { avisar } from "@/lib/toast";
import { ArvorePastas } from "@/components/common/ArvorePastas";
import { useEffect, useState } from "react";
import { CalendarDays, CheckCircle2, Circle, Flag, FlagTriangleRight, Flame, FolderInput, ListChecks, SquareArrowOutUpRight } from "lucide-react";
import { useAbrirDocumento } from "@/lib/documento-popup";
import type { PrioridadeTarefa, Tarefa } from "@/lib/types";
import { Avatar } from "@/components/common/Avatar";
import { TempoEdicao } from "@/components/common/TempoEdicao";
import { MarkdownPreview } from "@/lib/markdown-mini";
import { tarefas } from "@/lib/api";
import { useRefreshBus } from "@/lib/refresh-bus";
import { alternarChecklist, cortarCorpo } from "@/lib/checklist";
import { AvisoCortado, BotaoAcao, CLASSE_BARRA, ItemMenu, MenuAcao, PastaChip, TagsChips, useTarefaDetalhe, type PastaOpcao } from "./feed-comum";

/** A borda esquerda carrega a prioridade (como o roxo/verde das notas) — o fundo vermelho quebrava o ritmo do feed. */
const BORDA_POR_PRIORIDADE = { baixa: "border-cyan/40", media: "border-warning/50", alta: "border-error" } as const;
const ROTULO_PRIORIDADE: Record<PrioridadeTarefa, string> = { baixa: "Baixa", media: "Média", alta: "Alta" };

function formatarPrazo(iso: string) {
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "");
}

/**
 * Tarefa no Feed — mesma lógica do card de nota: pasta, tags, prazo e progresso das subtarefas (2/5) de relance,
 * concluir no próprio card, ações no hover e expansão no lugar para marcar subtarefas.
 */
export function TaskCard({ tarefa, pastas = [] }: { tarefa: Tarefa; pastas?: PastaOpcao[] }) {
  const abrirDocumento = useAbrirDocumento();
  const { notificar } = useRefreshBus();
  const [detalhe, setDetalhe] = useTarefaDetalhe(tarefa.id);
  const [expandido, setExpandido] = useState(false);
  const [concluida, setConcluida] = useState(tarefa.status === "concluida");
  const [prioridade, setPrioridade] = useState(tarefa.prioridade);
  const [pasta, setPasta] = useState(tarefa.pasta ?? null);
  const [menu, setMenu] = useState<"pasta" | "prioridade" | null>(null);
  useEffect(() => { setConcluida(tarefa.status === "concluida"); }, [tarefa.status]);
  useEffect(() => { if (detalhe) setConcluida(detalhe.status === "concluida"); }, [detalhe?.status]);
  useEffect(() => { setPrioridade(tarefa.prioridade); }, [tarefa.prioridade]);
  useEffect(() => { setPasta(tarefa.pasta ?? null); }, [tarefa.pasta]);

  const subtarefas = detalhe?.subtarefas ?? [];
  const feitas = subtarefas.filter((s) => s.concluida).length;
  const prazo = detalhe?.due_date ?? tarefa.dueDate ?? detalhe?.scheduled_at ?? tarefa.scheduledAt;
  const vencida = !!prazo && !concluida && prazo.slice(0, 10) < new Date().toLocaleDateString("sv-SE");
  const corpo = detalhe?.corpo?.trim() ?? "";
  const corte = cortarCorpo(corpo);
  const tags = detalhe?.tags ?? tarefa.tags ?? [];

  async function alternarConclusao() {
    const proximo = !concluida;
    setConcluida(proximo);
    try { await tarefas.atualizarStatus(tarefa.id, proximo ? "concluida" : "pendente"); notificar(); } catch { setConcluida(!proximo); }
  }
  async function alternarSubtarefa(id: string) {
    if (!detalhe) return;
    const anterior = detalhe;
    const proximas = detalhe.subtarefas.map((s) => s.id === id ? { ...s, concluida: !s.concluida } : s);
    setDetalhe({ ...detalhe, subtarefas: proximas });
    try { await tarefas.atualizar(tarefa.id, { subtarefas: proximas.map(({ id: sid, titulo, concluida: c }) => ({ id: sid, titulo, concluida: c })) }); } catch { setDetalhe(anterior); avisar("Não foi possível salvar a tarefa.", "erro"); }
  }
  async function alternarChecklistCorpo(indice: number) {
    if (!detalhe) return;
    const anterior = detalhe;
    const novo = alternarChecklist(detalhe.corpo, indice);
    setDetalhe({ ...detalhe, corpo: novo });
    try { await tarefas.atualizar(tarefa.id, { corpo: novo }); } catch { setDetalhe(anterior); avisar("Não foi possível salvar a tarefa.", "erro"); }
  }
  async function mudarPrioridade(p: PrioridadeTarefa) {
    const anterior = prioridade;
    setPrioridade(p); setMenu(null);
    try { await tarefas.atualizar(tarefa.id, { prioridade: p }); notificar(); } catch { setPrioridade(anterior); avisar("Não foi possível mudar a prioridade.", "erro"); }
  }
  async function mover(caminho: string | null) {
    const anterior = pasta;
    setPasta(caminho); setMenu(null);
    try { await tarefas.atualizar(tarefa.id, { pasta: caminho ?? "" }); notificar(); } catch { setPasta(anterior); avisar("Não foi possível mover a tarefa.", "erro"); }
  }

  return (
    <article
      className={`group/cartao flex w-full min-w-0 flex-col gap-2 rounded-card border-l-4 bg-surface-1 p-4 text-left ${BORDA_POR_PRIORIDADE[prioridade]} ${concluida ? "opacity-70" : ""}`}
    >
      <div className="flex min-h-7 items-center justify-between gap-2">
        <PastaChip caminho={pasta} />
        <div className="flex items-center gap-2">
          {prioridade === "alta" && !concluida && <span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-error"><Flame size={12} strokeWidth={2} />Alta</span>}
          <div className={`relative ${CLASSE_BARRA}`}>
            <BotaoAcao titulo="Prioridade" onClick={() => setMenu((m) => m === "prioridade" ? null : "prioridade")} ativo={menu === "prioridade"}><Flag size={15} /></BotaoAcao>
            <BotaoAcao titulo="Mover para pasta" onClick={() => setMenu((m) => m === "pasta" ? null : "pasta")} ativo={menu === "pasta"}><FolderInput size={15} /></BotaoAcao>
            <MenuAcao aberto={menu !== null} onFechar={() => setMenu(null)}>
              {menu === "prioridade" && (["alta", "media", "baixa"] as const).map((p) => <ItemMenu key={p} onClick={() => void mudarPrioridade(p)} ativo={prioridade === p}><FlagTriangleRight size={14} className="mr-2 text-text-muted" />{ROTULO_PRIORIDADE[p]}</ItemMenu>)}
              {menu === "pasta" && <><ItemMenu onClick={() => void mover(null)} ativo={!pasta}>Sem pasta</ItemMenu><ArvorePastas opcoes={pastas.map((p) => ({ valor: p.caminho, rotulo: p.nome, pasta: true }))} valores={[pasta ?? ""]} onSelect={(p) => void mover(p)} /></>}
            </MenuAcao>
            <BotaoAcao titulo="Abrir tarefa" onClick={() => abrirDocumento(`/tarefa/${tarefa.id}`)}><SquareArrowOutUpRight size={15} /></BotaoAcao>
          </div>
        </div>
      </div>

      <div className="flex items-start gap-2.5">
        <button type="button" aria-label={concluida ? "Reabrir tarefa" : "Concluir tarefa"} onClick={(e) => { e.stopPropagation(); void alternarConclusao(); }} className="mt-px shrink-0 text-text-muted hover:text-success">
          {concluida ? <CheckCircle2 size={18} strokeWidth={1.75} className="text-success" /> : <Circle size={18} strokeWidth={1.75} />}
        </button>
        <button type="button" onClick={(e) => { e.stopPropagation(); abrirDocumento(`/tarefa/${tarefa.id}`, e); }} className={`min-w-0 text-left font-body text-[15px] font-semibold leading-snug hover:underline ${concluida ? "text-text-muted line-through" : "text-text-primary"}`}>{tarefa.titulo}</button>
      </div>

      {expandido ? (
        <div className="flex flex-col gap-2 pl-7">
          {subtarefas.length > 0 && (
            <ul className="flex flex-col gap-1">
              {subtarefas.map((s) => (
                <li key={s.id}><label className="flex cursor-pointer items-start gap-2 text-sm text-text-secondary"><input type="checkbox" checked={s.concluida} onChange={() => void alternarSubtarefa(s.id)} className="mt-1 cursor-pointer" /><span className={s.concluida ? "line-through opacity-60" : ""}>{s.titulo}</span></label></li>
              ))}
            </ul>
          )}
          {corpo && <div className="text-sm leading-relaxed text-text-secondary"><MarkdownPreview corpo={corte.texto} itemId={tarefa.id} tipo="tarefa" aoAlternarChecklist={(i) => void alternarChecklistCorpo(i)} />{corte.cortado && <AvisoCortado onAbrir={() => abrirDocumento(`/tarefa/${tarefa.id}`)} tipo="tarefa" />}</div>}
          {!subtarefas.length && !corpo && <p className="text-sm text-text-muted">Sem detalhes.</p>}
        </div>
      ) : corpo && (
        <div className="relative max-h-[4.5rem] overflow-hidden pl-7 text-sm leading-snug text-text-secondary [mask-image:linear-gradient(to_bottom,black_55%,transparent)]"><MarkdownPreview corpo={corpo.slice(0, 500)} itemId={tarefa.id} tipo="tarefa" /></div>
      )}

      {(corpo || subtarefas.length > 0) && <button type="button" onClick={() => setExpandido((v) => !v)} className="w-fit pl-7 text-sm font-medium text-steel-300 hover:underline">{expandido ? "Mostrar menos" : "Mostrar mais"}</button>}

      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="flex min-w-0 items-center gap-2">
          <Avatar nome={tarefa.dono.nome} corFundo={tarefa.origemEquipe?.cor} tamanho={18} />
          <span className="truncate text-xs text-text-muted">
            {tarefa.dono.nome}
            {tarefa.origemEquipe && ` · ${tarefa.origemEquipe.nome}`}
            {tarefa.atualizadoEm && <> · <TempoEdicao iso={tarefa.atualizadoEm} /></>}
          </span>
        </span>
        {prazo && <span className={`flex items-center gap-1 text-[11px] ${vencida ? "font-semibold text-error" : "text-text-muted"}`}><CalendarDays size={12} />{formatarPrazo(prazo)}</span>}
        {subtarefas.length > 0 && <span className="flex items-center gap-1 text-[11px] text-text-muted"><ListChecks size={12} />{feitas}/{subtarefas.length}</span>}
        <TagsChips tags={tags} />
      </div>
    </article>
  );
}
