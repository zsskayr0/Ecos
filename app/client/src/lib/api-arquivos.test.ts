import { afterEach, expect, it, vi } from "vitest";
import { arquivos } from "./api";

afterEach(() => vi.unstubAllGlobals());

function respostaJson(dados: unknown) {
  return new Response(JSON.stringify(dados), { headers: { "content-type": "application/json" } });
}

it("recupera prioridades ausentes na listagem de arquivos usando as tarefas da mesma pasta e espaço", async () => {
  const fetch = vi.fn()
    .mockResolvedValueOnce(respostaJson({ pasta: "", pastas: [], arquivos: [
      { id: "t1", tipo: "tarefa", caminho: "Urgente.md" },
      { id: "t2", tipo: "tarefa", caminho: "Outra.md", prioridade: "baixa" },
      { id: "n1", tipo: "nota", caminho: "Notas.md" },
    ] }))
    .mockResolvedValueOnce(respostaJson({ items: [{ id: "t2", prioridade: "media" }], next_cursor: "pagina-2" }))
    .mockResolvedValueOnce(respostaJson({ items: [{ id: "t1", prioridade: "alta" }], next_cursor: null }));
  vi.stubGlobal("fetch", fetch);

  const lista = await arquivos.listar({ espaco: "equipe:e1", pasta: "" });
  expect(lista.arquivos.map((arquivo) => arquivo.prioridade)).toEqual(["alta", "baixa", undefined]);
  expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([
    expect.stringContaining("/arquivos?espaco=equipe%3Ae1"),
    expect.stringContaining("/tarefas?espaco=equipe%3Ae1&limit=100&pasta="),
    expect.stringContaining("/tarefas?espaco=equipe%3Ae1&cursor=pagina-2&limit=100&pasta="),
  ]);
});
