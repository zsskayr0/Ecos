import { useSyncExternalStore } from "react";
import { assinarContextoCofre, espacoAtualDoCofre } from "./api";
import { definirMoeda, MOEDAS } from "./format";

/**
 * Como o Cofre mostra os valores ao lado do número: só o número, uma barra ou um anel de progresso.
 * A escolha é por tela (Configurações → Cofre → Exibição de valores) e fica neste dispositivo.
 * O máximo da barra/anel é sempre o maior valor da própria tela no período selecionado (quem usa passa `max`).
 */
export type ModoValor = "numero" | "barra" | "anel";
export type TelaValores = "painel" | "lancamentos" | "contas" | "categorias" | "recorrencias" | "sacados";

export const TELAS_VALORES: { id: TelaValores; rotulo: string }[] = [
  { id: "painel", rotulo: "Painel" },
  { id: "lancamentos", rotulo: "Lançamentos" },
  { id: "contas", rotulo: "Contas" },
  { id: "categorias", rotulo: "Categorias" },
  { id: "recorrencias", rotulo: "Recorrências" },
  { id: "sacados", rotulo: "Pagadores e recebedores" },
];

export const CHAVE_EXIBICAO_VALORES = "ecos.config.cofre.exibicao-valores";
export const EVENTO_EXIBICAO_VALORES = "ecos:exibicao-valores";

export type ExibicaoValores = Record<TelaValores, ModoValor>;

/** Aparência do nome da categoria na lista de lançamentos: um ajuste para o tema claro e outro para o escuro. */
export interface CategoriaTema { nome: boolean; cor: boolean }
export type TemaCategoria = "claro" | "escuro";
export interface PreferenciasCofre { modos: ExibicaoValores; moeda: string; categoria: Record<TemaCategoria, CategoriaTema> }

const PADRAO: ExibicaoValores = { painel: "numero", lancamentos: "numero", contas: "barra", categorias: "barra", recorrencias: "numero", sacados: "numero" };
// Contas e Categorias já mostravam uma barra sob o valor: ela segue como padrão.
const MODOS: ModoValor[] = ["numero", "barra", "anel"];
const PADRAO_PREFS = (): PreferenciasCofre => ({ modos: { ...PADRAO }, moeda: "BRL", categoria: { claro: { nome: true, cor: true }, escuro: { nome: true, cor: true } } });

function normalizar(bruto: unknown): PreferenciasCofre {
  const o = (bruto && typeof bruto === "object" ? bruto : {}) as Record<string, unknown>;
  const r = PADRAO_PREFS();
  // Formato antigo: o próprio objeto era o mapa tela → modo.
  const modos = (o.modos && typeof o.modos === "object" ? o.modos : o) as Record<string, unknown>;
  for (const t of TELAS_VALORES) if (MODOS.includes(modos[t.id] as ModoValor)) r.modos[t.id] = modos[t.id] as ModoValor;
  if (typeof o.moeda === "string" && MOEDAS.some((m) => m.id === o.moeda)) r.moeda = o.moeda;
  const c = (o.categoria && typeof o.categoria === "object" ? o.categoria : {}) as Record<string, Partial<CategoriaTema>>;
  for (const tema of ["claro", "escuro"] as const) {
    if (typeof c[tema]?.nome === "boolean") r.categoria[tema].nome = c[tema]!.nome!;
    if (typeof c[tema]?.cor === "boolean") r.categoria[tema].cor = c[tema]!.cor!;
  }
  return r;
}

/** As configurações do Cofre são por equipe: cada espaço (`pessoal` / `equipe:<id>`) tem a sua chave. */
const chaveDoEspaco = () => `${CHAVE_EXIBICAO_VALORES}.${espacoAtualDoCofre()}`;

function lerBruto(): string | null {
  try { return localStorage.getItem(chaveDoEspaco()) ?? (espacoAtualDoCofre() === "pessoal" ? localStorage.getItem(CHAVE_EXIBICAO_VALORES) : null); } catch { return null; }
}

function lerPrefs(): PreferenciasCofre {
  try { return normalizar(JSON.parse(lerBruto() ?? "{}")); } catch { return PADRAO_PREFS(); }
}

function salvarPrefs(prefs: PreferenciasCofre): void {
  try { localStorage.setItem(chaveDoEspaco(), JSON.stringify(prefs)); } catch { /* vale só até recarregar */ }
  definirMoeda(prefs.moeda);
  window.dispatchEvent(new Event(EVENTO_EXIBICAO_VALORES));
}

export function salvarModoValor(tela: TelaValores, modo: ModoValor): void {
  const p = lerPrefs();
  salvarPrefs({ ...p, modos: { ...p.modos, [tela]: modo } });
}
export function salvarMoeda(moeda: string): void { salvarPrefs({ ...lerPrefs(), moeda }); }
export function salvarCategoriaTema(tema: TemaCategoria, mudanca: Partial<CategoriaTema>): void {
  const p = lerPrefs();
  salvarPrefs({ ...p, categoria: { ...p.categoria, [tema]: { ...p.categoria[tema], ...mudanca } } });
}

let chaveEmCache: string | undefined;
let textoEmCache: string | null | undefined;
let valorEmCache: PreferenciasCofre = PADRAO_PREFS();
function instantaneo(): PreferenciasCofre {
  const texto = lerBruto();
  const chave = chaveDoEspaco();
  if (texto !== textoEmCache || chave !== chaveEmCache) {
    textoEmCache = texto;
    chaveEmCache = chave;
    valorEmCache = lerPrefs();
    definirMoeda(valorEmCache.moeda);
  }
  return valorEmCache;
}

function assinar(aviso: () => void) {
  const aoArmazenar = (e: StorageEvent) => { if (e.key === null || e.key.startsWith(CHAVE_EXIBICAO_VALORES)) aviso(); };
  window.addEventListener(EVENTO_EXIBICAO_VALORES, aviso);
  window.addEventListener("storage", aoArmazenar);
  const parar = assinarContextoCofre(aviso);
  return () => {
    window.removeEventListener(EVENTO_EXIBICAO_VALORES, aviso);
    window.removeEventListener("storage", aoArmazenar);
    parar();
  };
}

export function usePreferenciasCofre(): PreferenciasCofre {
  return useSyncExternalStore(assinar, instantaneo, instantaneo);
}

export function useExibicaoValores(): ExibicaoValores {
  return usePreferenciasCofre().modos;
}

/** Moeda (id) do espaço ativo; quem a usa remonta a tela quando ela muda, já que `formatMoeda` é uma função simples. */
export function useMoeda(): string {
  return usePreferenciasCofre().moeda;
}

export function useModoValor(tela: TelaValores): ModoValor {
  return useExibicaoValores()[tela];
}

/** Maior valor absoluto de uma lista (o "100%" da barra/anel). */
export function maiorValor(valores: number[]): number {
  return valores.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
}

/**
 * Maior valor (centavos) de Lançamentos no período atual. A tela de Lançamentos o publica; o campo de valor do
 * editor o usa como 100% do anel/barra, já que o editor não conhece o período.
 */
let maxLancamentos = 0;
export function definirMaxLancamentos(centavos: number): void { maxLancamentos = centavos; }
export function lerMaxLancamentos(): number { return maxLancamentos; }
