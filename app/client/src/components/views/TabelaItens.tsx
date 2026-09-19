import { useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import { ArrowDown, ArrowUp, CheckCircle2, Circle, Folder, StickyNote } from "lucide-react";
import { Avatar } from "@/components/common/Avatar";
import { TempoEdicao } from "@/components/common/TempoEdicao";
import { useAbrirDocumento } from "@/lib/documento-popup";
import { MOTIVO_CLASSES, MOTIVO_LABEL, formatDuracao } from "@/lib/format";
import type { FeedItem } from "@/lib/types";
import {
  CLASSE_PRIORIDADE,
  RANKING_PRIORIDADE,
  ROTULO_PRIORIDADE,
  caminhoDoItem,
  dataCurta,
  ehNota,
  ehTarefa,
  nomeDaPasta,
  pastaDoItem,
  prazoDaTarefa,
  tagsDoItem,
} from "./util";

interface Coluna {
  id: string;
  titulo: string;
  largura: number;
  ordenar?: (a: FeedItem, b: FeedItem) => number;
  celula: (item: FeedItem) => ReactNode;
}

const VAZIO = <span className="text-text-muted/60">—</span>;
const PILULA = "rounded-md px-1.5 py-0.5 text-[11px] font-medium";
const LARGURA_MIN = 72;

const cmpTexto = (a: string, b: string) => a.localeCompare(b, "pt-BR");
const cmpNumero = (a: number, b: number) => a - b;
const ms = (iso: string | undefined) => (iso ? new Date(iso).getTime() : 0);

interface Contexto {
  temNota: boolean;
  temTarefa: boolean;
  itens: FeedItem[];
  mostrarCriada: boolean;
  mostrarMotivo: boolean;
}

/** As colunas que fazem sentido para o que está na lista: só notas não mostram Prioridade, só tarefas não mostram Tipo, e sem dado nenhum a coluna some. */
function montarColunas({ temNota, temTarefa, itens, mostrarCriada, mostrarMotivo }: Contexto): Coluna[] {
  const colunas: Coluna[] = [
    {
      id: "titulo",
      titulo: "Nome",
      largura: 340,
      ordenar: (a, b) => cmpTexto(a.titulo, b.titulo),
      celula: (item) => {
        const concluida = ehTarefa(item) && item.status === "concluida";
        return (
          <span className="flex min-w-0 items-center gap-2">
            {ehNota(item) ? (
              <StickyNote size={15} strokeWidth={1.75} className="shrink-0 text-steel-300" />
            ) : concluida ? (
              <CheckCircle2 size={15} strokeWidth={1.75} className="shrink-0 text-success" />
            ) : (
              <Circle size={15} strokeWidth={1.75} className="shrink-0 text-text-muted" />
            )}
            <span className={`truncate font-medium ${concluida ? "text-text-muted line-through" : "text-text-primary"}`}>{item.titulo || "Sem título"}</span>
          </span>
        );
      },
    },
  ];

  if (temNota && temTarefa) {
    colunas.push({
      id: "tipo",
      titulo: "Tipo",
      largura: 92,
      ordenar: (a, b) => cmpTexto(a.tipo, b.tipo),
      celula: (item) => <span className={`${PILULA} ${ehNota(item) ? "bg-steel-500/20 text-steel-300" : "bg-cyan/15 text-cyan"}`}>{ehNota(item) ? "Nota" : "Tarefa"}</span>,
    });
  }

  if (temTarefa) {
    colunas.push(
      {
        id: "status",
        titulo: "Status",
        largura: 108,
        ordenar: (a, b) => cmpTexto(ehTarefa(a) ? a.status : "", ehTarefa(b) ? b.status : ""),
        celula: (item) =>
          ehTarefa(item) ? (
            <span className={`${PILULA} ${item.status === "concluida" ? "bg-success/15 text-success" : "bg-surface-3 text-text-secondary"}`}>{item.status === "concluida" ? "Concluída" : "Pendente"}</span>
          ) : (
            VAZIO
          ),
      },
      {
        id: "prioridade",
        titulo: "Prioridade",
        largura: 104,
        ordenar: (a, b) => cmpNumero(ehTarefa(a) ? RANKING_PRIORIDADE[a.prioridade] : 9, ehTarefa(b) ? RANKING_PRIORIDADE[b.prioridade] : 9),
        celula: (item) => (ehTarefa(item) ? <span className={`${PILULA} ${CLASSE_PRIORIDADE[item.prioridade]}`}>{ROTULO_PRIORIDADE[item.prioridade]}</span> : VAZIO),
      },
      {
        id: "prazo",
        titulo: "Prazo",
        largura: 132,
        ordenar: (a, b) => cmpNumero((ehTarefa(a) && prazoDaTarefa(a)?.ms) || Infinity, (ehTarefa(b) && prazoDaTarefa(b)?.ms) || Infinity),
        celula: (item) => {
          const prazo = ehTarefa(item) ? prazoDaTarefa(item) : null;
          return prazo ? <span className="truncate font-mono-value text-xs text-text-secondary">{prazo.texto}</span> : VAZIO;
        },
      },
      {
        id: "duracao",
        titulo: "Duração",
        largura: 92,
        ordenar: (a, b) => cmpNumero(ehTarefa(a) ? a.durationMin : 0, ehTarefa(b) ? b.durationMin : 0),
        celula: (item) => (ehTarefa(item) && item.durationMin > 0 ? <span className="text-text-secondary">{formatDuracao(item.durationMin)}</span> : VAZIO),
      },
    );
  }

  colunas.push(
    {
      id: "pasta",
      titulo: "Pasta",
      largura: 150,
      ordenar: (a, b) => cmpTexto(pastaDoItem(a) ?? "", pastaDoItem(b) ?? ""),
      celula: (item) => {
        const pasta = pastaDoItem(item);
        return pasta ? (
          <span className="flex min-w-0 items-center gap-1.5 text-text-secondary">
            <Folder size={13} strokeWidth={1.75} className="shrink-0 text-steel-300" />
            <span className="truncate" title={pasta}>{nomeDaPasta(pasta)}</span>
          </span>
        ) : (
          VAZIO
        );
      },
    },
    {
      id: "equipe",
      titulo: "Equipe",
      largura: 150,
      ordenar: (a, b) => cmpTexto(a.origemEquipe?.nome ?? "", b.origemEquipe?.nome ?? ""),
      celula: (item) =>
        item.origemEquipe ? (
          <span className="flex min-w-0 items-center gap-1.5 text-text-secondary">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: item.origemEquipe.cor }} />
            <span className="truncate" title={item.origemEquipe.nome}>{item.origemEquipe.nome}</span>
          </span>
        ) : (
          <span className="text-text-muted">Pessoal</span>
        ),
    },
  );

  if (itens.some((i) => tagsDoItem(i).length)) {
    colunas.push({
      id: "tags",
      titulo: "Tags",
      largura: 210,
      ordenar: (a, b) => cmpNumero(tagsDoItem(b).length, tagsDoItem(a).length),
      celula: (item) => {
        const tags = tagsDoItem(item);
        if (!tags.length) return VAZIO;
        return (
          <span className="flex min-w-0 items-center gap-1 overflow-hidden">
            {tags.slice(0, 3).map((t) => (
              <span key={t} className={`${PILULA} shrink-0 bg-surface-3 text-text-secondary`}>#{t}</span>
            ))}
            {tags.length > 3 && <span className="shrink-0 text-[11px] text-text-muted">+{tags.length - 3}</span>}
          </span>
        );
      },
    });
  }

  if (mostrarMotivo) {
    colunas.push({
      id: "motivo",
      titulo: "Motivo",
      largura: 120,
      ordenar: (a, b) => cmpTexto(ehNota(a) ? a.motivoRanking : "~", ehNota(b) ? b.motivoRanking : "~"),
      celula: (item) => {
        if (ehNota(item)) {
          const cores = MOTIVO_CLASSES[item.motivoRanking];
          return <span className={`${PILULA} ${cores.bg} ${cores.text}`}>{MOTIVO_LABEL[item.motivoRanking]}</span>;
        }
        return item.encaixadaNaAgenda ? <span className={`${PILULA} bg-cyan/15 text-cyan`}>Na agenda</span> : VAZIO;
      },
    });
  }

  if (itens.some((i) => i.atualizadoEm)) {
    colunas.push({
      id: "editada",
      titulo: "Editada",
      largura: 150,
      ordenar: (a, b) => cmpNumero(ms(a.atualizadoEm), ms(b.atualizadoEm)),
      celula: (item) => (item.atualizadoEm ? <TempoEdicao iso={item.atualizadoEm} className="truncate text-text-secondary" /> : VAZIO),
    });
  }

  if (temNota) {
    colunas.push({
      id: "revisada",
      titulo: "Revisada",
      largura: 118,
      ordenar: (a, b) => cmpNumero(ehNota(a) ? ms(a.ultimaRevisaoEm ?? undefined) : 0, ehNota(b) ? ms(b.ultimaRevisaoEm ?? undefined) : 0),
      celula: (item) => {
        if (!ehNota(item)) return VAZIO;
        return item.ultimaRevisaoEm ? <span className="font-mono-value text-xs text-text-secondary">{dataCurta(item.ultimaRevisaoEm)}</span> : <span className="text-text-muted">Nunca</span>;
      },
    });
  }

  if (mostrarCriada && itens.some((i) => i.criadoEm)) {
    colunas.push({
      id: "criada",
      titulo: "Criada",
      largura: 112,
      ordenar: (a, b) => cmpNumero(ms(a.criadoEm), ms(b.criadoEm)),
      celula: (item) => (item.criadoEm ? <span className="font-mono-value text-xs text-text-secondary">{dataCurta(item.criadoEm)}</span> : VAZIO),
    });
  }

  colunas.push({
    id: "dono",
    titulo: "Dono",
    largura: 150,
    ordenar: (a, b) => cmpTexto(a.dono.nome, b.dono.nome),
    celula: (item) => (
      <span className="flex min-w-0 items-center gap-2 text-text-secondary">
        <Avatar nome={item.dono.nome} corFundo={item.origemEquipe?.cor} tamanho={18} />
        <span className="truncate">{item.dono.nome}</span>
      </span>
    ),
  });

  return colunas;
}

const chaveLarguras = (chave: string) => `ecos.tabela.larguras:${chave}`;

function lerLarguras(chave: string): Record<string, number> {
  try {
    const bruto = JSON.parse(localStorage.getItem(chaveLarguras(chave)) ?? "{}");
    return bruto && typeof bruto === "object" ? bruto : {};
  } catch {
    return {};
  }
}

/**
 * Visualização em tabela, no estilo de planilha do Notion: uma linha por item,
 * colunas de propriedades (status, prioridade, prazo, pasta, tags…), clique no
 * cabeçalho ordena, arrastar a borda do cabeçalho redimensiona (a largura fica
 * guardada por tela) e clicar numa linha abre o item.
 */
export function TabelaItens({ itens, chave, mostrarCriada = false, mostrarMotivo = false, selecionados = new Set(), onSelecionar, saindo = new Set(), entrando = new Set() }: { itens: FeedItem[]; chave: string; mostrarCriada?: boolean; mostrarMotivo?: boolean; selecionados?: Set<string>; onSelecionar?: (event: MouseEvent, item: FeedItem, ordem: FeedItem[]) => boolean; saindo?: Set<string>; entrando?: Set<string> }) {
  const abrir = useAbrirDocumento();
  const [ordem, setOrdem] = useState<{ id: string; dir: 1 | -1 } | null>(null);
  const [larguras, setLarguras] = useState<Record<string, number>>(() => lerLarguras(chave));
  const arraste = useRef<{ id: string; x: number; largura: number } | null>(null);
  const largurasAtuais = useRef(larguras);

  const temNota = itens.some(ehNota);
  const temTarefa = itens.some(ehTarefa);
  const colunas = useMemo(() => montarColunas({ temNota, temTarefa, itens, mostrarCriada, mostrarMotivo }), [temNota, temTarefa, itens, mostrarCriada, mostrarMotivo]);
  const larguraDe = (c: Coluna) => larguras[c.id] ?? c.largura;

  const linhas = useMemo(() => {
    const coluna = ordem && colunas.find((c) => c.id === ordem.id);
    if (!ordem || !coluna?.ordenar) return itens;
    return [...itens].sort((a, b) => ordem.dir * coluna.ordenar!(a, b));
  }, [itens, ordem, colunas]);

  const modelo = colunas.map((c, i) => (i === colunas.length - 1 ? `minmax(${larguraDe(c)}px, 1fr)` : `${larguraDe(c)}px`)).join(" ");
  const larguraTotal = colunas.reduce((soma, c) => soma + larguraDe(c), 0);

  function alternarOrdem(coluna: Coluna) {
    if (!coluna.ordenar) return;
    setOrdem((atual) => (atual?.id !== coluna.id ? { id: coluna.id, dir: 1 } : atual.dir === 1 ? { id: coluna.id, dir: -1 } : null));
  }

  function iniciarRedimensionar(e: PointerEvent<HTMLElement>, coluna: Coluna) {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    arraste.current = { id: coluna.id, x: e.clientX, largura: larguraDe(coluna) };
  }

  function moverRedimensionar(e: PointerEvent<HTMLElement>) {
    const a = arraste.current;
    if (!a) return;
    largurasAtuais.current = { ...largurasAtuais.current, [a.id]: Math.max(LARGURA_MIN, Math.round(a.largura + e.clientX - a.x)) };
    setLarguras(largurasAtuais.current);
  }

  function encerrarRedimensionar() {
    if (!arraste.current) return;
    arraste.current = null;
    try {
      localStorage.setItem(chaveLarguras(chave), JSON.stringify(largurasAtuais.current));
    } catch {
      /* só não persiste */
    }
  }

  function aoTeclarNaLinha(e: KeyboardEvent<HTMLDivElement>, item: FeedItem) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      abrir(caminhoDoItem(item), e);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="max-h-[72vh] overflow-auto rounded-xl border border-border bg-surface-1">
        <div role="table" aria-label="Itens" aria-rowcount={linhas.length + 1} style={{ minWidth: larguraTotal }}>
          <div role="row" className="sticky top-0 z-10 grid border-b border-border bg-surface-2" style={{ gridTemplateColumns: modelo }}>
            {colunas.map((coluna) => {
              const ativa = ordem?.id === coluna.id;
              return (
                <div key={coluna.id} role="columnheader" aria-sort={ativa ? (ordem!.dir === 1 ? "ascending" : "descending") : "none"} className="group relative flex h-9 min-w-0 items-center">
                  <button
                    type="button"
                    onClick={() => alternarOrdem(coluna)}
                    disabled={!coluna.ordenar}
                    className="flex h-full min-w-0 flex-1 items-center gap-1.5 px-3 text-left text-xs font-medium text-text-muted hover:text-text-primary"
                  >
                    <span className="truncate">{coluna.titulo}</span>
                    {ativa && (ordem!.dir === 1 ? <ArrowUp size={12} className="shrink-0 text-cyan" /> : <ArrowDown size={12} className="shrink-0 text-cyan" />)}
                  </button>
                  <span
                    role="separator"
                    aria-orientation="vertical"
                    aria-label={`Redimensionar ${coluna.titulo}`}
                    onPointerDown={(e) => iniciarRedimensionar(e, coluna)}
                    onPointerMove={moverRedimensionar}
                    onPointerUp={encerrarRedimensionar}
                    onPointerCancel={encerrarRedimensionar}
                    onDoubleClick={() => {
                      const { [coluna.id]: _, ...resto } = largurasAtuais.current;
                      largurasAtuais.current = resto;
                      setLarguras(resto);
                      try {
                        localStorage.setItem(chaveLarguras(chave), JSON.stringify(resto));
                      } catch {
                        /* só não persiste */
                      }
                    }}
                    title="Arraste para redimensionar — duplo clique restaura"
                    className="absolute -right-1 top-0 z-20 flex h-full w-2 cursor-col-resize touch-none justify-center"
                  >
                    <span className="h-full w-px bg-border transition-colors group-hover:bg-steel-400" />
                  </span>
                </div>
              );
            })}
          </div>

          {linhas.map((item) => (
            <div
              key={`${item.tipo}-${item.id}`}
              role="row"
              tabIndex={0}
              onClick={(e) => { if (!onSelecionar?.(e, item, linhas)) abrir(caminhoDoItem(item), e); }}
              onKeyDown={(e) => aoTeclarNaLinha(e, item)}
              className={`grid min-h-[40px] cursor-pointer border-b border-border text-[13px] last:border-b-0 hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none ${saindo.has(`${item.tipo}:${item.id}`) ? "ecos-item-sai pointer-events-none" : entrando.has(`${item.tipo}:${item.id}`) ? "ecos-item-entra" : ""} ${selecionados.has(`${item.tipo}:${item.id}`) ? "bg-steel-700/25" : ""}`}
              style={{ gridTemplateColumns: modelo }}
            >
              {colunas.map((coluna) => (
                <div key={coluna.id} role="cell" className="flex min-w-0 items-center px-3 py-1.5">
                  {coluna.id === "titulo" && onSelecionar && <input data-ecos-selection-control type="checkbox" checked={selecionados.has(`${item.tipo}:${item.id}`)} readOnly aria-label={`Selecionar ${item.titulo || "item"}`} title="Selecionar — Shift seleciona um intervalo" className="mr-2 h-4 w-4 shrink-0 cursor-pointer appearance-none rounded border-2 border-text-muted bg-surface-1 checked:border-steel-400 checked:bg-steel-500 checked:after:block checked:after:pl-[2px] checked:after:text-[11px] checked:after:leading-[11px] checked:after:text-white checked:after:content-['✓'] focus-visible:outline focus-visible:outline-2 focus-visible:outline-steel-400" />}
                  {coluna.celula(item)}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
      <p className="px-1 text-xs text-text-muted">{linhas.length} {linhas.length === 1 ? "item" : "itens"}</p>
    </div>
  );
}
