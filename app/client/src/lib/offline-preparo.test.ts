import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prepararConteudoOffline } from "./api";
import { guardarRespostaOffline, limparDadosOffline, obterRespostaOffline } from "./offline-store";

beforeEach(async () => {
  localStorage.clear();
  await limparDadosOffline();
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const respostaVazia = () => new Response(JSON.stringify({ items: [], next_cursor: null, subpastas: [], itens: [] }), { status: 200, headers: { "content-type": "application/json" } });

describe("preparação offline", () => {
  it("roda no máximo uma vez por dia por espaço", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => respostaVazia());
    vi.stubGlobal("fetch", fetchMock);
    await prepararConteudoOffline(["pessoal"]);
    const primeira = fetchMock.mock.calls.length;
    expect(primeira).toBeGreaterThan(0);
    await prepararConteudoOffline(["pessoal"]);
    expect(fetchMock.mock.calls.length).toBe(primeira); // carimbo de hoje: não baixa de novo
  });

  it("espaço novo é preparado mesmo com outro já em dia", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => respostaVazia());
    vi.stubGlobal("fetch", fetchMock);
    await prepararConteudoOffline(["pessoal"]);
    const antes = fetchMock.mock.calls.length;
    await prepararConteudoOffline(["pessoal", "equipe:x"]);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(antes);
  });
});

describe("cache offline em lote", () => {
  it("várias páginas gravadas em sequência aparecem juntas na coleção", async () => {
    void guardarRespostaOffline("/notas?limit=2", { items: [{ id: "a", titulo: "A", espaco: "pessoal" }], next_cursor: "x" });
    void guardarRespostaOffline("/notas?limit=2&cursor=x", { items: [{ id: "b", titulo: "B", espaco: "pessoal" }], next_cursor: null });
    // Leitura da coleção (URL sem página exata) espera o lote pendente.
    const colecao = await obterRespostaOffline<{ items: { id: string }[] }>("/notas?espaco=pessoal");
    expect(colecao?.items.map((i) => i.id).sort()).toEqual(["a", "b"]);
  });
});
