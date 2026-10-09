import type { CategoriaApi } from "./api";

/**
 * Subcategorias: um único nível. O lançamento guarda só o id da folha (`categoria_id`); o caminho completo é derivado
 * daqui, então renomear ou mover a categoria-mãe nunca reescreve lançamentos.
 */
export const SEPARADOR_CAMINHO = " › ";

export interface Hierarquia {
  porId: Map<string, CategoriaApi>;
  /** Categorias de nível principal, na ordem recebida. */
  raizes: CategoriaApi[];
  /** Subcategorias de cada mãe, na ordem recebida. */
  filhas: Map<string, CategoriaApi[]>;
}

export function montarHierarquia(categorias: CategoriaApi[]): Hierarquia {
  const porId = new Map(categorias.map((c) => [c.id, c]));
  const raizes: CategoriaApi[] = [];
  const filhas = new Map<string, CategoriaApi[]>();
  for (const c of categorias) {
    // Mãe que sumiu da lista (ex.: filtro de espaço) não esconde a filha: ela aparece como principal.
    if (c.pai_id && porId.has(c.pai_id)) filhas.set(c.pai_id, [...(filhas.get(c.pai_id) ?? []), c]);
    else raizes.push(c);
  }
  return { porId, raizes, filhas };
}

export const ehSub = (c: Pick<CategoriaApi, "pai_id"> | undefined | null): boolean => !!c?.pai_id;

/** Id da categoria de nível principal a que `id` pertence (ela mesma, se já for principal). */
export function idDaMae(id: string, porId: Map<string, CategoriaApi>): string {
  const pai = porId.get(id)?.pai_id;
  return pai && porId.has(pai) ? pai : id;
}

/** "Funcionários › Salários" para subcategorias; só o nome para as principais. */
export function caminhoCompleto(c: CategoriaApi | undefined | null, porId: Map<string, CategoriaApi>): string {
  if (!c) return "Sem categoria";
  const mae = c.pai_id ? porId.get(c.pai_id) : undefined;
  return mae ? `${mae.nome}${SEPARADOR_CAMINHO}${c.nome}` : c.nome;
}

/** Tipos que cabem sob uma mãe: mãe "ambos" aceita qualquer um; as demais, só o próprio tipo. */
export function tipoCabeNaMae(tipoFilha: CategoriaApi["tipo"], mae: Pick<CategoriaApi, "tipo">): boolean {
  return mae.tipo === "ambos" || mae.tipo === tipoFilha;
}

/**
 * Mães possíveis para `categoria`: de nível principal e outra que não ela; quem tem filhas não vira filha. O tipo não
 * filtra: ao escolher uma mãe de tipo diferente a subcategoria adota o tipo dela (ver `tipoAoMudarDeMae`).
 */
export function maesPossiveis(categorias: CategoriaApi[], categoria: { id?: string; tipo?: CategoriaApi["tipo"] }): CategoriaApi[] {
  if (categoria.id && categorias.some((c) => c.pai_id === categoria.id)) return [];
  return categorias.filter((c) => !c.pai_id && c.id !== categoria.id);
}

/** Tipo que a subcategoria passa a ter sob `mae`: o dela, a menos que a mãe seja "ambos" (aí mantém o próprio). */
export function tipoAoMudarDeMae(tipoAtual: CategoriaApi["tipo"], mae: Pick<CategoriaApi, "tipo">): CategoriaApi["tipo"] {
  return mae.tipo === "ambos" ? tipoAtual : mae.tipo;
}

/**
 * Soma valores por categoria. Com `agrupar`, cada subcategoria entra na conta da mãe (visão "em bloco"); sem ele,
 * cada uma conta como categoria própria. `null` é "sem categoria".
 */
export function somarPorCategoria<T extends { chave: string | null; valor: number }>(grupos: T[], porId: Map<string, CategoriaApi>, agrupar: boolean): { chave: string | null; valor: number }[] {
  if (!agrupar) return grupos.map((g) => ({ chave: g.chave, valor: g.valor }));
  const soma = new Map<string | null, number>();
  for (const g of grupos) {
    const k = g.chave ? idDaMae(g.chave, porId) : null;
    soma.set(k, (soma.get(k) ?? 0) + g.valor);
  }
  return [...soma.entries()].map(([chave, valor]) => ({ chave, valor })).sort((a, b) => b.valor - a.valor);
}
