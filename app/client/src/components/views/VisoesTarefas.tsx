import { useLayoutEffect, useRef, useState, type ReactNode, type DragEvent, type MouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { CheckCircle2, ChevronDown, ChevronRight, Circle, RotateCcw, StickyNote } from "lucide-react";
import { ApiError, tarefas as tarefasApi } from "@/lib/api";
import { useRefreshBus } from "@/lib/refresh-bus";
import { useAbrirDocumento } from "@/lib/documento-popup";
import { movimentoReduzido } from "@/lib/movimento";
import type { FeedItem, PrioridadeTarefa, Tarefa } from "@/lib/types";
import { CLASSE_PRIORIDADE, ROTULO_PRIORIDADE, RANKING_PRIORIDADE, caminhoDoItem, nomeDaPasta, pastaDoItem, prazoDaTarefa } from "./util";

type Selecionar = (event: MouseEvent, item: FeedItem, ordem: FeedItem[]) => boolean;

interface Comum {
  itens: FeedItem[];
  selecionados?: Set<string>;
  onSelecionar?: Selecionar;
  saindo?: Set<string>;
  entrando?: Set<string>;
}

const chaveDo = (item: FeedItem) => `${item.tipo}:${item.id}`;
const tarefasDe = (itens: FeedItem[]) => itens.filter((i): i is Tarefa => i.tipo === "tarefa");
const notasDe = (itens: FeedItem[]) => itens.filter((i) => i.tipo === "nota");

const inicioDoDia = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
const DIA = 86_400_000;

function porPrioridadeEPrazo(a: Tarefa, b: Tarefa) {
  return RANKING_PRIORIDADE[a.prioridade] - RANKING_PRIORIDADE[b.prioridade] || (prazoDaTarefa(a)?.ms ?? Infinity) - (prazoDaTarefa(b)?.ms ?? Infinity);
}

/** Cartão compacto usado pelas visões Kanban, Agrupada e Matriz. `arrastavel` liga o arrastar-e-soltar do Kanban. */
function Cartao({ item, comum, arrastavel = false }: { item: FeedItem; comum: Comum; arrastavel?: boolean }) {
  const abrir = useAbrirDocumento();
  const chave = chaveDo(item);
  const marcado = comum.selecionados?.has(chave);
  const animacao = comum.saindo?.has(chave) ? "ecos-item-sai pointer-events-none" : comum.entrando?.has(chave) ? "ecos-item-entra" : "";
  const aoArrastar = (e: DragEvent) => { e.dataTransfer.setData("text/ecos-tarefa", item.id); e.dataTransfer.effectAllowed = "move"; };
  const nota = item.tipo === "nota";
  const concluida = !nota && item.status === "concluida";
  const prazo = !nota ? prazoDaTarefa(item) : null;
  return (
    <div data-flip={chave} onClickCapture={(e) => { comum.onSelecionar?.(e, item, comum.itens); }} className={`${animacao} ${marcado ? "rounded-lg ring-2 ring-steel-400 ring-offset-2 ring-offset-base" : ""}`}>
      <button
        type="button"
        draggable={arrastavel && !nota}
        onDragStart={arrastavel && !nota ? aoArrastar : undefined}
        onClick={(e) => abrir(caminhoDoItem(item), e)}
        className={`flex w-full flex-col gap-1.5 rounded-lg border-0 bg-surface-1 p-3 text-left shadow-[0_1px_2px_rgba(0,0,0,0.12),0_0_0_1px_rgba(128,128,128,0.12)] transition-shadow hover:shadow-[0_2px_6px_rgba(0,0,0,0.18),0_0_0_1px_rgba(128,128,128,0.2)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-steel-400 ${arrastavel && !nota ? "cursor-grab active:cursor-grabbing" : ""}`}
      >
        <span className="flex items-start gap-2">
          {nota ? <StickyNote size={15} strokeWidth={1.75} className="mt-0.5 shrink-0 text-steel-300" /> : concluida ? <CheckCircle2 size={15} strokeWidth={1.75} className="mt-0.5 shrink-0 text-success" /> : <Circle size={15} strokeWidth={1.75} className="mt-0.5 shrink-0 text-text-muted" />}
          <span className={`line-clamp-3 text-sm font-medium leading-snug ${concluida ? "text-text-muted line-through" : "text-text-primary"}`}>{item.titulo || "Sem título"}</span>
        </span>
        {!nota && (
          <span className="flex flex-wrap items-center gap-1.5 text-[11px] text-text-muted">
            <span className={`rounded-md px-1.5 py-0.5 font-medium ${CLASSE_PRIORIDADE[item.prioridade]}`}>{ROTULO_PRIORIDADE[item.prioridade]}</span>
            {prazo && <span className="font-mono-value">{prazo.texto}</span>}
            {pastaDoItem(item) && <span className="truncate">{nomeDaPasta(pastaDoItem(item)!)}</span>}
          </span>
        )}
      </button>
    </div>
  );
}

/** Cor de cada coluna do quadro (estilo Notion): bolinha, pílula do título e fundo suave. */
interface TomColuna { ponto: string; pilula: string; fundo: string }
const tom = (rgb: string): TomColuna => ({ ponto: `rgb(${rgb})`, pilula: `rgb(${rgb} / 0.16)`, fundo: `rgb(${rgb} / 0.06)` });
const TOM_NEUTRO = tom("120 120 120");
const TOM_COLUNA: Record<string, TomColuna> = {
  pendente: tom("217 115 13"),
  concluida: tom("68 131 97"),
  alta: tom("212 76 71"),
  media: tom("217 115 13"),
  baixa: tom("51 126 169"),
  notas: TOM_NEUTRO,
};

function CabecalhoColuna({ rotulo, n, id }: { rotulo: string; n: number; id: string }) {
  const t = TOM_COLUNA[id] ?? TOM_NEUTRO;
  return (
    <h3 className="flex items-center gap-2 px-0.5 text-sm">
      <span className="flex items-center gap-1.5 rounded-md px-2 py-0.5 font-medium text-text-primary" style={{ background: t.pilula }}>
        <span className="size-2 rounded-full" style={{ background: t.ponto }} />{rotulo}
      </span>
      <span className="text-xs font-medium text-text-muted">{n}</span>
    </h3>
  );
}

function Contagem({ n }: { n: number }) {
  return <span className="rounded-full bg-surface-3 px-2 py-0.5 text-[11px] font-medium text-text-secondary">{n}</span>;
}

/* ───────────────────────────── Kanban ───────────────────────────── */

type ColunasPor = "status" | "prioridade";

interface Coluna { id: string; rotulo: string; itens: Tarefa[]; aplicar: (id: string) => Promise<unknown> }

function lerColunasPor(): ColunasPor {
  try { return localStorage.getItem("ecos:kanban:colunas") === "prioridade" ? "prioridade" : "status"; } catch { return "status"; }
}

/** Largura mínima do cartão: a coluna alarga e os cartões crescem junto, até caber mais uma coluna de cartões. */
const LARGURA_CARTAO = 260;
/** Cartão + respiro interno (p-2.5) e borda da coluna. */
const LARGURA_PADRAO = LARGURA_CARTAO + 22;
const LARGURA_MIN = LARGURA_PADRAO;
const GRADE_CARTOES = { gridTemplateColumns: `repeat(auto-fill, minmax(${LARGURA_CARTAO}px, 1fr))` };
const VAO = 8;
const colunasDaGrade = (larguraColuna: number) => Math.min(MAX_CARTOES_POR_LINHA, Math.max(1, Math.floor((larguraColuna - 22 + VAO) / (LARGURA_CARTAO + VAO))));

/**
 * Grade de cartões que anima o reposicionamento (FLIP) quando o número de colunas da grade muda
 * ou quando cartões entram/saem — os cartões deslizam até o novo lugar em vez de pular.
 */
function GradeFluida({ colunas, children }: { colunas: number; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const anterior = useRef<{ colunas: number; ids: string; posicoes: Map<string, { x: number; y: number }> } | null>(null);
  useLayoutEffect(() => {
    const raiz = ref.current;
    if (!raiz) return;
    const base = raiz.getBoundingClientRect();
    const filhos = [...raiz.children] as HTMLElement[];
    const posicoes = new Map(filhos.map((el, i) => { const b = el.getBoundingClientRect(); return [el.dataset.flip ?? String(i), { x: b.left - base.left, y: b.top - base.top }] as const; }));
    const ids = [...posicoes.keys()].join("|");
    const antes = anterior.current;
    if (antes && (antes.colunas !== colunas || antes.ids !== ids) && !movimentoReduzido()) {
      filhos.forEach((el, i) => {
        const nova = posicoes.get(el.dataset.flip ?? String(i));
        const velha = antes.posicoes.get(el.dataset.flip ?? String(i));
        if (!nova || !velha) return;
        const dx = velha.x - nova.x, dy = velha.y - nova.y;
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
        el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "translate(0, 0)" }], { duration: 320, easing: "cubic-bezier(0.22, 1, 0.36, 1)" });
      });
    }
    anterior.current = { colunas, ids, posicoes };
  });
  return <div ref={ref} className="grid content-start gap-2" style={GRADE_CARTOES}>{children}</div>;
}
/** No máximo 5 cartões por linha: 5 cartões + 4 vãos de 8px + respiro da coluna. */
const MAX_CARTOES_POR_LINHA = 5;
const LARGURA_MAX = MAX_CARTOES_POR_LINHA * LARGURA_CARTAO + (MAX_CARTOES_POR_LINHA - 1) * 8 + 22;

function lerLarguras(): Record<string, number> {
  try {
    const bruto = JSON.parse(localStorage.getItem("ecos:kanban:larguras") ?? "{}");
    return bruto && typeof bruto === "object" ? bruto : {};
  } catch { return {}; }
}

/** Alça na borda direita da coluna: arrastar com o mouse muda a largura; duplo clique volta ao padrão. */
function AlcaLargura({ largura, onInicio, onMudar, onSoltar, onRestaurar, rotulo }: { largura: number; onInicio: () => void; onMudar: (l: number) => void; onSoltar: () => void; onRestaurar: () => void; rotulo: string }) {
  function aoPressionar(e: ReactPointerEvent<HTMLDivElement>) {
    e.preventDefault();
    const alvo = e.currentTarget;
    alvo.setPointerCapture(e.pointerId);
    const x0 = e.clientX;
    onInicio();
    const mover = (ev: PointerEvent) => onMudar(Math.min(LARGURA_MAX, Math.max(LARGURA_MIN, largura + ev.clientX - x0)));
    const fim = () => { alvo.removeEventListener("pointermove", mover); alvo.removeEventListener("pointerup", fim); alvo.removeEventListener("pointercancel", fim); onSoltar(); };
    alvo.addEventListener("pointermove", mover);
    alvo.addEventListener("pointerup", fim);
    alvo.addEventListener("pointercancel", fim);
  }
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={`Redimensionar coluna ${rotulo}`}
      title="Arraste para ajustar a largura — duplo clique restaura"
      onPointerDown={aoPressionar}
      onDoubleClick={onRestaurar}
      className="group/alca absolute -right-2 top-0 z-10 flex h-full w-4 cursor-col-resize touch-none justify-center"
    >
      <span className="h-full w-0.5 rounded-full bg-transparent transition-colors group-hover/alca:bg-steel-400/70" />
    </div>
  );
}

/** Quadro em colunas. Arrastar um cartão para outra coluna muda o status (ou a prioridade) da Tarefa. */
export function KanbanItens(comum: Comum) {
  const { notificar } = useRefreshBus();
  const [por, setPor] = useState<ColunasPor>(lerColunasPor);
  const [sobre, setSobre] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [larguras, setLarguras] = useState<Record<string, number>>(lerLarguras);
  // Enquanto a alça é arrastada a largura segue o mouse sem atraso; fora disso (restaurar) ela desliza.
  const [redimensionando, setRedimensionando] = useState(false);
  const tarefas = tarefasDe(comum.itens);
  const notas = notasDe(comum.itens);
  const larguraDe = (id: string) => Math.min(LARGURA_MAX, larguras[`${por}:${id}`] ?? LARGURA_PADRAO);
  const mudarLargura = (id: string, l: number) => setLarguras((atual) => ({ ...atual, [`${por}:${id}`]: l }));
  const terminarRedimensao = () => { setRedimensionando(false); setLarguras((atual) => { guardarLarguras(atual); return atual; }); };
  const guardarLarguras = (proximas: Record<string, number>) => { try { localStorage.setItem("ecos:kanban:larguras", JSON.stringify(proximas)); } catch { /* cache indisponível */ } };
  const restaurarColuna = (id: string) => setLarguras((atual) => { const { [`${por}:${id}`]: _, ...resto } = atual; guardarLarguras(resto); return resto; });
  const restaurarTodas = () => { setLarguras({}); guardarLarguras({}); };
  const personalizado = Object.keys(larguras).length > 0;

  function escolher(proximo: ColunasPor) {
    setPor(proximo);
    try { localStorage.setItem("ecos:kanban:colunas", proximo); } catch { /* cache indisponível */ }
  }

  const colunas: Coluna[] = por === "status"
    ? [
        { id: "pendente", rotulo: "Pendentes", itens: tarefas.filter((t) => t.status === "pendente"), aplicar: (id) => tarefasApi.atualizarStatus(id, "pendente") },
        { id: "concluida", rotulo: "Concluídas", itens: tarefas.filter((t) => t.status === "concluida"), aplicar: (id) => tarefasApi.atualizarStatus(id, "concluida") },
      ]
    : (["alta", "media", "baixa"] as PrioridadeTarefa[]).map((p) => ({
        id: p,
        rotulo: ROTULO_PRIORIDADE[p],
        itens: tarefas.filter((t) => t.prioridade === p),
        aplicar: (id: string) => tarefasApi.atualizar(id, { prioridade: p }),
      }));

  async function soltar(e: DragEvent, coluna: Coluna) {
    e.preventDefault();
    setSobre(null);
    const id = e.dataTransfer.getData("text/ecos-tarefa");
    const tarefa = tarefas.find((t) => t.id === id);
    if (!tarefa || coluna.itens.some((t) => t.id === id)) return;
    setErro(null);
    try { await coluna.aplicar(id); notificar(); }
    catch (err) { setErro(err instanceof ApiError ? err.message : "Não foi possível mover a tarefa."); }
  }

  return (
    <div>
      <div className="mb-3 flex items-center gap-2 text-xs text-text-muted" role="group" aria-label="Colunas do quadro">
        <span>Colunas por</span>
        {(["status", "prioridade"] as const).map((opcao) => (
          <button key={opcao} type="button" aria-pressed={por === opcao} onClick={() => escolher(opcao)} className={`rounded-md px-2.5 py-1 font-medium ${por === opcao ? "bg-surface-3 text-text-primary" : "hover:text-text-secondary"}`}>{opcao === "status" ? "Status" : "Prioridade"}</button>
        ))}
        <button type="button" onClick={restaurarTodas} disabled={!personalizado} title="Restaurar a largura padrão das colunas" className="ml-2 flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium hover:text-text-secondary disabled:pointer-events-none disabled:opacity-40"><RotateCcw size={12} />Restaurar colunas</button>
      </div>
      {erro && <p role="alert" className="mb-3 text-sm text-error">{erro}</p>}
      <div className="flex items-start gap-3 overflow-x-auto pb-2">
        {colunas.map((coluna) => (
          <section
            key={coluna.id}
            aria-label={coluna.rotulo}
            onDragOver={(e) => { e.preventDefault(); setSobre(coluna.id); }}
            onDragLeave={() => setSobre((atual) => (atual === coluna.id ? null : atual))}
            onDrop={(e) => void soltar(e, coluna)}
            style={{ width: larguraDe(coluna.id), background: (TOM_COLUNA[coluna.id] ?? TOM_NEUTRO).fundo, transition: redimensionando ? "box-shadow 150ms" : "width 320ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow 150ms" }}
            className={`relative flex min-h-40 shrink-0 flex-col gap-2 rounded-xl p-2.5 ${sobre === coluna.id ? "ring-2 ring-steel-400" : ""}`}
          >
            <AlcaLargura rotulo={coluna.rotulo} largura={larguraDe(coluna.id)} onInicio={() => setRedimensionando(true)} onMudar={(l) => mudarLargura(coluna.id, l)} onSoltar={terminarRedimensao} onRestaurar={() => restaurarColuna(coluna.id)} />
            <CabecalhoColuna id={coluna.id} rotulo={coluna.rotulo} n={coluna.itens.length} />
            {coluna.itens.length === 0 && <p className="px-1 py-4 text-center text-xs text-text-muted">Solte tarefas aqui</p>}
            <GradeFluida colunas={colunasDaGrade(larguraDe(coluna.id))}>
              {[...coluna.itens].sort(porPrioridadeEPrazo).map((t) => <Cartao key={t.id} item={t} comum={comum} arrastavel />)}
            </GradeFluida>
          </section>
        ))}
        {notas.length > 0 && (
          <section aria-label="Notas" style={{ width: larguraDe("notas"), background: TOM_NEUTRO.fundo, transition: redimensionando ? undefined : "width 320ms cubic-bezier(0.22, 1, 0.36, 1)" }} className="relative flex shrink-0 flex-col gap-2 rounded-xl p-2.5">
            <AlcaLargura rotulo="Notas" largura={larguraDe("notas")} onInicio={() => setRedimensionando(true)} onMudar={(l) => mudarLargura("notas", l)} onSoltar={terminarRedimensao} onRestaurar={() => restaurarColuna("notas")} />
            <CabecalhoColuna id="notas" rotulo="Notas" n={notas.length} />
            <GradeFluida colunas={colunasDaGrade(larguraDe("notas"))}>
              {notas.map((n) => <Cartao key={n.id} item={n} comum={comum} />)}
            </GradeFluida>
          </section>
        )}
      </div>
    </div>
  );
}

/* ───────────────────────────── Agrupada ───────────────────────────── */

type AgruparPor = "prazo" | "prioridade" | "pasta";

const ROTULO_AGRUPAMENTO: Record<AgruparPor, string> = { prazo: "Prazo", prioridade: "Prioridade", pasta: "Pasta" };

function lerAgruparPor(): AgruparPor {
  try {
    const salvo = localStorage.getItem("ecos:agrupada:por");
    return salvo === "prioridade" || salvo === "pasta" ? salvo : "prazo";
  } catch { return "prazo"; }
}

function grupoDePrazo(t: Tarefa, hoje: number): string {
  if (t.status === "concluida") return "Concluídas";
  const prazo = prazoDaTarefa(t);
  if (!prazo) return "Sem prazo";
  const dias = Math.floor((inicioDoDia(new Date(prazo.ms)) - hoje) / DIA);
  if (dias < 0) return "Atrasadas";
  if (dias === 0) return "Hoje";
  if (dias === 1) return "Amanhã";
  if (dias < 7) return "Esta semana";
  return "Depois";
}

const ORDEM_PRAZO = ["Atrasadas", "Hoje", "Amanhã", "Esta semana", "Depois", "Sem prazo", "Concluídas"];

/** Seções recolhíveis por prazo, prioridade ou pasta. */
export function AgrupadaItens(comum: Comum) {
  const [por, setPor] = useState<AgruparPor>(lerAgruparPor);
  const [recolhidos, setRecolhidos] = useState<Set<string>>(new Set());
  const tarefas = tarefasDe(comum.itens);
  const notas = notasDe(comum.itens);
  const hoje = inicioDoDia(new Date());

  function escolher(proximo: AgruparPor) {
    setPor(proximo);
    try { localStorage.setItem("ecos:agrupada:por", proximo); } catch { /* cache indisponível */ }
  }

  const mapa = new Map<string, FeedItem[]>();
  const colocar = (rotulo: string, item: FeedItem) => mapa.set(rotulo, [...(mapa.get(rotulo) ?? []), item]);
  for (const t of [...tarefas].sort(porPrioridadeEPrazo)) {
    colocar(por === "prazo" ? grupoDePrazo(t, hoje) : por === "prioridade" ? ROTULO_PRIORIDADE[t.prioridade] : pastaDoItem(t) ? nomeDaPasta(pastaDoItem(t)!) : "Sem pasta", t);
  }
  for (const n of notas) colocar("Notas", n);

  const ordemFixa = por === "prazo" ? ORDEM_PRAZO : por === "prioridade" ? ["Alta", "Média", "Baixa"] : [];
  const rotulos = [...mapa.keys()].sort((a, b) => {
    if (a === "Notas" || b === "Notas") return a === "Notas" ? 1 : -1;
    if (ordemFixa.length) return ordemFixa.indexOf(a) - ordemFixa.indexOf(b);
    if (a === "Sem pasta" || b === "Sem pasta") return a === "Sem pasta" ? 1 : -1;
    return a.localeCompare(b, "pt-BR");
  });

  const alternar = (rotulo: string) => setRecolhidos((atual) => { const prox = new Set(atual); if (prox.has(rotulo)) prox.delete(rotulo); else prox.add(rotulo); return prox; });

  return (
    <div className="mx-auto w-full max-w-[780px]">
      <div className="mb-3 flex items-center gap-2 text-xs text-text-muted" role="group" aria-label="Agrupar por">
        <span>Agrupar por</span>
        {(Object.keys(ROTULO_AGRUPAMENTO) as AgruparPor[]).map((opcao) => (
          <button key={opcao} type="button" aria-pressed={por === opcao} onClick={() => escolher(opcao)} className={`rounded-md px-2.5 py-1 font-medium ${por === opcao ? "bg-surface-3 text-text-primary" : "hover:text-text-secondary"}`}>{ROTULO_AGRUPAMENTO[opcao]}</button>
        ))}
      </div>
      <div className="flex flex-col gap-4">
        {rotulos.map((rotulo) => {
          const itens = mapa.get(rotulo)!;
          const aberto = !recolhidos.has(rotulo);
          return (
            <section key={rotulo} aria-label={rotulo}>
              <button type="button" aria-expanded={aberto} onClick={() => alternar(rotulo)} className={`mb-2 flex w-full items-center gap-2 text-xs font-semibold uppercase tracking-wide ${rotulo === "Atrasadas" ? "text-error" : "text-text-muted"}`}>
                {aberto ? <ChevronDown size={14} /> : <ChevronRight size={14} />}{rotulo}<Contagem n={itens.length} />
              </button>
              {aberto && <div className="flex flex-col gap-2">{itens.map((item) => <Cartao key={chaveDo(item)} item={item} comum={comum} />)}</div>}
            </section>
          );
        })}
      </div>
    </div>
  );
}

/* ───────────────────────────── Matriz ───────────────────────────── */

/** Janela, em dias a partir de hoje, em que uma tarefa conta como urgente (atrasadas incluídas). */
const JANELA_URGENTE_DIAS = 3;

const QUADRANTES = [
  { id: "agora", titulo: "Fazer agora", dica: "Importante e urgente", importante: true, urgente: true },
  { id: "planejar", titulo: "Planejar", dica: "Importante, sem urgência", importante: true, urgente: false },
  { id: "rapidas", titulo: "Resolver rápido", dica: "Urgente, menos importante", importante: false, urgente: true },
  { id: "depois", titulo: "Deixar para depois", dica: "Nem importante nem urgente", importante: false, urgente: false },
] as const;

/** Matriz de Eisenhower: importância vem da prioridade (média e alta) e urgência do prazo (até 3 dias ou atrasado). Tarefas concluídas ficam de fora. */
export function MatrizItens(comum: Comum) {
  const hoje = inicioDoDia(new Date());
  const abertas = tarefasDe(comum.itens).filter((t) => t.status === "pendente");
  const concluidas = tarefasDe(comum.itens).length - abertas.length;
  const urgente = (t: Tarefa) => { const p = prazoDaTarefa(t); return !!p && p.ms < hoje + JANELA_URGENTE_DIAS * DIA; };
  const importante = (t: Tarefa) => t.prioridade !== "baixa";

  return (
    <div>
      <div className="grid gap-3 md:grid-cols-2">
        {QUADRANTES.map((q) => {
          const itens = abertas.filter((t) => importante(t) === q.importante && urgente(t) === q.urgente).sort(porPrioridadeEPrazo);
          return (
            <section key={q.id} aria-label={q.titulo} className="flex min-h-48 flex-col gap-2 rounded-2xl border border-border bg-surface-2/50 p-3">
              <h3 className="flex items-baseline justify-between gap-2 px-1">
                <span className="text-sm font-semibold text-text-primary">{q.titulo} <span className="text-xs font-normal text-text-muted">· {q.dica}</span></span>
                <Contagem n={itens.length} />
              </h3>
              {itens.length === 0 && <p className="px-1 py-6 text-center text-xs text-text-muted">Nada por aqui</p>}
              {itens.map((t) => <Cartao key={t.id} item={t} comum={comum} />)}
            </section>
          );
        })}
      </div>
      {(concluidas > 0 || notasDe(comum.itens).length > 0) && (
        <p className="mt-3 text-xs text-text-muted">
          {concluidas > 0 && `${concluidas} concluída${concluidas === 1 ? "" : "s"}`}
          {concluidas > 0 && notasDe(comum.itens).length > 0 && " e "}
          {notasDe(comum.itens).length > 0 && `${notasDe(comum.itens).length} nota${notasDe(comum.itens).length === 1 ? "" : "s"}`} fora da matriz.
        </p>
      )}
    </div>
  );
}
