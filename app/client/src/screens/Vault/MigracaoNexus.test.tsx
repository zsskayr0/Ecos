import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@/lib/api", async (importOriginal) => {
  const o = await importOriginal<typeof import("@/lib/api")>();
  return { ...o, financeiro: { ...o.financeiro, migrarNexus: vi.fn() } };
});
import { financeiro } from "@/lib/api";
import { MigracaoNexus } from "./MigracaoNexus";
import { contarPacote, dividirEmLotes, juntarRelatorios, lerPacote } from "./migracao-nexus";
import type { RelatorioNexus } from "./types";

const cont = (criadas: number, extra: Partial<RelatorioNexus["entidades"][string]> = {}) => ({ recebidas: criadas, criadas, reaproveitadas: 0, ja_migradas: 0, ignoradas: 0, com_erro: 0, ...extra });
const relatorio = (extra: Partial<RelatorioNexus> = {}): RelatorioNexus => ({
  dry_run: true, aplicado: false, backup: null, entidades: { lancamentos: cont(2) }, erros: [], avisos: [],
  verificacao: { antes: { lancamentos: 0, entradas_centavos: 0, saidas_centavos: 0 }, depois: { lancamentos: 2, entradas_centavos: 1000, saidas_centavos: 300 }, origem: { lancamentos: 2, entradas_centavos: 1000, saidas_centavos: 300 }, criados: { lancamentos: 2, entradas_centavos: 1000, saidas_centavos: 300 }, confere: true, projetado: true },
  ...extra,
});
const pacoteJson = JSON.stringify({ categories: [{ id: "c", name: "A", type: "expense" }], transactions: [{ id: "t", type: "income", amountCents: 1000 }, { id: "u", type: "expense", amountCents: 300 }] });
/** O jsdom não implementa `File.text()`. */
const arquivo = (texto: string) => Object.assign(new File([texto], "nexus-pacote.json", { type: "application/json" }), { text: async () => texto });

beforeEach(() => vi.clearAllMocks());

it("lerPacote recusa o que não é pacote e conta o que veio", () => {
  expect(() => lerPacote("não é json")).toThrow(/JSON/);
  expect(() => lerPacote("[]")).toThrow(/pacote/);
  expect(() => lerPacote("{}")).toThrow(/nenhum registro/);
  const c = contarPacote(lerPacote(pacoteJson));
  expect(c).toMatchObject({ categorias: 1, lancamentos: 2, receitasCentavos: 1000, despesasCentavos: 300 });
});

it("dividirEmLotes manda dados + anexos que cabem no primeiro e o resto em pedidos só de anexos", () => {
  const anexo = (id: string, tam: number) => ({ id, transactionId: "t", fileName: id, contentBase64: "x".repeat(tam) });
  const { lotes, naoSimulados } = dividirEmLotes({ transactions: [{ id: "t" }], attachments: [anexo("a", 60), anexo("b", 60), anexo("c", 30), { id: "d", transactionId: "t", fileName: "d" }] }, 100);
  expect(lotes).toHaveLength(2);
  expect(lotes[0].transactions).toHaveLength(1);
  expect(lotes[0].attachments!.map((a) => a.id)).toEqual(["a", "d"]);
  expect(lotes[1].transactions).toBeUndefined();
  expect(lotes[1].attachments!.map((a) => a.id)).toEqual(["b", "c"]);
  expect(naoSimulados).toBe(2);
});

it("juntarRelatorios soma contagens e exige todos aplicados", () => {
  const a = relatorio({ dry_run: false, aplicado: true, backup: "pre.enc" });
  const b = relatorio({ dry_run: false, aplicado: true, entidades: { anexos: cont(3) }, backup: null });
  const j = juntarRelatorios([a, b]);
  expect(j.aplicado).toBe(true);
  expect(j.backup).toBe("pre.enc");
  expect(j.entidades.lancamentos.criadas).toBe(2);
  expect(j.entidades.anexos.criadas).toBe(3);
  expect(juntarRelatorios([a, relatorio({ dry_run: false, aplicado: false })]).aplicado).toBe(false);
});

it("simula sem gravar e só libera aplicar depois da conferência e da confirmação", async () => {
  vi.mocked(financeiro.migrarNexus).mockResolvedValueOnce(relatorio());
  render(<MigracaoNexus atualizar={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Arquivo do Nexus"), { target: { files: [arquivo(pacoteJson)] } });
  fireEvent.click(await screen.findByRole("button", { name: /Simular migração/ }));
  await screen.findByText(/Simulação concluída: nada foi gravado/);
  expect(financeiro.migrarNexus).toHaveBeenCalledTimes(1);
  expect(vi.mocked(financeiro.migrarNexus).mock.calls[0][1]).toBe(true);
  const aplicar = screen.getByRole("button", { name: "Aplicar migração" }) as HTMLButtonElement;
  expect(aplicar.disabled).toBe(true);
  fireEvent.click(screen.getByRole("checkbox"));
  expect(aplicar.disabled).toBe(false);

  vi.mocked(financeiro.migrarNexus).mockResolvedValueOnce(relatorio({ dry_run: false, aplicado: true, backup: "pre-migracao-nexus-1.enc" }));
  fireEvent.click(aplicar);
  await screen.findByText(/Migração aplicada/);
  expect(vi.mocked(financeiro.migrarNexus).mock.calls[1].slice(1)).toEqual([false, "MIGRAR NEXUS"]);
  expect(screen.getByText(/pre-migracao-nexus-1\.enc/)).toBeTruthy();
});

it("com erros na simulação não oferece aplicar", async () => {
  vi.mocked(financeiro.migrarNexus).mockResolvedValueOnce(relatorio({ erros: [{ tabela: "lancamentos", id: "t9", erro: "categoria \"x\" não existe" }] }));
  render(<MigracaoNexus atualizar={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Arquivo do Nexus"), { target: { files: [arquivo(pacoteJson)] } });
  fireEvent.click(await screen.findByRole("button", { name: /Simular migração/ }));
  await waitFor(() => expect(screen.getByText(/t9: categoria/)).toBeTruthy());
  expect(screen.queryByRole("button", { name: "Aplicar migração" })).toBeNull();
});
