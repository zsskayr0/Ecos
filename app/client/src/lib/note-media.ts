import { media, notas } from "./api";

export function anexosDaNota(corpo: string, notaId: string) {
  return [...corpo.matchAll(/(!?)\[([^\]]*)\]\(([^)]+)\)/g)].flatMap((m) => {
    const caminho = m[3].replace(/^<|>$/g, "");
    const local = caminho.startsWith("src/Media/") || caminho.startsWith("_anexos/");
    if (!local && !(m[1] && /^https?:\/\//i.test(caminho))) return [];
    let nome = caminho.split("/").pop() ?? m[2];
    try { nome = decodeURIComponent(nome); } catch { /* nome legado */ }
    nome = nome.replace(/-[0-9A-HJKMNP-TV-Z]{26}(?=\.|$)/i, "");
    const tipo = nome.split(".").pop()?.toUpperCase() || "Arquivo";
    const imagem = m[1] === "!" || /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(nome);
    const url = caminho.startsWith("src/Media/") ? media.urlArquivo(caminho) : local ? notas.anexos.urlDownload(notaId, caminho.split("/").slice(2).join("/")) : caminho;
    return [{ nome, tipo, imagem, url, referencia: m[0] }];
  });
}

export function previewDaNota(corpo: string, notaId: string) {
  let texto = corpo;
  for (const item of anexosDaNota(corpo, notaId)) texto = texto.replace(item.referencia, "");
  return textoParaPreview(texto).slice(0, 240);
}

/** Texto curto de card deve ser legível, não o Markdown cru da nota. */
function textoParaPreview(markdown: string) {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!?(?:\[([^\]]*)\])\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s*(?:[-*+] |\d+[.)] )/gm, "")
    .replace(/(?:\*\*|__|~~|\*|_|`)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
