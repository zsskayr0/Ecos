import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@/lib/api", async (importOriginal) => {
  const o = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...o,
    vault: {
      ...o.vault,
      beneficiarios: { listar: vi.fn(), criarOuEncontrar: vi.fn(), renomear: vi.fn(), mesclar: vi.fn() },
      transacoes: { listar: vi.fn() },
    },
  };
});
import { vault } from "@/lib/api";
import { VaultSacados } from "./VaultSacados";

const tx = (id: string, tipo: "entrada" | "saida", valor: number, beneficiario: string | null) => ({ id, tipo, valor_centavos: valor, moeda: "BRL", data: "2026-09-10", descricao: `Lançamento ${id}`, categoria_id: null, conta_id: null, beneficiario_id: beneficiario, forma_pagamento: null, status: "efetivada" as const, observacoes: null, origem: "manual", espaco: "pessoal", criado_em: "", atualizado_em: "" });
const periodo = { kind: "month" as const, year: 2026, month: 9 };

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  vi.mocked(vault.beneficiarios.listar).mockResolvedValue([
    { id: "b1", nome: "Mercado Extra", documento: null, observacoes: null, transacoes: 5 },
    { id: "b2", nome: "Mercdo  Extra", documento: null, observacoes: null, transacoes: 1 },
    { id: "b3", nome: "Empresa Alfa", documento: null, observacoes: null, transacoes: 2 },
  ]);
  vi.mocked(vault.transacoes.listar).mockResolvedValue({ items: [tx("t1", "saida", 10000, "b1"), tx("t2", "entrada", 50000, "b3"), tx("t3", "saida", 2000, null)], next_cursor: null });
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

it("lista os sacados do período e separa pagadores de recebedores", async () => {
  render(<VaultSacados period={periodo} onPeriodChange={vi.fn()} atualizar={vi.fn()} />);
  expect(await screen.findByRole("button", { name: "Ver Mercado Extra" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Pagadores" }));
  expect(screen.queryByRole("button", { name: "Ver Mercado Extra" })).toBeNull();
  expect(screen.getByRole("button", { name: "Ver Empresa Alfa" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Recebedores" }));
  expect(screen.getByRole("button", { name: "Ver Mercado Extra" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Ver Empresa Alfa" })).toBeNull();
});

it("corrige o nome de um sacado", async () => {
  vi.mocked(vault.beneficiarios.renomear).mockResolvedValue({ ok: true, nome: "Mercado Extra SA" });
  render(<VaultSacados period={periodo} onPeriodChange={vi.fn()} atualizar={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "Ver Mercado Extra" }));
  fireEvent.click(screen.getByRole("button", { name: /Corrigir nome/ }));
  fireEvent.change(screen.getByLabelText("Nome do sacado"), { target: { value: "Mercado Extra SA" } });
  fireEvent.click(screen.getByRole("button", { name: "Salvar nome" }));
  await waitFor(() => expect(vault.beneficiarios.renomear).toHaveBeenCalledWith("b1", "Mercado Extra SA"));
});

it("a conciliação sugere juntar nomes parecidos, mantendo o mais usado, e junta ao confirmar", async () => {
  vi.mocked(vault.beneficiarios.mesclar).mockResolvedValue({ ok: true, movidos: 1 });
  render(<VaultSacados period={periodo} onPeriodChange={vi.fn()} atualizar={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: /Conciliação/ }));
  const grupo = screen.getByRole("radiogroup", { name: "Cadastro que permanece" });
  expect(within(grupo).getAllByRole("radio")).toHaveLength(2); // "Empresa Alfa" não é parecido com ninguém
  expect((within(grupo).getByRole("radio", { name: /Mercado Extra/ }) as HTMLInputElement).checked).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: /Juntar 2 cadastros/ }));
  await waitFor(() => expect(vault.beneficiarios.mesclar).toHaveBeenCalledWith({ destino_id: "b1", origem_ids: ["b2"], nome: "Mercado Extra" }));
});

it("“Não é o mesmo” tira o grupo da fila e lembra a decisão", async () => {
  render(<VaultSacados period={periodo} onPeriodChange={vi.fn()} atualizar={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: /Conciliação/ }));
  fireEvent.click(screen.getByRole("button", { name: "Não é o mesmo" }));
  expect(await screen.findByText("Nenhum nome parecido para conciliar")).toBeTruthy();
  expect(vault.beneficiarios.mesclar).not.toHaveBeenCalled();
});
