import { act, createEvent, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

const avisar = vi.hoisted(() => vi.fn());
vi.mock("@/lib/toast", () => ({ avisar }));
vi.mock("@/lib/api", async (importOriginal) => {
  const o = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...o,
    vault: {
      ...o.vault,
      config: vi.fn(),
      contas: { listar: vi.fn(), criar: vi.fn(), atualizar: vi.fn(), excluir: vi.fn(), uso: vi.fn() },
      preferencias: { obter: vi.fn(), salvar: vi.fn(), salvarOrdem: vi.fn() },
      transacoes: { ...o.vault.transacoes, listar: vi.fn() },
    },
    financeiro: { ...o.financeiro, recorrencias: vi.fn() },
  };
});
import { vault, financeiro, type CategoriaApi, type ContaApi } from "@/lib/api";
import { VaultAccounts } from "./VaultAccounts";
import { VaultCategories } from "./VaultCategories";
import { AlcaOrdem, useOrdemPessoal } from "./ordem-pessoal";

const conta = (id: string, nome: string, extra: Partial<ContaApi> = {}): ContaApi => ({ id, nome, banco: null, agencia: null, numero_conta: null, cor: "#8a05be", padrao: false, espaco: "pessoal", tipo: "corrente", codigo_banco: null, saldo_inicial_centavos: 0, ...extra });
const categoria = (id: string, nome: string): CategoriaApi => ({ id, nome, tipo: "saida", icone: "Tag", cor: "#86d7ad", padrao: false, espaco: "pessoal" });
const periodo = { kind: "month", year: 2026, month: 9 } as const;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(vault.config).mockResolvedValue({ cofre_ativado: true, destrancado: true, saldos_por_conta: [] });
  vi.mocked(vault.transacoes.listar).mockResolvedValue({ items: [], next_cursor: null });
  vi.mocked(financeiro.recorrencias).mockResolvedValue([]);
  vi.mocked(vault.preferencias.salvar).mockResolvedValue({ ok: true });
  vi.mocked(vault.preferencias.salvarOrdem).mockResolvedValue({ ok: true });
});

const nomesDasContas = () => screen.getAllByRole("button", { name: /^Conta / }).map((b) => b.getAttribute("aria-label")!.replace("Conta ", ""));
const nomesDasCategorias = () => screen.getAllByRole("button", { name: /^Editar categoria / }).map((b) => b.getAttribute("aria-label")!.replace("Editar categoria ", ""));
/** O jsdom não repassa `clientY` aos eventos de arrastar: define na mão. */
const arrastarSobre = (alvo: HTMLElement, tipo: "dragOver" | "drop", clientY: number, dataTransfer: unknown) => {
  const ev = createEvent[tipo](alvo, { dataTransfer } as never);
  Object.defineProperty(ev, "clientY", { value: clientY });
  fireEvent(alvo, ev);
};
const alca = (nome: string) => screen.getByRole("button", { name: new RegExp(`^Reordenar ${nome}\\.`) });

it("a conta padrão é escolhida por uma estrela, guardada para quem escolheu, e pode ser removida", async () => {
  vi.mocked(vault.contas.listar).mockResolvedValue([conta("c1", "Nubank"), conta("c2", "Carteira")]);
  render(<VaultAccounts period={periodo} onPeriodChange={vi.fn()} categorias={[]} atualizar={vi.fn()} />);
  await screen.findByRole("button", { name: "Conta Nubank" });
  // O servidor devolve a lista já com o `padrao` de quem pergunta.
  vi.mocked(vault.contas.listar).mockResolvedValue([conta("c1", "Nubank"), conta("c2", "Carteira", { padrao: true })]);
  fireEvent.click(screen.getByRole("button", { name: "Tornar Carteira a sua conta padrão" }));
  await waitFor(() => expect(vault.preferencias.salvar).toHaveBeenCalledWith("conta_padrao", "c2"));
  const remover = await screen.findByRole("button", { name: "Carteira é a sua conta padrão. Remover" });
  expect(remover.getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByRole("button", { name: "Conta Carteira" }).textContent).toContain("Padrão");

  vi.mocked(vault.contas.listar).mockResolvedValue([conta("c1", "Nubank"), conta("c2", "Carteira")]);
  fireEvent.click(remover);
  await waitFor(() => expect(vault.preferencias.salvar).toHaveBeenLastCalledWith("conta_padrao", null));
  await screen.findByRole("button", { name: "Tornar Carteira a sua conta padrão" });
});

it("falha ao guardar a conta padrão avisa", async () => {
  vi.mocked(vault.contas.listar).mockResolvedValue([conta("c1", "Nubank")]);
  vi.mocked(vault.preferencias.salvar).mockRejectedValue(new Error("Cofre indisponível"));
  render(<VaultAccounts period={periodo} onPeriodChange={vi.fn()} categorias={[]} atualizar={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "Tornar Nubank a sua conta padrão" }));
  await waitFor(() => expect(avisar).toHaveBeenCalledWith(expect.stringContaining("conta padrão")));
});

it("as contas são reordenadas pelo teclado na alça, na hora, e a nova ordem é guardada", async () => {
  vi.mocked(vault.contas.listar).mockResolvedValue([conta("c1", "Nubank"), conta("c2", "Itaú"), conta("c3", "Carteira")]);
  render(<VaultAccounts period={periodo} onPeriodChange={vi.fn()} categorias={[]} atualizar={vi.fn()} />);
  await screen.findByRole("button", { name: "Conta Nubank" });
  expect(nomesDasContas()).toEqual(["Nubank", "Itaú", "Carteira"]);
  fireEvent.keyDown(alca("Carteira"), { key: "ArrowUp" });
  expect(nomesDasContas()).toEqual(["Nubank", "Carteira", "Itaú"]);
  await waitFor(() => expect(vault.preferencias.salvarOrdem).toHaveBeenCalledWith("ordem_contas", ["c1", "c3", "c2"]));
  fireEvent.keyDown(alca("Carteira"), { key: "ArrowUp" });
  expect(nomesDasContas()).toEqual(["Carteira", "Nubank", "Itaú"]);
  fireEvent.keyDown(alca("Carteira"), { key: "ArrowUp" }); // já é a primeira: nada acontece
  expect(vault.preferencias.salvarOrdem).toHaveBeenCalledTimes(2);
});

it("arrastar uma conta para cima de outra a coloca antes ou depois, conforme a metade em que soltou", async () => {
  vi.mocked(vault.contas.listar).mockResolvedValue([conta("c1", "Nubank"), conta("c2", "Itaú"), conta("c3", "Carteira")]);
  render(<VaultAccounts period={periodo} onPeriodChange={vi.fn()} categorias={[]} atualizar={vi.fn()} />);
  const itau = await screen.findByRole("button", { name: "Conta Itaú" });
  itau.getBoundingClientRect = () => ({ top: 100, height: 40, bottom: 140, left: 0, right: 300, width: 300, x: 0, y: 100, toJSON: () => ({}) });
  const dados = { setData: vi.fn(), setDragImage: vi.fn(), effectAllowed: "", dropEffect: "" };
  fireEvent.dragStart(alca("Carteira"), { dataTransfer: dados });
  arrastarSobre(itau, "dragOver", 135, dados); // metade de baixo: depois
  expect(itau.getAttribute("data-alvo")).toBe("depois");
  arrastarSobre(itau, "dragOver", 105, dados); // metade de cima: antes
  expect(itau.getAttribute("data-alvo")).toBe("antes");
  arrastarSobre(itau, "drop", 105, dados);
  expect(nomesDasContas()).toEqual(["Nubank", "Carteira", "Itaú"]);
  await waitFor(() => expect(vault.preferencias.salvarOrdem).toHaveBeenCalledWith("ordem_contas", ["c1", "c3", "c2"]));
});

it("com busca ou filtro ativos a alça some: reordenar só faz sentido com a lista inteira", async () => {
  vi.mocked(vault.contas.listar).mockResolvedValue([conta("c1", "Nubank"), conta("c2", "Itaú")]);
  render(<VaultAccounts period={periodo} onPeriodChange={vi.fn()} categorias={[]} atualizar={vi.fn()} />);
  await screen.findByRole("button", { name: "Conta Nubank" });
  expect(document.querySelectorAll(".cofre-ordem-alca")).toHaveLength(2);
  fireEvent.change(screen.getByLabelText("Buscar conta"), { target: { value: "itau" } }); // sem acento
  expect(nomesDasContas()).toEqual(["Itaú"]);
  expect(document.querySelectorAll(".cofre-ordem-alca")).toHaveLength(0);
});

it("falha ao guardar a ordem devolve a lista à ordem do servidor e avisa", async () => {
  vi.mocked(vault.contas.listar).mockResolvedValue([conta("c1", "Nubank"), conta("c2", "Itaú")]);
  vi.mocked(vault.preferencias.salvarOrdem).mockRejectedValue(new Error("rede"));
  render(<VaultAccounts period={periodo} onPeriodChange={vi.fn()} categorias={[]} atualizar={vi.fn()} />);
  await screen.findByRole("button", { name: "Conta Nubank" });
  fireEvent.keyDown(alca("Itaú"), { key: "ArrowUp" });
  await waitFor(() => expect(avisar).toHaveBeenCalledWith(expect.stringContaining("ordem das contas")));
  expect(nomesDasContas()).toEqual(["Nubank", "Itaú"]);
});

it("as categorias também são reordenadas pela pessoa e a lista do Cofre é recarregada depois de guardar", async () => {
  const atualizar = vi.fn();
  render(<VaultCategories period={periodo} onPeriodChange={vi.fn()} categorias={[categoria("k1", "Casa"), categoria("k2", "Lazer"), categoria("k3", "Saúde")]} atualizar={atualizar} />);
  await screen.findByRole("button", { name: "Editar categoria Casa" });
  fireEvent.keyDown(alca("Saúde"), { key: "ArrowUp" });
  expect(nomesDasCategorias()).toEqual(["Casa", "Saúde", "Lazer"]);
  await waitFor(() => expect(vault.preferencias.salvarOrdem).toHaveBeenCalledWith("ordem_categorias", ["k1", "k3", "k2"]));
  await waitFor(() => expect(atualizar).toHaveBeenCalled());
});

it("busca de categoria ignora acento", async () => {
  render(<VaultCategories period={periodo} onPeriodChange={vi.fn()} categorias={[categoria("k1", "Casa"), categoria("k3", "Saúde")]} atualizar={vi.fn()} />);
  await screen.findByRole("button", { name: "Editar categoria Casa" });
  fireEvent.change(screen.getByLabelText("Buscar categoria"), { target: { value: "saude" } });
  expect(nomesDasCategorias()).toEqual(["Saúde"]);
});

it("o gancho aceita item novo (que ainda não está na ordem guardada) no fim e ignora ids que já não existem", async () => {
  function Lista({ itens }: { itens: { id: string }[] }) {
    const ordem = useOrdemPessoal(itens, async () => undefined);
    return <ul>{ordem.ordenados.map((i) => <li key={i.id}><AlcaOrdem nome={i.id} {...ordem.alca(i.id)} />{i.id}</li>)}</ul>;
  }
  const { rerender } = render(<Lista itens={[{ id: "a" }, { id: "b" }]} />);
  fireEvent.keyDown(screen.getByRole("button", { name: /^Reordenar b\./ }), { key: "ArrowUp" });
  expect(screen.getAllByRole("listitem").map((l) => l.textContent)).toEqual(["b", "a"]);
  // Chega a lista nova do servidor (já na ordem guardada, com um item novo): vale a do servidor.
  await act(async () => { rerender(<Lista itens={[{ id: "b" }, { id: "a" }, { id: "c" }]} />); });
  expect(screen.getAllByRole("listitem").map((l) => l.textContent)).toEqual(["b", "a", "c"]);
});
