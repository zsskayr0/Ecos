import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import { extrairTitulos, numerarTitulos, remarkSumario } from "./sumario";

describe("sumário", () => {
  it("extrai títulos fora de código e numera", () => {
    const t = extrairTitulos("# A\n```\n# não\n```\n## **B**\n### C\n## D\n# E");
    expect(t.map((x) => x.texto)).toEqual(["A", "B", "C", "D", "E"]);
    expect(numerarTitulos(t)).toEqual(["1", "1.1", "1.1.1", "1.2", "2"]);
    expect(numerarTitulos([{ nivel: 2 }, { nivel: 4 }])).toEqual(["1", "1.1.1"]);
  });
  it("troca [TOC] por lista e numera", () => {
    const html = renderToStaticMarkup(createElement(ReactMarkdown, { remarkPlugins: [remarkSumario({ numerar: true })] }, "[TOC]\n\n# Um\n\n## Dois"));
    expect(html).toContain('href="#user-content-ecos-titulo-3"');
    expect(html).toContain("1.1 Dois");
    expect(html).toContain('id="ecos-titulo-5"');
  });
});
