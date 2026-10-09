import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { RefreshProvider } from "@/lib/refresh-bus";
import { AppUIProvider } from "@/lib/ui-context";
import { AuthProvider } from "@/lib/auth-context";

const lembrado = vi.hoisted(() => ({
  suportado: vi.fn(),
  ler: vi.fn(),
  lembrar: vi.fn(),
  esquecer: vi.fn(),
  manual: vi.fn(),
  marcar: vi.fn(),
  limpar: vi.fn(),
}));
vi.mock("@/lib/cofre-lembrado", () => ({
  chaveDoCofre: (usuario: string, espaco: string) => `http://srv|${usuario}|${espaco}`,
  lembrarSenhaSuportado: () => lembrado.suportado(),
  lembradaExigeConfirmacao: () => false,
  lerSenhaLembrada: (k: string) => lembrado.ler(k),
  lembrarSenha: (k: string, s: string) => lembrado.lembrar(k, s),
  esquecerSenha: (k: string) => lembrado.esquecer(k),
  bloqueioManual: (k: string) => lembrado.manual(k),
  marcarBloqueioManual: (k: string) => lembrado.marcar(k),
  limparBloqueioManual: (k: string) => lembrado.limpar(k),
  esquecerSenhasDaConta: vi.fn().mockResolvedValue(undefined),
  temSenhaLembrada: vi.fn().mockResolvedValue(false),
}));
vi.mock("@/lib/api", async (importOriginal) => {
  const o = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...o,
    auth: { ...o.auth, perfil: vi.fn() },
    financeiro: { ...o.financeiro, painel: vi.fn() },
    vault: { ...o.vault, config: vi.fn(), desbloquear: vi.fn(), bloquear: vi.fn(), categorias: { listar: vi.fn() } },
  };
});
import { ApiError, auth, financeiro, vault } from "@/lib/api";
import { VaultScreen } from "./VaultScreen";

const perfil = { id: "u1", nome_usuario: "ana", nome: "Ana", cofre_ativado: true, avatar_atualizado_em: null, equipes: [], papel: "usuario", deve_trocar_senha: false, termos_pendente: false, termos_versao: "1" };
const trancado = { cofre_ativado: true, destrancado: false, saldos_por_conta: [] };
const aberto = { cofre_ativado: true, destrancado: true, saldos_por_conta: [] };

const tela = () => (
  <MemoryRouter initialEntries={["/cofre"]}>
    <AuthProvider><RefreshProvider><AppUIProvider><VaultScreen voltar={vi.fn()} /></AppUIProvider></RefreshProvider></AuthProvider>
  </MemoryRouter>
);
const CHAVE = "http://srv|u1|pessoal";

/** Servidor de mentira: começa trancado e abre quando recebe `desbloquear`. */
function servidorTrancado() {
  let destrancado = false;
  vi.mocked(vault.config).mockImplementation(async () => (destrancado ? aberto : trancado));
  vi.mocked(vault.desbloquear).mockImplementation(async () => { destrancado = true; return { ok: true }; });
}

beforeEach(() => {
  vi.clearAllMocks();
  Element.prototype.scrollIntoView = vi.fn();
  lembrado.suportado.mockResolvedValue(true);
  lembrado.ler.mockResolvedValue(null);
  lembrado.lembrar.mockResolvedValue(true);
  lembrado.esquecer.mockResolvedValue(undefined);
  lembrado.manual.mockReturnValue(false);
  vi.mocked(auth.perfil).mockResolvedValue(perfil as never);
  vi.mocked(financeiro.painel).mockReturnValue(new Promise(() => { /* só importa abrir o Cofre */ }));
  vi.mocked(vault.categorias.listar).mockResolvedValue([]);
});

it("servidor reiniciado + senha lembrada: o Cofre abre sozinho, sem digitar nada", async () => {
  lembrado.ler.mockResolvedValue("senha-lembrada");
  servidorTrancado();
  render(tela());
  await screen.findByLabelText("Navegação do Cofre");
  expect(vault.desbloquear).toHaveBeenCalledWith("senha-lembrada");
  expect(lembrado.ler).toHaveBeenCalledWith(CHAVE);
  expect(screen.queryByText("O Cofre está bloqueado")).toBeNull();
});

it("depois de “Bloquear” de propósito, a senha lembrada NÃO é usada: só a senha digitada abre", async () => {
  lembrado.manual.mockReturnValue(true);
  lembrado.ler.mockResolvedValue("senha-lembrada");
  vi.mocked(vault.config).mockResolvedValue(trancado);
  render(tela());
  await screen.findByText("O Cofre está bloqueado");
  expect(lembrado.ler).not.toHaveBeenCalled();
  expect(vault.desbloquear).not.toHaveBeenCalled();
});

it("sem senha lembrada: mostra a tela de senha como sempre", async () => {
  vi.mocked(vault.config).mockResolvedValue(trancado);
  render(tela());
  await screen.findByText("O Cofre está bloqueado");
  expect(vault.desbloquear).not.toHaveBeenCalled();
});

it("a senha lembrada ficou velha (senha do Cofre mudou): é esquecida e a pessoa é avisada", async () => {
  lembrado.ler.mockResolvedValue("senha-antiga");
  vi.mocked(vault.config).mockResolvedValue(trancado);
  vi.mocked(vault.desbloquear).mockRejectedValue(new ApiError("INVALID_CREDENTIALS", "Senha do Cofre incorreta.", 401));
  render(tela());
  await screen.findByText("O Cofre está bloqueado");
  await waitFor(() => expect(lembrado.esquecer).toHaveBeenCalledWith(CHAVE));
  expect((await screen.findByRole("alert")).textContent).toContain("A senha lembrada neste computador não funciona mais");
});

it("servidor fora do ar ao tentar abrir: a senha NÃO é apagada (só senha errada apaga)", async () => {
  lembrado.ler.mockResolvedValue("senha-lembrada");
  vi.mocked(vault.config).mockResolvedValue(trancado);
  vi.mocked(vault.desbloquear).mockRejectedValue(new ApiError("CONEXAO_INDISPONIVEL", "Sem conexão", 0));
  render(tela());
  await screen.findByText("O Cofre está bloqueado");
  expect(lembrado.esquecer).not.toHaveBeenCalled();
});

it("sessão expirada (401 que não é senha errada) também não apaga a senha lembrada", async () => {
  lembrado.ler.mockResolvedValue("senha-lembrada");
  vi.mocked(vault.config).mockResolvedValue(trancado);
  vi.mocked(vault.desbloquear).mockRejectedValue(new ApiError("UNAUTHORIZED", "Sua sessão expirou.", 401));
  render(tela());
  await screen.findByText("O Cofre está bloqueado");
  expect(lembrado.esquecer).not.toHaveBeenCalled();
});

it("desbloquear à mão marcando “Lembrar” guarda a senha e libera o desbloqueio automático", async () => {
  servidorTrancado();
  render(tela());
  await screen.findByText("O Cofre está bloqueado");
  fireEvent.change(screen.getByPlaceholderText("Senha do Cofre"), { target: { value: "minha-senha" } });
  expect((screen.getByLabelText(/Lembrar a senha neste computador/) as HTMLInputElement).checked).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Desbloquear" }));
  await screen.findByLabelText("Navegação do Cofre");
  expect(vault.desbloquear).toHaveBeenCalledWith("minha-senha");
  expect(lembrado.lembrar).toHaveBeenCalledWith(CHAVE, "minha-senha");
  expect(lembrado.limpar).toHaveBeenCalledWith(CHAVE);
});

it("desbloquear à mão DESMARCANDO “Lembrar” não guarda nada, mas tira o bloqueio manual", async () => {
  servidorTrancado();
  render(tela());
  await screen.findByText("O Cofre está bloqueado");
  fireEvent.change(screen.getByPlaceholderText("Senha do Cofre"), { target: { value: "minha-senha" } });
  fireEvent.click(screen.getByLabelText(/Lembrar a senha neste computador/));
  fireEvent.click(screen.getByRole("button", { name: "Desbloquear" }));
  await screen.findByLabelText("Navegação do Cofre");
  expect(lembrado.lembrar).not.toHaveBeenCalled();
  expect(lembrado.limpar).toHaveBeenCalledWith(CHAVE);
});

it("a opção de lembrar não aparece onde não há armazenamento seguro", async () => {
  lembrado.suportado.mockResolvedValue(false);
  vi.mocked(vault.config).mockResolvedValue(trancado);
  render(tela());
  await screen.findByText("O Cofre está bloqueado");
  expect(screen.queryByLabelText(/Lembrar a senha neste computador/)).toBeNull();
});

it("o botão Bloquear marca o bloqueio manual deste Cofre", async () => {
  vi.mocked(vault.config).mockResolvedValue(aberto);
  vi.mocked(vault.bloquear).mockImplementation(async () => { window.dispatchEvent(new Event("ecos:bloqueio-manual")); return { ok: true }; });
  render(tela());
  await screen.findByLabelText("Navegação do Cofre");
  act(() => { window.dispatchEvent(new Event("ecos:bloqueio-manual")); });
  expect(lembrado.marcar).toHaveBeenCalledWith(CHAVE);
});

it("o pedido de bloqueio da barra do desktop também marca como manual e tranca a tela", async () => {
  vi.mocked(vault.config).mockResolvedValue(aberto);
  lembrado.ler.mockResolvedValue("senha-lembrada");
  render(tela());
  await screen.findByLabelText("Navegação do Cofre");
  act(() => { window.dispatchEvent(new Event("ecos:solicitar-bloqueio")); });
  await screen.findByText("O Cofre está bloqueado");
  expect(lembrado.marcar).toHaveBeenCalledWith(CHAVE);
});
