import { describe, expect, it } from "vitest";
import { ocultoNoFeed } from "./feed-oculto";

const ocultos = { itens: [{ id: "n1", tipo: "nota" as const, titulo: "x" }], pastas: [{ espaco: "pessoal", caminho: "Proj" }], tags: ["chato"] };

describe("ocultoNoFeed", () => {
  it("filtra por item, pasta (com subpastas) e tag", () => {
    expect(ocultoNoFeed({ id: "n1", espaco: "pessoal" }, ocultos)).toBe(true);
    expect(ocultoNoFeed({ id: "n2", espaco: "pessoal", pasta: "Proj/Sub" }, ocultos)).toBe(true);
    expect(ocultoNoFeed({ id: "n3", espaco: "pessoal", tags: ["chato"] }, ocultos)).toBe(true);
  });
  it("não confunde nomes parecidos nem outro espaço", () => {
    expect(ocultoNoFeed({ id: "n4", espaco: "pessoal", pasta: "Projetos" }, ocultos)).toBe(false);
    expect(ocultoNoFeed({ id: "n5", espaco: "equipe:E", pasta: "Proj" }, ocultos)).toBe(false);
    expect(ocultoNoFeed({ id: "n6", espaco: "pessoal" }, null)).toBe(false);
  });
});
