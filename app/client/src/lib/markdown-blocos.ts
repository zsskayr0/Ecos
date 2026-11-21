/** Imagem: `![alt|300|centro](src "legenda")` — largura e alinhamento no alt (leitura e PDF). */

export type Alinhamento = "esquerda" | "centro" | "direita";

/** `alt|300|centro` → texto, largura em px (ou %), alinhamento. */
export function lerAltImagem(alt: string | undefined): { alt: string; largura?: string; alinhar?: Alinhamento } {
  const partes = (alt ?? "").split("|");
  const res: { alt: string; largura?: string; alinhar?: Alinhamento } = { alt: partes[0].trim() };
  for (const p of partes.slice(1).map((x) => x.trim().toLowerCase())) {
    if (/^\d{1,4}(px)?$/.test(p)) res.largura = `${parseInt(p, 10)}px`;
    else if (/^\d{1,3}%$/.test(p)) res.largura = p;
    else if (/^(centro|centralizado|center)$/.test(p)) res.alinhar = "centro";
    else if (/^(esquerda|left)$/.test(p)) res.alinhar = "esquerda";
    else if (/^(direita|right)$/.test(p)) res.alinhar = "direita";
  }
  return res;
}
