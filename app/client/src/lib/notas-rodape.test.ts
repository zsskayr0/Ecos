import { describe, expect, it } from "vitest";
import { bibliotecaDoCorpo, chavesCitadas, citacaoCurta, comBibliografia, extrairNotas } from "./notas-rodape";

const corpo = `Texto[^b] e outro[^a] citando [@silva2020].

[^a]: Nota A
[^b]: Nota B
  continua

\`\`\`bibtex
@book{silva2020, author = {Silva, Ana and Souza, Beto}, title = {Livro}, year = 2020, publisher = {Editora}}
\`\`\``;

describe("notas-rodape", () => {
  it("numera na ordem das chamadas e junta continuações", () => {
    expect(extrairNotas(corpo)).toEqual([{ rotulo: "b", numero: 1, texto: "Nota B continua" }, { rotulo: "a", numero: 2, texto: "Nota A" }]);
  });
  it("lê bibtex e cita", () => {
    const [r] = bibliotecaDoCorpo(corpo);
    expect(r.campos.year).toBe("2020");
    expect(chavesCitadas(corpo)).toEqual(["silva2020"]);
    expect(citacaoCurta(r, "silva2020")).toBe("Silva e Souza, 2020");
  });
  it("PDF: troca citação e põe a bibliografia no fim", () => {
    const pdf = comBibliografia(corpo);
    expect(pdf).toContain("citando (Silva e Souza, 2020)");
    expect(pdf).not.toContain("```bibtex");
    expect(pdf.trimEnd().endsWith("Silva, Ana; Souza, Beto. Livro. Editora. 2020")).toBe(true);
  });
});
