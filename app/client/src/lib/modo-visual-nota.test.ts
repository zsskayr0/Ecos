import { beforeEach, describe, expect, it } from "vitest";
import { lembrarModoDaNota, modoInicialDaNota, renovarModoDaNota, VALIDADE_MODO_NOTA_MS } from "./modo-visual-nota";
import { lerPreferenciasAplicativo, salvarPreferenciasAplicativo } from "./preferencias-aplicativo";

describe("modo visual da nota", () => {
  beforeEach(() => { localStorage.clear(); salvarPreferenciasAplicativo({ ...lerPreferenciasAplicativo(), notaModoLeitura: "fluido", notaModoEdicao: "fluido" }); });

  it("os dois padrões começam em Fluido, e leitura e edição têm o seu cada um", () => {
    expect(modoInicialDaNota("a", "leitura")).toBe("fluido");
    expect(modoInicialDaNota("a", "edicao")).toBe("fluido");
    salvarPreferenciasAplicativo({ ...lerPreferenciasAplicativo(), notaModoEdicao: "pagina" });
    expect(modoInicialDaNota("a", "leitura")).toBe("fluido");
    expect(modoInicialDaNota("a", "edicao")).toBe("pagina");
  });

  it("a escolha vale por 2 minutos, só no contexto em que foi feita, e depois volta ao padrão", () => {
    lembrarModoDaNota("a", "leitura", "pagina", 1000);
    expect(modoInicialDaNota("a", "leitura", 1000 + VALIDADE_MODO_NOTA_MS - 1)).toBe("pagina");
    expect(modoInicialDaNota("a", "edicao", 1500)).toBe("fluido");
    expect(modoInicialDaNota("a", "leitura", 1000 + VALIDADE_MODO_NOTA_MS)).toBe("fluido");
    expect(modoInicialDaNota("b", "leitura", 1500)).toBe("fluido");
  });

  it("fechar a nota renova o prazo; escolha expirada não é renovada", () => {
    lembrarModoDaNota("a", "edicao", "pagina", 0);
    renovarModoDaNota("a", "edicao", 100_000);
    expect(modoInicialDaNota("a", "edicao", 100_000 + VALIDADE_MODO_NOTA_MS - 1)).toBe("pagina");
    renovarModoDaNota("a", "edicao", 100_000 + VALIDADE_MODO_NOTA_MS + 5);
    expect(modoInicialDaNota("a", "edicao", 100_000 + VALIDADE_MODO_NOTA_MS + 6)).toBe("fluido");
  });
});
