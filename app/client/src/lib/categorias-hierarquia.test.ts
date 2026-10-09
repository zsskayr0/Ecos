import { describe, expect, it } from "vitest";
import type { CategoriaApi } from "./api";
import { caminhoCompleto, maesPossiveis, montarHierarquia, somarPorCategoria, tipoAoMudarDeMae } from "./categorias-hierarquia";

const c = (id: string, nome: string, extra: Partial<CategoriaApi> = {}): CategoriaApi => ({ id, nome, tipo: "saida", icone: null, cor: "#fff", padrao: false, espaco: "pessoal", ...extra });
const lista = [c("f", "Funcionários"), c("s", "Salários", { pai_id: "f" }), c("b", "Benefícios", { pai_id: "f" }), c("m", "Moradia"), c("r", "Renda", { tipo: "entrada" })];

describe("hierarquia de categorias", () => {
  it("separa principais de subcategorias e monta o caminho a partir da mãe", () => {
    const h = montarHierarquia(lista);
    expect(h.raizes.map((x) => x.id)).toEqual(["f", "m", "r"]);
    expect(h.filhas.get("f")?.map((x) => x.id)).toEqual(["s", "b"]);
    expect(caminhoCompleto(h.porId.get("s"), h.porId)).toBe("Funcionários › Salários");
    expect(caminhoCompleto(h.porId.get("m"), h.porId)).toBe("Moradia");
    expect(caminhoCompleto(undefined, h.porId)).toBe("Sem categoria");
  });
  it("filha órfã (mãe fora da lista) aparece como principal", () => {
    expect(montarHierarquia([c("s", "Salários", { pai_id: "sumiu" })]).raizes.map((x) => x.id)).toEqual(["s"]);
  });
  it("oferece qualquer mãe de nível principal (o tipo se ajusta), e nunca para quem já tem filhas", () => {
    expect(maesPossiveis(lista, { tipo: "saida" }).map((x) => x.id)).toEqual(["f", "m", "r"]);
    expect(maesPossiveis(lista, { id: "s", tipo: "saida" }).map((x) => x.id)).toEqual(["f", "m", "r"]);
    expect(tipoAoMudarDeMae("ambos", lista[0]!)).toBe("saida");
    expect(tipoAoMudarDeMae("saida", { tipo: "ambos" })).toBe("saida");
    expect(maesPossiveis(lista, { id: "f", tipo: "saida" })).toEqual([]);
  });
  it("soma separada ou agrupada na mãe", () => {
    const h = montarHierarquia(lista);
    const g = [{ chave: "s", valor: 100 }, { chave: "b", valor: 50 }, { chave: "m", valor: 120 }, { chave: null, valor: 10 }];
    expect(somarPorCategoria(g, h.porId, false)).toHaveLength(4);
    expect(somarPorCategoria(g, h.porId, true)).toEqual([{ chave: "f", valor: 150 }, { chave: "m", valor: 120 }, { chave: null, valor: 10 }]);
  });
});
