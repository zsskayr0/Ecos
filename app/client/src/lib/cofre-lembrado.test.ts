import { afterEach, beforeEach, expect, it, vi } from "vitest";

const invoke = vi.fn();
const estado = { tauri: true, servidor: "http://ecos.local:8080/" as string | null };

vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));
vi.mock("./server-config", () => ({ estaNoTauri: () => estado.tauri, obterServidorBaseUrl: () => estado.servidor }));

/** O módulo guarda "suportado" em cache; cada teste começa com um módulo novo. */
async function carregar() {
  vi.resetModules();
  return await import("./cofre-lembrado");
}

beforeEach(() => {
  invoke.mockReset();
  estado.tauri = true;
  estado.servidor = "http://ecos.local:8080/";
  window.localStorage.clear();
});
afterEach(() => vi.restoreAllMocks());

it("a chave junta servidor, conta e espaço (sem barra no fim) e não existe sem servidor ou conta", async () => {
  const m = await carregar();
  expect(m.chaveDoCofre("u1", "pessoal")).toBe("http://ecos.local:8080|u1|pessoal");
  expect(m.chaveDoCofre("u1", "equipe:abc")).not.toBe(m.chaveDoCofre("u1", "pessoal"));
  expect(m.chaveDoCofre("u2", "pessoal")).not.toBe(m.chaveDoCofre("u1", "pessoal"));
  expect(m.chaveDoCofre("", "pessoal")).toBeNull();
  estado.servidor = null;
  expect(m.chaveDoCofre("u1", "pessoal")).toBeNull();
});

it("fora do app nativo nada é suportado e nenhum comando é chamado", async () => {
  estado.tauri = false;
  const m = await carregar();
  expect(await m.lembrarSenhaSuportado()).toBe(false);
  expect(await m.lembrarSenha("k", "senha")).toBe(false);
  expect(await m.temSenhaLembrada("k")).toBe(false);
  expect(await m.lerSenhaLembrada("k")).toBeNull();
  await m.esquecerSenha("k");
  expect(invoke).not.toHaveBeenCalled();
});

it("sistema sem armazenamento seguro (Android): não oferece e não grava", async () => {
  invoke.mockResolvedValue(false);
  const m = await carregar();
  expect(await m.lembrarSenhaSuportado()).toBe(false);
  expect(await m.lembrarSenha("k", "senha")).toBe(false);
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(invoke).toHaveBeenCalledWith("cofre_senha_suportada", undefined);
});

it("no Windows: grava, confere que gravou, lê e esquece pelos comandos nativos", async () => {
  const guardado = new Map<string, string>();
  invoke.mockImplementation(async (nome: string, args: { chave?: string; senha?: string } = {}) => {
    if (nome === "cofre_senha_suportada") return true;
    if (nome === "cofre_senha_salvar") { guardado.set(args.chave!, args.senha!); return null; }
    if (nome === "cofre_senha_tem") return guardado.has(args.chave!);
    if (nome === "cofre_senha_ler") return guardado.get(args.chave!) ?? null;
    if (nome === "cofre_senha_esquecer") { guardado.delete(args.chave!); return null; }
    throw new Error("comando inesperado " + nome);
  });
  const m = await carregar();
  expect(await m.lembrarSenhaSuportado()).toBe(true);
  expect(await m.temSenhaLembrada("k")).toBe(false);
  expect(await m.lembrarSenha("k", "senha-do-cofre")).toBe(true);
  expect(await m.temSenhaLembrada("k")).toBe(true);
  expect(await m.lerSenhaLembrada("k")).toBe("senha-do-cofre");
  expect(await m.lerSenhaLembrada("outra")).toBeNull();
  await m.esquecerSenha("k");
  expect(await m.temSenhaLembrada("k")).toBe(false);
});

it("falha ao gravar (Credential Manager indisponível) devolve false em vez de estourar", async () => {
  invoke.mockImplementation(async (nome: string) => {
    if (nome === "cofre_senha_suportada") return true;
    throw { code: "SESSAO_NATIVA", message: "negado" };
  });
  const m = await carregar();
  expect(await m.lembrarSenha("k", "senha")).toBe(false);
  expect(await m.temSenhaLembrada("k")).toBe(false);
  expect(await m.lerSenhaLembrada("k")).toBeNull();
});

it("bloqueio manual: marca, consulta e limpa por Cofre, sem vazar para outro", async () => {
  const m = await carregar();
  expect(m.bloqueioManual("a")).toBe(false);
  m.marcarBloqueioManual("a");
  expect(m.bloqueioManual("a")).toBe(true);
  expect(m.bloqueioManual("b")).toBe(false);
  m.limparBloqueioManual("a");
  expect(m.bloqueioManual("a")).toBe(false);
});

it("sem armazenamento local, o bloqueio manual não derruba o app", async () => {
  const m = await carregar();
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("bloqueado"); });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("bloqueado"); });
  vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new Error("bloqueado"); });
  expect(() => m.marcarBloqueioManual("a")).not.toThrow();
  expect(m.bloqueioManual("a")).toBe(false);
  expect(() => m.limparBloqueioManual("a")).not.toThrow();
});

it("sair da conta esquece a senha e o bloqueio manual de cada Cofre dela (pessoal e equipes) e só dela", async () => {
  invoke.mockResolvedValue(null);
  const m = await carregar();
  m.marcarBloqueioManual(m.chaveDoCofre("u1", "pessoal")!);
  m.marcarBloqueioManual(m.chaveDoCofre("u2", "pessoal")!);
  await m.esquecerSenhasDaConta("u1", ["pessoal", "equipe:e1", "equipe:e2"]);
  const esquecidas = invoke.mock.calls.filter(([n]) => n === "cofre_senha_esquecer").map(([, a]) => (a as { chave: string }).chave);
  expect(esquecidas).toEqual(["http://ecos.local:8080|u1|pessoal", "http://ecos.local:8080|u1|equipe:e1", "http://ecos.local:8080|u1|equipe:e2"]);
  expect(m.bloqueioManual("http://ecos.local:8080|u1|pessoal")).toBe(false);
  expect(m.bloqueioManual("http://ecos.local:8080|u2|pessoal")).toBe(true);
});

// ---- Android: Keystore + biometria pela ponte `window.EcosCofreSenha` ------------------------------------------------
type Ponte = {
  suportado: () => boolean; tem: (c: string) => boolean; esquecer: (c: string) => void;
  salvar: (p: number, c: string, s: string) => void; ler: (p: number, c: string) => void;
};
function instalarPonteAndroid(resposta: { estado: string; valor?: string }) {
  const guardado = new Map<string, string>();
  const ponte: Ponte = {
    suportado: () => true,
    tem: (c) => guardado.has(c),
    esquecer: (c) => { guardado.delete(c); },
    salvar: (p, c, s) => { if (resposta.estado === "ok") guardado.set(c, s); queueMicrotask(() => (window as any).__ecosCofreSenha(p, JSON.stringify({ estado: resposta.estado }))); },
    ler: (p, c) => queueMicrotask(() => (window as any).__ecosCofreSenha(p, JSON.stringify(resposta.estado === "ok" ? { estado: "ok", valor: guardado.get(c) } : { estado: resposta.estado }))),
  };
  (window as any).EcosCofreSenha = ponte;
  return guardado;
}
afterEach(() => { delete (window as any).EcosCofreSenha; delete (window as any).__ecosCofreSenha; });

it("Android: guarda e lê a senha pela ponte do Keystore, sem passar pelos comandos do Tauri", async () => {
  instalarPonteAndroid({ estado: "ok" });
  const m = await carregar();
  expect(await m.lembrarSenhaSuportado()).toBe(true);
  expect(m.lembradaExigeConfirmacao()).toBe(true);
  expect(await m.lembrarSenha("k", "senha-forte-com-25-caracteres")).toBe(true);
  expect(await m.temSenhaLembrada("k")).toBe(true);
  expect(await m.lerSenhaLembrada("k")).toBe("senha-forte-com-25-caracteres");
  await m.esquecerSenha("k");
  expect(await m.temSenhaLembrada("k")).toBe(false);
  expect(invoke).not.toHaveBeenCalled();
});

it("Android: biometria cancelada não guarda nem devolve senha", async () => {
  const guardado = instalarPonteAndroid({ estado: "cancelado" });
  const m = await carregar();
  expect(await m.lembrarSenha("k", "senha")).toBe(false);
  expect(guardado.size).toBe(0);
  guardado.set("k", "senha");
  expect(await m.lerSenhaLembrada("k")).toBeNull();
});
