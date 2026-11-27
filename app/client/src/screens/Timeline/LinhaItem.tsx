import type { CSSProperties, MouseEvent } from "react";
import { CalendarClock, CalendarDays, Check, CircleCheck, FilePen, FilePlus2, Flag, Folder, ListPlus, ListTodo, PencilLine, Tag, Wallet, type LucideIcon } from "lucide-react";
import { rotuloHorario } from "@/lib/agenda-tempo";
import type { Icone, ItemTimeline, RamoDaLinha } from "@/lib/timeline";
import { COR_TRILHO, RAMO, RECUO_ITEM, RECUO_LISTA, REGISTRO } from "./geometria";

const ICONES: Record<Icone, LucideIcon> = {
  tarefa: ListTodo, prazo: Flag, evento: CalendarDays, transacao: Wallet,
  "nota-criada": FilePlus2, "nota-editada": FilePen, "tarefa-criada": ListPlus, "tarefa-editada": PencilLine, "tarefa-concluida": CircleCheck,
};

const TIPO: Record<Icone, string> = {
  tarefa: "Tarefa", prazo: "Prazo", evento: "Evento", transacao: "Lançamento do Cofre",
  "nota-criada": "Nota", "nota-editada": "Nota", "tarefa-criada": "Tarefa", "tarefa-editada": "Tarefa", "tarefa-concluida": "Tarefa",
};

const PRIORIDADE: Record<string, string> = { alta: "Prioridade alta", media: "Prioridade média", baixa: "Prioridade baixa" };

const fmtData = new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const fmtDuracao = (min: number) => (min >= 60 ? `${Math.floor(min / 60)}h${min % 60 ? ` ${min % 60}min` : ""}` : `${min}min`);

/**
 * Cor do ponto: nota é cinza (some no fundo), tarefa pela prioridade (baixa também aparece), Cofre sempre roxo,
 * registro de tarefa no ciano do ramo. Atrasada e concluída são decididas antes.
 */
const COR_PRIORIDADE: Record<string, string> = { alta: "bg-warning", media: "bg-cyan", baixa: "bg-steel-300" };
function corDoPonto(item: ItemTimeline): string {
  if (item.icone === "nota-criada" || item.icone === "nota-editada") return "bg-text-muted";
  if (item.icone === "transacao") return "bg-violet";
  if (item.natureza === "registro") return "bg-cyan";
  if (item.icone === "tarefa" || item.icone === "prazo") return COR_PRIORIDADE[item.info?.prioridade ?? "media"] ?? "bg-cyan";
  return "bg-text-muted";
}

export interface AcoesItem {
  onAbrir: (item: ItemTimeline, e: MouseEvent<HTMLButtonElement>) => void;
  onConcluir: (item: ItemTimeline) => void;
  onAdiar: (item: ItemTimeline) => void;
}

/** Posição de um trilho relativa ao `<li>` do item (que começa em RECUO_LISTA). */
const x = (trilho: number) => trilho - RECUO_LISTA;

/** Trecho do trilho da programação nesta linha (dias com registro: o grupo não desenha o trilho inteiro). */
function TrilhoDaLinha() {
  return <span aria-hidden className={`pointer-events-none absolute inset-y-0 w-0 border-l ${COR_TRILHO}`} style={{ left: x(RAMO) - 0.5 }} />;
}

/** O ramo do registro nesta linha: reta, curva de entrada (do trilho principal) ou de saída (de volta a ele). */
function RamoRegistro({ ramo }: { ramo: RamoDaLinha }) {
  if (!ramo.cima && !ramo.baixo && !ramo.entra && !ramo.sai) return null;
  const a = 1;
  const b = REGISTRO - RAMO + 1;
  const caminhos = [
    ramo.cima && `M${b} 0 L${b} 50`,
    ramo.baixo && `M${b} 50 L${b} 100`,
    ramo.entra && `M${a} 0 C${a} 35, ${b} 22, ${b} 50`,
    ramo.sai && `M${b} 50 C${b} 78, ${a} 65, ${a} 100`,
  ].filter(Boolean) as string[];
  return <svg aria-hidden className="pointer-events-none absolute inset-y-0 z-10 h-full text-cyan/45" style={{ left: x(RAMO) - 1 }} width={b + 1} viewBox={`0 0 ${b + 1} 100`} preserveAspectRatio="none" fill="none">
    {caminhos.map((d) => <path key={d} d={d} stroke="currentColor" strokeWidth={1.25} vectorEffect="non-scaling-stroke" className="ecos-timeline-ramo-registro" />)}
  </svg>;
}

/** Cartão de detalhes ao passar o mouse (desktop), com ações rápidas em tarefa pendente. */
function CartaoDetalhes({ item, acoes }: { item: ItemTimeline; acoes: AcoesItem }) {
  const info = item.info;
  const quando = item.minutos === null ? "Dia todo" : rotuloHorario(item.minutos);
  const linhas: { icone: LucideIcon; texto: string }[] = [];
  if (info?.pasta) linhas.push({ icone: Folder, texto: info.pasta });
  if (info?.tags?.length) linhas.push({ icone: Tag, texto: info.tags.map((t) => `#${t}`).join("  ") });
  if (info?.duracaoMin) linhas.push({ icone: CalendarClock, texto: `Duração ${fmtDuracao(info.duracaoMin)}` });
  const tarefaPendente = item.alvo?.tipo === "tarefa" && item.natureza === "programado" && info?.pendente;
  const botao = "flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary";

  return <div role="tooltip" className="ecos-timeline-cartao pointer-events-none invisible absolute left-6 top-full z-30 w-80 pt-1 opacity-0 max-lg:hidden group-hover/linha:pointer-events-auto group-hover/linha:visible group-hover/linha:opacity-100">
    <div className="overflow-hidden rounded-2xl border border-border bg-surface-raised shadow-xl shadow-black/30">
      <div className="px-4 pb-3 pt-3.5">
        <p className="mb-1 flex items-center gap-2 text-[11px] uppercase tracking-wide text-text-muted">
          <span>{item.natureza === "registro" ? item.detalhe : TIPO[item.icone]}</span><span aria-hidden>·</span><span className="normal-case tracking-normal">{quando}</span>
          {item.situacao === "atrasada" && <span className="rounded bg-error/15 px-1.5 py-0.5 font-semibold normal-case tracking-normal text-error">Atrasada</span>}
        </p>
        <p className="text-sm leading-snug text-text-primary">{item.titulo}</p>
        {linhas.length > 0 && <ul className="mt-2.5 space-y-1">{linhas.map(({ icone: I, texto }) => <li key={texto} className="flex items-center gap-2 text-xs text-text-secondary"><I size={12} className="shrink-0 text-text-muted" /><span className="truncate">{texto}</span></li>)}</ul>}
        {(info?.prioridade || info?.criadoEm) && <p className="mt-2.5 text-[11px] text-text-muted">{[info.prioridade && PRIORIDADE[info.prioridade], info.criadoEm && `criada em ${fmtData.format(new Date(info.criadoEm)).replace(/\./g, "")}`].filter(Boolean).join(" · ")}</p>}
      </div>
      {tarefaPendente && <div className="flex items-center gap-1 border-t border-border px-2 py-1.5">
        <button type="button" onClick={() => acoes.onConcluir(item)} className={`${botao} hover:text-success`}><Check size={13} />Concluir</button>
        <button type="button" onClick={() => acoes.onAdiar(item)} className={botao}><CalendarClock size={13} />Para amanhã</button>
      </div>}
    </div>
  </div>;
}

export function LinhaItem({ item, indice, ramo, enfase, mostrarData, acoes }: {
  item: ItemTimeline;
  indice: number;
  ramo?: RamoDaLinha;
  /** Grupo "Atrasadas": o atraso ganha texto vermelho e selo. Nos dias, só o ponto e o horário avisam. */
  enfase?: boolean;
  mostrarData?: boolean;
  acoes: AcoesItem;
}) {
  const Icone = ICONES[item.icone];
  const registro = item.natureza === "registro";
  const atrasada = item.situacao === "atrasada";
  const concluida = item.situacao === "concluida";
  const horario = mostrarData ? `${item.dia.slice(8, 10)}/${item.dia.slice(5, 7)}`
    : item.minutos === null ? (item.icone === "prazo" ? "Prazo" : item.icone === "transacao" ? "Cofre" : "Dia todo") : rotuloHorario(item.minutos);

  const corPonto = atrasada ? "bg-error" : concluida ? "bg-success" : corDoPonto(item);
  const corTexto = atrasada && enfase ? "text-error" : concluida ? "text-text-muted line-through decoration-text-muted/50" : registro ? "text-text-secondary" : "text-text-primary";
  const corPropria = item.cor && !atrasada && !concluida ? item.cor : undefined;
  // Só o evento pinta o ponto com a própria cor; o lançamento do Cofre fica roxo e a cor dele vai só no valor.
  const corDoPontoProprio = item.icone === "evento" ? corPropria : undefined;

  const classe = "relative flex items-center gap-3 rounded-xl py-2 pr-3 transition-colors";
  const estilo: CSSProperties = { marginLeft: -RECUO_ITEM, paddingLeft: RECUO_ITEM, width: `calc(100% + ${RECUO_ITEM}px)` };
  const conteudo = <>
    <span className={`w-12 shrink-0 text-right text-xs tabular-nums ${atrasada ? "text-error/80" : "text-text-muted"}`}>{horario}</span>
    <Icone size={15} aria-hidden className={`shrink-0 ${atrasada && enfase ? "text-error" : registro ? "text-cyan/70" : "text-text-secondary"}`} style={item.icone !== "transacao" && corPropria ? { color: corPropria } : undefined} />
    <span className={`min-w-0 flex-1 truncate text-left text-[14px] ${corTexto}`}>
      {registro && <span className="text-text-muted">{item.detalhe} · </span>}{item.titulo}
    </span>
    {!registro && item.detalhe && <span className={`shrink-0 text-xs tabular-nums ${item.icone === "transacao" ? "fonte-cofre" : ""} ${item.detalhe === "Alta" ? "text-warning" : "text-text-muted"}`} style={item.icone === "transacao" ? { color: item.cor } : undefined}>{item.detalhe}</span>}
    {atrasada && enfase && <span className="shrink-0 rounded bg-error/15 px-1.5 py-0.5 text-[10px] font-semibold text-error">Atrasada</span>}
    {concluida && !registro && <Check size={14} aria-hidden className="shrink-0 text-success" />}
  </>;

  return <li data-item-timeline={item.chave} data-situacao={item.situacao} className="ecos-timeline-item group/linha relative hover:z-20 focus-within:z-20" style={{ "--i": indice } as CSSProperties}>
    {item.alvo
      ? <button type="button" onClick={(e) => acoes.onAbrir(item, e)} aria-label={`${registro ? `${item.detalhe} ` : ""}${item.titulo}${atrasada ? " (atrasada)" : ""}`} style={estilo} className={`${classe} hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan/70`}>{conteudo}</button>
      : <div style={estilo} className={classe}>{conteudo}</div>}
    {ramo?.porLinha && ramo.trilho && <TrilhoDaLinha />}
    {ramo && <RamoRegistro ramo={ramo} />}
    <span aria-hidden className={`pointer-events-none absolute top-1/2 z-10 h-[6px] w-[6px] -translate-x-1/2 -translate-y-1/2 rounded-full transition-transform duration-200 group-hover/linha:scale-150 ${corPonto} ${registro ? "ring-2 ring-cyan/15" : ""}`}
      style={{ left: x(registro ? REGISTRO : RAMO), backgroundColor: corDoPontoProprio }} />
    {item.alvo && <CartaoDetalhes item={item} acoes={acoes} />}
  </li>;
}

export function MarcadorAgora({ agora, trilho }: { agora: Date; /** Dia com registro: o trilho é desenhado por linha. */ trilho?: boolean }) {
  return <li aria-label="Agora" data-agora className="ecos-timeline-item relative flex h-6 items-center">
    {trilho && <TrilhoDaLinha />}
    <span aria-hidden className="ecos-timeline-agora absolute z-10 h-[9px] w-[9px] -translate-x-1/2 rounded-full bg-cyan" style={{ left: x(RAMO) }} />
    <span aria-hidden className="h-px flex-1 bg-gradient-to-r from-cyan/60 to-transparent" />
    <span className="ml-2 text-[11px] font-medium tabular-nums text-cyan">{rotuloHorario(agora.getHours() * 60 + agora.getMinutes())}</span>
  </li>;
}
