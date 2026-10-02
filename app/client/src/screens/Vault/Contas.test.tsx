import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@/lib/api", async (importOriginal) => {
  const o = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...o,
    vault: { ...o.vault, config: vi.fn(), contas: { listar: vi.fn(), criar: vi.fn(), atualizar: vi.fn(), excluir: vi.fn(), uso: vi.fn() }, transacoes: { ...o.vault.transacoes, listar: vi.fn() } },
    financeiro: { ...o.financeiro, recorrencias: vi.fn() },
  };
});
import { vault, financeiro, type ContaApi, type TransacaoApi } from "@/lib/api";
import { VaultAccounts } from "./VaultAccounts";
import { ContaModal } from "./contas/ContaModal";
import { BANCOS, buscarBancos } from "./contas/bancos";

const conta = (id: string, nome: string, extra: Partial<ContaApi> = {}): ContaApi => ({ id, nome, banco: null, agencia: null, numero_conta: null, cor: "#8a05be", padrao: false, espaco: "pessoal", tipo: "corrente", codigo_banco: null, saldo_inicial_centavos: 0, ...extra });
const nubank = conta("c1", "Nubank", { banco: "Nubank", codigo_banco: "260", agencia: "0001", numero_conta: "123-4", saldo_inicial_centavos: 100000 });
const carteira = conta("c2", "Carteira", { tipo: "carteira", cor: "#94a3b8" });
const tx = (id: string, tipo: "entrada" | "saida", valor: number, contaId: string | null, extra: Partial<TransacaoApi> = {}): TransacaoApi => ({ id, tipo, valor_centavos: valor, moeda: "BRL", data: "2026-09-10", descricao: `Lançamento ${id}`, categoria_id: null, conta_id: contaId, beneficiario_id: null, forma_pagamento: "pix", status: "efetivada", observacoes: null, origem: "manual", espaco: "pessoal", criado_em: "", atualizado_em: "", ...extra });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(vault.contas.listar).mockResolvedValue([nubank, carteira]);
  vi.mocked(vault.config).mockResolvedValue({ cofre_ativado: true, destrancado: true, saldos_por_conta: [{ conta_id: "c1", nome: "Nubank", saldo_centavos: 120000 }, { conta_id: "c2", nome: "Carteira", saldo_centavos: -2000 }] });
  vi.mocked(vault.transacoes.listar).mockResolvedValue({ items: [tx("a", "entrada", 50000, "c1"), tx("b", "saida", 30000, "c1"), tx("c", "saida", 2000, "c2")], next_cursor: null });
  vi.mocked(financeiro.recorrencias).mockResolvedValue([]);
});

const periodo = { kind: "month", year: 2026, month: 9 } as const;
const abrir = () => render(<VaultAccounts period={periodo} onPeriodChange={vi.fn()} categorias={[]} atualizar={vi.fn()} />);

it("lista as contas com saldo, banco e dados, e mostra o patrimônio total na visão geral", async () => {
  abrir();
  const linha = await screen.findByRole("button", { name: "Conta Nubank" });
  expect(linha.textContent).toContain("R$ 1.200,00");
  expect(linha.textContent).toContain("ag. 0001");
  expect(screen.getByRole("button", { name: "Conta Carteira" }).textContent).toContain("-R$ 20,00");
  // patrimônio = 1.200 − 20
  expect((await screen.findAllByText("R$ 1.180,00")).length).toBeGreaterThan(0);
  expect(screen.getByText("Patrimônio total")).toBeTruthy();
});

it("selecionar uma conta troca a análise para ela e mostra os dados cadastrais", async () => {
  abrir();
  fireEvent.click(await screen.findByRole("button", { name: "Conta Nubank" }));
  expect(await screen.findByText("Saldo atual", { selector: "b" })).toBeTruthy();
  expect(screen.getByText("Dados da conta")).toBeTruthy();
  expect(screen.getByText("260")).toBeTruthy();
  // Entradas 500 e saídas 300 só da conta: resultado +200.
  expect(screen.getByText("+R$ 200,00")).toBeTruthy();
});

it("sem contas: convida a cadastrar e abre o modal", async () => {
  vi.mocked(vault.contas.listar).mockResolvedValue([]);
  vi.mocked(vault.config).mockResolvedValue({ cofre_ativado: true, destrancado: true, saldos_por_conta: [] });
  vi.mocked(vault.transacoes.listar).mockResolvedValue({ items: [], next_cursor: null });
  abrir();
  expect(await screen.findByText("Nenhuma conta cadastrada")).toBeTruthy();
  fireEvent.click(screen.getAllByRole("button", { name: /Nova conta/ })[0]!);
  expect(await screen.findByRole("dialog", { name: "Nova conta" })).toBeTruthy();
});

it("catálogo: tem muitos bancos e acha por nome (sem acento) ou pelo número", () => {
  expect(BANCOS.length).toBeGreaterThanOrEqual(40);
  expect(new Set(BANCOS.map((b) => b.codigo)).size).toBe(BANCOS.length);
  expect(BANCOS.every((b) => /^\d{3}$/.test(b.codigo))).toBe(true);
  expect(buscarBancos("itau").map((b) => b.codigo)).toContain("341");
  expect(buscarBancos("260").map((b) => b.curto)).toEqual(["Nubank"]);
  expect(buscarBancos("zzzz")).toEqual([]);
});

it("escolher um banco do catálogo preenche nome, número e cor, e cria a conta com saldo inicial", async () => {
  vi.mocked(vault.contas.criar).mockResolvedValue({ id: "novo" });
  const onSaved = vi.fn();
  render(<ContaModal contas={[]} onClose={vi.fn()} onSaved={onSaved} />);
  fireEvent.click(screen.getByRole("option", { name: /Itaú/ }));
  expect((screen.getByLabelText("Nome da conta") as HTMLInputElement).value).toBe("Itaú");
  fireEvent.change(screen.getByLabelText("Agência"), { target: { value: "1234" } });
  fireEvent.change(screen.getByLabelText("Número da conta"), { target: { value: "99999-0" } });
  fireEvent.change(screen.getByLabelText(/^Saldo inicial/), { target: { value: "1.500,50" } });
  fireEvent.click(screen.getByRole("button", { name: "Criar conta" }));
  await waitFor(() => expect(vault.contas.criar).toHaveBeenCalledWith(expect.objectContaining({ nome: "Itaú", banco: "Itaú", codigo_banco: "341", agencia: "1234", numero_conta: "99999-0", tipo: "corrente", saldo_inicial_centavos: 150050, cor: "#ec7000" })));
  expect(onSaved).toHaveBeenCalledWith("novo");
});

it("banco personalizado: pede nome e número do banco", async () => {
  vi.mocked(vault.contas.criar).mockResolvedValue({ id: "n2" });
  render(<ContaModal contas={[]} onClose={vi.fn()} onSaved={vi.fn()} />);
  fireEvent.click(screen.getByRole("option", { name: /Outro banco/ }));
  fireEvent.change(screen.getByLabelText("Nome do banco"), { target: { value: "Banco Fulano" } });
  fireEvent.change(screen.getByLabelText("Número do banco"), { target: { value: "9x9" } });
  fireEvent.change(screen.getByLabelText("Nome da conta"), { target: { value: "Reserva" } });
  fireEvent.click(screen.getByRole("button", { name: "Criar conta" }));
  await waitFor(() => expect(vault.contas.criar).toHaveBeenCalledWith(expect.objectContaining({ nome: "Reserva", banco: "Banco Fulano", codigo_banco: "099" })));
});

it("saldo inicial inválido não envia nada e avisa", async () => {
  render(<ContaModal contas={[]} onClose={vi.fn()} onSaved={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Nome da conta"), { target: { value: "X" } });
  fireEvent.change(screen.getByLabelText(/^Saldo inicial/), { target: { value: "abc" } });
  fireEvent.click(screen.getByRole("button", { name: "Criar conta" }));
  expect((await screen.findByRole("alert")).textContent).toContain("Saldo inicial inválido");
  expect(vault.contas.criar).not.toHaveBeenCalled();
});

it("apagar conta em uso: lista o que usa e move para outra conta", async () => {
  vi.mocked(vault.contas.uso).mockResolvedValue({ transacoes: 2, recorrencias: 1, amostra: [{ id: "a", data: "2026-09-10", descricao: "Mercado", tipo: "saida", valor_centavos: 5000 }] });
  vi.mocked(vault.contas.excluir).mockResolvedValue({ ok: true, movidos: 3 });
  const onSaved = vi.fn();
  render(<ContaModal conta={nubank} contas={[nubank, carteira]} onClose={vi.fn()} onSaved={onSaved} />);
  fireEvent.click(screen.getByRole("button", { name: "Apagar conta" }));
  const menu = await screen.findByRole("alert", { name: "Apagar Nubank" });
  expect(menu.textContent).toContain("2 lançamentos");
  expect(menu.textContent).toContain("1 recorrência");
  expect(within(menu).getByRole("list", { name: "Lançamentos desta conta" })).toBeTruthy();
  fireEvent.click(within(menu).getByRole("button", { name: "Deixar sem conta e apagar" }));
  await waitFor(() => expect(vault.contas.excluir).toHaveBeenCalledWith("c1", { sem_conta: true }));
  expect(onSaved).toHaveBeenCalled();
});
