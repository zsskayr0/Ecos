import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({ notas: {} }));

import { docxParaMarkdown } from "@/lib/importar-nota";
import { gerarZip, lerZip } from "@/lib/zip-mini";

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

function docx(corpo: string, rels = "") {
  const z = gerarZip([
    { nome: "word/document.xml", dados: `<?xml version="1.0"?><w:document ${W}><w:body>${corpo}</w:body></w:document>` },
    { nome: "word/_rels/document.xml.rels", dados: `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>` },
    { nome: "word/media/a.png", dados: new Uint8Array([1, 2, 3]) },
  ]);
  return z.buffer.slice(z.byteOffset, z.byteOffset + z.byteLength) as ArrayBuffer;
}

describe("zip-mini", () => {
  it("lê de volta o que grava", async () => {
    const z = gerarZip([{ nome: "a.txt", dados: "olá" }]);
    const lido = await lerZip(z.buffer as ArrayBuffer);
    expect(new TextDecoder().decode(lido.get("a.txt"))).toBe("olá");
  });
});

describe("docxParaMarkdown", () => {
  it("converte títulos, negrito, listas, links e imagens", async () => {
    const corpo = `
      <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Título</w:t></w:r></w:p>
      <w:p><w:r><w:t xml:space="preserve">Texto </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>forte</w:t></w:r></w:p>
      <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>um</w:t></w:r></w:p>
      <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>dois</w:t></w:r></w:p>
      <w:p><w:hyperlink r:id="rL"><w:r><w:t>site</w:t></w:r></w:hyperlink></w:p>
      <w:p><w:r><w:drawing><a:blip xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" r:embed="rI"/></w:drawing></w:r></w:p>`;
    const rels = '<Relationship Id="rL" Target="https://ex.com" TargetMode="External"/><Relationship Id="rI" Target="media/a.png"/>';
    const r = await docxParaMarkdown(docx(corpo, rels));
    expect(r.markdown).toBe("# Título\n\nTexto **forte**\n\n- um\n- dois\n\n[site](https://ex.com)\n\n![](ecos-importar-imagem-1)\n");
    expect(r.imagens).toHaveLength(1);
    expect(Array.from(r.imagens[0].dados)).toEqual([1, 2, 3]);
  });
});
