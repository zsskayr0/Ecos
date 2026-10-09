import { useSyncExternalStore } from "react";

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

const PADRAO: ExibicaoValores = { painel: "numero", lancamentos: "numero", contas: "barra", categorias: "barra", recorrencias: "numero", sacados: "numero" };
// Contas e Categorias já mostravam uma barra sob o valor: ela segue como padrão.
const MODOS: ModoValor[] = ["numero", "barra", "anel"];

function normalizar(bruto: unknown): ExibicaoValores {
  const o = (bruto && typeof bruto === "object" ? bruto : {}) as Record<string, unknown>;
  const r = { ...PADRAO };
  for (const t of TELAS_VALORES) if (MODOS.includes(o[t.id] as ModoValor)) r[t.id] = o[t.id] as ModoValor;
  return r;
}

function lerBruto(): string | null {
  try { return localStorage.getItem(CHAVE_EXIBICAO_VALORES); } catch { return null; }
}

export function salvarModoValor(tela: TelaValores, modo: ModoValor): void {
  let atual: ExibicaoValores;
  try { atual = normalizar(JSON.parse(lerBruto() ?? "{}")); } catch { atual = { ...PADRAO }; }
  try { localStorage.setItem(CHAVE_EXIBICAO_VALORES, JSON.stringify({ ...atual, [tela]: modo })); } catch { /* vale só até recarregar */ }
  window.dispatchEvent(new Event(EVENTO_EXIBICAO_VALORES));
}

let textoEmCache: string | null | undefined;
let valorEmCache: ExibicaoValores = { ...PADRAO };
function instantaneo(): ExibicaoValores {
  const texto = lerBruto();
  if (texto !== textoEmCache) {
    textoEmCache = texto;
    try { valorEmCache = normalizar(JSON.parse(texto ?? "{}")); } catch { valorEmCache = { ...PADRAO }; }
  }
  return valorEmCache;
}

function assinar(aviso: () => void) {
  const aoArmazenar = (e: StorageEvent) => { if (e.key === null || e.key === CHAVE_EXIBICAO_VALORES) aviso(); };
  window.addEventListener(EVENTO_EXIBICAO_VALORES, aviso);
  window.addEventListener("storage", aoArmazenar);
  return () => {
    window.removeEventListener(EVENTO_EXIBICAO_VALORES, aviso);
    window.removeEventListener("storage", aoArmazenar);
  };
}

export function useExibicaoValores(): ExibicaoValores {
  return useSyncExternalStore(assinar, instantaneo, instantaneo);
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
