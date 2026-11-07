import { describe, expect, it } from "vitest";
import { atinge, caixa, caminhoCentral, contornoCaneta, gerarD, intersecta, novoTraco, simplificar } from "./geometria";
import { aplicar, desfazer, historicoVazio, refazer, registrar } from "./historico";
import { ativos } from "./tipos";

/** Mesma whitelist do servidor (`tinta.rs::d_valido`). */
const D_SERVIDOR = /^[MmLlHhVvCcQqSsTtZz0-9 .,-]+$/;

const linha = (n: number, pressao = 0.5) => Array.from({ length: n }, (_, i) => ({ x: 10 + i * 3, y: 20 + Math.sin(i / 3) * 4, pressao }));

describe("geometria da tinta", () => {
  it("gera d aceito pelo servidor para caneta, marca-texto e ponto único", () => {
    for (const d of [contornoCaneta(linha(30), 2.5), contornoCaneta([{ x: 5, y: 5, pressao: 0.5 }], 2), gerarD("marca-texto", linha(10), 16), caminhoCentral([{ x: 1e-9, y: -0.00001 }])]) {
      expect(d).toMatch(D_SERVIDOR);
      expect(d).not.toMatch(/e|NaN|Infinity/);
    }
    expect(contornoCaneta(linha(30), 2.5).endsWith("Z")).toBe(true);
  });

  it("pressão maior engrossa o contorno", () => {
    const largura = (p: number) => { const d = contornoCaneta([{ x: 0, y: 0, pressao: p }, { x: 100, y: 0, pressao: p }], 4); const ys = [...d.matchAll(/-?\d+(?:\.\d+)? (-?\d+(?:\.\d+)?)/g)].map((m) => Number(m[1])); return Math.max(...ys) - Math.min(...ys); };
    expect(largura(1)).toBeGreaterThan(largura(0.5));
    expect(largura(0.5)).toBeGreaterThan(largura(0));
  });

  it("simplificar descarta pontos repetidos e mantém as pontas", () => {
    const pts = [{ x: 0, y: 0, pressao: 0.5 }, { x: 0.1, y: 0, pressao: 0.5 }, { x: 0.2, y: 0, pressao: 0.5 }, { x: 5, y: 0, pressao: 0.5 }];
    expect(simplificar(pts)).toEqual([pts[0], pts[3]]);
  });

  it("borracha acerta perto do traço e erra longe; caixa e interseção", () => {
    const t = { pontos: [{ x: 0, y: 0, pressao: 0.5 }, { x: 100, y: 0, pressao: 0.5 }], espessura: 2 };
    expect(atinge(t, 50, 3, 3)).toBe(true);
    expect(atinge(t, 50, 30, 3)).toBe(false);
    expect(atinge(t, 140, 0, 3)).toBe(false);
    expect(intersecta(caixa(t), { x0: 90, y0: -5, x1: 200, y1: 5 })).toBe(true);
    expect(intersecta(caixa(t), { x0: 0, y0: 50, x1: 10, y1: 60 })).toBe(false);
  });

  it("novoTraco arredonda, limita a pressão e gera ids distintos", () => {
    const a = novoTraco("caneta", "auto", 2.5, [{ x: 1.234, y: 5.678, pressao: 1.7 }, { x: 9.99, y: 9.99, pressao: -1 }]);
    expect(a.pontos).toEqual([{ x: 1.2, y: 5.7, pressao: 1 }, { x: 10, y: 10, pressao: 0 }]);
    expect(a.id).toMatch(/^[0-9a-z]+$/);
    expect(novoTraco("caneta", "auto", 2, linha(3)).id).not.toBe(a.id);
  });
});

describe("histórico da tinta", () => {
  it("desfaz e refaz desenhar e apagar, com lápide", () => {
    const t1 = novoTraco("caneta", "auto", 2, linha(5));
    const t2 = novoTraco("marca-texto", "#facc15", 16, linha(5));
    let h = historicoVazio();
    let tracos = aplicar([], { tipo: "adicionar", traco: t1 });
    h = registrar(h, { tipo: "adicionar", traco: t1 });
    tracos = aplicar(tracos, { tipo: "adicionar", traco: t2 });
    h = registrar(h, { tipo: "adicionar", traco: t2 });
    const apagar = { tipo: "apagar" as const, ids: [t1.id, t2.id], em: "2026-11-06T00:00:00Z" };
    tracos = aplicar(tracos, apagar);
    h = registrar(h, apagar);
    expect(ativos(tracos)).toHaveLength(0);
    expect(tracos).toHaveLength(2);

    let r = desfazer(h, tracos)!;
    expect(ativos(r.tracos).map((t) => t.id)).toEqual([t1.id, t2.id]);
    r = desfazer(r.h, r.tracos)!;
    expect(r.tracos.map((t) => t.id)).toEqual([t1.id]);
    r = refazer(r.h, r.tracos)!;
    expect(r.tracos.map((t) => t.id)).toEqual([t1.id, t2.id]);
    expect(refazer(r.h, r.tracos)).not.toBeNull();
    // Nova operação apaga o que dava para refazer.
    expect(registrar(r.h, { tipo: "adicionar", traco: t1 }).desfeitas).toHaveLength(0);
    expect(desfazer(historicoVazio(), [])).toBeNull();
  });
});
