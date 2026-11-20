import { describe, expect, it } from "vitest";
import type { FechamentoApi, FechamentoCategoriaApi, FechamentoContaApi, FechamentoPendenciaApi } from "@/lib/api";
import { agruparCategorias, categoriasSugeridasParaTransferencia, situacaoDoFechamento } from "./analise";

const cat = (extra: Partial<FechamentoCategoriaApi>): FechamentoCategoriaApi => ({ tipo: "saida", categoria_id: "c1", nome: "Mercado", pai_id: null, valor: 1000, lancamentos: 1, ...extra });
const nomes = [{ id: "mae", nome: "Alimentação" }, { id: "c1", nome: "Mercado" }];

describe("agruparCategorias", () => {
  it("separa por tipo, ordena do maior para o menor e põe 'Sem categoria' como grupo", () => {
    const g = agruparCategorias([
      cat({ categoria_id: "a", nome: "Aluguel", valor: 5000 }),
      cat({ categoria_id: null, nome: null, valor: 9000, lancamentos: 3 }),
      cat({ tipo: "entrada", categoria_id: "m", nome: "Mensalidades", valor: 70000 }),
    ], "saida", nomes);
    expect(g.map((x) => [x.nome, x.valor])).toEqual([["Sem categoria", 9000], ["Aluguel", 5000]]);
    expect(g[0].lancamentos).toBe(3);
  });

  it("soma as subcategorias na mãe e mostra o lançado direto na mãe como 'Sem subcategoria'", () => {
    const g = agruparCategorias([
      cat({ categoria_id: "c1", nome: "Mercado", pai_id: "mae", valor: 3000, lancamentos: 2 }),
      cat({ categoria_id: "c2", nome: "Feira", pai_id: "mae", valor: 1000 }),
      cat({ categoria_id: "mae", nome: "Alimentação", pai_id: null, valor: 500 }),
    ], "saida", nomes);
    expect(g).toHaveLength(1);
    expect([g[0].nome, g[0].valor, g[0].lancamentos]).toEqual(["Alimentação", 4500, 4]);
    expect(g[0].filhas.map((f) => [f.nome, f.valor])).toEqual([["Mercado", 3000], ["Feira", 1000], ["Sem subcategoria", 500]]);
  });

  it("mãe sem lançamento próprio ganha o nome pela lista de categorias", () => {
    const g = agruparCategorias([cat({ categoria_id: "c1", pai_id: "mae", valor: 800 })], "saida", nomes);
    expect([g[0].id, g[0].nome, g[0].valor]).toEqual(["mae", "Alimentação", 800]);
  });

  it("mãe só com lançamento direto não mostra filhas", () => {
    const g = agruparCategorias([cat({ categoria_id: "mae", nome: "Alimentação", valor: 500 })], "saida", nomes);
    expect(g[0].filhas).toEqual([]);
  });
});

const vazia: FechamentoPendenciaApi = { quantidade: 0, valor_centavos: 0, itens: [] };
const conta = (extra: Partial<FechamentoContaApi>): FechamentoContaApi => ({
  conta_id: "a", nome: "Banco A", banco: null, tipo: "corrente", cor: "#fff", codigo_banco: null, sigla: null,
  saldo_inicial: 0, entradas: 1000, saidas: 0, transferencias: 0, saldo_final: 1000, lancamentos: 1, saldo_banco: null, diferenca: null, conferido_por: null, conferido_em: null,
  saldo_inicial_cadastrado: 0, abertura: null, abertura_neste_periodo: false, saldo_banco_anterior: null, mes_anterior: null, ...extra,
});
const lucrosConfigurados = (semRecibo: number) => ({ configurada: true, categoria_id: "cl", categoria_nome: "Distribuição de lucros", quantidade: 2, valor_centavos: 150_000, sem_recibo: semRecibo, pendentes: 0, itens: [] });
const fechamento = (extra: Partial<FechamentoApi> = {}, pend: Partial<FechamentoApi["pendencias"]> = {}): FechamentoApi => ({
  data_de: "2026-10-01", data_ate: "2026-10-31", mes: "2026-10", em_andamento: false, contas: [conta({ saldo_banco: 1000, diferenca: 0 })], todas_as_contas: [{ id: "a", nome: "Banco A", banco: null, cor: "#fff", codigo_banco: null, sigla: null, fora: false }],
  totais: { saldo_inicial: 0, entradas: 1000, saidas: 0, transferencias: 0, resultado: 1000, saldo_final: 1000 }, categorias: [],
  transferencias: { configurada: false, categorias: [], quantidade: 0, entradas: 0, saidas: 0, liquido: 0, equilibrada: true },
  lucros: { configurada: false, categoria_id: null, categoria_nome: null, quantidade: 0, valor_centavos: 0, sem_recibo: 0, pendentes: 0, itens: [] },
  pendencias: { pendentes: vazia, sem_categoria: vazia, sem_conta: vazia, sem_comprovante: vazia, nao_conciliadas: vazia, rascunhos: 0, ...pend }, ...extra,
});
const com = (n: number): FechamentoPendenciaApi => ({ quantidade: n, valor_centavos: n * 100, itens: [] });

describe("situacaoDoFechamento", () => {
  it("pronto quando nada bloqueia e todas as contas batem", () => {
    expect(situacaoDoFechamento(fechamento())).toMatchObject({ pronto: true, bloqueios: 0, aConferir: 0, divergentes: 0 });
  });

  it("pendente, sem categoria e sem conta bloqueiam; sem comprovante, não conciliado e rascunho só pedem atenção", () => {
    const bloqueia = situacaoDoFechamento(fechamento({}, { pendentes: com(1), sem_categoria: com(2), sem_conta: com(1) }));
    expect([bloqueia.bloqueios, bloqueia.pronto]).toEqual([3, false]);
    const atencao = situacaoDoFechamento(fechamento({}, { sem_comprovante: com(4), nao_conciliadas: com(1), rascunhos: 2 }));
    expect([atencao.atencao, atencao.pronto]).toEqual([3, true]);
  });

  it("conta sem saldo do banco informado, ou com diferença, impede de fechar", () => {
    expect(situacaoDoFechamento(fechamento({ contas: [conta({})] }))).toMatchObject({ aConferir: 1, divergentes: 0, pronto: false });
    expect(situacaoDoFechamento(fechamento({ contas: [conta({ saldo_banco: 900, diferenca: -100 })] }))).toMatchObject({ aConferir: 0, divergentes: 1, pronto: false });
  });

  it("distribuição de lucros sem recibo impede de fechar; com todos os recibos, não; sem categoria escolhida não conta", () => {
    expect(situacaoDoFechamento(fechamento({ lucros: lucrosConfigurados(1) }))).toMatchObject({ recibosFaltando: 1, pronto: false });
    expect(situacaoDoFechamento(fechamento({ lucros: lucrosConfigurados(0) }))).toMatchObject({ recibosFaltando: 0, pronto: true });
    expect(situacaoDoFechamento(fechamento()).recibosFaltando).toBe(0);
  });

  it("conta parada e a linha 'Sem conta' não precisam de conferência; fora de um mês inteiro nada se confere", () => {
    const parada = conta({ conta_id: "b", lancamentos: 0, saldo_inicial: 0, entradas: 0, saldo_final: 0 });
    const semConta = conta({ conta_id: null, nome: "Sem conta" });
    expect(situacaoDoFechamento(fechamento({ contas: [parada, semConta] })).aConferir).toBe(0);
    expect(situacaoDoFechamento(fechamento({ mes: null, contas: [conta({})] })).aConferir).toBe(0);
  });
});

describe("transferências entre contas", () => {
  it("transferência que não se compensa pede atenção, mas não impede de fechar", () => {
    const sem = fechamento({ transferencias: { configurada: true, categorias: [{ id: "t", nome: "Transferência" }], quantidade: 1, entradas: 0, saidas: 500, liquido: -500, equilibrada: false } });
    expect(situacaoDoFechamento(sem)).toMatchObject({ transferenciasSemPar: true, atencao: 1, pronto: true });
    const com = fechamento({ transferencias: { configurada: true, categorias: [{ id: "t", nome: "Transferência" }], quantidade: 2, entradas: 500, saidas: 500, liquido: 0, equilibrada: true } });
    expect(situacaoDoFechamento(com)).toMatchObject({ transferenciasSemPar: false, atencao: 0 });
    expect(situacaoDoFechamento(fechamento()).transferenciasSemPar).toBe(false);
  });

  it("sugere só categorias-mãe, ativas, com nome de transferência (sem acento e com qualquer caixa), fora as já escolhidas e a de lucros", () => {
    const c = (id: string, nome: string, extra = {}) => ({ id, nome, pai_id: null, arquivada: false, ...extra });
    const sugeridas = categoriasSugeridasParaTransferencia([
      c("1", "Transferência recebida"), c("2", "TRANSFERENCIA enviada"), c("3", " transferências internas"), c("4", "Aluguel"),
      c("5", "Transferência filha", { pai_id: "4" }), c("6", "Transferência velha", { arquivada: true }), c("7", "Transferência já escolhida"), c("8", "Transferência de lucros"),
    ], ["7"], "8");
    expect(sugeridas.map((x) => x.id)).toEqual(["1", "2", "3"]);
  });
});
