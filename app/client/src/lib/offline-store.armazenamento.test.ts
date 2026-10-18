import "fake-indexeddb/auto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const ESQUEMA = "ecos:offline-esquema";
const idbOriginal = globalThis.indexedDB;

function abrirLegado(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const abrir = indexedDB.open("ecos-offline-v1", 1);
    abrir.onupgradeneeded = () => {
      abrir.result.createObjectStore("respostas", { keyPath: "chave" });
      abrir.result.createObjectStore("fila", { keyPath: "id" });
    };
    abrir.onerror = () => reject(abrir.error);
    abrir.onsuccess = () => resolve(abrir.result);
  });
}

async function semear(): Promise<void> {
  const db = await abrirLegado();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(["respostas", "fila"], "readwrite");
    tx.objectStore("respostas").put({ chave: "/tarefas/t1", valor: { id: "t1", titulo: "velho" }, salvoEm: 1 });
    tx.objectStore("fila").put({ id: "m1", metodo: "PATCH", caminho: "/tarefas/t1", corpo: "{\"titulo\":\"offline\"}", criadaEm: 1 });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
});
afterEach(() => { vi.restoreAllMocks(); Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: idbOriginal }); });

it("a migração de esquema descarta só o cache derivado: fila e rascunhos ficam", async () => {
  await semear();
  localStorage.setItem("ecos.task-draft.v1:t1", "{\"titulo\":\"rascunho\"}");
  localStorage.setItem("ecos:offline-preparado:pessoal", String(Date.now()));
  const loja = await import("./offline-store");

  expect(await loja.obterRespostaOffline("/tarefas/t1")).toBeUndefined();
  expect((await loja.listarMutacoesPendentes()).map((m) => m.id)).toEqual(["m1"]);
  expect(localStorage.getItem("ecos.task-draft.v1:t1")).toBe("{\"titulo\":\"rascunho\"}");
  expect(localStorage.getItem("ecos:offline-preparado:pessoal")).toBeNull(); // o cache será refeito na próxima preparação
  expect(localStorage.getItem(ESQUEMA)).toBe("2");
});

it("com o esquema atual o cache é mantido", async () => {
  await semear();
  localStorage.setItem(ESQUEMA, "2");
  const loja = await import("./offline-store");
  expect(await loja.obterRespostaOffline("/tarefas/t1")).toEqual({ id: "t1", titulo: "velho" });
});

it("IndexedDB que nunca abre: leitura devolve no prazo e a fila nunca perde a escrita", async () => {
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: { open: () => ({}) } });
  const loja = await import("./offline-store");
  const inicio = Date.now();
  expect(await loja.obterRespostaOffline("/tarefas/qualquer")).toBeUndefined();
  expect(Date.now() - inicio).toBeLessThan(loja.PRAZO_IDB_MS + 1_500);

  await loja.enfileirarMutacao("PATCH", "/tarefas/t9", "{\"titulo\":\"x\"}");
  expect((await loja.listarMutacoesPendentes()).map((m) => m.caminho)).toEqual(["/tarefas/t9"]);
  const [pendente] = await loja.listarMutacoesPendentes();
  await loja.concluirMutacaoPendente(pendente.id);
  expect(await loja.listarMutacoesPendentes()).toEqual([]);
}, 15000);

it("onversionchange: fecha a conexão antiga para não bloquear outra aba", async () => {
  await semear();
  localStorage.setItem(ESQUEMA, "2");
  const loja = await import("./offline-store");
  await loja.listarMutacoesPendentes(); // abre a conexão do módulo
  const atualizou = await new Promise<boolean>((resolve) => {
    const pedido = indexedDB.open("ecos-offline-v1", 2);
    pedido.onblocked = () => resolve(false);
    pedido.onsuccess = () => { pedido.result.close(); resolve(true); };
  });
  expect(atualizou).toBe(true);
  // E o módulo reabre sozinho depois (na versão 2 já existente a abertura em v1 falha: cai para memória sem travar).
  expect(await loja.listarMutacoesPendentes()).toBeDefined();
});
