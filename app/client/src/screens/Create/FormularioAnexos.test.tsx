import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { RefreshProvider } from "@/lib/refresh-bus";
import { AuthProvider } from "@/lib/auth-context";

const uiMock = vi.hoisted(() => ({ fecharCaptura: vi.fn() }));
vi.mock("@/lib/ui-context", async (importOriginal) => {
  const o = await importOriginal<typeof import("@/lib/ui-context")>();
  return { ...o, useAppUI: () => ({ capturaAberta: "transacao", fecharCaptura: uiMock.fecharCaptura, trocarTipoCaptura: vi.fn(), espacoAtivo: "pessoal", anexosDeCaptura: [], limparAnexosDeCaptura: vi.fn(), dataCaptura: null, tituloCaptura: "" }) };
});
vi.mock("@/lib/api", async (importOriginal) => {
  const o = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...o,
    auth: { ...o.auth, perfil: vi.fn() },
    vault: {
      ...o.vault,
      categorias: { listar: vi.fn(), criar: vi.fn() },
      contas: { listar: vi.fn() },
      beneficiarios: { listar: vi.fn(), criarOuEncontrar: vi.fn() },
      transacoes: { criar: vi.fn(), obter: vi.fn(), atualizar: vi.fn(), excluir: vi.fn() },
      anexos: { listar: vi.fn(), enviar: vi.fn(), conteudo: vi.fn(), miniatura: vi.fn() },
    },
  };
});
import { auth, vault, type TransacaoApi } from "@/lib/api";
import { CreateFlow } from "./CreateFlow";
import { EditorDeLancamento } from "@/screens/Vault/EditorDeLancamento";

const perfil = { id: "u1", nome_usuario: "ana", nome: "Ana", cofre_ativado: true, avatar_atualizado_em: null, equipes: [], papel: "usuario", deve_trocar_senha: false, termos_pendente: false, termos_versao: "1" };
const existente: TransacaoApi = { id: "t1", tipo: "saida", valor_centavos: 5000, moeda: "BRL", data: "2026-09-30", descricao: "Mercado", categoria_id: null, conta_id: null, beneficiario_id: null, forma_pagamento: null, status: "efetivada", observacoes: null, origem: "manual", espaco: "pessoal", criado_em: "", atualizado_em: "", anexos: 0 };

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:t"), revokeObjectURL: vi.fn() }));
  window.matchMedia = vi.fn((q: string) => ({ matches: true, media: q, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), onchange: null, dispatchEvent: vi.fn() })) as unknown as typeof window.matchMedia;
  vi.mocked(auth.perfil).mockResolvedValue(perfil as never);
  vi.mocked(vault.categorias.listar).mockResolvedValue([]);
  vi.mocked(vault.contas.listar).mockResolvedValue([]);
  vi.mocked(vault.beneficiarios.listar).mockResolvedValue([]);
  vi.mocked(vault.transacoes.criar).mockResolvedValue({ ...existente, id: "novo" });
  vi.mocked(vault.transacoes.obter).mockResolvedValue(existente);
  vi.mocked(vault.anexos.listar).mockResolvedValue([]);
  vi.mocked(vault.anexos.enviar).mockResolvedValue({ id: "a", nome_arquivo: "a", tamanho_bytes: 1, duplicado_em: null });
});

const envolver = (ui: React.ReactElement) => render(<MemoryRouter><AuthProvider><RefreshProvider>{ui}</RefreshProvider></AuthProvider></MemoryRouter>);

it("EDITAR: o container Anexos fica DENTRO do formulário, logo abaixo de Observações e acima do botão Salvar", async () => {
  envolver(<EditorDeLancamento id="t1" aoSalvar={vi.fn()} aoExcluir={vi.fn()} aoFechar={vi.fn()} />);
  const observacoes = await screen.findByPlaceholderText("Opcional");
  const anexos = await screen.findByRole("region", { name: "Anexos do lançamento" });
  const salvar = screen.getByRole("button", { name: /Salvar alterações/ });
  const antes = (a: Node, b: Node) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
  expect(antes(observacoes, anexos)).toBe(true); // Observações → Anexos
  expect(antes(anexos, salvar)).toBe(true); // Anexos → Salvar
  expect(salvar.closest("form")!.contains(anexos)).toBe(true); // dentro do formulário
});

it("NOVO: o formulário de lançamento também tem o container Anexos abaixo de Observações", async () => {
  envolver(<CreateFlow />);
  const observacoes = await screen.findByPlaceholderText("Opcional");
  const anexos = await screen.findByRole("region", { name: "Anexos do lançamento" });
  expect(Boolean(observacoes.compareDocumentPosition(anexos) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
});

it("NOVO: os anexos escolhidos antes de salvar são enviados ao lançamento recém-criado", async () => {
  envolver(<CreateFlow />);
  fireEvent.change(await screen.findByPlaceholderText("Ex.: Mercado Extra"), { target: { value: "Compra no mercado" } });
  fireEvent.change(screen.getByPlaceholderText("R$ 0,00"), { target: { value: "12990" } });
  const comprovante = new File(["png"], "comprovante.png", { type: "image/png" });
  fireEvent.change(screen.getByLabelText("Escolher anexos do lançamento"), { target: { files: [comprovante] } });
  expect(screen.getByText("comprovante.png")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Salvar lançamento/ }));
  await waitFor(() => expect(vault.transacoes.criar).toHaveBeenCalledWith(expect.objectContaining({ descricao: "Compra no mercado", valor_centavos: 12990 })));
  await waitFor(() => expect(vault.anexos.enviar).toHaveBeenCalledWith("novo", comprovante));
});

it("NOVO: sem anexos escolhidos, salvar não chama o envio de anexos", async () => {
  envolver(<CreateFlow />);
  fireEvent.change(await screen.findByPlaceholderText("Ex.: Mercado Extra"), { target: { value: "Compra sem anexo" } });
  fireEvent.change(screen.getByPlaceholderText("R$ 0,00"), { target: { value: "500" } });
  fireEvent.click(screen.getByRole("button", { name: /Salvar lançamento/ }));
  await waitFor(() => expect(vault.transacoes.criar).toHaveBeenCalled());
  expect(vault.anexos.enviar).not.toHaveBeenCalled();
});
