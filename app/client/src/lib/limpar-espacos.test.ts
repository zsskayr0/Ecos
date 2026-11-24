import { describe, expect, it } from "vitest";
import { removerEspacosEmBranco } from "./limpar-espacos";

describe("removerEspacosEmBranco", () => {
  it("tira sobras no fim e todas as linhas em branco", () => {
    expect(removerEspacosEmBranco("\n\na  \n\n\n\nb\t\n\n")).toBe("a\nb\n");
  });
  it("não mexe em bloco de código", () => {
    expect(removerEspacosEmBranco("a\n```js\nx  \n\n\ny\n```\n\n\nb")).toBe("a\n```js\nx  \n\n\ny\n```\nb\n");
  });
  it("nota vazia continua vazia", () => { expect(removerEspacosEmBranco(" \n\n")).toBe(""); });
});
