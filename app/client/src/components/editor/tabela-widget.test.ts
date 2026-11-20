import { describe, expect, it } from "vitest";
import { dividirLinha, escreverTabela, lerTabela, preencherCelula } from "./tabela-widget";

describe("tabela-widget", () => {
  it("divide células respeitando pipe escapado e barras das pontas", () => {
    expect(dividirLinha("| a | b \\| c | d |")).toEqual(["a", "b | c", "d"]);
    expect(dividirLinha("a | b")).toEqual(["a", "b"]);
  });

  it("lê cabeçalho, alinhamentos e linhas, completando células faltantes", () => {
    const t = lerTabela("| Função | Seção |\n|:---|---:|\n| Todos | 1 |\n| QA |");
    expect(t?.cabecalho).toEqual(["Função", "Seção"]);
    expect(t?.alinhamentos).toEqual(["left", "right"]);
    expect(t?.linhas).toEqual([["Todos", "1"], ["QA", ""]]);
  });

  it("rejeita texto sem linha delimitadora", () => {
    expect(lerTabela("| a | b |\n| c | d |")).toBeNull();
  });
});

describe("escreverTabela e preencherCelula", () => {
  it("serializa preservando alinhamento e escapando pipe", () => {
    const md = "| A | B |\n| :---: | ---: |\n| x \\| y | 2 |";
    expect(escreverTabela(lerTabela(md)!)).toBe(md);
  });

  it("renderiza _itálico_, link e imagem", () => {
    const el = document.createElement("td");
    preencherCelula(el, "_it_ [site](https://ex.com) ![alt](a.png) [mau](javascript:alert(1))");
    expect(el.querySelector("em")?.textContent).toBe("it");
    expect(el.querySelector("a")?.getAttribute("href")).toBe("https://ex.com");
    expect(el.querySelector("img")?.getAttribute("src")).toBe("a.png");
    expect(el.querySelectorAll("a")[1].hasAttribute("href")).toBe(false);
  });
});
