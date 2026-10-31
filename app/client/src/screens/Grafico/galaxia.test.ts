import { describe, expect, it } from "vitest";
import type { NoGrafico } from "@/lib/api";
import { calcularOrbitas, filtrarGalaxia, gruposLigados, importancia, pastasVisiveis, posicaoOrbital, regiao, separarColisoes } from "./galaxia";
import { idsVisiveis } from "./grafo-puro";

const nota = (id: string, caminho: string): NoGrafico => ({ id, caminho, titulo: id, tipo: "nota", espaco: "pessoal", status: null, atualizado_em: "2026-10-30T00:00:00Z", tamanho: 1000 });

describe("galáxia", () => {
  it("agrupa a pasta e a subpasta a partir do caminho do arquivo", () => {
    expect(regiao(nota("a", "Ana/Notas/Dev/Ecos/a.md"))).toEqual({ espaco: "pessoal", constelacao: "Dev", sistema: "Ecos" });
    expect(regiao(nota("b", "Ana/Notas/b.md"))).toEqual({ espaco: "pessoal", constelacao: "Notas", sistema: "Sem subpasta" });
    expect(regiao({ ...nota("c", ""), caminho: undefined, pasta: "Dev/Ecos App" })).toEqual({ espaco: "pessoal", constelacao: "Dev", sistema: "Ecos App" });
  });

  it("repete a tag como lua de cada planeta e filtra os níveis", () => {
    const nos = [nota("a", "Ana/Notas/Dev/Ecos/a.md"), nota("b", "Ana/Notas/Dev/Ecos/b.md"), nota("c", "Ana/Notas/Pessoal/c.md"), { id: "tag:ideia", titulo: "#ideia", tipo: "tag" as const, espaco: null, status: null }];
    const arestas = [{ origem: "a", destino: "tag:ideia", tipo: "tag" as const }, { origem: "b", destino: "tag:ideia", tipo: "tag" as const }, { origem: "a", destino: "c", tipo: "wikilink" as const }];
    const universo = filtrarGalaxia(nos, arestas, { nivel: "universo" });
    expect(universo.nos.filter((n) => n.tipo === "tag").map((n) => n.id)).toEqual(["tag:ideia@a", "tag:ideia@b"]);
    expect(universo.arestas).toContainEqual({ origem: "a", destino: "c", tipo: "wikilink" });
    const sistema = filtrarGalaxia(nos, arestas, { nivel: "sistema", espaco: "pessoal", constelacao: "Dev", sistema: "Ecos" });
    expect(sistema.nos.map((n) => n.id)).not.toContain("c");
    const planeta = filtrarGalaxia(nos, arestas, { nivel: "planeta", id: "a", espaco: "pessoal", constelacao: "Dev", sistema: "Ecos" });
    expect(planeta.nos.map((n) => n.id)).toContain("c");
  });

  it("não mistura pastas com o mesmo nome de equipes diferentes", () => {
    const pessoal = nota("p", "Ana/Notas/Dev/p.md");
    const equipe = { ...nota("e", "Orion/Notas/Dev/e.md"), espaco: "equipe:orion" };
    const todos = filtrarGalaxia([pessoal, equipe], [], { nivel: "universo" });
    expect(todos.nos).toHaveLength(2);
    const constelacao = filtrarGalaxia([pessoal, equipe], [], { nivel: "constelacao", espaco: "equipe:orion", constelacao: "Dev" });
    expect(constelacao.nos.map((n) => n.id)).toEqual(["e"]);
  });

  it("aproxima notas recentes, conectadas e grandes do centro", () => {
    const pequena = { ...nota("a", "Ana/Notas/a.md"), atualizado_em: "2020-01-01T00:00:00Z", tamanho: 100 };
    const grande = { ...nota("b", "Ana/Notas/b.md"), tamanho: 20000 };
    expect(importancia(grande, 8, Date.parse("2026-10-31T00:00:00Z"))).toBeGreaterThan(importancia(pequena, 0, Date.parse("2026-10-31T00:00:00Z")));
  });

  it("dá centros separados às equipes e órbitas menores aos itens mais importantes", () => {
    const antiga = { ...nota("antiga", "Ana/Notas/Dev/Ecos/a.md"), atualizado_em: "2020-01-01T00:00:00Z", tamanho: 100 };
    const recente = { ...nota("recente", "Ana/Notas/Dev/Ecos/b.md"), tamanho: 20000 };
    const outraEquipe = { ...nota("equipe", "Orion/Notas/Dev/Ecos/c.md"), espaco: "equipe:orion" };
    const graus = new Map([["antiga", 0], ["recente", 8], ["equipe", 0]]);
    const universo = calcularOrbitas([antiga, recente, outraEquipe], graus, { nivel: "universo" });
    expect(universo.galaxias).toHaveLength(2);
    expect(universo.galaxias[0].y).not.toBe(universo.galaxias[1].y);
    expect(universo.constelacoes).toHaveLength(2);
    expect(universo.constelacoes[0].y).not.toBe(universo.constelacoes[1].y);
    expect(universo.constelacoes.find((c) => c.chave.includes("pessoal"))?.titulo).toBe("Dev");
    const sistema = calcularOrbitas([antiga, recente], graus, { nivel: "sistema", espaco: "pessoal", constelacao: "Dev", sistema: "Ecos" });
    const centro = sistema.sistemas[0];
    const distancia = (id: string) => Math.hypot(sistema.posicoes.get(id)!.x - centro.x, sistema.posicoes.get(id)!.y - centro.y);
    expect(distancia("recente")).toBeLessThan(distancia("antiga"));
  });

  it("centraliza o planeta e distribui tags como luas", () => {
    const pai = nota("pai", "Ana/Notas/Dev/Ecos/pai.md");
    const vizinho = nota("vizinho", "Ana/Notas/Dev/Ecos/vizinho.md");
    const lua = { id: "tag:ideia@pai", titulo: "#ideia", tipo: "tag" as const, espaco: "pessoal", status: null };
    const layout = calcularOrbitas([pai, vizinho, lua], new Map(), { nivel: "planeta", id: "pai", espaco: "pessoal", constelacao: "Dev", sistema: "Ecos" });
    expect(layout.posicoes.get("pai")).toEqual({ x: 0, y: 0 });
    expect(Math.hypot(layout.posicoes.get(lua.id)!.x, layout.posicoes.get(lua.id)!.y)).toBeLessThan(Math.hypot(layout.posicoes.get("vizinho")!.x, layout.posicoes.get("vizinho")!.y));
  });

  it("move planetas em órbitas reais e leva o sistema junto com a pasta", () => {
    const item = nota("astro", "Ana/Notas/Dev/Ecos/astro.md");
    const layout = calcularOrbitas([item], new Map(), { nivel: "universo" });
    const pasta = layout.constelacoes[0];
    const sistema = layout.sistemas[0];
    const orbita = layout.orbitas.get(item.id)!;
    expect(pasta.pasta).toBe("Dev");
    expect(sistema.pasta).toBe("Dev/Ecos");
    const primeiro = posicaoOrbital(sistema, orbita, 0);
    const depois = posicaoOrbital(sistema, orbita, 20);
    expect(primeiro.x).toBeCloseTo(layout.posicoes.get(item.id)!.x);
    expect(primeiro.y).toBeCloseTo(layout.posicoes.get(item.id)!.y);
    expect(depois).not.toEqual(primeiro);
    const deslocado = posicaoOrbital({ x: sistema.x + 100, y: sistema.y - 40 }, orbita, 20);
    expect(deslocado.x - depois.x).toBeCloseTo(100);
    expect(deslocado.y - depois.y).toBeCloseTo(-40);
  });

  it("faz as notas ligadas orbitarem a nota mais relevante da mesma pasta", () => {
    const centro = { ...nota("centro", "Ana/Notas/Dev/Ecos/centro.md"), tamanho: 30000 };
    const satelite = { ...nota("satelite", "Ana/Notas/Dev/Ecos/satelite.md"), tamanho: 100 };
    const distante = nota("distante", "Ana/Notas/Outra/distante.md");
    const arestas = [{ origem: centro.id, destino: satelite.id, tipo: "wikilink" as const }, { origem: satelite.id, destino: distante.id, tipo: "wikilink" as const }];
    const graus = new Map([[centro.id, 4], [satelite.id, 1], [distante.id, 1]]);
    expect(gruposLigados([centro, satelite], arestas, graus)[0][0].id).toBe(centro.id);
    const layout = calcularOrbitas([centro, satelite, distante], graus, { nivel: "universo" }, arestas);
    expect(layout.orbitas.get(satelite.id)?.centro).toBe(centro.id);
    expect(layout.orbitas.get(satelite.id)?.centroNo).toBe(true);
    expect(layout.orbitas.get(distante.id)?.centro).not.toBe(centro.id);
  });

  it("impede sobreposição de planetas e respeita uma estrela fixa", () => {
    const pontos = [
      { id: "estrela", x: 0, y: 0, raio: 12, fixo: true },
      { id: "a", x: 0, y: 0, raio: 8 },
      { id: "b", x: 1, y: 0, raio: 8 },
    ];
    separarColisoes(pontos);
    expect(pontos[0]).toMatchObject({ x: 0, y: 0 });
    for (let i = 0; i < pontos.length; i++) for (let j = i + 1; j < pontos.length; j++) {
      expect(Math.hypot(pontos[i].x - pontos[j].x, pontos[i].y - pontos[j].y)).toBeGreaterThanOrEqual(pontos[i].raio + pontos[j].raio + 2.9);
    }
  });

  it("esconde a estrela da pasta quando o filtro esconde todos os seus itens", () => {
    const n = nota("n", "Ana/Notas/Dev/n.md");
    const t = { ...nota("t", "Ana/Tarefas/Rotina/t.md"), tipo: "tarefa" as const };
    const ids = idsVisiveis([n, t], [], { nota: false, tarefa: true, evento: false, tag: false }, true);
    const visiveis = pastasVisiveis([n, t], ids);
    expect(visiveis.constelacoes.has('["pessoal","Dev"]')).toBe(false);
    expect(visiveis.constelacoes.has('["pessoal","Rotina"]')).toBe(true);
  });

  it("espalha uma pasta populosa por uma área ampla, sem formar um anel estreito", () => {
    const itens = Array.from({ length: 300 }, (_, i) => nota(`item-${i}`, `Ana/Notas/Dev/item-${i}.md`));
    const layout = calcularOrbitas(itens, new Map(), { nivel: "universo" });
    const raios = itens.map((n) => layout.orbitas.get(n.id)!.raioY);
    expect(Math.min(...raios)).toBeLessThan(150);
    expect(Math.max(...raios)).toBeGreaterThan(900);
    expect(Math.max(...raios) - Math.min(...raios)).toBeGreaterThan(750);
  });
});
