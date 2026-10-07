import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@/lib/api", async (importOriginal) => {
  const o = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...o,
    vault: {
      ...o.vault,
      contas: { ...o.vault.contas, listar: vi.fn() },
      beneficiarios: { listar: vi.fn(), criarOuEncontrar: vi.fn() },
      transacoes: { ...o.vault.transacoes, excluir: vi.fn(), atualizar: vi.fn() },
    },
    financeiro: {
      ...o.financeiro,
      recorrencias: vi.fn(), ocorrenciasDoPeriodo: vi.fn(), concluir: vi.fn(), reagendar: vi.fn(), criarRecorrencia: vi.fn(),
      atualizarRecorrencia: vi.fn(), excluirRecorrencia: vi.fn(), duplicarRecorrencia: vi.fn(), pularOcorrencia: vi.fn(), encerrarAPartir: vi.fn(),
    },
  };
});
import { financeiro, vault, type CategoriaApi, type OcorrenciaRecorrente, type RecorrenciaApi } from "@/lib/api";
import { VaultRecorrencias } from "./VaultRecorrencias";

const regra = (id: string, descricao: string, extra: Partial<RecorrenciaApi> = {}): RecorrenciaApi => ({
  id, tipo: "saida", descricao, valor_centavos: 5990, categoria_id: "cat", conta_id: null, beneficiario_id: "b1", forma_pagamento: null,
  tipo_recorrencia: "fixa", frequencia: "mensal", intervalo: 1, dia_vencimento: null, data_inicio: "2026-01-01", data_fim: null, total_parcelas: null,
  parcelas_geradas: 0, efetivadas: 0, observacoes: null, espaco: "pessoal", ativa: true, criado_em: "", atualizado_em: "t0", ...extra,
});
const oc = (recorrencia_id: string, data: string, extra: Partial<OcorrenciaRecorrente> = {}): OcorrenciaRecorrente => ({
  recorrencia_id, data, parcela: null, transacao_id: null, status: null, valor_centavos: 5990, data_lancamento: null, ...extra,
});
const categoria: CategoriaApi = { id: "cat", nome: "Assinaturas", tipo: "saida", icone: "Repeat", cor: "#f29a9f", padrao: false, espaco: "pessoal" };
const periodo = { kind: "month", year: 2026, month: 10 } as const;

const netflix = regra("r1", "Netflix Premium");
const carro = regra("r2", "Financiamento do carro", { tipo_recorrencia: "parcelada", total_parcelas: 12, parcelas_geradas: 3, efetivadas: 2, valor_centavos: 90000 });
const salario = regra("r3", "Salário", { tipo: "entrada", valor_centavos: 500000, categoria_id: null });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(financeiro.recorrencias).mockResolvedValue([netflix, carro, salario]);
  vi.mocked(financeiro.ocorrenciasDoPeriodo).mockResolvedValue([
    oc("r1", "2026-10-01"),
    oc("r2", "2026-10-06", { parcela: 4, valor_centavos: 90000, status: "efetivada", transacao_id: "t2", data_lancamento: "2026-10-06" }),
    oc("r3", "2026-10-05", { valor_centavos: 500000 }),
  ]);
  vi.mocked(vault.contas.listar).mockResolvedValue([]);
  vi.mocked(vault.beneficiarios.listar).mockResolvedValue([{ id: "b1", nome: "Netflix Inc.", documento: null, observacoes: null }]);
  vi.mocked(vault.beneficiarios.criarOuEncontrar).mockResolvedValue({ id: "b9", nome: "Novo", novo: true });
  vi.mocked(financeiro.concluir).mockResolvedValue({ transacao_id: "t" });
  vi.mocked(financeiro.atualizarRecorrencia).mockResolvedValue(netflix);
  vi.mocked(financeiro.criarRecorrencia).mockResolvedValue({ id: "novo" });
  vi.mocked(financeiro.pularOcorrencia).mockResolvedValue({ ok: true });
  vi.mocked(financeiro.encerrarAPartir).mockResolvedValue({ ok: true, lancamentos_apagados: 0, regra_removida: false });
  vi.mocked(financeiro.excluirRecorrencia).mockResolvedValue({ ok: true });
  vi.mocked(financeiro.duplicarRecorrencia).mockResolvedValue({ id: "c" });
  vi.mocked(financeiro.reagendar).mockResolvedValue({ ok: true });
  vi.mocked(vault.transacoes.excluir).mockResolvedValue({ ok: true });
});

const abrir = () => render(<VaultRecorrencias period={periodo} onPeriodChange={vi.fn()} categorias={[categoria]} atualizar={vi.fn()} recarregar={0} />);
const menuDe = async (nome: string) => { fireEvent.click(await screen.findByRole("button", { name: new RegExp(`^Mais ações: ${nome}`) })); return screen.getByRole("menu"); };
const itemDoMenu = (nome: string | RegExp) => screen.getByRole("menuitem", { name: nome });

it("lista as ocorrências do período com status, valor e rótulo fixa/parcela, e totaliza o que falta", async () => {
  abrir();
  expect(await screen.findByRole("button", { name: /Editar Netflix Premium, vencimento 01\/10\/2026/ })).toBeTruthy();
  const linhas = screen.getAllByRole("button", { name: /^Editar / }).map((b) => b.textContent);
  expect(linhas).toEqual(["Netflix Premium", "Salário", "Financiamento do carro"]);
  expect(screen.getAllByText(/Netflix Inc\. · Fixa · mensal/).length).toBeGreaterThan(0);
  expect(screen.getByText(/Parcela 4\/12/)).toBeTruthy();
  expect(screen.getAllByText("Efetivado")).toHaveLength(1);
  expect(screen.getAllByText("Pendente")).toHaveLength(2);
  // Só o que não foi efetivado entra no rodapé.
  expect(screen.getByText(/a pagar/).textContent).toContain("R$ 59,90");
  expect(screen.getByText(/a receber/).textContent).toContain("R$ 5.000,00");
});

it("filtra por receitas e despesas", async () => {
  abrir();
  await screen.findByText("Netflix Premium");
  fireEvent.click(screen.getByRole("button", { name: /Apenas receitas/ }));
  expect(screen.queryByText("Netflix Premium")).toBeNull();
  expect(screen.getByText("Salário")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Apenas despesas/ }));
  expect(screen.queryByText("Salário")).toBeNull();
  expect(screen.getByText("Netflix Premium")).toBeTruthy();
});

it("Concluir efetiva a ocorrência na data dela; ocorrência já efetivada não oferece Concluir", async () => {
  abrir();
  await menuDe("Netflix Premium");
  fireEvent.click(itemDoMenu("Concluir"));
  await waitFor(() => expect(financeiro.concluir).toHaveBeenCalledWith("r1", "2026-10-01", "2026-10-01"));
  fireEvent.click(await screen.findByRole("button", { name: /^Mais ações: Financiamento do carro/ }));
  expect(screen.queryByRole("menuitem", { name: "Concluir" })).toBeNull();
  expect(screen.queryByRole("menuitem", { name: "Concluir parcialmente" })).toBeNull();
});

it("Concluir parcialmente envia só o valor pago e mostra quanto fica pendente", async () => {
  abrir();
  await menuDe("Netflix Premium");
  fireEvent.click(itemDoMenu("Concluir parcialmente"));
  const dialogo = await screen.findByRole("dialog", { name: "Concluir parcialmente" });
  fireEvent.change(within(dialogo).getByLabelText("Valor pago"), { target: { value: "20,00" } });
  expect(dialogo.textContent).toContain("R$ 39,90");
  fireEvent.click(within(dialogo).getByRole("button", { name: "Confirmar conclusão parcial" }));
  await waitFor(() => expect(financeiro.concluir).toHaveBeenCalledWith("r1", "2026-10-01", "2026-10-01", { valor_centavos: 2000 }));
});

it("conclusão parcial recusa o valor cheio", async () => {
  abrir();
  await menuDe("Netflix Premium");
  fireEvent.click(itemDoMenu("Concluir parcialmente"));
  const dialogo = await screen.findByRole("dialog", { name: "Concluir parcialmente" });
  fireEvent.click(within(dialogo).getByRole("button", { name: "Confirmar conclusão parcial" }));
  expect((await within(dialogo).findByRole("alert")).textContent).toContain("valor cheio");
  expect(financeiro.concluir).not.toHaveBeenCalled();
});

it("Reagendar uma ocorrência prevista agenda sem efetivar; já lançada só muda a data do lançamento", async () => {
  abrir();
  await menuDe("Netflix Premium");
  fireEvent.click(itemDoMenu("Reagendar"));
  let dialogo = await screen.findByRole("dialog", { name: "Reagendar" });
  fireEvent.click(within(dialogo).getByRole("button", { name: "Nova data" }));
  fireEvent.click(within(dialogo).getByRole("button", { name: "12" }));
  fireEvent.click(within(dialogo).getByRole("button", { name: "Reagendar" }));
  await waitFor(() => expect(financeiro.concluir).toHaveBeenCalledWith("r1", "2026-10-01", "2026-10-12", { confirmar: false }));

  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Reagendar" })).toBeNull());
  fireEvent.click(await screen.findByRole("button", { name: /^Mais ações: Financiamento do carro/ }));
  fireEvent.click(itemDoMenu("Reagendar"));
  dialogo = await screen.findByRole("dialog", { name: "Reagendar" });
  fireEvent.click(within(dialogo).getByRole("button", { name: "Nova data" }));
  fireEvent.click(within(dialogo).getByRole("button", { name: "9" }));
  fireEvent.click(within(dialogo).getByRole("button", { name: "Reagendar" }));
  await waitFor(() => expect(financeiro.reagendar).toHaveBeenCalledWith("t2", "2026-10-09"));
});

it("Excluir só esta data pula a ocorrência sem confirmar quando ainda é só previsão", async () => {
  abrir();
  await menuDe("Netflix Premium");
  fireEvent.click(itemDoMenu("Excluir só esta data"));
  await waitFor(() => expect(financeiro.pularOcorrencia).toHaveBeenCalledWith("r1", "2026-10-01"));
  expect(vault.transacoes.excluir).not.toHaveBeenCalled();
});

it("Excluir uma ocorrência efetivada pede confirmação e apaga o lançamento", async () => {
  abrir();
  fireEvent.click(await screen.findByRole("button", { name: /^Mais ações: Financiamento do carro/ }));
  fireEvent.click(itemDoMenu("Excluir só esta data"));
  const dialogo = await screen.findByRole("dialog", { name: "Excluir esta ocorrência?" });
  expect(financeiro.pularOcorrencia).not.toHaveBeenCalled();
  fireEvent.click(within(dialogo).getByRole("button", { name: "Excluir ocorrência" }));
  await waitFor(() => expect(vault.transacoes.excluir).toHaveBeenCalledWith("t2"));
  expect(financeiro.pularOcorrencia).toHaveBeenCalledWith("r2", "2026-10-06");
});

it("Excluir esta e as próximas encerra a série; Excluir toda apaga só a regra", async () => {
  abrir();
  await menuDe("Netflix Premium");
  fireEvent.click(itemDoMenu("Excluir esta e as próximas"));
  fireEvent.click(within(await screen.findByRole("dialog", { name: "Excluir esta e as próximas?" })).getByRole("button", { name: "Encerrar daqui" }));
  await waitFor(() => expect(financeiro.encerrarAPartir).toHaveBeenCalledWith("r1", "2026-10-01"));

  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  fireEvent.click(await screen.findByRole("button", { name: /^Mais ações: Netflix Premium/ }));
  fireEvent.click(itemDoMenu("Excluir toda a recorrência"));
  fireEvent.click(within(await screen.findByRole("dialog", { name: "Excluir toda a recorrência?" })).getByRole("button", { name: "Excluir recorrência" }));
  await waitFor(() => expect(financeiro.excluirRecorrencia).toHaveBeenCalledWith("r1"));
});

it("Duplicar abre uma recorrência nova preenchida (sem salvar) e Pausar chama o servidor", async () => {
  abrir();
  await menuDe("Netflix Premium");
  fireEvent.click(itemDoMenu("Duplicar"));
  const nova = await screen.findByRole("dialog", { name: "Nova recorrência" });
  expect(within(nova).getByLabelText("Descrição")).toHaveProperty("value", "Netflix Premium (cópia)");
  expect(financeiro.duplicarRecorrencia).not.toHaveBeenCalled();
  expect(financeiro.criarRecorrencia).not.toHaveBeenCalled();
  fireEvent.click(within(nova).getByRole("button", { name: "Cancelar" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Nova recorrência" })).toBeNull());
  await menuDe("Netflix Premium");
  fireEvent.click(itemDoMenu("Pausar recorrência"));
  await waitFor(() => expect(financeiro.atualizarRecorrencia).toHaveBeenCalledWith("r1", expect.objectContaining({ ativa: false, descricao: "Netflix Premium", data_inicio: "2026-01-01" })));
});

it("recorrências pausadas ficam numa seção própria e podem ser reativadas", async () => {
  vi.mocked(financeiro.recorrencias).mockResolvedValue([netflix, regra("r9", "Academia", { ativa: false })]);
  abrir();
  fireEvent.click(await screen.findByText(/Pausadas \(1\)/));
  fireEvent.click(await screen.findByRole("button", { name: /Reativar/ }));
  await waitFor(() => expect(financeiro.atualizarRecorrencia).toHaveBeenCalledWith("r9", expect.objectContaining({ ativa: true })));
});

it("clicar na linha abre a edição com progresso do parcelamento e trava início/tipo quando já gerou lançamentos", async () => {
  abrir();
  fireEvent.click(await screen.findByRole("button", { name: /Editar Financiamento do carro/ }));
  const dialogo = await screen.findByRole("dialog", { name: "Editar recorrência" });
  expect(within(dialogo).getByLabelText("2 de 12 parcelas efetivadas")).toBeTruthy();
  expect((within(dialogo).getByLabelText("Início") as HTMLInputElement).disabled).toBe(true);
  expect(dialogo.textContent).toContain("Parcela 4/12");
});

it("salvar a edição envia a regra completa, incluindo ativa", async () => {
  abrir();
  fireEvent.click(await screen.findByRole("button", { name: /Editar Netflix Premium/ }));
  const dialogo = await screen.findByRole("dialog", { name: "Editar recorrência" });
  fireEvent.change(within(dialogo).getByLabelText("Valor"), { target: { value: "69,90" } });
  fireEvent.click(within(dialogo).getByLabelText(/Recorrência ativa/));
  fireEvent.click(within(dialogo).getByRole("button", { name: "Salvar alterações" }));
  const escopo = await screen.findByRole("dialog", { name: "Aplicar a quais ocorrências?" });
  fireEvent.click(within(escopo).getByLabelText(/^Todas/));
  fireEvent.click(within(escopo).getByRole("button", { name: "Salvar alterações" }));
  await waitFor(() => expect(financeiro.atualizarRecorrencia).toHaveBeenCalledWith("r1", expect.objectContaining({ valor_centavos: 6990, ativa: false, beneficiario_id: "b9", tipo_recorrencia: "fixa" })));
});

it("editar só esta ocorrência agenda o lançamento e muda apenas ele", async () => {
  abrir();
  fireEvent.click(await screen.findByRole("button", { name: /Editar Netflix Premium/ }));
  const dialogo = await screen.findByRole("dialog", { name: "Editar recorrência" });
  fireEvent.change(within(dialogo).getByLabelText("Valor"), { target: { value: "10,00" } });
  fireEvent.click(within(dialogo).getByRole("button", { name: "Salvar alterações" }));
  const escopo = await screen.findByRole("dialog", { name: "Aplicar a quais ocorrências?" });
  fireEvent.click(within(escopo).getByRole("button", { name: "Salvar alterações" }));
  await waitFor(() => expect(vault.transacoes.atualizar).toHaveBeenCalledWith("t", expect.objectContaining({ valor_centavos: 1000, data: "2026-10-01", status: "pendente" })));
  expect(financeiro.concluir).toHaveBeenCalledWith("r1", "2026-10-01", "2026-10-01", { confirmar: false });
  expect(financeiro.atualizarRecorrencia).not.toHaveBeenCalled();
});

it("editar esta e as próximas encerra a série daqui e cria outra a partir da data", async () => {
  abrir();
  fireEvent.click(await screen.findByRole("button", { name: /Editar Netflix Premium/ }));
  const dialogo = await screen.findByRole("dialog", { name: "Editar recorrência" });
  fireEvent.change(within(dialogo).getByLabelText("Valor"), { target: { value: "10,00" } });
  fireEvent.click(within(dialogo).getByRole("button", { name: "Salvar alterações" }));
  const escopo = await screen.findByRole("dialog", { name: "Aplicar a quais ocorrências?" });
  fireEvent.click(within(escopo).getByLabelText(/^Esta e as próximas/));
  fireEvent.click(within(escopo).getByRole("button", { name: "Salvar alterações" }));
  await waitFor(() => expect(financeiro.criarRecorrencia).toHaveBeenCalledWith(expect.objectContaining({ valor_centavos: 1000, data_inicio: "2026-10-01" })));
  expect(financeiro.encerrarAPartir).toHaveBeenCalledWith("r1", "2026-10-01");
});

it("cria uma recorrência parcelada nova", async () => {
  abrir();
  fireEvent.click((await screen.findAllByRole("button", { name: /Nova recorrência/ }))[0]!);
  const dialogo = await screen.findByRole("dialog", { name: "Nova recorrência" });
  fireEvent.change(within(dialogo).getByLabelText("Descrição"), { target: { value: "Celular" } });
  fireEvent.change(within(dialogo).getByLabelText("Valor"), { target: { value: "250,00" } });
  fireEvent.click(within(dialogo).getByRole("button", { name: "Parcelada" }));
  fireEvent.change(within(dialogo).getByLabelText("Parcelas"), { target: { value: "10" } });
  fireEvent.click(within(dialogo).getByRole("button", { name: "Frequência" }));
  fireEvent.click(screen.getByRole("option", { name: "Semanal" }));
  fireEvent.click(within(dialogo).getByRole("button", { name: "Criar recorrência" }));
  await waitFor(() => expect(financeiro.criarRecorrencia).toHaveBeenCalledWith(expect.objectContaining({
    descricao: "Celular", valor_centavos: 25000, tipo_recorrencia: "parcelada", total_parcelas: 10, frequencia: "semanal", tipo: "saida", data_inicio: "2026-10-01",
  })));
});

it("valida o valor antes de enviar", async () => {
  abrir();
  fireEvent.click((await screen.findAllByRole("button", { name: /Nova recorrência/ }))[0]!);
  const dialogo = await screen.findByRole("dialog", { name: "Nova recorrência" });
  fireEvent.change(within(dialogo).getByLabelText("Descrição"), { target: { value: "X" } });
  fireEvent.click(within(dialogo).getByRole("button", { name: "Criar recorrência" }));
  expect((await within(dialogo).findByRole("alert")).textContent).toContain("valor válido");
  expect(financeiro.criarRecorrencia).not.toHaveBeenCalled();
});

it("sem nenhuma recorrência: convida a cadastrar", async () => {
  vi.mocked(financeiro.recorrencias).mockResolvedValue([]);
  vi.mocked(financeiro.ocorrenciasDoPeriodo).mockResolvedValue([]);
  abrir();
  expect(await screen.findByText("Nenhuma recorrência cadastrada")).toBeTruthy();
});

it("Ctrl+clique seleciona várias e exclui as selecionadas de uma vez", async () => {
  abrir();
  const a = await screen.findByRole("button", { name: /Editar Netflix Premium/ });
  const b = screen.getByRole("button", { name: /Editar Salário/ });
  fireEvent.click(a, { ctrlKey: true });
  fireEvent.click(b, { ctrlKey: true });
  expect(screen.getByText("2 selecionadas")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Excluir selecionadas/ }));
  fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Excluir selecionadas" }));
  await waitFor(() => expect(financeiro.pularOcorrencia).toHaveBeenCalledTimes(2));
  expect(financeiro.pularOcorrencia).toHaveBeenCalledWith("r1", "2026-10-01");
  expect(financeiro.pularOcorrencia).toHaveBeenCalledWith("r3", "2026-10-05");
});

it("mostra o erro de carga e permite tentar de novo", async () => {
  vi.mocked(financeiro.recorrencias).mockRejectedValueOnce(new Error("sem conexão"));
  abrir();
  expect((await screen.findByRole("alert")).textContent).toContain("sem conexão");
  fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
  expect(await screen.findByText("Netflix Premium")).toBeTruthy();
});
