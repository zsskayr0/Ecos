import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { perfil, config } = vi.hoisted(() => ({ perfil: vi.fn(), config: vi.fn() }));

vi.mock("@/lib/api", async () => {
  const real = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...real, auth: { ...real.auth, perfil }, vault: { ...real.vault, config } };
});
vi.mock("@/lib/ui-context", () => ({ useAppUI: () => ({ espacoAtivo: "pessoal" }) }));
vi.mock("@/lib/use-minhas-equipes", () => ({ useMinhasEquipes: () => ({ equipes: [] }) }));
vi.mock("@/lib/auth-context", async () => {
  const real = await vi.importActual<typeof import("@/lib/auth-context")>("@/lib/auth-context");
  return { ...real, useAuth: () => ({ perfil: null }) };
});
vi.mock("@/lib/exibicao-valores", () => ({ useMoeda: () => "BRL" }));
vi.mock("@/lib/fila-comprovantes", () => ({ useComprovantesEsperando: () => 0 }));
vi.mock("@/lib/cofre-lembrado", () => ({
  bloqueioManual: () => false, chaveDoCofre: () => "k", esquecerSenha: async () => {}, lembradaExigeConfirmacao: () => false,
  lembrarSenha: async () => {}, lembrarSenhaSuportado: async () => false, lerSenhaLembrada: async () => null,
  temSenhaLembrada: async () => false, limparBloqueioManual: () => {}, marcarBloqueioManual: () => {},
}));
vi.mock("./VaultLockScreen", () => ({ VaultLockScreen: () => <div>TELA DE SENHA</div> }));

import { ApiError } from "@/lib/api";
import { VaultScreen } from "./VaultScreen";

const abrir = () => render(<MemoryRouter><VaultScreen voltar={() => {}} embedded /></MemoryRouter>);

beforeEach(() => vi.clearAllMocks());

describe("Cofre — falha de conexão x bloqueado", () => {
  it("sem servidor mostra erro de conexão e não pede a senha", async () => {
    perfil.mockRejectedValue(new ApiError("CONEXAO_INDISPONIVEL", "Não foi possível conectar ao servidor Ecos.", 0));
    abrir();
    expect(await screen.findByText("Sem conexão com o servidor")).toBeTruthy();
    expect(screen.queryByText("TELA DE SENHA")).toBeNull();
  });

  it("com o servidor respondendo que está bloqueado, mostra a tela de senha", async () => {
    perfil.mockResolvedValue({ cofre_ativado: true });
    config.mockResolvedValue({ cofre_ativado: true, destrancado: false, saldos_por_conta: [] });
    abrir();
    expect(await screen.findByText("TELA DE SENHA")).toBeTruthy();
    expect(screen.queryByText("Sem conexão com o servidor")).toBeNull();
  });

  it("tentar novamente refaz a verificação e chega à tela de senha quando o servidor volta", async () => {
    perfil.mockRejectedValueOnce(new ApiError("CONEXAO_INDISPONIVEL", "Não foi possível conectar ao servidor Ecos.", 0));
    perfil.mockResolvedValue({ cofre_ativado: true });
    config.mockResolvedValue({ cofre_ativado: true, destrancado: false, saldos_por_conta: [] });
    abrir();
    fireEvent.click(await screen.findByRole("button", { name: /Tentar novamente/ }));
    await waitFor(() => expect(screen.getByText("TELA DE SENHA")).toBeTruthy());
  });
});
