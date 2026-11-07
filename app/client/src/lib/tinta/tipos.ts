/**
 * Contrato da tinta do Modo de escrita, espelho de `app/server/src/routes/tinta.rs`.
 *
 * Coordenadas absolutas em px da coluna de largura fixa (`largura_coluna`), origem no topo
 * esquerdo do texto da Nota. `d` é gerado aqui: caneta = contorno fechado (preenchido),
 * marca-texto = linha central (traçada com `espessura`). O servidor só aceita
 * `[MmLlHhVvCcQqSsTtZz0-9 .,-]` em `d` e monta o `tinta.svg` ele mesmo.
 */

export type Ferramenta = "caneta" | "marca-texto";

export interface PontoTinta {
  x: number;
  y: number;
  /** 0–1. Mouse e dedo sem pressão real chegam como 0,5. */
  pressao: number;
}

export interface Traco {
  id: string;
  ferramenta: Ferramenta;
  /** `"auto"` (cor do texto do tema) ou `#rrggbb`. */
  cor: string;
  espessura: number;
  pontos: PontoTinta[];
  d: string;
  criado_em: string;
  /** Lápide: o traço foi apagado (fica fora do desenho e do SVG; o servidor poda depois). */
  apagado_em?: string | null;
}

export interface TintaNota {
  versao: number;
  /** 0 = nunca gravada (ou apagada por completo). */
  revisao: number;
  /** `null` = Nota não convertida: largura fluida, o aviso aparece na 1ª ativação. */
  largura_coluna: number | null;
  tracos: Traco[];
}

export interface SalvarTintaNota {
  revisao_base: number;
  largura_coluna: number;
  tracos: Traco[];
}

/** Largura de uma folha A4 (210 mm) a 96 dpi. Notas já convertidas mantêm a largura congelada. */
export const LARGURA_COLUNA_PADRAO = 794;

export const ativos = (tracos: readonly Traco[]) => tracos.filter((t) => !t.apagado_em);
