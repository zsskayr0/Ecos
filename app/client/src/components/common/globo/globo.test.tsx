import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Bandeira } from "./Bandeira";
import { PAISES_NO_GLOBO } from "./paises";
import { ehTerra } from "./terra-mascara";

const PAISES_DA_TELA = ["Brasil", "Portugal", "Estados Unidos", "Canadá", "México", "Argentina", "Chile", "Colômbia", "Uruguai", "Reino Unido", "Espanha", "França", "Alemanha", "Itália", "Países Baixos", "Suíça", "Japão", "China", "Índia", "Austrália"];

describe("globo de países", () => {
  it("a máscara acerta terra e mar em pontos conhecidos", () => {
    expect(ehTerra(-14.2, -51.9)).toBe(true); // Brasil
    expect(ehTerra(36, 138)).toBe(true); // Japão
    expect(ehTerra(0, -30)).toBe(false); // Atlântico
    expect(ehTerra(-40, -150)).toBe(false); // Pacífico Sul
  });

  it("todo país da lista tem coordenada em terra e bandeira", () => {
    for (const pais of PAISES_DA_TELA) {
      const p = PAISES_NO_GLOBO[pais];
      expect(p, `coordenada de ${pais}`).toBeTruthy();
      expect(ehTerra(p.lat, p.lon) || p.raio < 5, `${pais} cai no mar`).toBe(true);
      const { container } = render(<Bandeira pais={pais} />);
      expect(container.querySelector("svg"), `bandeira de ${pais}`).toBeTruthy();
    }
  });
});
