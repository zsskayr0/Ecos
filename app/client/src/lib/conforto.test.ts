import { afterEach, describe, expect, it } from "vitest";
import { PADRAO_PREFERENCIAS_APLICATIVO as P, aplicarPreferenciasAplicativo } from "./preferencias-aplicativo";
import { modoTemaSalvo, resolverTema, temaInicial } from "./theme";

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
  it("primeira abertura: com o sistema em tema claro, o tema inicial é claro", () => {
    const original = window.matchMedia;
    window.matchMedia = ((q: string) => ({ matches: q.includes("light"), media: q, addEventListener() {}, removeEventListener() {} })) as never;
    try {
      expect(temaInicial()).toBe("light");
      localStorage.setItem("ecos-tema", "dark");
      expect(temaInicial()).toBe("dark");
    } finally { window.matchMedia = original; }
  });
  it("tema: sem preferência salva acompanha o sistema; aceita escuro, claro e sistema", () => {
    expect(modoTemaSalvo()).toBe("sistema");
    localStorage.setItem("ecos-tema", "dark");
    expect(modoTemaSalvo()).toBe("dark");
    localStorage.setItem("ecos-tema", "sistema");
    expect(modoTemaSalvo()).toBe("sistema");
    expect(["dark", "light"]).toContain(resolverTema("sistema"));
    expect(resolverTema("light")).toBe("light");
  });
});
