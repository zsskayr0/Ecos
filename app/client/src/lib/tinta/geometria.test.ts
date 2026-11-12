import { describe, expect, it } from "vitest";
import { atinge, caixa, caixaDoConjunto, pontoNoPoligono, selecionadosPeloLaco, transformarTraco, caminhoCentral, contornoCaneta, cortar, densificar, gerarD, intersecta, novoTraco, reconhecerForma, simplificar } from "./geometria";
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

const P = (x: number, y: number) => ({ x, y, pressao: 0.5 });
const tremor = (n: number) => Math.sin(n * 12.9898) * 1.2;
const caminhoPoligono = (v: { x: number; y: number }[], fecha = true) => densificar([...v, ...(fecha ? [v[0]] : [])].map((q) => P(q.x, q.y)), 4).map((q, i) => P(q.x + tremor(i), q.y + tremor(i + 7)));

describe("borracha por trecho e formas", () => {
  it("cortar remove só o trecho tocado e mantém os dois pedaços", () => {
    const t = { pontos: [P(0, 0), P(100, 0)], espessura: 2 };
    const pedacos = cortar(t, [P(50, 0)], 10);
    expect(pedacos).toHaveLength(2);
    expect(pedacos[0][pedacos[0].length - 1].x).toBeLessThan(42);
    expect(pedacos[1][0].x).toBeGreaterThan(58);
    expect(cortar(t, [P(50, 80)], 10)).toHaveLength(1);
  });

  it("substituir é desfeito devolvendo o traço original", () => {
    const a = novoTraco("caneta", "auto", 3, linha(40));
    const pedaco = novoTraco("caneta", "auto", 3, linha(10));
    const op = { tipo: "substituir" as const, ids: [a.id], novos: [pedaco], em: "t" };
    const feito = aplicar([a], op);
    expect(ativos(feito).map((t) => t.id)).toEqual([pedaco.id]);
    expect(ativos(aplicar(aplicar([a], op), { tipo: "apagar", ids: [pedaco.id], em: "u" }))).toHaveLength(0);
    const h = registrar(historicoVazio(), op);
    const r = desfazer(h, feito)!;
    expect(r.tracos.map((t) => t.id)).toEqual([a.id]);
    expect(ativos(r.tracos)).toHaveLength(1);
  });

  it("reconhece linha, círculo, retângulo e triângulo desenhados com tremor", () => {
    expect(reconhecerForma(caminhoPoligono([P(10, 10), P(200, 40)], false))?.forma).toBe("linha");
    const circ = Array.from({ length: 60 }, (_, i) => P(100 + 50 * Math.cos((i / 58) * Math.PI * 2) + tremor(i), 100 + 50 * Math.sin((i / 58) * Math.PI * 2) + tremor(i + 3)));
    expect(reconhecerForma(circ)?.forma).toBe("circulo");
    expect(reconhecerForma(caminhoPoligono([P(10, 10), P(150, 10), P(150, 90), P(10, 90)]))?.forma).toBe("retangulo");
    expect(reconhecerForma(caminhoPoligono([P(80, 10), P(150, 120), P(10, 120)]))?.forma).toBe("triangulo");
  });

  it("não transforma curva solta nem letra em figura", () => {
    const onda = Array.from({ length: 50 }, (_, i) => P(i * 5, 40 + Math.sin(i / 4) * 30));
    expect(reconhecerForma(onda)).toBeNull();
    expect(reconhecerForma([P(0, 0), P(1, 1), P(2, 1), P(3, 2)])).toBeNull();
  });
});

describe("seleção por laço", () => {
  const quadrado = [P(0, 0), P(100, 0), P(100, 100), P(0, 100)];
  it("ponto dentro e fora do polígono", () => {
    expect(pontoNoPoligono(50, 50, quadrado)).toBe(true);
    expect(pontoNoPoligono(150, 50, quadrado)).toBe(false);
  });
  it("seleciona só os traços envolvidos pelo laço", () => {
    const dentro = novoTraco("caneta", "auto", 2, [P(10, 10), P(40, 40), P(60, 20)]);
    const fora = novoTraco("caneta", "auto", 2, [P(200, 10), P(240, 40)]);
    expect(selecionadosPeloLaco([dentro, fora], quadrado)).toEqual([dentro.id]);
    expect(selecionadosPeloLaco([dentro], [P(0, 0), P(1, 1)])).toEqual([]);
  });
  it("mover e ampliar mudam os pontos e a espessura", () => {
    const t = novoTraco("caneta", "auto", 4, [P(10, 10), P(30, 10), P(50, 30)]);
    const m = transformarTraco(t, { x: 0, y: 0 }, 1, 5, -3);
    expect(m.id).not.toBe(t.id);
    expect(m.pontos[0]).toMatchObject({ x: 15, y: 7 });
    const g = transformarTraco(t, { x: 10, y: 10 }, 2, 0, 0);
    expect(g.pontos[g.pontos.length - 1]).toMatchObject({ x: 90, y: 50 });
    expect(g.espessura).toBe(8);
    expect(caixaDoConjunto([t, g])!.x1).toBeGreaterThan(80);
    expect(caixaDoConjunto([])).toBeNull();
  });
});
