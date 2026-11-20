import "fake-indexeddb/auto";
import { beforeEach, expect, it } from "vitest";
import { _reiniciarMigracaoRascunhos, contarRascunhosNota, guardarRascunhoNota, lerRascunhoNota, limparDadosOffline, migrarRascunhosNotaLegados, removerRascunhoNota } from "./offline-store";

beforeEach(async () => {
  localStorage.clear();
  await limparDadosOffline();
  _reiniciarMigracaoRascunhos();
});

it("guarda, lê e remove o rascunho no IndexedDB (não no localStorage)", async () => {
  expect(await guardarRascunhoNota("n1", { titulo: "T", corpo: "texto", baseVersao: 3 })).toBe(true);
  expect(Object.keys(localStorage).some((k) => k.includes("note-draft"))).toBe(false);
  expect(await lerRascunhoNota("n1")).toMatchObject({ chave: "n1", titulo: "T", corpo: "texto", baseVersao: 3 });
  expect(await contarRascunhosNota()).toBe(1);
  await removerRascunhoNota("n1");
  expect(await lerRascunhoNota("n1")).toBeUndefined();
});

it("migra os rascunhos antigos do localStorage (v2 do desktop vence o v1) e apaga as chaves", async () => {
  localStorage.setItem("ecos.note-draft.v1:a", JSON.stringify({ titulo: "celular", corpo: "v1" }));
  localStorage.setItem("ecos.note-draft.v2:a", JSON.stringify({ titulo: "desktop", corpo: "v2", tags: ["x"], pasta: null, espaco: "pessoal" }));
  localStorage.setItem("ecos.note-draft.v1:b", JSON.stringify({ titulo: "só celular", corpo: "b" }));
  localStorage.setItem("ecos.note-draft.v1:c", "{quebrado");
  await migrarRascunhosNotaLegados();
  expect(await lerRascunhoNota("a")).toMatchObject({ titulo: "desktop", corpo: "v2", tags: ["x"] });
  expect(await lerRascunhoNota("b")).toMatchObject({ titulo: "só celular", corpo: "b" });
  expect(Object.keys(localStorage).filter((k) => k.startsWith("ecos.note-draft."))).toEqual([]);
});

it("rascunho já no banco não é sobrescrito por um legado", async () => {
  await guardarRascunhoNota("a", { titulo: "novo", corpo: "idb" });
  localStorage.setItem("ecos.note-draft.v2:a", JSON.stringify({ titulo: "velho", corpo: "ls", tags: [] }));
  await migrarRascunhosNotaLegados();
  expect(await lerRascunhoNota("a")).toMatchObject({ corpo: "idb" });
});

it("expira rascunhos com mais de 30 dias", async () => {
  await guardarRascunhoNota("velho", { titulo: "T", corpo: "c" });
  await migrarRascunhosNotaLegados(Date.now() + 31 * 86_400_000);
  _reiniciarMigracaoRascunhos();
  expect(await lerRascunhoNota("velho")).toBeUndefined();
});

it("sair da conta (limparDadosOffline) apaga os rascunhos", async () => {
  await guardarRascunhoNota("n1", { titulo: "T", corpo: "c" });
  await limparDadosOffline();
  expect(await contarRascunhosNota()).toBe(0);
});
