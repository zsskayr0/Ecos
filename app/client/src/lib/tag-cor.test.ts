import { describe, expect, it } from "vitest";
import type { TagCatalogo } from "./api";
import { corAutomaticaDaTag, corDaTag, corFoiEscolhida, registrarCoresDasTags } from "./tag-cor";

const tag = (nome: string, espacos: { espaco: string; cor?: string | null }[]): TagCatalogo => ({ tag: nome, notas: 1, tarefas: 0, total: 1, espacos: espacos.map((e) => ({ notas: 1, tarefas: 0, ...e })) });

describe("cor das tags", () => {
  it("sem escolha, deriva do nome e é estável", () => {
    expect(corAutomaticaDaTag("casa")).toBe(corAutomaticaDaTag("casa"));
    expect(corDaTag("sem-cor-nenhuma", "pessoal")).toBe(corAutomaticaDaTag("sem-cor-nenhuma"));
  });

  it("a escolha vale por espaço: mesmo nome em outro espaço não herda", () => {
    registrarCoresDasTags([tag("casa", [{ espaco: "equipe:EQ", cor: "#E11D48" }, { espaco: "pessoal", cor: null }])]);
    expect(corDaTag("casa", "equipe:EQ")).toBe("#E11D48");
    expect(corDaTag("casa", "pessoal")).toBe(corAutomaticaDaTag("casa"));
    expect(corDaTag("casa")).toBe("#E11D48");
    expect(corFoiEscolhida("casa", "equipe:EQ")).toBe(true);
    expect(corFoiEscolhida("casa", "pessoal")).toBe(false);
  });

  it("um catálogo filtrado por espaço só troca as cores daquele espaço", () => {
    registrarCoresDasTags([tag("a", [{ espaco: "pessoal", cor: "#16A34A" }]), tag("b", [{ espaco: "equipe:EQ", cor: "#0891B2" }])]);
    registrarCoresDasTags([tag("a", [{ espaco: "pessoal", cor: null }])], "pessoal");
    expect(corFoiEscolhida("a", "pessoal")).toBe(false);
    expect(corDaTag("b", "equipe:EQ")).toBe("#0891B2");
  });

  it("a paleta automática não usa violeta (reservado ao Cofre)", () => {
    const cores = new Set(Array.from({ length: 400 }, (_, i) => corAutomaticaDaTag(`tag${i}`)));
    for (const cor of cores) {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(cor.slice(i, i + 2), 16));
      expect(b > r && b > g && r > g, cor).toBe(false);
    }
  });
});
