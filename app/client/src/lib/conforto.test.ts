import { afterEach, describe, expect, it } from "vitest";
import { PADRAO_PREFERENCIAS_APLICATIVO as P, aplicarPreferenciasAplicativo } from "./preferencias-aplicativo";
import { modoTemaSalvo, resolverTema } from "./theme";

afterEach(() => { document.documentElement.removeAttribute("data-reduzir-movimento"); document.documentElement.style.fontSize = ""; localStorage.clear(); });

describe("conforto", () => {
  it("escala a interface pela raiz e volta ao normal em 100%", () => {
    aplicarPreferenciasAplicativo({ ...P, escalaInterface: 125 });
    expect(document.documentElement.style.fontSize).toBe("125%");
    aplicarPreferenciasAplicativo({ ...P, escalaInterface: 100 });
    expect(document.documentElement.style.fontSize).toBe("");
  });
  it("reduzir movimento liga e desliga o atributo da raiz", () => {
    aplicarPreferenciasAplicativo({ ...P, reduzirMovimento: "ligado" });
    expect(document.documentElement.getAttribute("data-reduzir-movimento")).toBe("true");
    aplicarPreferenciasAplicativo({ ...P, reduzirMovimento: "desligado" });
    expect(document.documentElement.hasAttribute("data-reduzir-movimento")).toBe(false);
  });
  it("tema: escuro por padrão, aceita claro e sistema", () => {
    expect(modoTemaSalvo()).toBe("dark");
    localStorage.setItem("ecos-tema", "sistema");
    expect(modoTemaSalvo()).toBe("sistema");
    expect(["dark", "light"]).toContain(resolverTema("sistema"));
    expect(resolverTema("light")).toBe("light");
  });
});
