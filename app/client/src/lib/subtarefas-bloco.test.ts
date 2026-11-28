import { describe, expect, it } from "vitest";
import { unified } from "unified";
import remarkParse from "remark-parse";
import type { Root } from "mdast";
import { anexarMarcador, blocoDoMarcador, blocosNoCorpo, remarkSubtarefas } from "./subtarefas-bloco";

describe("marcador de subtarefas", () => {
  it("reconhece nome, bloco padrão e rejeita o resto", () => {
    expect(blocoDoMarcador("::: subtarefas Fase 2")).toBe("Fase 2");
    expect(blocoDoMarcador(":::subtarefas")).toBeNull();
    expect(blocoDoMarcador("  ::: SUBTAREFAS  ")).toBeNull();
    expect(blocoDoMarcador("texto ::: subtarefas")).toBeUndefined();
    expect(blocoDoMarcador("::: subtarefasx")).toBeUndefined();
  });
  it("ignora marcador dentro de bloco de código", () => {
    expect(blocosNoCorpo("::: subtarefas A\n```\n::: subtarefas B\n```\n::: subtarefas")).toEqual(["A", null]);
  });
  it("anexa no fim com linha em branco", () => {
    expect(anexarMarcador("Texto\n\n", "Fase 1")).toBe("Texto\n\n::: subtarefas Fase 1\n");
    expect(anexarMarcador("", null)).toBe("::: subtarefas\n");
  });
  it("vira nó próprio e parte o parágrafo em volta", () => {
    const arvore = unified().use(remarkParse).parse("antes\n::: subtarefas Fase 2\ndepois") as Root;
    remarkSubtarefas.call(unified() as never)!(arvore, undefined as never, () => {});
    expect(arvore.children.map((c) => c.type)).toEqual(["paragraph", "ecosSubtarefas", "paragraph"]);
  });
});

import { expandirMarcadores } from "./subtarefas-bloco";
import { blocosDoResumo } from "./resumo-texto";

describe("expandirMarcadores (PDF)", () => {
  const subs = [
    { titulo: "A1", concluida: true, bloco: "Fase 1" },
    { titulo: "G1", concluida: false },
    { titulo: "B1", concluida: false, bloco: "Fase 2" },
  ];
  it("põe cada bloco no lugar do marcador e o resto no fim", () => {
    expect(expandirMarcadores("Intro\n\n::: subtarefas Fase 1\n\nFim", subs)).toBe("Intro\n\n- [x] A1\n\nFim\n\n- [ ] G1\n- [ ] B1");
  });
  it("sem marcador, igual ao formato antigo", () => {
    expect(expandirMarcadores("Texto", subs)).toBe("Texto\n\n- [x] A1\n- [ ] G1\n- [ ] B1");
  });
  it("marcador de bloco vazio some", () => {
    expect(expandirMarcadores("a\n\n::: subtarefas Nada\n\nb", [])).toBe("a\n\nb");
  });
});

describe("resumo da miniatura", () => {
  it("não mostra a linha do marcador", () => {
    expect(blocosDoResumo("Oi\n\n::: subtarefas Fase 2\n\nTchau").map((b) => b.texto)).toEqual(["Oi", "Tchau"]);
  });
});
