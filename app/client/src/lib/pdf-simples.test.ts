import { describe, expect, it } from "vitest";
import { DocumentoPdf, TOTAL_LARGURAS, limparTexto, medir, quebrar } from "./pdf-simples";

const lerTexto = (blob: Blob) => new Promise<string>((ok) => { const r = new FileReader(); r.onload = () => ok(r.result as string); r.readAsText(blob, "latin1"); });

describe("pdf-simples", () => {
  it("tem a tabela de larguras completa (códigos 32 a 126)", () => expect(TOTAL_LARGURAS).toBe(95));

  it("gera um PDF com cabeçalho, uma página por chamada e xref coerente", async () => {
    const pdf = new DocumentoPdf();
    pdf.texto("Olá (mundo) açaí", 50, 80, "normal", 12);
    pdf.novaPagina();
    pdf.texto("Segunda", 50, 80, "negrito", 12);
    const t = await lerTexto(pdf.gerar());
    expect(t.startsWith("%PDF-1.4")).toBe(true);
    expect(t).toContain("/Count 2");
    expect(t).toContain(String.raw`(Ol\341 \(mundo\) a\347a\355)`); // acentos em WinAnsi, parênteses escapados
    expect(t.trimEnd().endsWith("%%EOF")).toBe(true);
    const inicio = Number(/startxref\n(\d+)/.exec(t)![1]);
    expect(t.slice(inicio, inicio + 4)).toBe("xref");
  });

  it("quebra por largura e respeita quebras de linha", () => {
    const linhas = quebrar("uma frase bem comprida que precisa quebrar\noutra", medir("uma frase bem", "normal", 10), "normal", 10);
    expect(linhas.length).toBeGreaterThan(2);
    expect(linhas.at(-1)).toBe("outra");
  });

  it("troca o que a fonte padrão não desenha", () => expect(limparTexto("ok 😀 “aspas” — fim")).toBe("ok ? “aspas” — fim"));
});
