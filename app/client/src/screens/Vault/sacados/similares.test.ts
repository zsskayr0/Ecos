import { describe, expect, it } from "vitest";
import { agruparSimilares, chaveCompacta, parecidos } from "./similares";

const c = (id: string, nome: string, transacoes = 1) => ({ id, nome, transacoes });

describe("similaridade de sacados", () => {
  it("ignora espaços, acento, caixa, pontuação e sufixo societário", () => {
    expect(chaveCompacta("  Mercado   Extra Ltda. ")).toBe("mercadoextra");
    expect(chaveCompacta("AÇAÍ do João")).toBe("acaidojoao");
    expect(parecidos("Mercado Extra", "mercado  extra LTDA")).toBe("espacos");
    expect(parecidos("Maria Silva", "Silva Maria")).toBe("espacos");
    expect(parecidos("Mercado Extra", "Mercado-Extra")).toBe("espacos");
  });

  it("pega erro de digitação, mas não nomes diferentes", () => {
    expect(parecidos("Mercado Extra", "Mercdo Extra")).toBe("digitacao");
    expect(parecidos("Padaria Pão Quente", "Padaria Pao Quemte")).toBe("digitacao");
    expect(parecidos("Mercado Extra", "Mercado Atacadão")).toBeNull();
    expect(parecidos("Ana", "Ani")).toBeNull(); // nomes curtos só casam se forem iguais
    expect(parecidos("João Silva", "João Souza")).toBeNull();
  });

  it("agrupa por transitividade, sugere o mais usado e ignora quem está sozinho", () => {
    const grupos = agruparSimilares([c("1", "Mercado Extra", 9), c("2", "Mercdo Extra", 1), c("3", "mercado extra ltda", 2), c("4", "Padaria"), c("5", "Uber", 4)]);
    expect(grupos).toHaveLength(1);
    expect(grupos[0]!.principal.id).toBe("1");
    expect(grupos[0]!.membros.map((m) => m.id)).toEqual(["1", "3", "2"]);
    expect(grupos[0]!.motivo).toBe("digitacao");
    expect(grupos[0]!.chave).toBe("1|2|3");
  });
});
