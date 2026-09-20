import { beforeEach, describe, expect, it } from "vitest";
import { limparConteudoLocal } from "./dados-locais";

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
