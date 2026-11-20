import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", async (importOriginal) => {
  const o = await importOriginal<typeof import("@/lib/api")>();
  return { ...o, vault: { ...o.vault, fechamento: { obter: vi.fn(), conferir: vi.fn(), definirLucros: vi.fn(), configuracao: vi.fn(), definirTransferencias: vi.fn(), pacote: vi.fn(), resumoPdf: vi.fn(), definirAbertura: vi.fn(), definirContas: vi.fn(), lancamentos: vi.fn() }, categorias: { ...o.vault.categorias, criar: vi.fn() }, anexos: { ...o.vault.anexos, enviar: vi.fn() } } };
});
vi.mock("@/lib/baixar-arquivo", () => ({ baixarArquivo: vi.fn() }));
import { baixarArquivo } from "@/lib/baixar-arquivo";
import { ApiError, vault, type CategoriaApi, type FechamentoApi, type FechamentoContaApi, type FechamentoLancamentoApi, type FechamentoLucrosApi, type FechamentoPendenciaApi } from "@/lib/api";
import { VaultFechamento } from "./VaultFechamento";

const obter = vi.mocked(vault.fechamento.obter);
const conferir = vi.mocked(vault.fechamento.conferir);
const definirLucros = vi.mocked(vault.fechamento.definirLucros);
const definirTransferencias = vi.mocked(vault.fechamento.definirTransferencias);
const pacote = vi.mocked(vault.fechamento.pacote);
const resumoPdf = vi.mocked(vault.fechamento.resumoPdf);
const definirAbertura = vi.mocked(vault.fechamento.definirAbertura);
const definirContas = vi.mocked(vault.fechamento.definirContas);
const lancamentos = vi.mocked(vault.fechamento.lancamentos);
const criarCategoria = vi.mocked(vault.categorias.criar);
const enviarAnexo = vi.mocked(vault.anexos.enviar);
const outubro = { kind: "month", year: 2026, month: 10 } as const;

const vazia: FechamentoPendenciaApi = { quantidade: 0, valor_centavos: 0, itens: [] };
const conta = (extra: Partial<FechamentoContaApi> = {}): FechamentoContaApi => ({
  conta_id: "a", nome: "Banco do Lar", banco: null, tipo: "corrente", cor: "#3366aa", codigo_banco: null, sigla: null,
  saldo_inicial: 100_000, entradas: 50_000, saidas: 10_000, transferencias: 0, saldo_final: 140_000, lancamentos: 3, saldo_banco: null, diferenca: null, conferido_por: null, conferido_em: null,
  saldo_inicial_cadastrado: 100_000, abertura: null, abertura_neste_periodo: false, saldo_banco_anterior: null, mes_anterior: null, ...extra,
});
const SEM_LUCROS = { configurada: false, categoria_id: null, categoria_nome: null, quantidade: 0, valor_centavos: 0, sem_recibo: 0, pendentes: 0, itens: [] } as const;
const SEM_TRANSFERENCIAS: FechamentoApi["transferencias"] = { configurada: false, categorias: [], quantidade: 0, entradas: 0, saidas: 0, liquido: 0, equilibrada: true };
const dados = (extra: Partial<FechamentoApi> = {}): FechamentoApi => ({
  data_de: "2026-10-01", data_ate: "2026-10-31", mes: "2026-10", em_andamento: false, contas: [conta()], todas_as_contas: [{ id: "a", nome: "Banco A", banco: null, cor: "#fff", codigo_banco: null, sigla: null, fora: false }],
  totais: { saldo_inicial: 100_000, entradas: 50_000, saidas: 10_000, transferencias: 0, resultado: 40_000, saldo_final: 140_000 },
  transferencias: SEM_TRANSFERENCIAS,
  categorias: [{ tipo: "entrada", categoria_id: "m", nome: "Mensalidades", pai_id: null, valor: 50_000, lancamentos: 2 }, { tipo: "saida", categoria_id: null, nome: null, pai_id: null, valor: 10_000, lancamentos: 1 }],
  lucros: { ...SEM_LUCROS, itens: [] },
  pendencias: { pendentes: vazia, sem_categoria: vazia, sem_conta: vazia, sem_comprovante: vazia, nao_conciliadas: vazia, rascunhos: 0 }, ...extra,
});

const categoria = (id: string, nome: string, extra: Partial<CategoriaApi> = {}) => ({ id, nome, tipo: "ambos", cor: "#888888", ...extra }) as CategoriaApi;

function tela(abrir = vi.fn(), irParaComprovantes = vi.fn(), periodo: Parameters<typeof VaultFechamento>[0]["period"] = outubro, categorias: CategoriaApi[] = []) {
  render(<VaultFechamento period={periodo} onPeriodChange={() => {}} categorias={categorias} recarregar={0} atualizar={() => {}} abrir={abrir} irParaComprovantes={irParaComprovantes} />);
}

const lucrosCom = (extra: Partial<FechamentoLucrosApi> = {}): FechamentoLucrosApi => ({
  configurada: true, categoria_id: "cl", categoria_nome: "Distribuição de lucros", quantidade: 2, valor_centavos: 150_000, sem_recibo: 1, pendentes: 0,
  itens: [
    { id: "t1", descricao: "Lucros outubro Ana", data: "2026-10-05", valor_centavos: 100_000, status: "efetivada", recibos: 1, outros_anexos: 0 },
    { id: "t2", descricao: "Lucros outubro Bruno", data: "2026-10-10", valor_centavos: 50_000, status: "efetivada", recibos: 0, outros_anexos: 1 },
  ],
  ...extra,
});

beforeEach(() => { vi.clearAllMocks(); definirAbertura.mockResolvedValue({ ok: true }); conferir.mockResolvedValue({ ok: true }); definirLucros.mockResolvedValue({ ok: true }); definirTransferencias.mockResolvedValue({ ok: true }); definirContas.mockResolvedValue({ ok: true }); lancamentos.mockResolvedValue({ lancamentos: [], limite: 50_000, cortado: false }); });

describe("VaultFechamento", () => {
  it("pede o fechamento do período escolhido e mostra o extrato da conta", async () => {
    obter.mockResolvedValue(dados());
    tela();
    expect(await screen.findByText("Banco do Lar")).toBeTruthy();
    expect(obter).toHaveBeenCalledWith({ data_de: "2026-10-01", data_ate: "2026-10-31" });
    const linha = screen.getByText("Banco do Lar").closest("tr")!;
    for (const v of ["R$ 1.000,00", "R$ 500,00", "R$ 100,00", "R$ 1.400,00"]) expect(within(linha).getByText(v)).toBeTruthy();
  });

  it("sem saldo do banco informado, a faixa diz que falta conferir; sem pendências aparece o 'nada pendente'", async () => {
    obter.mockResolvedValue(dados());
    tela();
    expect(await screen.findByText(/ainda não está pronto/)).toBeTruthy();
    expect(screen.getByText(/1 conta a conferir com o banco/)).toBeTruthy();
    expect(screen.getByText("Nada pendente neste período.")).toBeTruthy();
  });

  it("conta que bate com o banco deixa o mês pronto para a contabilidade", async () => {
    obter.mockResolvedValue(dados({ contas: [conta({ saldo_banco: 140_000, diferenca: 0, conferido_em: "2026-11-05T10:00:00Z" })] }));
    tela();
    expect(await screen.findByText(/está pronto para a contabilidade/)).toBeTruthy();
    expect(screen.getByText("Bate")).toBeTruthy();
  });

  it("digitar o saldo do banco e sair do campo grava a conferência e recarrega", async () => {
    obter.mockResolvedValueOnce(dados()).mockResolvedValue(dados({ contas: [conta({ saldo_banco: 139_000, diferenca: -1_000 })] }));
    tela();
    const campo = await screen.findByLabelText("Saldo no banco de Banco do Lar no fim do mês");
    fireEvent.change(campo, { target: { value: "1.390,00" } });
    fireEvent.blur(campo);
    await waitFor(() => expect(conferir).toHaveBeenCalledWith({ mes: "2026-10", conta_id: "a", saldo_banco_centavos: 139_000 }));
    expect(await screen.findByText(/não está pronto|ainda não está pronto/)).toBeTruthy();
    expect(screen.getByText("-R$ 10,00")).toBeTruthy();
  });

  it("campo vazio apaga a conferência e valor inválido não grava", async () => {
    obter.mockResolvedValue(dados({ contas: [conta({ saldo_banco: 140_000, diferenca: 0 })] }));
    tela();
    const campo = await screen.findByLabelText("Saldo no banco de Banco do Lar no fim do mês");
    fireEvent.change(campo, { target: { value: "abc" } });
    fireEvent.blur(campo);
    expect(await screen.findByText("Valor inválido")).toBeTruthy();
    expect(conferir).not.toHaveBeenCalled();
    fireEvent.change(campo, { target: { value: "" } });
    fireEvent.blur(campo);
    await waitFor(() => expect(conferir).toHaveBeenCalledWith({ mes: "2026-10", conta_id: "a", saldo_banco_centavos: null }));
  });

  it("fora de um mês inteiro não há campo de conferência e a faixa explica", async () => {
    obter.mockResolvedValue(dados({ mes: null, data_de: "2026-01-01", data_ate: "2026-12-31" }));
    tela(vi.fn(), vi.fn(), { kind: "year", year: 2026 });
    expect(await screen.findByText(/escolha um mês inteiro/)).toBeTruthy();
    expect(screen.queryByLabelText(/Saldo no banco de/)).toBeNull();
  });

  it("pendências listam os lançamentos, abrem o lançamento e levam aos comprovantes", async () => {
    const abrir = vi.fn();
    const irParaComprovantes = vi.fn();
    obter.mockResolvedValue(dados({
      pendencias: {
        pendentes: vazia, sem_conta: vazia, sem_comprovante: vazia, nao_conciliadas: vazia, rascunhos: 2,
        sem_categoria: { quantidade: 30, valor_centavos: 123_00, itens: [{ id: "t1", descricao: "Padaria", tipo: "saida", valor_centavos: 4_500, data: "2026-10-03" }] },
      },
    }));
    tela(abrir, irParaComprovantes);
    expect(await screen.findByRole("heading", { name: "Sem categoria" })).toBeTruthy();
    expect(screen.getByText(/Mostrando os 1 mais antigos de 30/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Abrir lançamento Padaria/ }));
    expect(abrir).toHaveBeenCalledWith("t1");
    fireEvent.click(screen.getByRole("button", { name: /Revisar em Comprovantes/ }));
    expect(irParaComprovantes).toHaveBeenCalled();
    expect(screen.getByText(/1 tipo de pendência a resolver/)).toBeTruthy();
  });

  it("mostra o erro e tenta de novo", async () => {
    obter.mockRejectedValueOnce(new Error("falhou")).mockResolvedValue(dados());
    tela();
    expect(await screen.findByText("falhou")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Tentar novamente/ }));
    expect(await screen.findByText("Banco do Lar")).toBeTruthy();
  });

  it("sem categoria de lucros escolhida, oferece criar a padrão e a escolhe", async () => {
    obter.mockResolvedValue(dados());
    criarCategoria.mockResolvedValue({ id: "nova" });
    tela();
    fireEvent.click(await screen.findByRole("button", { name: /Usar a categoria “Distribuição de lucros”/ }));
    await waitFor(() => expect(definirLucros).toHaveBeenCalledWith("nova"));
    expect(criarCategoria).toHaveBeenCalledWith({ nome: "Distribuição de lucros", tipo: "saida", cor: "#9b6bd6" });
  });

  it("lista as distribuições, mostra o recibo faltando e impede de fechar", async () => {
    obter.mockResolvedValue(dados({ lucros: lucrosCom(), contas: [conta({ saldo_banco: 140_000, diferenca: 0 })] }));
    tela();
    expect(await screen.findByText("Lucros outubro Bruno")).toBeTruthy();
    expect(screen.queryByText(/sócio/i)).toBeNull();
    expect(screen.getByText("1 recibo faltando")).toBeTruthy();
    expect(screen.getByText("tem comprovante, falta o recibo")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Ver 1 recibo de Lucros outubro Ana/ })).toBeTruthy();
    expect(screen.getByText(/1 recibo de lucros a anexar/)).toBeTruthy();
    expect(screen.getByText(/ainda não está pronto/)).toBeTruthy();
  });

  it("anexar o recibo envia o arquivo como recibo de lucros e recarrega", async () => {
    obter.mockResolvedValueOnce(dados({ lucros: lucrosCom() })).mockResolvedValue(dados({ lucros: lucrosCom({ sem_recibo: 0 }) }));
    enviarAnexo.mockResolvedValue({ id: "a1", nome_arquivo: "r.pdf", tamanho_bytes: 3, duplicado_em: null });
    tela();
    fireEvent.click(await screen.findByRole("button", { name: /Anexar recibo de Lucros outubro Bruno/ }));
    const arquivo = new File(["pdf"], "recibo.pdf", { type: "application/pdf" });
    fireEvent.change(screen.getByLabelText("Escolher o recibo de lucros"), { target: { files: [arquivo] } });
    await waitFor(() => expect(enviarAnexo).toHaveBeenCalledWith("t2", arquivo, "recibo_lucros"));
    expect(await screen.findByText("Todos com recibo")).toBeTruthy();
  });

  it("mostra o erro do servidor ao anexar e não recarrega", async () => {
    obter.mockResolvedValue(dados({ lucros: lucrosCom() }));
    enviarAnexo.mockRejectedValue(new Error("Arquivo inválido"));
    tela();
    fireEvent.click(await screen.findByRole("button", { name: /Anexar recibo de Lucros outubro Bruno/ }));
    fireEvent.change(screen.getByLabelText("Escolher o recibo de lucros"), { target: { files: [new File(["x"], "r.pdf", { type: "application/pdf" })] } });
    await waitFor(() => expect(enviarAnexo).toHaveBeenCalled());
    expect(obter).toHaveBeenCalledTimes(1);
  });
  it("sem categoria de transferência, sugere as que têm esse nome num clique e não sugere a arquivada", async () => {
    obter.mockResolvedValue(dados());
    tela(vi.fn(), vi.fn(), outubro, [categoria("t1", "Transferência recebida"), categoria("t2", "Transferencia enviada"), categoria("x", "Aluguel"), categoria("t3", "Transferência antiga", { arquivada: true })]);
    fireEvent.click(await screen.findByRole("button", { name: /Usar “Transferência recebida” e “Transferencia enviada”/ }));
    await waitFor(() => expect(definirTransferencias).toHaveBeenCalledWith(["t1", "t2"]));
  });

  it("com transferências marcadas, a coluna aparece no extrato e o bloco mostra que se compensam", async () => {
    obter.mockResolvedValue(dados({
      contas: [conta({ transferencias: -20_000, saldo_final: 120_000 }), conta({ conta_id: "b", nome: "Banco B", saldo_inicial: 0, entradas: 0, saidas: 0, transferencias: 20_000, saldo_final: 20_000 })],
      totais: { saldo_inicial: 100_000, entradas: 50_000, saidas: 10_000, transferencias: 0, resultado: 40_000, saldo_final: 140_000 },
      transferencias: { configurada: true, categorias: [{ id: "t1", nome: "Transferência entre contas" }], quantidade: 2, entradas: 20_000, saidas: 20_000, liquido: 0, equilibrada: true },
    }));
    tela(vi.fn(), vi.fn(), outubro, [categoria("t1", "Transferência entre contas")]);
    expect(await screen.findByRole("columnheader", { name: "Transferências" })).toBeTruthy();
    expect(within(screen.getByText("Banco B").closest("tr")!).getAllByText("R$ 200,00").length).toBe(2);
    expect(screen.getByText("Se compensam")).toBeTruthy();
  });

  it("transferência sem o outro lado avisa quanto falta e pede atenção", async () => {
    obter.mockResolvedValue(dados({
      contas: [conta({ saldo_banco: 140_000, diferenca: 0 })],
      transferencias: { configurada: true, categorias: [{ id: "t1", nome: "Transferência" }], quantidade: 1, entradas: 0, saidas: 7_000, liquido: -7_000, equilibrada: false },
    }));
    tela();
    expect(await screen.findByText(/Faltam R\$ 70,00 entrando em alguma conta/)).toBeTruthy();
    expect(screen.getByText(/Ainda há itens de atenção abaixo/)).toBeTruthy();
  });

  it("remover uma categoria de transferência grava a lista sem ela", async () => {
    obter.mockResolvedValue(dados({ transferencias: { configurada: true, categorias: [{ id: "t1", nome: "Transferência" }, { id: "t2", nome: "Aplicação" }], quantidade: 0, entradas: 0, saidas: 0, liquido: 0, equilibrada: true } }));
    tela();
    fireEvent.click(await screen.findByRole("button", { name: /Deixar de tratar “Transferência” como transferência/ }));
    await waitFor(() => expect(definirTransferencias).toHaveBeenCalledWith(["t2"]));
  });

  it("mostra o erro do servidor ao marcar a categoria", async () => {
    obter.mockResolvedValue(dados());
    definirTransferencias.mockRejectedValue(new ApiError("VALIDATION_ERROR", "A categoria de lucros não pode ser transferência.", 422));
    tela(vi.fn(), vi.fn(), outubro, [categoria("t1", "Transferência")]);
    fireEvent.click(await screen.findByRole("button", { name: /Usar “Transferência”/ }));
    expect(await screen.findByText("A categoria de lucros não pode ser transferência.")).toBeTruthy();
  });

  it("o botão do pacote baixa o .zip do período com o nome do mês", async () => {
    obter.mockResolvedValue(dados());
    const zip = new Blob(["zip"], { type: "application/zip" });
    pacote.mockResolvedValue(zip);
    tela();
    fireEvent.click(await screen.findByRole("button", { name: /Pacote para a contabilidade/ }));
    await waitFor(() => expect(baixarArquivo).toHaveBeenCalledWith(zip, "fechamento-2026-10.zip"));
    expect(pacote).toHaveBeenCalledWith({ data_de: "2026-10-01", data_ate: "2026-10-31" });
  });

  it("falha ao gerar o pacote aparece como erro e não baixa nada", async () => {
    obter.mockResolvedValue(dados());
    pacote.mockRejectedValue(new ApiError("VALIDATION_ERROR", "Os arquivos do período somam mais de 256 MB.", 422));
    tela();
    fireEvent.click(await screen.findByRole("button", { name: /Pacote para a contabilidade/ }));
    expect(await screen.findByText(/somam mais de 256 MB/)).toBeTruthy();
    expect(baixarArquivo).not.toHaveBeenCalled();
  });

  it("o botão do resumo em PDF baixa só o PDF do período", async () => {
    obter.mockResolvedValue(dados());
    const pdf = new Blob(["pdf"], { type: "application/pdf" });
    resumoPdf.mockResolvedValue(pdf);
    tela();
    fireEvent.click(await screen.findByRole("button", { name: /Resumo em PDF/ }));
    await waitFor(() => expect(baixarArquivo).toHaveBeenCalledWith(pdf, "resumo-fechamento-2026-10.pdf"));
    expect(resumoPdf).toHaveBeenCalledWith({ data_de: "2026-10-01", data_ate: "2026-10-31" });
    expect(pacote).not.toHaveBeenCalled();
  });

  it("falha ao gerar o PDF aparece como erro e não baixa nada", async () => {
    obter.mockResolvedValue(dados());
    resumoPdf.mockRejectedValue(new ApiError("INTERNAL", "Não deu para desenhar o PDF.", 500));
    tela();
    fireEvent.click(await screen.findByRole("button", { name: /Resumo em PDF/ }));
    expect(await screen.findByText("Não deu para desenhar o PDF.")).toBeTruthy();
    expect(baixarArquivo).not.toHaveBeenCalled();
  });

  describe("saldo inicial ajustável", () => {
    it("mostra de onde vem o saldo e grava a abertura no primeiro dia do período", async () => {
      obter.mockResolvedValue(dados());
      tela();
      expect(await screen.findByText("Do cadastro da conta")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Ajustar o saldo inicial de Banco do Lar" }));
      const campo = screen.getByLabelText("Saldo de Banco do Lar no começo de 01/10/2026") as HTMLInputElement;
      expect(campo.value).toBe("1000,00");
      fireEvent.change(campo, { target: { value: "900,00" } });
      fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
      await waitFor(() => expect(definirAbertura).toHaveBeenCalledWith({ conta_id: "a", data: "2026-10-01", saldo_centavos: 90_000 }));
    });

    it("valor inválido não grava", async () => {
      obter.mockResolvedValue(dados());
      tela();
      fireEvent.click(await screen.findByRole("button", { name: "Ajustar o saldo inicial de Banco do Lar" }));
      fireEvent.change(screen.getByLabelText(/Saldo de Banco do Lar no começo/), { target: { value: "abc" } });
      fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
      expect(await screen.findByText("Valor inválido")).toBeTruthy();
      expect(definirAbertura).not.toHaveBeenCalled();
    });

    it("Cancelar fecha o campo sem gravar", async () => {
      obter.mockResolvedValue(dados());
      tela();
      fireEvent.click(await screen.findByRole("button", { name: "Ajustar o saldo inicial de Banco do Lar" }));
      fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
      expect(screen.queryByLabelText(/Saldo de Banco do Lar no começo/)).toBeNull();
      expect(definirAbertura).not.toHaveBeenCalled();
    });

    it("abertura deste período aparece como informada e dá para voltar ao cadastro", async () => {
      obter.mockResolvedValue(dados({ contas: [conta({ abertura: { data: "2026-10-01", saldo: 90_000, por: "ana" }, abertura_neste_periodo: true, saldo_inicial: 90_000 })] }));
      tela();
      expect(await screen.findByText("Informado para 01/10/2026")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Ajustar o saldo inicial de Banco do Lar" }));
      fireEvent.click(screen.getByRole("button", { name: "Voltar ao cadastro" }));
      await waitFor(() => expect(definirAbertura).toHaveBeenCalledWith({ conta_id: "a", data: "2026-10-01", saldo_centavos: null }));
    });

    it("abertura de um período anterior aparece como 'a partir de' e não oferece voltar ao cadastro", async () => {
      obter.mockResolvedValue(dados({ contas: [conta({ abertura: { data: "2026-09-01", saldo: 80_000, por: null }, abertura_neste_periodo: false })] }));
      tela();
      expect(await screen.findByText("A partir de 01/09/2026")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Ajustar o saldo inicial de Banco do Lar" }));
      expect(screen.queryByRole("button", { name: "Voltar ao cadastro" })).toBeNull();
    });

    it("oferece usar o saldo do banco conferido no mês anterior, num clique", async () => {
      obter.mockResolvedValue(dados({ contas: [conta({ saldo_banco_anterior: 130_050, mes_anterior: "2026-09" })] }));
      tela();
      fireEvent.click(await screen.findByRole("button", { name: /Usar o saldo do banco de 09\/2026 como saldo inicial de Banco do Lar/ }));
      await waitFor(() => expect(definirAbertura).toHaveBeenCalledWith({ conta_id: "a", data: "2026-10-01", saldo_centavos: 130_050 }));
    });

    it("não sugere quando o saldo do banco do mês anterior já é o saldo inicial", async () => {
      obter.mockResolvedValue(dados({ contas: [conta({ saldo_banco_anterior: 100_000, mes_anterior: "2026-09" })] }));
      tela();
      await screen.findByText("Banco do Lar");
      expect(screen.queryByRole("button", { name: /Usar o saldo do banco/ })).toBeNull();
    });

    it("a linha 'Sem conta' não tem ajuste", async () => {
      obter.mockResolvedValue(dados({ contas: [conta({ conta_id: null, nome: "Sem conta" })] }));
      tela();
      await screen.findByText("Sem conta");
      expect(screen.queryByRole("button", { name: /Ajustar o saldo inicial/ })).toBeNull();
    });

    it("mostra o erro do servidor ao gravar", async () => {
      obter.mockResolvedValue(dados());
      definirAbertura.mockRejectedValue(new ApiError("VALIDATION_ERROR", "Saldo fora do limite.", 422));
      tela();
      fireEvent.click(await screen.findByRole("button", { name: "Ajustar o saldo inicial de Banco do Lar" }));
      fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
      expect(await screen.findByText("Saldo fora do limite.")).toBeTruthy();
    });
  });
  describe("lançamentos do período", () => {
    const lanc = (id: string, extra: Partial<FechamentoLancamentoApi> = {}): FechamentoLancamentoApi => ({
      id, data: "2026-10-05", conta_id: "a", conta: "Banco do Lar", tipo: "saida", valor_centavos: 12_345, categoria: "Aluguel", beneficiario: null, descricao: `Lançamento ${id}`, forma_pagamento: null, transferencia: false, arquivos: 0, ...extra,
    });

    it("lista cada lançamento efetivado com data, conta, categoria e valor, e abre o lançamento ao clicar", async () => {
      obter.mockResolvedValue(dados());
      lancamentos.mockResolvedValue({ lancamentos: [lanc("l1", { beneficiario: "Imobiliária", arquivos: 2 }), lanc("l2", { tipo: "entrada", valor_centavos: 50_000, categoria: null, descricao: "Mensalidade", transferencia: false })], limite: 50_000, cortado: false });
      const abrirLancamento = vi.fn();
      tela(abrirLancamento);
      expect(await screen.findByText("2 lançamentos efetivados")).toBeTruthy();
      expect(screen.getByText("Lançamento l1")).toBeTruthy();
      expect(screen.getByText("Imobiliária", { exact: false })).toBeTruthy();
      expect(within(screen.getByRole("region", { name: "Lançamentos do período" })).getByText("Sem categoria")).toBeTruthy();
      expect(lancamentos).toHaveBeenCalledWith({ data_de: "2026-10-01", data_ate: "2026-10-31" });
      fireEvent.click(screen.getByRole("button", { name: /Abrir lançamento Lançamento l1/ }));
      expect(abrirLancamento).toHaveBeenCalledWith("l1");
    });

    it("marca a transferência entre contas e avisa quando a lista foi cortada", async () => {
      obter.mockResolvedValue(dados());
      lancamentos.mockResolvedValue({ lancamentos: [lanc("t1", { transferencia: true })], limite: 1, cortado: true });
      tela();
      expect(await screen.findByText("Transferência entre contas")).toBeTruthy();
      expect(screen.getByText(/cortada no limite/)).toBeTruthy();
    });

    it("mostra aos poucos: 200 por vez, com botão para o resto", async () => {
      obter.mockResolvedValue(dados());
      lancamentos.mockResolvedValue({ lancamentos: Array.from({ length: 230 }, (_, i) => lanc(`m${i}`)), limite: 50_000, cortado: false });
      tela();
      expect(await screen.findByText("230 lançamentos efetivados")).toBeTruthy();
      expect(screen.getAllByRole("button", { name: /Abrir lançamento/ })).toHaveLength(200);
      fireEvent.click(screen.getByRole("button", { name: /Mostrar mais 30/ }));
      expect(screen.getAllByRole("button", { name: /Abrir lançamento/ })).toHaveLength(230);
    });
  });

  describe("período em andamento", () => {
    it("não cobra conferência nem diz que não está pronto: avisa que o período não terminou", async () => {
      obter.mockResolvedValue(dados({ em_andamento: true, mes: "2026-11", data_de: "2026-11-01", data_ate: "2026-11-30" }));
      tela();
      expect(await screen.findByText(/ainda está em andamento/)).toBeTruthy();
      expect(screen.queryByText(/ainda não está pronto/)).toBeNull();
      expect(screen.queryByRole("columnheader", { name: "Saldo no banco" })).toBeNull();
    });
  });

  describe("contas que entram no fechamento", () => {
    const duas = [
      { id: "a", nome: "Banco do Lar", banco: null, cor: "#3366aa", codigo_banco: null, sigla: null, fora: false },
      { id: "b", nome: "Caixa velho", banco: null, cor: "#aa6633", codigo_banco: null, sigla: null, fora: false },
    ];

    it("mostra quantas contas entram e deixa escolher; desmarcar grava as que ficam de fora", async () => {
      obter.mockResolvedValue(dados({ todas_as_contas: duas }));
      tela();
      fireEvent.click(await screen.findByRole("button", { name: /Contas: 2 de 2/ }));
      fireEvent.click(screen.getByRole("checkbox", { name: /Caixa velho/ }));
      await waitFor(() => expect(definirContas).toHaveBeenCalledWith(["b"]));
    });

    it("marcar de novo uma conta de fora a traz de volta", async () => {
      obter.mockResolvedValue(dados({ todas_as_contas: [duas[0], { ...duas[1], fora: true }] }));
      tela();
      fireEvent.click(await screen.findByRole("button", { name: /Contas: 1 de 2/ }));
      fireEvent.click(screen.getByRole("checkbox", { name: /Caixa velho/ }));
      await waitFor(() => expect(definirContas).toHaveBeenCalledWith([]));
    });

    it("com todas as contas fora avisa em vez de mostrar uma tabela vazia", async () => {
      obter.mockResolvedValue(dados({ contas: [], todas_as_contas: duas.map((c) => ({ ...c, fora: true })) }));
      tela();
      expect(await screen.findByText("Todas as contas estão fora do fechamento")).toBeTruthy();
    });
  });
});
