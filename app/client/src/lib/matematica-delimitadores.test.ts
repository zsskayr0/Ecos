import { describe, expect, it } from "vitest";
import { acharMatematica, normalizarDelimitadores } from "./matematica";

describe("delimitadores \\( \\) e \\[ \\]", () => {
  it("acha fórmula na linha e em bloco", () => {
    const t = "Sabendo que \\(p=V\\) e \\(q=F\\):\n\\[ (p\\land q)\\rightarrow r \\]";
    const a = acharMatematica(t);
    expect(a.map((x) => [x.tex, x.bloco])).toEqual([["p=V", false], ["q=F", false], ["(p\\land q)\\rightarrow r", true]]);
  });
  it("bloco em várias linhas", () => {
    const a = acharMatematica("\\[\nx^2\n\\]");
    expect(a).toHaveLength(1);
    expect(a[0].bloco).toBe(true);
  });
  it("normaliza para $ e $$, sem mexer em código nem preço", () => {
    expect(normalizarDelimitadores("a \\(x\\) b")).toBe("a $x$ b");
    expect(normalizarDelimitadores("\\[ y \\]")).toBe("$$y$$");
    expect(normalizarDelimitadores("`\\(x\\)` custa R$ 5")).toBe("`\\(x\\)` custa R$ 5");
  });
});
