import { beforeEach, describe, expect, it } from "vitest";
import { contarRascunhosLocais, expirarRascunhosAntigos, limparConteudoLocal } from "./dados-locais";

beforeEach(() => localStorage.clear());

describe("limparConteudoLocal", () => {
  it("apaga rascunhos, buscas recentes e layout com títulos, e mantém as preferências de interface", () => {
    const conteudo = ["ecos-buscas-recentes", "ecos.capture-draft.v1", "ecos.desktop.workspace.v1", "ecos.task-draft.v1:t1", "ecos.note-draft.v1:n1", "ecos.note-draft.v2:n2"];
    const preferencias = ["ecos-tema", "ecos:espaco-ativo", "ecos:filtros3:tarefas", "ecos.tabela.larguras:feed", "ecos:servidor_base_url"];
    [...conteudo, ...preferencias].forEach((k) => localStorage.setItem(k, "x"));
    limparConteudoLocal();
    expect(conteudo.filter((k) => localStorage.getItem(k) !== null)).toEqual([]);
    expect(preferencias.filter((k) => localStorage.getItem(k) === null)).toEqual([]);
  });
});

describe("rascunhos e dados financeiros", () => {
  it("bloquear o Cofre apaga nomes de sacados e rascunho de lançamento antigo, e mantém preferências e rascunhos de nota", () => {
    localStorage.setItem("ecos:cofre:sacados-ignorados", "[\"mercado joao\"]");
    localStorage.setItem("ecos.capture-draft.v1", "{\"valorCentavos\":12345}");
    localStorage.setItem("ecos-buscas-recentes", "[\"aluguel\"]");
    localStorage.setItem("ecos.note-draft.v1:n1", "x");
    localStorage.setItem("ecos.cofre.categorias.preferencias", "{}");
    window.dispatchEvent(new Event("ecos:cofre-bloqueado"));
    expect(localStorage.getItem("ecos-buscas-recentes")).toBeNull();
    expect(localStorage.getItem("ecos:cofre:sacados-ignorados")).toBeNull();
    expect(localStorage.getItem("ecos.capture-draft.v1")).toBeNull();
    expect(localStorage.getItem("ecos.note-draft.v1:n1")).toBe("x");
    expect(localStorage.getItem("ecos.cofre.categorias.preferencias")).toBe("{}");
  });

  it("sair da conta também apaga os rastros financeiros e a rota do Cofre da sessão", () => {
    localStorage.setItem("ecos:cofre:sacados-ignorados", "[]");
    sessionStorage.setItem("ecos.desktop.cofre-rota.v1", "/cofre/transacao/abc");
    limparConteudoLocal();
    expect(localStorage.getItem("ecos:cofre:sacados-ignorados")).toBeNull();
    expect(sessionStorage.getItem("ecos.desktop.cofre-rota.v1")).toBeNull();
  });

  it("conta os rascunhos de nota e tarefa não salvos", () => {
    expect(contarRascunhosLocais()).toBe(0);
    localStorage.setItem("ecos.task-draft.v1:t1", "{}");
    localStorage.setItem("ecos.note-draft.v2:n1", "{}");
    localStorage.setItem("ecos-tema", "escuro");
    expect(contarRascunhosLocais()).toBe(2);
  });

  it("rascunho esquecido expira depois do prazo contado da primeira vez que foi visto", () => {
    const t0 = 1_700_000_000_000;
    localStorage.setItem("ecos.task-draft.v1:t1", "{}");
    expirarRascunhosAntigos(30, t0);
    expect(localStorage.getItem("ecos.task-draft.v1:t1")).toBe("{}");
    expirarRascunhosAntigos(30, t0 + 29 * 86_400_000);
    expect(localStorage.getItem("ecos.task-draft.v1:t1")).toBe("{}");
    expirarRascunhosAntigos(30, t0 + 31 * 86_400_000);
    expect(localStorage.getItem("ecos.task-draft.v1:t1")).toBeNull();
    expect(localStorage.getItem("ecos.rascunhos.vistos.v1")).toBeNull();
  });
});
