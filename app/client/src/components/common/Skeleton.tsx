import type { ReactNode } from "react";
import { ATRASO_SKELETON_MS, useAtraso } from "@/lib/use-atraso";

type Variante = "texto" | "linha" | "circulo" | "bloco";

const BASE: Record<Variante, string> = {
  texto: "h-3 rounded-md",
  linha: "h-4 rounded-md",
  circulo: "aspect-square rounded-full",
  bloco: "rounded-2xl",
};

/** Peça decorativa de skeleton. Sempre dentro de uma `SkeletonRegiao`; fica fora da árvore de acessibilidade. */
export function Skeleton({ variante = "linha", className = "" }: { variante?: Variante; className?: string }) {
  return <span aria-hidden="true" data-skeleton={variante} className={`ecos-skeleton block shrink-0 bg-surface-3 ${BASE[variante]} ${className}`} />;
}

/**
 * Região de carregamento: anuncia o rótulo a leitores de tela de imediato e só desenha o skeleton depois de
 * `atrasoMs` (carregamentos curtos não piscam). O container existe desde o início, então o texto fica no DOM.
 */
export function SkeletonRegiao({
  rotulo = "Carregando…",
  atrasoMs = ATRASO_SKELETON_MS,
  className = "",
  children,
}: {
  rotulo?: string;
  atrasoMs?: number;
  className?: string;
  children: ReactNode;
}) {
  const visivel = useAtraso(true, atrasoMs);
  return (
    <div role="status" aria-busy="true" className={className}>
      <span className="sr-only">{rotulo}</span>
      {visivel && <div aria-hidden="true">{children}</div>}
    </div>
  );
}

const larguras = ["w-3/4", "w-full", "w-5/6", "w-2/3"];

/** Linhas de texto com larguras variadas (a última sempre mais curta). */
export function SkeletonTexto({ linhas = 3, className = "" }: { linhas?: number; className?: string }) {
  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      {Array.from({ length: linhas }, (_, i) => (
        <Skeleton key={i} variante="texto" className={i === linhas - 1 && linhas > 1 ? "w-1/2" : larguras[i % larguras.length]} />
      ))}
    </div>
  );
}

/** Card de nota/tarefa do Feed e das listas em modo cards (mesmas bordas e espaçamento do card real). */
export function SkeletonCardItem() {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border bg-surface-1 p-4">
      <div className="flex items-center gap-3">
        <Skeleton variante="circulo" className="h-8 w-8" />
        <Skeleton variante="linha" className="w-2/5" />
      </div>
      <SkeletonTexto linhas={2} />
      <div className="flex gap-2">
        <Skeleton variante="linha" className="h-5 w-16 rounded-pill" />
        <Skeleton variante="linha" className="h-5 w-12 rounded-pill" />
      </div>
    </div>
  );
}

type Props = { rotulo?: string; className?: string; atrasoMs?: number };

export function SkeletonCards({ itens = 3, ...r }: Props & { itens?: number }) {
  return (
    <SkeletonRegiao {...r}>
      <div className="flex flex-col gap-3">
        {Array.from({ length: itens }, (_, i) => <SkeletonCardItem key={i} />)}
      </div>
    </SkeletonRegiao>
  );
}

/** Lista de linhas com ícone/avatar à esquerda, título e subtítulo. */
export function SkeletonLista({ itens = 5, ...r }: Props & { itens?: number }) {
  return (
    <SkeletonRegiao {...r}>
      <div className="overflow-hidden rounded-2xl border border-border bg-surface-1">
        {Array.from({ length: itens }, (_, i) => (
          <div key={i} className={`flex min-h-14 items-center gap-3 px-4 py-3 ${i > 0 ? "border-t border-border" : ""}`}>
            <Skeleton variante="circulo" className="h-9 w-9" />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <Skeleton variante="linha" className="w-3/5" />
              <Skeleton variante="texto" className="w-2/5" />
            </div>
          </div>
        ))}
      </div>
    </SkeletonRegiao>
  );
}

/** Tabela simples: cabeçalho + linhas com `colunas` células. */
export function SkeletonTabela({ linhas = 5, colunas = 3, ...r }: Props & { linhas?: number; colunas?: number }) {
  const grade = { gridTemplateColumns: `repeat(${colunas}, minmax(0, 1fr))` };
  return (
    <SkeletonRegiao {...r}>
      <div className="overflow-hidden rounded-2xl border border-border bg-surface-1">
        <div className="grid gap-4 border-b border-border px-4 py-3" style={grade}>
          {Array.from({ length: colunas }, (_, c) => <Skeleton key={c} variante="texto" className="w-1/2" />)}
        </div>
        {Array.from({ length: linhas }, (_, rr) => (
          <div key={rr} className={`grid gap-4 px-4 py-3 ${rr > 0 ? "border-t border-border" : ""}`} style={grade}>
            {Array.from({ length: colunas }, (_, c) => <Skeleton key={c} variante="linha" className={c === 0 ? "w-4/5" : "w-3/5"} />)}
          </div>
        ))}
      </div>
    </SkeletonRegiao>
  );
}

/** Grade de miniaturas quadradas (Mídia). */
export function SkeletonGrade({ itens = 6, ...r }: Props & { itens?: number }) {
  return (
    <SkeletonRegiao {...r}>
      <div className="grid grid-cols-2 gap-3">
        {Array.from({ length: itens }, (_, i) => (
          <div key={i} className="overflow-hidden rounded-2xl border border-border bg-surface-1">
            <Skeleton variante="bloco" className="aspect-square w-full rounded-none" />
            <div className="p-3"><Skeleton variante="texto" className="w-3/4" /></div>
          </div>
        ))}
      </div>
    </SkeletonRegiao>
  );
}

/** Documento aberto (nota/tarefa/equipe em detalhe): título grande e parágrafos. */
export function SkeletonDocumento({ rotulo, className = "", atrasoMs }: Props) {
  return (
    <SkeletonRegiao rotulo={rotulo} atrasoMs={atrasoMs} className={className}>
      <div className="flex flex-col gap-5">
        <Skeleton variante="linha" className="h-8 w-2/3" />
        <SkeletonTexto linhas={4} />
        <SkeletonTexto linhas={3} />
      </div>
    </SkeletonRegiao>
  );
}

/** Perfil: avatar, nome e bloco de métricas 2x2. */
export function SkeletonPerfil({ rotulo, className = "", atrasoMs }: Props) {
  return (
    <SkeletonRegiao rotulo={rotulo} atrasoMs={atrasoMs} className={`px-4 pt-1 ${className}`}>
      <div className="mb-6 flex flex-col items-center gap-3">
        <Skeleton variante="circulo" className="h-24 w-24" />
        <Skeleton variante="linha" className="h-6 w-1/2" />
        <Skeleton variante="texto" className="w-1/3" />
      </div>
      <SkeletonMetricasCorpo />
    </SkeletonRegiao>
  );
}

function SkeletonMetricasCorpo() {
  return (
    <div className="grid grid-cols-2 overflow-hidden rounded-2xl border border-border bg-surface-1">
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3">
          <Skeleton variante="circulo" className="h-5 w-5" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton variante="texto" className="w-1/2" />
            <Skeleton variante="linha" className="w-2/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Bloco de métricas do perfil (grade 2x2 dentro de uma tela já montada). */
export function SkeletonMetricas({ rotulo, className = "", atrasoMs }: Props) {
  return (
    <SkeletonRegiao rotulo={rotulo} atrasoMs={atrasoMs} className={className}>
      <SkeletonMetricasCorpo />
    </SkeletonRegiao>
  );
}

/** Genérico de tela inteira (fallback das rotas lazy): título, subtítulo e alguns cards. */
export function SkeletonTela({ rotulo, atrasoMs }: { rotulo?: string; atrasoMs?: number }) {
  return (
    <SkeletonRegiao rotulo={rotulo} atrasoMs={atrasoMs} className="px-4 pt-1">
      <div className="mb-5 flex items-center gap-3">
        <Skeleton variante="bloco" className="h-10 w-10 rounded-xl" />
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton variante="linha" className="h-6 w-1/3" />
          <Skeleton variante="texto" className="w-1/2" />
        </div>
      </div>
      <div className="flex flex-col gap-3">
        {Array.from({ length: 3 }, (_, i) => <SkeletonCardItem key={i} />)}
      </div>
    </SkeletonRegiao>
  );
}
