import "fake-indexeddb/auto";
import { StrictMode } from "react";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

/**
 * Boot a frio com ARMAZENAMENTO LEGADO: o navegador do usuário já tem o IndexedDB `ecos-offline-v1` (cache + fila de
 * escrita pendente) e o localStorage de versões anteriores. A primeira janela "Tarefa" aberta depois de carregar o
 * app tem que mostrar a tarefa, nunca ficar em skeleton.
 */
const TAREFA = { id: "t1", titulo: "Pagar boleto", corpo: "", status: "pendente", scheduled_at: null, duration_min: 5, due_date: null, pasta: null, espaco: "pessoal", criado_em: "2026-10-01T00:00:00Z", atualizado_em: "2026-10-01T00:00:00Z", concluida_em: null, tags: [], prioridade: "baixa", subtarefas: [], serie: null };

function semearIndexedDb(): Promise<void> {
  return new Promise((resolve, reject) => {
    const abrir = indexedDB.open("ecos-offline-v1", 1);
    abrir.onupgradeneeded = () => {
      abrir.result.createObjectStore("respostas", { keyPath: "chave" });
      abrir.result.createObjectStore("fila", { keyPath: "id" });
    };
    abrir.onerror = () => reject(abrir.error);
    abrir.onsuccess = () => {
      const db = abrir.result;
      const tx = db.transaction(["respostas", "fila"], "readwrite");
      tx.objectStore("respostas").put({ chave: "__colecao__:tarefas", valor: [{ ...TAREFA, id: "velha" }], salvoEm: 1 });
      tx.objectStore("respostas").put({ chave: "/tarefas/t1", valor: { ...TAREFA, titulo: "versao velha" }, salvoEm: 1 });
      tx.objectStore("fila").put({ id: "m1", metodo: "PATCH", caminho: "/tarefas/outra", corpo: "{\"titulo\":\"x\"}", criadaEm: 1 });
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  });
}

beforeEach(() => {
  vi.resetModules();
  window.matchMedia = ((q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as typeof window.matchMedia;
  localStorage.clear();
  // Estado de versões anteriores: layout do workspace e carimbos.
  localStorage.setItem("ecos.desktop.workspace.v1", JSON.stringify({ abas: [] }));
  localStorage.setItem("ecos.rascunhos.vistos.v1", "[]");
  globalThis.fetch = vi.fn((url: RequestInfo | URL) => {
    const caminho = String(url);
    return new Promise<Response>((resolve) => setTimeout(() => resolve(
      caminho.endsWith("/tarefas/t1") ? new Response(JSON.stringify(TAREFA), { status: 200, headers: { "content-type": "application/json" } })
        : new Response("[]", { status: 200, headers: { "content-type": "application/json" } }),
    ), 120));
  }) as unknown as typeof fetch;
});
afterEach(() => { vi.unstubAllGlobals(); });

it("abre a primeira tarefa no boot a frio com IndexedDB e localStorage legados", async () => {
  await semearIndexedDb();
  const { DocumentoJanela } = await import("./DocumentoJanela");
  const { RefreshProvider } = await import("@/lib/refresh-bus");
  render(
    <StrictMode>
      <RefreshProvider><DocumentoJanela path="/tarefa/t1" ordem={0} z={1} aoFechar={() => {}} aoFocar={() => {}} /></RefreshProvider>
    </StrictMode>,
  );
  expect(await screen.findByDisplayValue("Pagar boleto", {}, { timeout: 8000 })).toBeTruthy();
}, 15000);

/**
 * Abertura do IndexedDB que nunca responde (conexão antiga de outra aba bloqueando, perfil corrompido): com o
 * servidor falhando na primeira chamada, a leitura do cache offline pendurava a requisição para sempre.
 */
it.fails("não fica em skeleton quando o IndexedDB nunca abre e a primeira chamada falha", async () => {
  await semearIndexedDb();
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: { open: () => ({}) } });
  globalThis.fetch = vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))) as unknown as typeof fetch;
  const { DocumentoJanela } = await import("./DocumentoJanela");
  const { RefreshProvider } = await import("@/lib/refresh-bus");
  render(
    <StrictMode>
      <RefreshProvider><DocumentoJanela path="/tarefa/t1" ordem={0} z={1} aoFechar={() => {}} aoFocar={() => {}} /></RefreshProvider>
    </StrictMode>,
  );
  expect(await screen.findByText(/Volte e tente abrir a tarefa|Tentar de novo/, {}, { timeout: 7000 })).toBeTruthy();
}, 15000);
