import { describe, expect, it } from "vitest";
import { blocosDoResumo, textoSimples } from "./resumo-texto";

describe("textoSimples", () => {
  it("tira a marcação inline", () => {
    expect(textoSimples("**Projeto:** veja [o site](http://x.y) e [[Nota|apelido]] com `código`")).toBe("Projeto: veja o site e apelido com código");
  });
});

describe("blocosDoResumo", () => {
  it("junta linhas seguidas em um parágrafo e separa títulos e itens", () => {
    const b = blocosDoResumo("# Título\nlinha um\nlinha dois\n\n- item a\n- [ ] item b");
    expect(b).toEqual([
      { tipo: "titulo", texto: "Título" },
      { tipo: "paragrafo", texto: "linha um linha dois" },
      { tipo: "item", texto: "item a" },
      { tipo: "item", texto: "item b" },
    ]);
  });
  it("ignora código, tabela, imagem e régua", () => {
    const b = blocosDoResumo("antes\n\n```js\nconst a = 1;\n```\n\n| a | b |\n|---|---|\n\n![img](x.png)\n\n---\n\ndepois");
    expect(b.map((x) => x.texto)).toEqual(["antes", "depois"]);
  });
  it("para ao passar do limite", () => {
    const b = blocosDoResumo(Array.from({ length: 50 }, (_, i) => `paragrafo ${i} com algum texto\n`).join("\n"), 100);
    expect(b.length).toBeLessThan(10);
  });
});
