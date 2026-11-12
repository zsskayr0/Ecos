import { afterEach, describe, expect, it } from "vitest";
import { comPastasOtimistas, definirPastaOtimista, reconciliarPastasOtimistas } from "./pasta-otimista";

const pastas = [{ caminho: "Dev", nome: "Dev", contagem_itens: 0, cor: null, tags: null }];
const limpar: (() => void)[] = [];
afterEach(() => { limpar.splice(0).forEach((f) => f()); });

describe("pasta otimista", () => {
  it("sobrepõe na hora e desfaz ao reverter", () => {
    let atual = new Map<string, object>();
    const reverter = definirPastaOtimista("Dev", { cor: "#ff0000", tags: ["x"] });
    limpar.push(reverter);
    // lê o estado pela própria API pública de reconciliação: com o servidor diferente, a sobreposição continua valendo
    reconciliarPastasOtimistas(pastas);
    atual = new Map([["Dev", { cor: "#ff0000", tags: ["x"] }]]);
    expect(comPastasOtimistas(pastas, atual as never)[0]).toMatchObject({ cor: "#ff0000", tags: ["x"] });
  });

  it("some sozinha quando o servidor passa a dizer o mesmo", () => {
    definirPastaOtimista("Dev", { cor: "#ff0000", fixada: false });
    reconciliarPastasOtimistas([{ ...pastas[0]!, cor: "#ff0000", fixada: null }]);
    // sem sobreposição restante, a lista volta a ser exatamente a do servidor
    expect(comPastasOtimistas(pastas, new Map())).toBe(pastas);
  });
});
