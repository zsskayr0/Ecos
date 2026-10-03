import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { RefreshProvider } from "@/lib/refresh-bus";
import { AppUIProvider } from "@/lib/ui-context";
import { AuthProvider } from "@/lib/auth-context";

vi.mock("@/lib/api", async (importOriginal) => {
  const o = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...o,
    auth: { ...o.auth, perfil: vi.fn() },
    equipes: { ...o.equipes, listarMinhas: vi.fn(), listarMembros: vi.fn() },
    avatarPerfil: { ...o.avatarPerfil, obter: vi.fn() },
    financeiro: { ...o.financeiro, lote: vi.fn() },
    vault: {
      ...o.vault,
      busca: vi.fn(),
      beneficiarios: { listar: vi.fn() },
      transacoes: { listar: vi.fn() },
      anexos: { listar: vi.fn(), enviar: vi.fn(), conteudo: vi.fn(), miniatura: vi.fn() },
    },
  };
});
import { auth, avatarPerfil, equipes, vault, type CategoriaApi, type TransacaoApi } from "@/lib/api";
import { VaultTransactions } from "./VaultTransactions";
import { defaultPeriod } from "./nexus/period";

const base = { moeda: "BRL", conta_id: null, forma_pagamento: "pix", status: "efetivada" as const, observacoes: null, origem: "manual", espaco: "equipe:eq1", criado_em: "2026-09-30", atualizado_em: "2026-09-30", tipo: "saida" as const, valor_centavos: 1000, data: "2026-09-30", anexos: 0, notas_fiscais: 0 };
const tx = (id: string, descricao: string, extra: Partial<TransacaoApi> = {}): TransacaoApi => ({ ...base, id, descricao, categoria_id: "cat1", beneficiario_id: null, criado_por: "u1", ...extra });
const linhas = [
  tx("t1", "Mercado", { beneficiario_id: "b1", criado_por: "u2" }),
  tx("t2", "Açaí da esquina", { valor_centavos: 2500 }),
  tx("t3", "Aluguel", { valor_centavos: 120000, beneficiario_id: "b1" }),
  tx("t4", "Farmácia", { valor_centavos: 3000, tipo: "entrada" }),
];
const categorias: CategoriaApi[] = [{ id: "cat1", nome: "Alimentação", tipo: "saida", icone: "ShoppingCart", cor: "#86d7ad", padrao: false, espaco: "pessoal" }];
const perfil = { id: "u1", nome_usuario: "ana", nome: "Ana", cofre_ativado: true, avatar_atualizado_em: null, equipes: [], papel: "usuario", deve_trocar_senha: false, termos_pendente: false, termos_versao: "1" };

function tela(extra: Partial<React.ComponentProps<typeof VaultTransactions>> = {}, oculta = false) {
  const abrir = vi.fn();
  const atualizar = vi.fn();
  const r = render(
    <AuthProvider><RefreshProvider><AppUIProvider>
      <div className="cofre-app" hidden={oculta}>
        <VaultTransactions recarregar={0} periodo={{ data_de: "2026-09-01", data_ate: "2026-09-30" }} period={defaultPeriod()} onPeriodChange={vi.fn()} filtro={{}} categorias={categorias} abrir={abrir} atualizar={atualizar} {...extra} />
      </div>
    </AppUIProvider></RefreshProvider></AuthProvider>,
  );
  return { abrir, atualizar, ...r };
}
const linha = (nome: string) => screen.getByText(nome).closest(".cofre-transaction-list-row") as HTMLElement;
const caixa = (nome: string) => within(linha(nome)).getByRole("checkbox", { name: `Selecionar ${nome}` });
const marcadas = () => document.querySelectorAll('.cofre-caixa[data-marcada]').length;

beforeEach(() => {
  vi.clearAllMocks();
  try { localStorage.clear(); } catch { /* sem armazenamento */ }
  window.matchMedia = vi.fn((q: string) => ({ matches: false, media: q, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), onchange: null, dispatchEvent: vi.fn() })) as unknown as typeof window.matchMedia;
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:t"), revokeObjectURL: vi.fn() }));
  vi.mocked(auth.perfil).mockResolvedValue(perfil as never);
  vi.mocked(equipes.listarMinhas).mockResolvedValue([]);
  vi.mocked(avatarPerfil.obter).mockResolvedValue(null);
  vi.mocked(vault.transacoes.listar).mockResolvedValue({ items: linhas, next_cursor: null });
  vi.mocked(vault.beneficiarios.listar).mockResolvedValue([{ id: "b1", nome: "Supermercado Bom Preço", documento: null, observacoes: null }]);
  vi.mocked(vault.busca).mockResolvedValue({ items: [] });
  vi.mocked(vault.anexos.listar).mockResolvedValue([]);
});

it("a caixa de seleção é a do Ecos (botão), nunca a nativa, e a lista começa fora do modo de seleção", async () => {
  tela();
  await screen.findByText("Mercado");
  expect(document.querySelectorAll('.cofre-transactions input[type="checkbox"]')).toHaveLength(0);
  expect(caixa("Mercado").getAttribute("aria-checked")).toBe("false");
  expect(document.querySelector(".cofre-transactions-card")!.hasAttribute("data-selecionando")).toBe(false);
  expect(document.querySelector(".cofre-selection-bar")).toBeNull();
});

it("marcar a caixa seleciona sem abrir o lançamento; entra no modo de seleção; Esc sai", async () => {
  const { abrir } = tela();
  await screen.findByText("Mercado");
  fireEvent.click(caixa("Mercado"));
  expect(abrir).not.toHaveBeenCalled();
  expect(caixa("Mercado").getAttribute("aria-checked")).toBe("true");
  expect(screen.getByText("1 selecionado")).toBeTruthy();
  expect(document.querySelector(".cofre-transactions-card")!.hasAttribute("data-selecionando")).toBe(true);
  fireEvent.keyDown(window, { key: "Escape" });
  expect(marcadas()).toBe(0);
  expect(screen.queryByText("1 selecionado")).toBeNull();
  expect(document.querySelector(".cofre-transactions-card")!.hasAttribute("data-selecionando")).toBe(false);
});

it("Ctrl+A seleciona tudo o que está na lista, e não rouba o Ctrl+A de quem digita na busca", async () => {
  tela();
  await screen.findByText("Mercado");
  const busca = screen.getByLabelText("Buscar transação");
  busca.focus();
  const digitando = fireEvent.keyDown(busca, { key: "a", ctrlKey: true });
  expect(digitando).toBe(true); // não foi cancelado: o campo trata o atalho
  expect(marcadas()).toBe(0);
  (document.activeElement as HTMLElement).blur();
  const livre = fireEvent.keyDown(document.body, { key: "a", ctrlKey: true });
  expect(livre).toBe(false); // foi tratado (cancelado)
  expect(marcadas()).toBe(4);
  expect(screen.getByText("4 selecionados")).toBeTruthy();
  fireEvent.keyDown(window, { key: "Escape" });
  expect(marcadas()).toBe(0);
});

it("Ctrl+clique alterna a linha sem abrir; Shift+clique seleciona a faixa; com seleção ativa, clicar na linha alterna em vez de abrir", async () => {
  const { abrir } = tela();
  await screen.findByText("Mercado");
  fireEvent.click(linha("Mercado"), { ctrlKey: true });
  expect(abrir).not.toHaveBeenCalled();
  expect(marcadas()).toBe(1);
  fireEvent.click(linha("Aluguel"), { shiftKey: true }); // do Mercado até o Aluguel: 3 linhas
  expect(marcadas()).toBe(3);
  fireEvent.click(linha("Açaí da esquina"), { ctrlKey: true }); // tira uma do meio
  expect(marcadas()).toBe(2);
  fireEvent.click(linha("Farmácia")); // clique simples, mas já há seleção: marca
  expect(abrir).not.toHaveBeenCalled();
  expect(marcadas()).toBe(3);
  fireEvent.keyDown(window, { key: "Escape" });
  fireEvent.click(linha("Farmácia")); // sem seleção, clique simples abre
  expect(abrir).toHaveBeenCalledWith("t4");
});

it("Ctrl+A e Esc não valem numa aba escondida (o desktop mantém as abas inativas montadas)", async () => {
  const { rerender } = tela({}, false);
  await screen.findByText("Mercado");
  fireEvent.click(caixa("Mercado"));
  rerender(
    <AuthProvider><RefreshProvider><AppUIProvider>
      <div className="cofre-app" hidden>
        <VaultTransactions recarregar={0} periodo={{ data_de: "2026-09-01", data_ate: "2026-09-30" }} period={defaultPeriod()} onPeriodChange={vi.fn()} filtro={{}} categorias={categorias} abrir={vi.fn()} atualizar={vi.fn()} />
      </div>
    </AppUIProvider></RefreshProvider></AuthProvider>,
  );
  fireEvent.keyDown(window, { key: "Escape" });
  expect(marcadas()).toBe(1);
  expect(fireEvent.keyDown(document.body, { key: "a", ctrlKey: true })).toBe(true); // não foi tratado: o atalho não é desta aba
});

it("Esc e Ctrl+A não valem com uma janela aberta por cima", async () => {
  tela();
  await screen.findByText("Mercado");
  fireEvent.click(caixa("Mercado"));
  const janela = document.createElement("div");
  janela.setAttribute("aria-modal", "true");
  document.body.appendChild(janela);
  fireEvent.keyDown(window, { key: "Escape" });
  expect(marcadas()).toBe(1);
  janela.remove();
});

it("o nome sob a descrição é o pagador (ou 'Sem pagador'), e o ícone é o da categoria, não a primeira letra", async () => {
  tela();
  await screen.findByText("Mercado");
  expect(linha("Mercado").querySelector(".cofre-transaction-description small")!.textContent).toBe("Supermercado Bom Preço");
  expect(linha("Açaí da esquina").querySelector(".cofre-transaction-description small")!.textContent).toBe("Sem pagador");
  const icone = linha("Mercado").querySelector(".cofre-row-lead .cofre-cats-icon")!;
  expect(icone.querySelector("svg")).not.toBeNull();
  expect(icone.textContent).toBe("");
});

it("em Cofre pessoal não há coluna de quem lançou", async () => {
  tela();
  await screen.findByText("Mercado");
  expect(document.querySelector(".cofre-autor")).toBeNull();
  expect(document.querySelector(".cofre-transactions-card")!.hasAttribute("data-autoria")).toBe(false);
});

it("no Cofre de uma equipe, depois do status, vem o círculo de quem lançou, com o nome na dica", async () => {
  localStorage.setItem("ecos:espaco-ativo", "equipe:eq1");
  vi.mocked(equipes.listarMinhas).mockResolvedValue([{ id: "eq1", nome: "CRBS", cargo: "admin", tipo: "time" as never, membros: 2 }]);
  vi.mocked(equipes.listarMembros).mockResolvedValue([{ usuario_id: "u1", cargo: "admin", nome: "Ana Souza" }, { usuario_id: "u2", cargo: "membro", nome: "Bruno Lima" }]);
  tela();
  await screen.findByText("Mercado");
  await waitFor(() => expect(document.querySelectorAll(".cofre-autor[title^='Lançado por']")).toHaveLength(4));
  const filhos = Array.from(linha("Mercado").children);
  const status = filhos.findIndex((el) => el.classList.contains("cofre-status"));
  expect(filhos[status + 1]!.classList.contains("cofre-autor")).toBe(true);
  expect(linha("Mercado").querySelector(".cofre-autor")!.getAttribute("title")).toBe("Lançado por Bruno Lima");
  expect(linha("Aluguel").querySelector(".cofre-autor")!.getAttribute("title")).toBe("Lançado por Ana Souza");
});

it("recarregar depois de concluir/anexar troca os dados no lugar: a lista NÃO é esvaziada (a tela não volta ao topo)", async () => {
  tela();
  await screen.findByText("Mercado");
  let liberar!: (v: { items: TransacaoApi[]; next_cursor: null }) => void;
  vi.mocked(vault.transacoes.listar).mockImplementationOnce(() => new Promise((r) => { liberar = r; }));
  fireEvent.click(screen.getByRole("button", { name: /Atualizar/ }));
  await waitFor(() => expect(vault.transacoes.listar).toHaveBeenCalledTimes(2));
  // Com a resposta ainda pendente, as linhas continuam na tela e não aparece "Carregando".
  expect(screen.getByText("Mercado")).toBeTruthy();
  expect(screen.queryByText("Carregando lançamentos…")).toBeNull();
  await act(async () => { liberar({ items: [{ ...linhas[0]!, descricao: "Mercado atualizado" }, ...linhas.slice(1)], next_cursor: null }); });
  expect(await screen.findByText("Mercado atualizado")).toBeTruthy();
});

it("a seleção sobrevive à recarga, só perde o que sumiu", async () => {
  tela();
  await screen.findByText("Mercado");
  fireEvent.click(caixa("Mercado"));
  fireEvent.click(caixa("Aluguel"));
  expect(marcadas()).toBe(2);
  vi.mocked(vault.transacoes.listar).mockResolvedValue({ items: linhas.filter((t) => t.id !== "t3"), next_cursor: null });
  fireEvent.click(screen.getByRole("button", { name: /Atualizar/ }));
  await waitFor(() => expect(screen.queryByText("Aluguel")).toBeNull());
  expect(screen.getByText("1 selecionado")).toBeTruthy();
});

it("a recarga traz de volta tantas páginas quantas já estavam na tela", async () => {
  const pagina1 = Array.from({ length: 3 }, (_, i) => tx(`p${i}`, `Item ${i}`));
  const pagina2 = Array.from({ length: 2 }, (_, i) => tx(`q${i}`, `Outro ${i}`));
  vi.mocked(vault.transacoes.listar).mockResolvedValueOnce({ items: pagina1, next_cursor: "c1" });
  tela();
  await screen.findByText("Item 0");
  vi.mocked(vault.transacoes.listar).mockResolvedValueOnce({ items: pagina2, next_cursor: null });
  fireEvent.click(screen.getByRole("button", { name: "Carregar mais" }));
  await screen.findByText("Outro 1");
  vi.mocked(vault.transacoes.listar).mockReset();
  vi.mocked(vault.transacoes.listar).mockResolvedValueOnce({ items: pagina1, next_cursor: "c1" }).mockResolvedValueOnce({ items: pagina2, next_cursor: null });
  fireEvent.click(screen.getByRole("button", { name: /Atualizar/ }));
  await waitFor(() => expect(vault.transacoes.listar).toHaveBeenCalledTimes(2));
  expect(vi.mocked(vault.transacoes.listar).mock.calls[1]![0]).toMatchObject({ cursor: "c1" });
  expect(await screen.findByText("Outro 1")).toBeTruthy();
});

it("a busca ignora acento na hora e soma o que o Cofre achou por semelhança ou pelo texto do comprovante", async () => {
  tela();
  await screen.findByText("Mercado");
  const busca = screen.getByLabelText("Buscar transação");
  fireEvent.change(busca, { target: { value: "acai" } });
  expect(screen.getByText("Açaí da esquina")).toBeTruthy();
  expect(screen.queryByText("Mercado")).toBeNull();

  // Palavra com erro de digitação: o filtro simples não acha, o Cofre acha (e avisa que foi dentro do comprovante).
  vi.mocked(vault.busca).mockResolvedValue({ items: [{ id: "t4", pontuacao: 1, so_no_anexo: true }] });
  fireEvent.change(busca, { target: { value: "farmasia" } });
  expect(await screen.findByText("Farmácia")).toBeTruthy();
  expect(vault.busca).toHaveBeenCalledWith("farmasia", { data_de: "2026-09-01", data_ate: "2026-09-30" });
  expect(await screen.findByText("achado no comprovante")).toBeTruthy();
  expect(screen.queryByText("Mercado")).toBeNull();

  fireEvent.change(busca, { target: { value: "zzzz" } });
  vi.mocked(vault.busca).mockResolvedValue({ items: [] });
  expect(await screen.findByText("Nada encontrado para “zzzz”.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Limpar busca" }));
  expect(await screen.findByText("Mercado")).toBeTruthy();
});
