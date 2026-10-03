import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { RefreshProvider, useRefreshBus } from "@/lib/refresh-bus";
import { AppUIProvider } from "@/lib/ui-context";
import { AuthProvider } from "@/lib/auth-context";

vi.mock("@/lib/api", async (importOriginal) => {
  const o = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...o,
    auth: { ...o.auth, perfil: vi.fn() },
    equipes: { ...o.equipes, listarMinhas: vi.fn() },
    avatarPerfil: { ...o.avatarPerfil, obter: vi.fn() },
    vault: { ...o.vault, config: vi.fn(), bloquear: vi.fn(), categorias: { listar: vi.fn() }, transacoes: { listar: vi.fn() } },
    financeiro: { ...o.financeiro, painel: vi.fn(), ocorrencias: vi.fn(), reagendar: vi.fn(), pendencias: { listar: vi.fn(), converter: vi.fn(), excluir: vi.fn(), criar: vi.fn() } },
  };
});
import { auth, avatarPerfil, equipes, vault, financeiro } from "@/lib/api";
import { VaultScreen } from "./VaultScreen";
import { VaultWorkflow } from "./VaultWorkflow";
import type { Painel } from "./types";

const painel: Painel = { saldo: 987654321, receitas: 0, despesas: 0, taxa_economia: null, mensal: false, series: [], categorias: [], pagamentos: [], maiores_entradas: [], maiores_saidas: [], previsoes: [] };
const perfil = { id: "u1", nome_usuario: "ana", nome: "Ana Souza", cofre_ativado: true, avatar_atualizado_em: null, equipes: [], papel: "usuario", deve_trocar_senha: false, termos_pendente: false, termos_versao: "1" };

beforeEach(() => {
  vi.clearAllMocks();
  try { localStorage.clear(); } catch { /* sem armazenamento */ }
  Element.prototype.scrollIntoView = vi.fn(); // o jsdom não tem
  window.matchMedia = vi.fn((q: string) => ({ matches: false, media: q, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), onchange: null, dispatchEvent: vi.fn() })) as unknown as typeof window.matchMedia;
  vi.mocked(auth.perfil).mockResolvedValue(perfil as never);
  vi.mocked(equipes.listarMinhas).mockResolvedValue([]);
  vi.mocked(avatarPerfil.obter).mockResolvedValue(null);
  vi.mocked(vault.config).mockResolvedValue({ cofre_ativado: true, destrancado: true, saldos_por_conta: [] });
  vi.mocked(vault.categorias.listar).mockResolvedValue([]);
  vi.mocked(vault.transacoes.listar).mockResolvedValue({ items: [], next_cursor: null });
  vi.mocked(financeiro.painel).mockResolvedValue(painel);
  vi.mocked(financeiro.ocorrencias).mockResolvedValue([]);
  vi.mocked(financeiro.pendencias.listar).mockResolvedValue([]);
});

function Notificar() {
  const { notificar } = useRefreshBus();
  return <button onClick={notificar}>__recarregar__</button>;
}
const cofre = () => render(
  <MemoryRouter initialEntries={["/cofre"]}><AuthProvider><RefreshProvider><AppUIProvider>
    <VaultScreen voltar={vi.fn()} />
    <Notificar />
  </AppUIProvider></RefreshProvider></AuthProvider></MemoryRouter>,
);
const menu = () => document.querySelector<HTMLElement>(".cofre-nav")!;

it("o menu lateral recolhe, vira só ícones com dica, lembra a escolha e expande de novo", async () => {
  const { unmount } = cofre();
  const recolher = await screen.findByRole("button", { name: "Recolher menu lateral" });
  expect(menu().hasAttribute("data-recolhido")).toBe(false);
  fireEvent.click(recolher);
  expect(menu().hasAttribute("data-recolhido")).toBe(true);
  expect(document.querySelector(".cofre-workspace")!.hasAttribute("data-recolhido")).toBe(true);
  expect(localStorage.getItem("ecos:cofre:menu-recolhido")).toBe("1");
  // Recolhido, cada botão ainda tem nome acessível e dica (o texto some só no CSS).
  expect(screen.getByRole("button", { name: "Transações" }).getAttribute("title")).toBe("Transações");
  expect(screen.getByRole("button", { name: "Comprovantes" }).getAttribute("title")).toBe("Comprovantes");
  expect(screen.getByRole("button", { name: "Expandir menu lateral" }).getAttribute("aria-expanded")).toBe("false");
  unmount();

  // Abrir o Cofre de novo: continua recolhido.
  cofre();
  const expandir = await screen.findByRole("button", { name: "Expandir menu lateral" });
  expect(menu().hasAttribute("data-recolhido")).toBe(true);
  fireEvent.click(expandir);
  expect(menu().hasAttribute("data-recolhido")).toBe(false);
  expect(localStorage.getItem("ecos:cofre:menu-recolhido")).toBe("0");
});

it("recolher o menu fecha o menu da conta que estivesse aberto", async () => {
  cofre();
  fireEvent.click(await screen.findByRole("button", { name: /Conta e equipe/ }));
  expect(screen.getByText("Trocar equipe")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Recolher menu lateral" }));
  expect(screen.queryByText("Trocar equipe")).toBeNull();
});

it("sem armazenamento disponível o menu ainda recolhe (só não lembra)", async () => {
  const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("cheio"); });
  try {
    cofre();
    fireEvent.click(await screen.findByRole("button", { name: "Recolher menu lateral" }));
    expect(menu().hasAttribute("data-recolhido")).toBe(true);
  } finally {
    set.mockRestore();
  }
});

it("recarregar o painel depois de mexer em algo troca os números no lugar: o painel NÃO vira esqueleto (a tela não volta ao topo)", async () => {
  cofre();
  await screen.findByText("Saldo total (histórico)");
  let liberar!: (p: Painel) => void;
  vi.mocked(financeiro.painel).mockImplementationOnce(() => new Promise((r) => { liberar = r; }));
  fireEvent.click(screen.getByText("__recarregar__"));
  await waitFor(() => expect(financeiro.painel).toHaveBeenCalledTimes(2));
  expect(screen.getByText("Saldo total (histórico)")).toBeTruthy();
  expect(screen.queryByText("Preparando seu painel…")).toBeNull();
  await act(async () => { liberar({ ...painel, saldo: 123456 }); });
  expect(await screen.findByText(/1\.234,56/)).toBeTruthy();
});

it("Fluxo: concluir ou recarregar não esvazia o quadro (nada de 'Carregando fluxo…' no meio da página)", async () => {
  vi.mocked(financeiro.pendencias.listar).mockResolvedValue([{ id: "p1", descricao: "Pendência teste", tipo: "saida", valor_centavos: 500 }]);
  render(<MemoryRouter><AuthProvider><RefreshProvider><AppUIProvider><VaultWorkflow recarregar={0} atualizar={vi.fn()} /></AppUIProvider></RefreshProvider></AuthProvider></MemoryRouter>);
  await screen.findByRole("button", { name: /Pendência teste/ });
  let liberar!: (v: never[]) => void;
  vi.mocked(financeiro.pendencias.listar).mockImplementationOnce(() => new Promise((r) => { liberar = r as never; }));
  fireEvent.click(screen.getByRole("button", { name: "Atualizar" }));
  await waitFor(() => expect(financeiro.pendencias.listar).toHaveBeenCalledTimes(2));
  expect(screen.getByRole("button", { name: /Pendência teste/ })).toBeTruthy();
  expect(screen.queryByText("Carregando fluxo…")).toBeNull();
  await act(async () => { liberar([]); });
  await waitFor(() => expect(screen.queryByRole("button", { name: /Pendência teste/ })).toBeNull());
});

it("Fluxo: o aviso 'Salvando alteração…' fica só para leitor de tela, sem empurrar o quadro para baixo", async () => {
  vi.mocked(financeiro.pendencias.listar).mockResolvedValue([{ id: "p1", descricao: "Pendência teste", tipo: "saida", valor_centavos: 500 }]);
  vi.mocked(financeiro.pendencias.converter).mockImplementation(() => new Promise(() => undefined));
  render(<MemoryRouter><AuthProvider><RefreshProvider><AppUIProvider><VaultWorkflow recarregar={0} atualizar={vi.fn()} /></AppUIProvider></RefreshProvider></AuthProvider></MemoryRouter>);
  fireEvent.click(await screen.findByRole("button", { name: /Pendência teste/ }));
  fireEvent.click(screen.getByRole("button", { name: "Concluir na data" }));
  const aviso = await screen.findByText("Salvando alteração…");
  expect(aviso.className).toContain("sr-only");
});
