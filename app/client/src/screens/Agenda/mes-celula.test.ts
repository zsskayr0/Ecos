import { describe, expect, it } from "vitest";
import { calcularVisiveis, classeDiaMes } from "./mes-celula";
import { dataLocalISO } from "@/lib/agenda-tempo";

describe("calcularVisiveis", () => {
  it("mostra tudo quando cabe", () => {
    expect(calcularVisiveis(3, 44 + 24 * 3)).toEqual({ visiveis: 3, resto: 0 });
  });
  it("reserva uma linha para o +N quando não cabe", () => {
    // cabem 3 linhas; com 7 itens: 2 chips + "+5 itens"
    expect(calcularVisiveis(7, 44 + 24 * 3)).toEqual({ visiveis: 2, resto: 5 });
  });
  it("célula muito baixa mostra só o +N", () => {
    expect(calcularVisiveis(4, 50)).toEqual({ visiveis: 0, resto: 4 });
  });
  it("sem medida usa 3 itens", () => {
    expect(calcularVisiveis(5, 0)).toEqual({ visiveis: 2, resto: 3 });
    expect(calcularVisiveis(2, 0)).toEqual({ visiveis: 2, resto: 0 });
  });
  it("linhas mais altas mostram mais itens", () => {
    expect(calcularVisiveis(10, 44 + 24 * 6).visiveis).toBe(5);
  });
});

describe("classeDiaMes", () => {
  it("só hoje recebe o círculo cheio; o dia selecionado não", () => {
    const hoje = classeDiaMes({ ehHoje: true, ativo: false });
    const selecionado = classeDiaMes({ ehHoje: false, ativo: true });
    expect(hoje).toContain("bg-steel-500");
    expect(selecionado).not.toContain("bg-steel-500");
    expect(classeDiaMes({ ehHoje: true, ativo: true })).toContain("bg-steel-500");
  });
  it("hoje é comparado pela data local injetada, não pelo relógio nem pelo fuso", () => {
    // 16/10/2026 23:30 local: dataLocalISO usa getters locais, então não vira dia 17 em UTC.
    const agora = new Date(2026, 9, 16, 23, 30);
    const hojeISO = dataLocalISO(agora);
    expect(hojeISO).toBe("2026-10-16");
    expect(dataLocalISO(new Date(2026, 8, 10)) === hojeISO).toBe(false);
  });
});
