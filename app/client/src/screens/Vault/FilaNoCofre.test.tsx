import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { RefreshProvider } from "@/lib/refresh-bus";
import { AppUIProvider } from "@/lib/ui-context";
import { AuthProvider } from "@/lib/auth-context";

vi.mock("@/lib/api", async (importOriginal) => {
  const o = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...o,
    auth: { ...o.auth, perfil: vi.fn() },
    financeiro: { ...o.financeiro, painel: vi.fn() },
    vault: {
      ...o.vault,
      categorias: { listar: vi.fn() },
      beneficiarios: { listar: vi.fn() },
      contas: { listar: vi.fn() },
      anexos: { miniatura: vi.fn(), conteudo: vi.fn() },
      comprovantes: { listar: vi.fn(), receber: vi.fn(), rascunhos: { listar: vi.fn(), obter: vi.fn(), conteudo: vi.fn(), miniatura: vi.fn() } },
    },
  };
});
import { auth, financeiro, vault } from "@/lib/api";
import { enfileirarComprovantes, limparFilaDeComprovantes, quantosEsperando } from "@/lib/fila-comprovantes";
import { VaultWorkspace } from "./VaultScreen";

const perfil = { id: "u1", nome_usuario: "ana", nome: "Ana", cofre_ativado: true, avatar_atualizado_em: null, equipes: [], papel: "usuario", deve_trocar_senha: false, termos_pendente: false, termos_versao: "1" };

beforeEach(() => {
  vi.clearAllMocks();
  limparFilaDeComprovantes();
  Element.prototype.scrollIntoView = vi.fn(); // jsdom não implementa; o menu do Cofre centraliza o item atual
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:t"), revokeObjectURL: vi.fn() }));
  vi.mocked(auth.perfil).mockResolvedValue(perfil as never);
  vi.mocked(financeiro.painel).mockReturnValue(new Promise(() => { /* painel nunca termina: só importa a navegação */ }));
  vi.mocked(vault.categorias.listar).mockResolvedValue([]);
  vi.mocked(vault.beneficiarios.listar).mockResolvedValue([]);
  vi.mocked(vault.contas.listar).mockResolvedValue([]);
  vi.mocked(vault.comprovantes.listar).mockResolvedValue({ items: [] });
  vi.mocked(vault.comprovantes.rascunhos.listar).mockResolvedValue({ items: [] });
  vi.mocked(vault.comprovantes.receber).mockResolvedValue({ id: "r1", nome_arquivo: "pix.pdf", mime_type: "application/pdf", tamanho_bytes: 5, reaproveitado: false, ja_anexado_em: null, ocr_status: "processando" });
  vi.mocked(vault.comprovantes.rascunhos.obter).mockResolvedValue({ id: "r1", nome_arquivo: "pix.pdf", mime_type: "application/pdf", tamanho_bytes: 5, criado_em: "2026-10-02 10:00:00", ocr_status: "indisponivel", tem_miniatura: false });
});

const tela = () => (
  <MemoryRouter initialEntries={["/cofre"]}>
    <AuthProvider><RefreshProvider><AppUIProvider><VaultWorkspace /></AppUIProvider></RefreshProvider></AuthProvider>
  </MemoryRouter>
);
const pdf = () => new File(["%PDF-"], "pix.pdf", { type: "application/pdf" });

it("com o Cofre aberto no Painel, um comprovante que chega leva direto à aba Comprovantes e é enviado para revisão", async () => {
  render(tela());
  await screen.findByLabelText("Navegação do Cofre"); // é um <aside>, não role=navigation
  expect(screen.queryByLabelText("Buscar comprovante")).toBeNull();
  const arquivo = pdf();
  act(() => { enfileirarComprovantes([arquivo]); });
  await screen.findByLabelText("Buscar comprovante");
  await screen.findByRole("dialog", { name: "Revisar comprovante" });
  expect(vault.comprovantes.receber).toHaveBeenCalledWith(arquivo);
  expect(quantosEsperando()).toBe(0);
});

it("comprovante que já esperava (Cofre estava trancado) é enviado assim que o Cofre abre", async () => {
  enfileirarComprovantes([pdf()]);
  render(tela());
  await screen.findByRole("dialog", { name: "Revisar comprovante" });
  await waitFor(() => expect(vault.comprovantes.receber).toHaveBeenCalledOnce());
  expect(quantosEsperando()).toBe(0);
});
