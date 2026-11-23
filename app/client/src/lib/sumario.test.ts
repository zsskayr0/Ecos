import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import { extrairEstrutura, extrairTitulos, numerarTitulos, remarkSumario } from "./sumario";

describe("sumário", () => {
  it("extrai títulos fora de código e numera", () => {
    const t = extrairTitulos("# A\n```\n# não\n```\n## **B**\n### C\n## D\n# E");
    expect(t.map((x) => x.texto)).toEqual(["A", "B", "C", "D", "E"]);
    expect(numerarTitulos(t)).toEqual(["1", "1.1", "1.1.1", "1.2", "2"]);
    expect(numerarTitulos([{ nivel: 2 }, { nivel: 4 }])).toEqual(["1", "1.1.1"]);
  });
  it("põe o sumário no início quando pedido e numera", () => {
    const html = renderToStaticMarkup(createElement(ReactMarkdown, { remarkPlugins: [remarkSumario({ numerar: true, sumario: true })] }, "# Um\n\n## Dois"));
    expect(html.indexOf("ecos-sumario")).toBeLessThan(html.indexOf("<h1"));
    expect(html).toContain('href="#user-content-ecos-titulo-3"');
    expect(html).toContain("1.1 Dois");
  });
  it("sem a opção, não gera sumário", () => {
    const html = renderToStaticMarkup(createElement(ReactMarkdown, { remarkPlugins: [remarkSumario({})] }, "[TOC]\n\n# Um\n\n## Dois"));
    expect(html).not.toContain("ecos-sumario");
  });
  it("estrutura inclui linhas só em negrito, fora de código", () => {
    const e = extrairEstrutura("# A\n**Parte 1**\ntexto **meio** texto\n```\n**não**\n```\n__Parte 2:__");
    expect(e.map((x) => [x.nivel, x.texto])).toEqual([[1, "A"], [7, "Parte 1"], [7, "Parte 2:"]]);
  });
  it("estrutura tira rótulos em negrito repetidos 3+ vezes", () => {
    const e = extrairEstrutura("# A\n**Evidência.**\n# B\n**Evidência.**\n# C\n**Evidência:**\n**Único**");
    expect(e.map((x) => x.texto)).toEqual(["A", "B", "C", "Único"]);
  });
});
