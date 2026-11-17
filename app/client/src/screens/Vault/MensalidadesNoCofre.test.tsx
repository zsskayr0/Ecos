import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
    equipes: { ...o.equipes, listarMinhas: vi.fn() },
    avatarPerfil: { ...o.avatarPerfil, obter: vi.fn() },
    vault: {
      ...o.vault, config: vi.fn(), bloquear: vi.fn(), categorias: { listar: vi.fn() }, transacoes: { listar: vi.fn() },
      mensalidades: { ...o.vault.mensalidades, listar: vi.fn(), obter: vi.fn(), reajustar: vi.fn() },
    },
    financeiro: { ...o.financeiro, painel: vi.fn(), ocorrencias: vi.fn(), concluir: vi.fn(), lote: vi.fn(), reagendar: vi.fn(), pendencias: { listar: vi.fn(), converter: vi.fn(), excluir: vi.fn(), criar: vi.fn() } },
  };
});
import { ApiError, auth, avatarPerfil, equipes, financeiro, vault, type MensalidadeDetalheApi, type ReajusteApi } from "@/lib/api";
import { hojeISO } from "@/lib/format";
import { VaultScreen } from "./VaultScreen";
import { VaultWorkflow } from "./VaultWorkflow";

const perfil = { id: "u1", nome_usuario: "ana", nome: "Ana Souza", cofre_ativado: true, avatar_atualizado_em: null, equipes: [], papel: "usuario", deve_trocar_senha: false, termos_pendente: false, termos_versao: "1" };
const contrato: MensalidadeDetalheApi = {
  recorrencia_id: "r1", descricao: "Mensalidade", ativa: true, beneficiario_id: "b1", beneficiario_nome: "Ana Souza", valor_atual_centavos: 350000,
  data_base: "2024-11-20", ciclos_desde: "2026-01-01", percentual_minimo_bp: 1000, aviso_dias: 30, ciclos_sem_decisao: 1,
  ciclo_em_foco: { ciclo: "2026-11-20", estado: "atrasado", limite_aviso: "2026-10-21", valor_minimo_centavos: 385000, perda_estimada_centavos: 35000, reajuste: null },
  ciclos: [{ ciclo: "2026-11-20", estado: "atrasado", limite_aviso: "2026-10-21", valor_minimo_centavos: 385000, perda_estimada_centavos: 35000, reajuste: null }],
};
const mantido: ReajusteApi = {
  id: "novo", ciclo: "2026-11-20", regra: "mantido", valor_anterior_centavos: 350000, valor_novo_centavos: 350000, percentual_bp: 0, igpm_bp: null,
  aviso_em: "2026-11-15", vigente_desde: "2026-11-20", vigencia_minima: "2026-11-20", perda_centavos: 0, motivo: "x", criado_por: "u1", criado_em: null,
};
const recusa = () => new ApiError("MENSALIDADE_REAJUSTE_PENDENTE", "Há reajuste sem decisão.", 409, undefined, undefined, { recorrencia_id: "r1", ciclo: "2026-11-20" });

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
  vi.mocked(financeiro.ocorrencias).mockResolvedValue([]);
  vi.mocked(financeiro.pendencias.listar).mockResolvedValue([]);
  vi.mocked(vault.mensalidades.listar).mockResolvedValue([contrato]);
  vi.mocked(vault.mensalidades.obter).mockResolvedValue(contrato);
  vi.mocked(vault.mensalidades.reajustar).mockResolvedValue(mantido);
});

const comProvedores = (ui: React.ReactNode, rota = "/cofre") => render(<MemoryRouter initialEntries={[rota]}><AuthProvider><RefreshProvider><AppUIProvider>{ui}</AppUIProvider></RefreshProvider></AuthProvider></MemoryRouter>);

it("Mensalidades está no menu do Cofre (e no 'Mais' do celular) e abre a própria tela, sem o cabeçalho genérico", async () => {
  comProvedores(<VaultScreen voltar={vi.fn()} />, "/cofre/mensalidades");
  // O selo com a contagem de ciclos sem decisão vai junto no nome do item.
  const item = await screen.findByRole("button", { name: "Mensalidades, 1 reajuste esperando decisão" });
  expect(item.getAttribute("aria-current")).toBe("page");
  expect(item.hasAttribute("data-mais")).toBe(true);
  expect(item.querySelector(".cofre-nav-selo")?.textContent).toBe("1");
  expect(screen.getByRole("button", { name: "Mais opções" }).querySelector(".cofre-nav-selo")?.textContent).toBe("1");
  expect(await screen.findByRole("article", { name: "Aviso atrasado de Ana Souza" })).toBeTruthy();
  expect(screen.getAllByRole("heading", { level: 1, name: "Mensalidades" })).toHaveLength(1);
});

it("Painel do Cofre: faixa com os reajustes esperando decisão e a perda, que leva à seção; uma consulta só ao abrir", async () => {
  vi.mocked(financeiro.painel).mockResolvedValue({ saldo: 0, receitas: 0, despesas: 0, taxa_economia: null, mensal: false, series: [], categorias: [], pagamentos: [], maiores_entradas: [], maiores_saidas: [], previsoes: [] });
  comProvedores(<VaultScreen voltar={vi.fn()} />, "/cofre/painel");
  const faixa = await screen.findByText("1 reajuste de mensalidade esperando sua decisão");
  expect(faixa.parentElement!.textContent).toContain("Perda estimada se avisar hoje: R$ 350,00");
  // Trocar de seção não consulta de novo.
  fireEvent.click(screen.getByRole("button", { name: "Categorias" }));
  fireEvent.click(screen.getByRole("button", { name: "Painel" }));
  fireEvent.click(await screen.findByRole("button", { name: /Ver mensalidades/ }));
  expect(await screen.findByRole("article", { name: "Aviso atrasado de Ana Souza" })).toBeTruthy();
  // Uma do Cofre ao abrir e uma da própria tela de Mensalidades.
  expect(vault.mensalidades.listar).toHaveBeenCalledTimes(2);
});

it("sem pendência (ou sem resposta), o menu não tem selo e o Painel não tem faixa", async () => {
  vi.mocked(financeiro.painel).mockResolvedValue({ saldo: 0, receitas: 0, despesas: 0, taxa_economia: null, mensal: false, series: [], categorias: [], pagamentos: [], maiores_entradas: [], maiores_saidas: [], previsoes: [] });
  vi.mocked(vault.mensalidades.listar).mockRejectedValue(new ApiError("CONFLICT", "O Cofre está numa versão anterior do esquema; Mensalidades fica indisponível até a atualização.", 409));
  comProvedores(<VaultScreen voltar={vi.fn()} />, "/cofre/painel");
  expect(await screen.findByRole("button", { name: "Mensalidades" })).toBeTruthy();
  await waitFor(() => expect(vault.mensalidades.listar).toHaveBeenCalled());
  expect(document.querySelector(".cofre-nav-selo")).toBeNull();
  expect(screen.queryByText(/esperando sua decisão/)).toBeNull();
  expect(screen.queryByRole("alert")).toBeNull();
});

it("Fluxo: concluir uma ocorrência barrada abre o diálogo do reajuste e, resolvido, conclui", async () => {
  const hoje = hojeISO();
  vi.mocked(financeiro.ocorrencias).mockResolvedValue([{ recorrencia_id: "r1", data: hoje, tipo: "entrada", descricao: "Mensalidade Ana", valor_centavos: 350000 }]);
  vi.mocked(financeiro.concluir).mockRejectedValueOnce(recusa()).mockResolvedValueOnce({ transacao_id: "t1" });
  comProvedores(<VaultWorkflow recarregar={0} atualizar={vi.fn()} />);
  fireEvent.click((await screen.findAllByRole("button", { name: /Mensalidade Ana/ }))[0]!);
  fireEvent.click(screen.getByRole("button", { name: "Concluir na data" }));

  const d = await screen.findByRole("dialog", { name: "Reajuste pendente" });
  expect(screen.queryByRole("alert")).toBeNull();
  fireEvent.click(await within(d).findByRole("button", { name: "Manter valor" }));
  const m = await screen.findByRole("dialog", { name: "Manter valor" });
  await waitFor(() => expect(within(m).getByLabelText("Prévia do reajuste").textContent).toContain("Valor mantido"));
  fireEvent.change(within(m).getByLabelText("Motivo"), { target: { value: "Reajustado em agosto" } });
  fireEvent.click(within(m).getAllByRole("button", { name: "Manter valor" }).at(-1)!);
  await waitFor(() => expect(financeiro.concluir).toHaveBeenCalledTimes(2));
  expect(vault.mensalidades.reajustar).toHaveBeenLastCalledWith("r1", expect.objectContaining({ modo: "mantido", motivo: "Reajustado em agosto", simular: false }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

it("Fluxo: 'Concluir lançamento' barrado também abre o diálogo", async () => {
  const hoje = hojeISO();
  vi.mocked(vault.transacoes.listar).mockResolvedValue({ items: [{ id: "t9", tipo: "entrada", valor_centavos: 350000, data: hoje, descricao: "Mensalidade Ana", status: "pendente" } as never], next_cursor: null });
  vi.mocked(financeiro.lote).mockRejectedValue(recusa());
  comProvedores(<VaultWorkflow recarregar={0} atualizar={vi.fn()} />);
  fireEvent.click((await screen.findAllByRole("button", { name: "Concluir lançamento" }))[0]!);
  expect(await screen.findByRole("dialog", { name: "Reajuste pendente" })).toBeTruthy();
});
