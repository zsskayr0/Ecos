import { beforeEach, describe, expect, it, vi } from "vitest";

const salvos: { blob: Blob; nome: string }[] = [];
vi.mock("@/lib/baixar-arquivo", () => ({ baixarArquivo: (blob: Blob, nome: string) => salvos.push({ blob, nome }) }));
vi.mock("@/lib/api", () => ({
  notas: { obter: vi.fn(async () => ({ id: "n1", titulo: "Reunião de equipe", tags: ["time"], atualizado_em: "2026-11-17T10:00:00Z", corpo: "Texto com **negrito** e *itálico* e `código`.\n\n- item um\n- [x] feito\n\n![foto](https://exemplo.test/a.png)\n\nBom dia 😀" })) },
  tarefas: { obter: vi.fn(async () => ({ id: "t1", titulo: "Tabela", tags: [], atualizado_em: "2026-11-17T10:00:00Z", status: "pendente", prioridade: "media", subtarefas: [], corpo: "| Tela | Rota | Estado |\n|---|:---:|---|\n| Feed | /feed | Alta prioridade com texto longo que precisa quebrar dentro da célula da tabela |\n| Hoje | /hoje | Média |" })) },
}));

const lerTexto = (blob: Blob) => new Promise<string>((ok) => { const r = new FileReader(); r.onload = () => ok(r.result as string); r.readAsText(blob, "latin1"); });

describe("exportarDocumentosEmPdf", () => {
  beforeEach(() => { salvos.length = 0; });

  it("baixa um PDF com título, negrito/itálico/código e lista, mesmo sem conseguir baixar imagens", async () => {
    const { exportarDocumentosEmPdf } = await import("./exportar-pdf");
    await exportarDocumentosEmPdf([{ tipo: "nota", id: "n1" }]);
    expect(salvos).toHaveLength(1);
    expect(salvos[0].nome).toBe("Reunião de equipe.pdf");
    const t = await lerTexto(salvos[0].blob);
    expect(t.startsWith("%PDF-1.4")).toBe(true);
    expect(t).toContain("(negrito) Tj"); // trecho em negrito desenhado à parte
    expect(t).toMatch(/\/F2 [\d.]+ Tf[^\n]*\(negrito\)/);
    expect(t).toContain(String.raw`(it\341lico) Tj`); // itálico (Helvetica-Oblique)
    expect(t).toMatch(/\/F4 [\d.]+ Tf/);
    expect(t).toContain(String.raw`(c\363digo) Tj`); // código (Courier)
    expect(t).toMatch(/\/F3 [\d.]+ Tf/);
    expect(t).toContain("([imagem:) Tj"); expect(t).toContain("(foto]) Tj"); // sem rede/canvas, vira legenda
  });

  it("desenha tabela como grade: células separadas, cabeçalho com fundo e bordas", async () => {
    const { exportarDocumentosEmPdf } = await import("./exportar-pdf");
    await exportarDocumentosEmPdf([{ tipo: "tarefa", id: "t1" }]);
    const t = await lerTexto(salvos[0].blob);
    expect(t).not.toContain("|");
    expect(t).toContain("(Tela) Tj");
    expect(t).toContain("(/feed) Tj");
    expect(t).toMatch(/ re f/); // fundo do cabeçalho
    expect((t.match(/ l S/g) ?? []).length).toBeGreaterThan(8); // bordas
  });
});
