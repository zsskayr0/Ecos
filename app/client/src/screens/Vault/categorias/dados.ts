import type { CategoriaApi } from "@/lib/api";
import { montarHierarquia } from "@/lib/categorias-hierarquia";
import { casaBusca } from "@/lib/texto-busca";

/** O que uma categoria movimentou no período. */
export interface Uso {
  count: number;
  entradas: number;
  saidas: number;
  /** Entradas + saídas: o "tamanho" da categoria, qualquer que seja o tipo dela. */
  volume: number;
  ultimo: string | null;
}

/** Uma categoria de nível principal e as suas subcategorias. */
export interface Familia {
  mae: CategoriaApi;
  filhas: CategoriaApi[];
}

export type Criterio = "manual" | "nome" | "nome-desc" | "usadas" | "volume";
export const ROTULO_CRITERIO: Record<Criterio, string> = {
  manual: "Ordem manual",
  nome: "Nome (A–Z)",
  "nome-desc": "Nome (Z–A)",
  usadas: "Mais usadas",
  volume: "Maior volume",
};

export const USO_VAZIO: Uso = { count: 0, entradas: 0, saidas: 0, volume: 0, ultimo: null };

export function somarUso(a: Uso, b: Uso): Uso {
  return { count: a.count + b.count, entradas: a.entradas + b.entradas, saidas: a.saidas + b.saidas, volume: a.volume + b.volume, ultimo: a.ultimo && b.ultimo ? (a.ultimo > b.ultimo ? a.ultimo : b.ultimo) : a.ultimo ?? b.ultimo };
}

export function usoPorCategoria(transacoes: { categoria_id?: string | null; tipo: "entrada" | "saida"; valor_centavos: number; data: string }[]): Map<string, Uso> {
  const mapa = new Map<string, Uso>();
  for (const t of transacoes) {
    if (!t.categoria_id) continue;
    const u = mapa.get(t.categoria_id) ?? { ...USO_VAZIO };
    u.count += 1;
    if (t.tipo === "entrada") u.entradas += t.valor_centavos; else u.saidas += t.valor_centavos;
    u.volume += t.valor_centavos;
    if (!u.ultimo || t.data > u.ultimo) u.ultimo = t.data;
    mapa.set(t.categoria_id, u);
  }
  return mapa;
}

export function usoDaFamilia(f: Familia, usos: Map<string, Uso>): Uso {
  return [f.mae, ...f.filhas].reduce((s, c) => somarUso(s, usos.get(c.id) ?? USO_VAZIO), USO_VAZIO);
}

/** Compara pelo critério; `manual` mantém a ordem recebida (que já é a da pessoa). */
function comparar(criterio: Criterio, uso: (c: CategoriaApi) => Uso): ((a: CategoriaApi, b: CategoriaApi) => number) | null {
  const nome = (a: CategoriaApi, b: CategoriaApi) => a.nome.localeCompare(b.nome, "pt-BR", { sensitivity: "base" });
  switch (criterio) {
    case "manual": return null;
    case "nome": return nome;
    case "nome-desc": return (a, b) => nome(b, a);
    case "usadas": return (a, b) => uso(b).count - uso(a).count || nome(a, b);
    case "volume": return (a, b) => uso(b).volume - uso(a).volume || nome(a, b);
  }
}

export interface Filtros { busca: string; tipo: "todas" | CategoriaApi["tipo"]; /** Mostra também as arquivadas (padrão: escondidas). */ arquivadas?: boolean }

/**
 * Monta as famílias a exibir: filtra por busca/tipo (uma mãe aparece se ela ou alguma filha casar; se só a filha
 * casou, só essa filha vem) e ordena mães e filhas pelo critério. A mãe é ordenada pelo uso da família inteira.
 */
export function montarFamilias(categorias: CategoriaApi[], usos: Map<string, Uso>, criterio: Criterio, filtros: Filtros): Familia[] {
  const h = montarHierarquia(filtros.arquivadas ? categorias : categorias.filter((c) => !c.arquivada));
  const passaTipo = (c: CategoriaApi) => filtros.tipo === "todas" || c.tipo === filtros.tipo;
  let familias: Familia[] = h.raizes.flatMap((mae) => {
    const todas = h.filhas.get(mae.id) ?? [];
    const casaMae = passaTipo(mae) && casaBusca(filtros.busca, mae.nome);
    const filhas = todas.filter((f) => passaTipo(f) && (casaMae || casaBusca(filtros.busca, f.nome, mae.nome)));
    const filhasDaMaeQueCasa = casaMae ? todas.filter(passaTipo) : filhas;
    if (!casaMae && filhas.length === 0) return [];
    return [{ mae, filhas: filhasDaMaeQueCasa }];
  });
  const usoDe = (c: CategoriaApi) => usos.get(c.id) ?? USO_VAZIO;
  const porFamilia = new Map(familias.map((f) => [f.mae.id, usoDaFamilia(f, usos)]));
  const cmpMae = comparar(criterio, (c) => porFamilia.get(c.id) ?? usoDe(c));
  const cmpFilha = comparar(criterio, usoDe);
  if (cmpMae) familias = [...familias].sort((a, b) => cmpMae(a.mae, b.mae));
  if (cmpFilha) familias = familias.map((f) => ({ ...f, filhas: [...f.filhas].sort(cmpFilha) }));
  return familias;
}

/** Retângulos de um treemap (fatiar e distribuir, alternando o eixo): suficiente para dezenas de blocos. */
export interface Bloco { id: string; valor: number; x: number; y: number; w: number; h: number }
export function treemap(itens: { id: string; valor: number }[], x: number, y: number, w: number, h: number): Bloco[] {
  const lista = itens.filter((i) => i.valor > 0).sort((a, b) => b.valor - a.valor);
  const total = lista.reduce((s, i) => s + i.valor, 0);
  if (lista.length === 0 || total <= 0 || w <= 0 || h <= 0) return [];
  const saida: Bloco[] = [];
  const dividir = (grupo: { id: string; valor: number }[], gx: number, gy: number, gw: number, gh: number) => {
    if (grupo.length === 1) { saida.push({ id: grupo[0]!.id, valor: grupo[0]!.valor, x: gx, y: gy, w: gw, h: gh }); return; }
    const soma = grupo.reduce((s, i) => s + i.valor, 0);
    // Separa no ponto que deixa os dois lados mais equilibrados.
    let acc = 0;
    let corte = 1;
    for (let i = 0; i < grupo.length - 1; i++) { acc += grupo[i]!.valor; corte = i + 1; if (acc >= soma / 2) break; }
    const a = grupo.slice(0, corte);
    const b = grupo.slice(corte);
    const fa = a.reduce((s, i) => s + i.valor, 0) / soma;
    if (gw >= gh) { dividir(a, gx, gy, gw * fa, gh); dividir(b, gx + gw * fa, gy, gw * (1 - fa), gh); }
    else { dividir(a, gx, gy, gw, gh * fa); dividir(b, gx, gy + gh * fa, gw, gh * (1 - fa)); }
  };
  dividir(lista, x, y, w, h);
  return saida;
}

/** Soma a série mensal de uma lista de categorias (a da família = mãe + filhas). */
export function somarSeries(series: Map<string, number[]> | null, ids: string[], tamanho: number): number[] {
  const total = new Array<number>(tamanho).fill(0);
  if (!series) return total;
  for (const id of ids) { const s = series.get(id); if (s) s.forEach((v, i) => { total[i] = (total[i] ?? 0) + v; }); }
  return total;
}

/** Volume mensal por categoria nos `meses` (ex.: ["2026-05", ...]) dados; lançamentos fora deles são ignorados. */
export function serieMensal(transacoes: { categoria_id?: string | null; valor_centavos: number; data: string }[], meses: string[]): Map<string, number[]> {
  const indice = new Map(meses.map((m, i) => [m, i]));
  const mapa = new Map<string, number[]>();
  for (const t of transacoes) {
    const i = indice.get(t.data.slice(0, 7));
    if (!t.categoria_id || i === undefined) continue;
    const v = mapa.get(t.categoria_id) ?? new Array<number>(meses.length).fill(0);
    v[i] = (v[i] ?? 0) + t.valor_centavos;
    mapa.set(t.categoria_id, v);
  }
  return mapa;
}

/** Os `n` meses (AAAA-MM) terminando no mês de `fim` (AAAA-MM-DD). */
export function ultimosMeses(fim: string, n: number): string[] {
  const [a, m] = fim.split("-").map(Number) as [number, number];
  return Array.from({ length: n }, (_, k) => { const d = new Date(a, m - 1 - (n - 1 - k), 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; });
}
