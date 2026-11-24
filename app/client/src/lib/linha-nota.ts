import { lerPreferenciasAplicativo } from "@/lib/preferencias-aplicativo";

/**
 * O número central da nota: a altura de UMA linha, em px.
 *
 * Tudo na nota se mede em linhas, não em px: o texto, a entrelinha, o espaço de um título (1 linha),
 * a linha em branco do Enter (1 linha), as imagens e a grade da folha (pautada, quadriculada e pontilhada).
 * Para mudar o espaçamento de tudo de uma vez, é só mudar este valor (Configurações > Editor > Linha da nota).
 *
 * No CSS ele chega como `--ecos-linha-nota`, que a raiz da nota define a partir daqui.
 */
export const LINHA_NOTA_PADRAO = 24;
/** Valores oferecidos nas Configurações. */
export const LINHAS_NOTA = [20, 24, 28, 32] as const;

/** A linha em px a partir das preferências (0 ou inválido = padrão). */
export const linhaDasPreferencias = (p: { notaLinha?: number }) => (p.notaLinha && p.notaLinha >= 16 && p.notaLinha <= 48 ? Math.round(p.notaLinha) : LINHA_NOTA_PADRAO);

/** A linha atual, lida das preferências salvas (para quem não está num componente React). */
export const linhaNotaAtual = () => linhaDasPreferencias(lerPreferenciasAplicativo());
