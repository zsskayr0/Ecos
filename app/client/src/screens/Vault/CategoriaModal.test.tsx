import { escolher, opcoesDe } from "@/test-helpers/escolher";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@/lib/api", async (importOriginal) => {
  const o = await importOriginal<typeof import("@/lib/api")>();
  return { ...o, vault: { ...o.vault, categorias: { ...o.vault.categorias, uso: vi.fn(), excluir: vi.fn() } } };
});
import { vault, ApiError, type CategoriaApi, type CategoriaUsoApi } from "@/lib/api";
import { CategoriaModal } from "./VaultCategories";

const cat = (id: string, nome: string, tipo: CategoriaApi["tipo"], padrao = true): CategoriaApi => ({ id, nome, tipo, icone: "Tag", cor: "#86d7ad", padrao, espaco: "pessoal" });
const alimentacao = cat("cat_nexus_alimentacao", "Alimentação", "saida");
const todas = [
  cat("cat_nexus_renda", "Renda", "entrada"),
  alimentacao,
  cat("cat_nexus_transporte", "Transporte", "saida"),
  cat("cat_nexus_outros", "Outros", "ambos"),
];
const amostra = (n: number): CategoriaUsoApi["amostra"] => Array.from({ length: n }, (_, i) => ({ id: `t${i}`, data: "2026-09-30", descricao: `Compra ${i + 1}`, tipo: "saida", valor_centavos: 1000 + i }));
const emUso = (extra: Partial<CategoriaUsoApi> = {}): CategoriaUsoApi => ({ transacoes: 2, recorrencias: 0, pendencias: 1, tipos: ["saida"], amostra: amostra(2), ...extra });

function abrir(categoria: CategoriaApi) {
  const onSaved = vi.fn();
  render(<CategoriaModal categoria={categoria} categorias={todas} onClose={vi.fn()} onSaved={onSaved} />);
  return onSaved;
}
/** A lixeira fica no cabeçalho, ao lado do X (não há mais "Apagar" no rodapé). */
const apagar = () => fireEvent.click(screen.getByRole("button", { name: "Apagar categoria" }));

beforeEach(() => {
  vi.clearAllMocks();
  Element.prototype.scrollTo = vi.fn(); // o seletor de ícones rola até o ícone atual; jsdom não implementa
  vi.mocked(vault.categorias.excluir).mockResolvedValue({ ok: true });
});

it("categoria que ninguém usa: só pede confirmação e apaga sem destino", async () => {
  vi.mocked(vault.categorias.uso).mockResolvedValue({ transacoes: 0, recorrencias: 0, pendencias: 0, tipos: [], amostra: [] });
  const onSaved = abrir(alimentacao);
  apagar();
  expect((await screen.findByRole("alert")).textContent).toContain("Nenhum lançamento usa esta categoria");
  fireEvent.click(screen.getByRole("button", { name: "Apagar", description: "" }));
  await waitFor(() => expect(vault.categorias.excluir).toHaveBeenCalledWith("cat_nexus_alimentacao", undefined));
  expect(onSaved).toHaveBeenCalled();
});

it("categoria em uso: mostra quais lançamentos são dela e oferece mover para outra categoria, com “Sem categoria” já escolhida", async () => {
  vi.mocked(vault.categorias.uso).mockResolvedValue(emUso());
  const onSaved = abrir(alimentacao);
  apagar();
  const menu = await screen.findByRole("alert", { name: "Apagar Alimentação" });
  expect(menu.textContent).toContain("2 lançamentos");
  expect(menu.textContent).toContain("1 pendência");
  const lista = within(menu).getByRole("list", { name: "Lançamentos desta categoria" });
  expect(within(lista).getAllByRole("listitem").map((li) => li.textContent)).toEqual([expect.stringContaining("Compra 1"), expect.stringContaining("Compra 2")]);
  expect(within(lista).getAllByRole("listitem")[0]!.textContent).toContain("30/09/2026");
  expect(within(menu).getByRole("button", { name: "Mover tudo para" }).textContent).toBe("Sem categoria");
  escolher("Mover tudo para", "Outros", menu);
  fireEvent.click(within(menu).getByRole("button", { name: "Mover e apagar" }));
  await waitFor(() => expect(vault.categorias.excluir).toHaveBeenCalledWith("cat_nexus_alimentacao", { mover_para: "cat_nexus_outros" }));
  expect(onSaved).toHaveBeenCalled();
});

it("só oferece destinos do mesmo tipo dos itens, sem a própria categoria", async () => {
  vi.mocked(vault.categorias.uso).mockResolvedValue(emUso());
  abrir(alimentacao);
  apagar();
  const menu = await screen.findByRole("alert", { name: "Apagar Alimentação" });
  const opcoes = opcoesDe("Mover tudo para", menu);
  expect(opcoes).toEqual(["Sem categoria", "Transporte", "Outros"]); // sem "Renda" (só receitas) e sem "Alimentação"
});

it("pode deixar tudo sem categoria", async () => {
  vi.mocked(vault.categorias.uso).mockResolvedValue(emUso());
  abrir(alimentacao);
  apagar();
  const menu = await screen.findByRole("alert", { name: "Apagar Alimentação" });
  fireEvent.click(within(menu).getByRole("button", { name: "Deixar sem categoria e apagar" }));
  await waitFor(() => expect(vault.categorias.excluir).toHaveBeenCalledWith("cat_nexus_alimentacao", { sem_categoria: true }));
});

it("sem categoria Outros compatível, o padrão do menu é Sem categoria", async () => {
  vi.mocked(vault.categorias.uso).mockResolvedValue(emUso());
  render(<CategoriaModal categoria={alimentacao} categorias={todas.filter((c) => c.id !== "cat_nexus_outros")} onClose={vi.fn()} onSaved={vi.fn()} />);
  apagar();
  const menu = await screen.findByRole("alert", { name: "Apagar Alimentação" });
  expect(within(menu).getByRole("button", { name: "Mover tudo para" }).textContent).toBe("Sem categoria");
});

it("cancelar fecha o menu sem apagar nada", async () => {
  vi.mocked(vault.categorias.uso).mockResolvedValue(emUso());
  abrir(alimentacao);
  apagar();
  const menu = await screen.findByRole("alert", { name: "Apagar Alimentação" });
  fireEvent.click(within(menu).getByRole("button", { name: "Cancelar" }));
  expect(screen.queryByRole("alert", { name: "Apagar Alimentação" })).toBeNull();
  expect(vault.categorias.excluir).not.toHaveBeenCalled();
});

it("quando há mais lançamentos que os listados, avisa quantos faltam", async () => {
  vi.mocked(vault.categorias.uso).mockResolvedValue(emUso({ transacoes: 130, amostra: amostra(100) }));
  abrir(alimentacao);
  apagar();
  const menu = await screen.findByRole("alert", { name: "Apagar Alimentação" });
  expect(menu.textContent).toContain("e mais 30 lançamentos");
});

it("“Outros” não é mais fixa: tem lixeira ativa como as demais", () => {
  abrir(todas[3]!);
  const lixeira = screen.getByRole("button", { name: "Apagar categoria" }) as HTMLButtonElement;
  expect(lixeira.disabled).toBe(false);
});

it("categoria de sistema, como Moradia, agora tem a lixeira ativa", () => {
  abrir(cat("cat_nexus_moradia", "Moradia", "saida", true));
  expect((screen.getByRole("button", { name: "Apagar categoria" }) as HTMLButtonElement).disabled).toBe(false);
});

it("o rodapé não tem mais o botão Apagar: só Cancelar e Salvar", () => {
  abrir(alimentacao);
  const rodape = document.querySelector("footer")!;
  expect(Array.from(rodape.querySelectorAll("button")).map((b) => b.textContent)).toEqual(["Cancelar", "Salvar"]);
});

it("categoria nova não tem lixeira, só o X", () => {
  render(<CategoriaModal categorias={todas} onClose={vi.fn()} onSaved={vi.fn()} />);
  expect(screen.queryByRole("button", { name: /Apagar categoria/ })).toBeNull();
  expect(screen.getByRole("button", { name: "Fechar" })).toBeTruthy();
});

it("com o menu de destino aberto, a lixeira fica desligada (não abre outro menu por cima)", async () => {
  vi.mocked(vault.categorias.uso).mockResolvedValue(emUso());
  abrir(alimentacao);
  apagar();
  await screen.findByRole("alert", { name: "Apagar Alimentação" });
  expect((screen.getByRole("button", { name: "Apagar categoria" }) as HTMLButtonElement).disabled).toBe(true);
});

it("erro do servidor ao mover e apagar aparece na tela e nada é dado como feito", async () => {
  vi.mocked(vault.categorias.uso).mockResolvedValue(emUso());
  vi.mocked(vault.categorias.excluir).mockRejectedValue(new ApiError("VALIDATION_ERROR", "A categoria de destino é só de receitas, e há itens do outro tipo.", 422));
  const onSaved = abrir(alimentacao);
  apagar();
  const menu = await screen.findByRole("alert", { name: "Apagar Alimentação" });
  escolher("Mover tudo para", "Transporte", menu);
  fireEvent.click(within(menu).getByRole("button", { name: "Mover e apagar" }));
  await screen.findByText(/só de receitas/);
  expect(onSaved).not.toHaveBeenCalled();
});

it("falha ao consultar o uso não apaga nada e mostra o erro", async () => {
  vi.mocked(vault.categorias.uso).mockRejectedValue(new ApiError("INTERNAL_ERROR", "Cofre indisponível no momento.", 500));
  const onSaved = abrir(alimentacao);
  apagar();
  await screen.findByText(/Cofre indisponível|não foi possível|servidor/i);
  expect(vault.categorias.excluir).not.toHaveBeenCalled();
  expect(onSaved).not.toHaveBeenCalled();
});
