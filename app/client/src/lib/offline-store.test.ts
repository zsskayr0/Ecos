import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { notas, sincronizarPendenciasOffline, tarefas } from "./api";
import {
  guardarRespostaOffline,
  limparDadosOffline,
  listarMutacoesPendentes,
  obterRespostaOffline,
} from "./offline-store";

beforeEach(async () => {
  await limparDadosOffline();
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("dados offline", () => {
  it("abre a última lista salva quando o servidor não responde", async () => {
    const salva = { items: [{ id: "n1", titulo: "Ideias" }], next_cursor: null };
    await guardarRespostaOffline("/notas", salva);

    await expect(notas.listar()).resolves.toEqual(salva);
  });

  it("guarda a edição localmente e condensa autosaves da mesma nota", async () => {
    await guardarRespostaOffline("/notas/n1", { id: "n1", titulo: "Antes", corpo: "", tags: [] });
    await guardarRespostaOffline("/notas", { items: [{ id: "n1", titulo: "Antes", corpo: "", tags: [] }], next_cursor: null });

    await notas.atualizar("n1", { titulo: "Durante" });
    await notas.atualizar("n1", { titulo: "Depois", corpo: "Texto offline" });

    const fila = await listarMutacoesPendentes();
    expect(fila).toHaveLength(1);
    expect(JSON.parse(fila[0].corpo ?? "{}")).toEqual({ titulo: "Depois", corpo: "Texto offline" });
    expect(await obterRespostaOffline<{ titulo: string; corpo: string }>("/notas/n1")).toMatchObject({ titulo: "Depois", corpo: "Texto offline" });
    expect(await obterRespostaOffline<{ items: { titulo: string }[] }>("/notas")).toMatchObject({ items: [{ titulo: "Depois" }] });
  });

  it("cria com id temporário e troca pelo id do servidor antes de enviar edições seguintes", async () => {
    await guardarRespostaOffline("/tarefas", { items: [], next_cursor: null });
    const criada = await tarefas.criar({ titulo: "Preparar viagem" });
    expect(criada.id).toMatch(/^offline-/);
    await tarefas.atualizar(criada.id, { corpo: "Lista pronta" });

    const caminhos: string[] = [];
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      caminhos.push(`${init?.method} ${url}`);
      const body = init?.method === "POST" ? { id: "t-real" } : { id: "t-real" };
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    }));

    await expect(sincronizarPendenciasOffline()).resolves.toBe(2);
    expect(caminhos[0]).toContain("POST");
    expect(caminhos[1]).toContain("/tarefas/t-real");
    expect(await listarMutacoesPendentes()).toEqual([]);
    expect(await obterRespostaOffline("/tarefas/t-real")).toMatchObject({ id: "t-real", corpo: "Lista pronta" });
    expect(await obterRespostaOffline(`/tarefas/${criada.id}`)).toBeUndefined();
  });
});
