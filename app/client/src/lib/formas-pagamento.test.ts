import { describe, expect, it } from "vitest";
import type { FormaPagamentoApi } from "./api";
import { nomeJaExiste, opcoesDeFiltro, opcoesDoSeletor, registroReflete, resolverFormaCsv, rotuloForma } from "./formas-pagamento";

const f = (codigo: string, nome: string, extra: Partial<FormaPagamentoApi> = {}): FormaPagamentoApi => ({ codigo, nome, icone: null, cor: null, padrao: false, ativa: true, ordem: 1, criado_por: null, usos: 0, ...extra });
const lista = [f("pix", "Pix"), f("ted", "TED", { ativa: false, usos: 4 }), f("boleto", "Boleto", { ativa: false })];

describe("formas de pagamento (funções puras)", () => {
  it("o seletor mostra só as ativas e mantém a atual mesmo inativa ou desconhecida", () => {
    expect(opcoesDoSeletor(lista, null).map((o) => o.codigo)).toEqual(["pix"]);
    expect(opcoesDoSeletor(lista, "ted")).toEqual([{ codigo: "pix", nome: "Pix", inativa: false }, { codigo: "ted", nome: "TED", inativa: true }]);
    expect(opcoesDoSeletor(lista, "sumiu").at(-1)).toEqual({ codigo: "sumiu", nome: "sumiu", inativa: true });
  });
  it("o rótulo vem do cadastro e cai para o código", () => {
    expect(rotuloForma(lista, "ted")).toBe("TED");
    expect(rotuloForma(lista, "x")).toBe("x");
    expect(rotuloForma(lista, null)).toBe("");
  });
  it("o filtro inclui inativas que ainda têm lançamentos", () => {
    expect(opcoesDeFiltro(lista).map((x) => x.codigo)).toEqual(["pix", "ted"]);
  });
  it("nome repetido compara só caixa e espaços, nunca acento, e ignora a própria forma", () => {
    expect(nomeJaExiste(lista, " pix ")).toBe(true);
    expect(nomeJaExiste(lista, "pix", "pix")).toBe(false);
    expect(nomeJaExiste([f("credito", "Crédito")], "Credito")).toBe(false);
  });
  it("resolverFormaCsv: código, nome único, ambíguo e inexistente", () => {
    const l = [f("credito", "Crédito"), f("credito_2", "Credito"), f("pix", "Pix")];
    expect(resolverFormaCsv(l, "PIX")).toEqual({ codigo: "pix" });
    expect(resolverFormaCsv(l, "credito")).toEqual({ codigo: "credito" });
    expect("erro" in resolverFormaCsv(l, "CRÉDITO")).toBe(true);
    expect(resolverFormaCsv(l, "cheque")).toEqual({ erro: 'Pagamento inválido: "cheque"' });
  });
  it("registroReflete só confirma quando todos os campos enviados batem", () => {
    const atual = f("pix", "Pix", { icone: "Zap", cor: "#111111", ativa: false });
    expect(registroReflete(atual, { nome: "Pix", icone: "Zap", cor: "#111111", ativa: false })).toBe(true);
    expect(registroReflete(atual, { nome: "Pix", icone: "Zap", cor: "#222222" })).toBe(false);
    expect(registroReflete(atual, { ativa: true })).toBe(false);
    expect(registroReflete(undefined, { nome: "Pix" })).toBe(false);
  });
});
