import { describe, expect, it } from "vitest";
import type { ArestaGrafico, NoGrafico } from "@/lib/api";
import { escalaParaAnel, layoutAneis, MAX_ANEL_EXTERNO } from "./explorar-layout";

const no = (id: string, tipo: NoGrafico["tipo"] = "nota"): NoGrafico => ({ id, tipo, titulo: id.toUpperCase(), espaco: null, status: null });
const lig = (origem: string, destino: string): ArestaGrafico => ({ origem, destino, tipo: "wikilink" });

describe("layout em anéis do explorador", () => {
  const nos = [no("a"), no("b"), no("c"), no("d"), no("e"), no("t", "tag"), no("longe")];
  const arestas = [lig("a", "b"), lig("c", "a"), lig("b", "d"), lig("d", "e"), lig("a", "t"), lig("e", "longe")];

  it("põe a raiz no centro e cada item no anel da sua distância", () => {
    const l = layoutAneis(nos, arestas, "a", 2, false)!;
    const anel = Object.fromEntries(l.nos.map((n) => [n.no.id, n.anel]));
    expect(anel).toEqual({ a: 0, b: 1, c: 1, d: 2 });
    const raiz = l.nos.find((n) => n.no.id === "a")!;
    expect([raiz.x, raiz.y]).toEqual([l.centro.x, l.centro.y]);
  });

  it("tags só entram quando pedidas; profundidade corta o resto", () => {
    expect(layoutAneis(nos, arestas, "a", 1, true)!.nos.map((n) => n.no.id).sort()).toEqual(["a", "b", "c", "t"]);
    expect(layoutAneis(nos, arestas, "a", 3, false)!.nos.map((n) => n.no.id).sort()).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("as linhas nascem do anel de dentro para o de fora e só ligam quem está no desenho", () => {
    const l = layoutAneis(nos, arestas, "a", 2, false)!;
    expect(l.linhas.map((x) => `${x.de}→${x.para}`).sort()).toEqual(["a→b", "a→c", "b→d"]);
  });

  it("item inexistente não desenha nada", () => {
    expect(layoutAneis(nos, arestas, "zzz", 2, false)).toBeNull();
  });

  it("a partir do 2º anel mostra só os mais conectados e conta o que ficou de fora", () => {
    const muitos = Array.from({ length: MAX_ANEL_EXTERNO + 10 }, (_, i) => no(`f${i}`));
    const l = layoutAneis([no("a"), no("b"), ...muitos], [lig("a", "b"), ...muitos.map((f) => lig("b", f.id))], "a", 2, false)!;
    expect(l.nos.filter((n) => n.anel === 2)).toHaveLength(MAX_ANEL_EXTERNO);
    expect(l.ocultos).toBe(10);
  });

  it("a escala para o anel nunca passa de 1 nem cai abaixo do piso", () => {
    const l = layoutAneis(nos, arestas, "a", 2, false)!;
    const s = escalaParaAnel(l, 1, 1400, 800);
    expect(s).toBeGreaterThanOrEqual(0.45);
    expect(s).toBeLessThanOrEqual(1);
    expect(escalaParaAnel(l, 2, 200, 100)).toBe(0.45);
  });
});
