import { escolher } from "@/test-helpers/escolher";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@/lib/api", async (importOriginal) => {
  const o = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...o,
    vault: {
      ...o.vault,
      contas: { ...o.vault.contas, listar: vi.fn() },
      beneficiarios: { ...o.vault.beneficiarios, listar: vi.fn(), criarOuEncontrar: vi.fn(), renomear: vi.fn() },
      formasPagamento: { listar: vi.fn(), criar: vi.fn(), atualizar: vi.fn(), uso: vi.fn(), excluir: vi.fn() },
    },
  };
});
vi.mock("@/lib/toast", () => ({ avisar: vi.fn() }));
import { ApiError, vault, type BeneficiarioApi, type ContaApi, type FormaPagamentoApi } from "@/lib/api";
import { reiniciarFormasPagamento } from "@/lib/formas-pagamento-store";
import { avisar } from "@/lib/toast";
import { VaultCadastros } from "./VaultCadastros";
import { agruparPorBanco } from "./ContasBancosListas";

const forma = (codigo: string, nome: string, extra: Partial<FormaPagamentoApi> = {}): FormaPagamentoApi => ({ codigo, nome, icone: null, cor: null, padrao: true, ativa: true, ordem: 1, criado_por: null, usos: 0, ...extra });
const conta = (id: string, nome: string, extra: Partial<ContaApi> = {}): ContaApi => ({ id, nome, banco: null, agencia: null, numero_conta: null, cor: "#ec7000", padrao: false, espaco: "pessoal", tipo: "corrente", codigo_banco: null, sigla: null, saldo_inicial_centavos: 0, ...extra } as ContaApi);
const sacado = (id: string, nome: string, transacoes = 0): BeneficiarioApi => ({ id, nome, documento: null, observacoes: null, transacoes });

const FORMAS = [forma("pix", "Pix", { usos: 12 }), forma("ted", "TED"), forma("cartao_de_debito", "Cartão de Débito", { padrao: false, usos: 2 })];

function abrir(aba: string, atualizar = vi.fn()) {
  render(<MemoryRouter initialEntries={[`/cofre/cadastros?aba=${aba}`]}><VaultCadastros atualizar={atualizar} /></MemoryRouter>);
  return atualizar;
}

beforeEach(() => {
  vi.clearAllMocks();
  reiniciarFormasPagamento();
  Element.prototype.scrollTo = vi.fn();
  vi.mocked(vault.contas.listar).mockResolvedValue([]);
  vi.mocked(vault.beneficiarios.listar).mockResolvedValue([]);
  vi.mocked(vault.formasPagamento.listar).mockResolvedValue(FORMAS);
  vi.mocked(vault.formasPagamento.atualizar).mockResolvedValue({ ok: true });
  vi.mocked(vault.formasPagamento.excluir).mockResolvedValue({ ok: true });
});

it("as abas seguem o padrão ARIA e se movem com as setas", async () => {
  abrir("contas");
  const abas = screen.getAllByRole("tab");
  expect(abas.map((a) => a.textContent)).toEqual(["Contas", "Bancos", "Sacados", "Formas de pagamento"]);
  expect(abas[0].getAttribute("aria-selected")).toBe("true");
  expect(abas[1].getAttribute("tabindex")).toBe("-1");
  fireEvent.keyDown(abas[0]!, { key: "ArrowRight" });
  await waitFor(() => expect(screen.getByRole("tab", { name: "Bancos" }).getAttribute("aria-selected")).toBe("true"));
  expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe("cad-aba-bancos");
});

it("formas: lista com selo de fábrica, uso e interruptor; as de fábrica não têm Excluir", async () => {
  abrir("formas");
  expect(await screen.findByRole("button", { name: "Editar Pix" })).toBeTruthy();
  expect(screen.getByText("Usada em 12 itens")).toBeTruthy();
  expect(screen.getAllByText("De fábrica")).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: "Editar Pix" }));
  const dialogo = await screen.findByRole("dialog", { name: "Editar forma de pagamento" });
  expect(within(dialogo).queryByRole("button", { name: "Apagar forma de pagamento" })).toBeNull();
  expect(within(dialogo).getByText(/não apagar/)).toBeTruthy();
});

it("criar forma: nome repetido (409) aparece no próprio campo e o texto digitado fica", async () => {
  vi.mocked(vault.formasPagamento.criar).mockRejectedValue(new ApiError("CONFLICT", "Já existe uma forma de pagamento com este nome.", 409));
  abrir("formas");
  await screen.findByRole("button", { name: "Editar Pix" });
  fireEvent.click(screen.getByRole("button", { name: "Nova forma" }));
  const dialogo = await screen.findByRole("dialog", { name: "Nova forma de pagamento" });
  const campo = within(dialogo).getByLabelText(/^Nome/);
  fireEvent.change(campo, { target: { value: "Pix" } });
  fireEvent.click(within(dialogo).getByRole("button", { name: "Criar forma" }));
  expect(await within(dialogo).findByText("Já existe uma forma de pagamento com este nome.")).toBeTruthy();
  expect(campo.getAttribute("aria-invalid")).toBe("true");
  expect((campo as HTMLInputElement).value).toBe("Pix");
});

it("criar forma e usá-la sem recarregar a página: a lista é recarregada depois do POST", async () => {
  vi.mocked(vault.formasPagamento.criar).mockImplementation(async () => {
    vi.mocked(vault.formasPagamento.listar).mockResolvedValue([...FORMAS, forma("vale_refeicao", "Vale-refeição", { padrao: false })]);
    return { codigo: "vale_refeicao" };
  });
  abrir("formas");
  await screen.findByRole("button", { name: "Editar Pix" });
  fireEvent.click(screen.getByRole("button", { name: "Nova forma" }));
  const dialogo = await screen.findByRole("dialog");
  fireEvent.change(within(dialogo).getByLabelText(/^Nome/), { target: { value: "Vale-refeição" } });
  fireEvent.click(within(dialogo).getByRole("button", { name: "Criar forma" }));
  expect(await screen.findByRole("button", { name: "Editar Vale-refeição" })).toBeTruthy();
  expect(vault.formasPagamento.criar).toHaveBeenCalledWith(expect.objectContaining({ nome: "Vale-refeição" }));
});

it("excluir forma em uso exige destino; 'sem forma' manda sem_forma e avisa as outras telas", async () => {
  vi.mocked(vault.formasPagamento.uso).mockResolvedValue({ transacoes: 2, recorrencias: 1, amostra: [{ id: "t1", data: "2026-09-30", descricao: "Mercado", tipo: "saida", valor_centavos: 1000 }] });
  const atualizar = abrir("formas");
  fireEvent.click(await screen.findByRole("button", { name: "Editar Cartão de Débito" }));
  const dialogo = await screen.findByRole("dialog");
  fireEvent.click(within(dialogo).getByRole("button", { name: "Apagar forma de pagamento" }));
  const menu = await screen.findByRole("alert", { name: "Apagar Cartão de Débito" });
  expect(menu.textContent).toContain("2 lançamentos");
  expect(menu.textContent).toContain("1 recorrência");
  expect(within(menu).getByText("Mercado")).toBeTruthy();
  expect(vault.formasPagamento.excluir).not.toHaveBeenCalled();
  expect(within(menu).getByRole("button", { name: "Mover tudo para" }).textContent).toBe("Deixar sem forma de pagamento");
  fireEvent.click(within(menu).getByRole("button", { name: "Deixar sem forma e apagar" }));
  await waitFor(() => expect(vault.formasPagamento.excluir).toHaveBeenCalledWith("cartao_de_debito", { sem_forma: true }));
  await waitFor(() => expect(atualizar).toHaveBeenCalled());
});

it("excluir forma em uso movendo para outra envia mover_para", async () => {
  vi.mocked(vault.formasPagamento.uso).mockResolvedValue({ transacoes: 2, recorrencias: 0, amostra: [] });
  abrir("formas");
  fireEvent.click(await screen.findByRole("button", { name: "Editar Cartão de Débito" }));
  fireEvent.click(await screen.findByRole("button", { name: "Apagar forma de pagamento" }));
  const menu = await screen.findByRole("alert", { name: "Apagar Cartão de Débito" });
  escolher("Mover tudo para", "TED", menu);
  fireEvent.click(within(menu).getByRole("button", { name: "Mover e apagar" }));
  await waitFor(() => expect(vault.formasPagamento.excluir).toHaveBeenCalledWith("cartao_de_debito", { mover_para: "ted" }));
});

it("desativar mostra 'Desfazer' e o desfazer só restaura se ninguém mais mexeu", async () => {
  abrir("formas");
  fireEvent.click(await screen.findByRole("switch", { name: "Desativar TED" }));
  await waitFor(() => expect(vault.formasPagamento.atualizar).toHaveBeenCalledWith("ted", { ativa: false }));
  const chamada = vi.mocked(avisar).mock.calls.find((c) => c[2]?.rotulo === "Desfazer");
  expect(chamada).toBeTruthy();
  // Outra pessoa reativou antes do desfazer: nada é restaurado.
  vi.mocked(vault.formasPagamento.listar).mockResolvedValue(FORMAS.map((f) => f)); // TED já ativa
  chamada![2]!.aoClicar();
  await waitFor(() => expect(avisar).toHaveBeenCalledWith(expect.stringContaining("Nada foi desfeito"), "neutro"));
  expect(vault.formasPagamento.atualizar).toHaveBeenCalledTimes(1);
});

it("sem resposta ao desativar: confirma pela lista e não anuncia sucesso se não bate", async () => {
  vi.mocked(vault.formasPagamento.atualizar).mockRejectedValue(new ApiError("CONEXAO_INDISPONIVEL", "sem rede", 0));
  abrir("formas");
  fireEvent.click(await screen.findByRole("switch", { name: "Desativar TED" }));
  await waitFor(() => expect(avisar).toHaveBeenCalledWith(expect.stringContaining("Não deu para confirmar"), "erro"));
});

it("PATCH sem resposta que na verdade gravou: o modal confirma pelos campos e fecha", async () => {
  vi.mocked(vault.formasPagamento.atualizar).mockImplementation(async () => {
    vi.mocked(vault.formasPagamento.listar).mockResolvedValue(FORMAS.map((f) => (f.codigo === "ted" ? { ...f, nome: "Transferência", icone: "CreditCard", cor: "#7dd3fc" } : f)));
    throw new ApiError("CONEXAO_INDISPONIVEL", "sem rede", 0);
  });
  abrir("formas");
  fireEvent.click(await screen.findByRole("button", { name: "Editar TED" }));
  const dialogo = await screen.findByRole("dialog");
  fireEvent.change(within(dialogo).getByLabelText(/^Nome/), { target: { value: "Transferência" } });
  fireEvent.click(within(dialogo).getByRole("button", { name: "Salvar" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(avisar).toHaveBeenCalledWith("Forma de pagamento atualizada.", "sucesso");
});

it("PATCH sem resposta que não gravou: o formulário fica e oferece tentar de novo", async () => {
  vi.mocked(vault.formasPagamento.atualizar).mockRejectedValue(new ApiError("CONEXAO_INDISPONIVEL", "sem rede", 0));
  abrir("formas");
  fireEvent.click(await screen.findByRole("button", { name: "Editar TED" }));
  const dialogo = await screen.findByRole("dialog");
  const campo = within(dialogo).getByLabelText(/^Nome/);
  fireEvent.change(campo, { target: { value: "Transferência" } });
  fireEvent.click(within(dialogo).getByRole("button", { name: "Salvar" }));
  expect(await within(dialogo).findByText(/Não deu para confirmar se foi salvo/)).toBeTruthy();
  expect((campo as HTMLInputElement).value).toBe("Transferência");
  expect(within(dialogo).getByRole("button", { name: "Tentar de novo" })).toBeTruthy();
});

it("403 mostra permissão negada sem fechar o formulário", async () => {
  vi.mocked(vault.formasPagamento.atualizar).mockRejectedValue(new ApiError("FORBIDDEN", "Proibido", 403));
  abrir("formas");
  fireEvent.click(await screen.findByRole("button", { name: "Editar TED" }));
  const dialogo = await screen.findByRole("dialog");
  fireEvent.change(within(dialogo).getByLabelText(/^Nome/), { target: { value: "X" } });
  fireEvent.click(within(dialogo).getByRole("button", { name: "Salvar" }));
  expect(await within(dialogo).findByText(/não tem permissão/)).toBeTruthy();
});

it("erro ao carregar as formas mostra mensagem com 'Tentar novamente'", async () => {
  vi.mocked(vault.formasPagamento.listar).mockRejectedValueOnce(new ApiError("X", "Servidor fora do ar.", 503)).mockResolvedValue(FORMAS);
  abrir("formas");
  expect(await screen.findByText("Servidor fora do ar.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Tentar novamente/ }));
  expect(await screen.findByRole("button", { name: "Editar Pix" })).toBeTruthy();
});

it("todas inativas: avisa e orienta", async () => {
  vi.mocked(vault.formasPagamento.listar).mockResolvedValue(FORMAS.map((f) => ({ ...f, ativa: false })));
  abrir("formas");
  expect(await screen.findByText(/Todas as formas estão inativas/)).toBeTruthy();
});

it("sacados: criar um nome que já existe avisa 'já está cadastrado' em vez de anunciar criação", async () => {
  vi.mocked(vault.beneficiarios.listar).mockResolvedValue([sacado("b1", "Mercado Extra", 3)]);
  vi.mocked(vault.beneficiarios.criarOuEncontrar).mockResolvedValue({ id: "b1", nome: "Mercado Extra", novo: false });
  abrir("sacados");
  await screen.findByRole("button", { name: "Renomear Mercado Extra" });
  fireEvent.click(screen.getByRole("button", { name: "Novo sacado" }));
  const dialogo = await screen.findByRole("dialog");
  fireEvent.change(within(dialogo).getByLabelText(/^Nome/), { target: { value: "mercado extra" } });
  fireEvent.click(within(dialogo).getByRole("button", { name: "Criar sacado" }));
  expect(await within(dialogo).findByText(/Este sacado já está cadastrado/)).toBeTruthy();
  expect(avisar).not.toHaveBeenCalledWith("Sacado criado.", "sucesso");
});

it("sacados: renomear para um nome de outro cadastro (409) mantém o texto e leva a conciliar", async () => {
  vi.mocked(vault.beneficiarios.listar).mockResolvedValue([sacado("b1", "Mercado Extra", 3), sacado("b2", "Extra", 1)]);
  vi.mocked(vault.beneficiarios.renomear).mockRejectedValue(new ApiError("CONFLICT", "Já existe", 409));
  abrir("sacados");
  fireEvent.click(await screen.findByRole("button", { name: "Renomear Extra" }));
  const dialogo = await screen.findByRole("dialog");
  const campo = within(dialogo).getByLabelText(/^Nome/);
  fireEvent.change(campo, { target: { value: "Mercado Extra" } });
  fireEvent.click(within(dialogo).getByRole("button", { name: "Renomear" }));
  expect(await within(dialogo).findByRole("button", { name: "Conciliar e mesclar" })).toBeTruthy();
  expect((campo as HTMLInputElement).value).toBe("Mercado Extra");
});

it("bancos: agrupa as contas por banco e 'Adicionar conta neste banco' abre o modal com o banco escolhido", async () => {
  vi.mocked(vault.contas.listar).mockResolvedValue([
    conta("c1", "Itaú Pessoal", { banco: "Itaú", codigo_banco: "341", padrao: true }),
    conta("c2", "Itaú Empresa", { banco: "Itaú", codigo_banco: "341" }),
    conta("c3", "Dinheiro", { tipo: "carteira" }),
  ]);
  abrir("bancos");
  const botoes = await screen.findAllByRole("button", { name: "Adicionar conta neste banco" });
  expect(botoes).toHaveLength(1);
  expect(screen.getByText("2 contas")).toBeTruthy();
  fireEvent.click(botoes[0]!);
  const dialogo = await screen.findByRole("dialog");
  expect((within(dialogo).getByLabelText(/Nome da conta/i) as HTMLInputElement).value).toBe("Itaú");
});

it("agruparPorBanco separa banco personalizado, catálogo e sem banco", () => {
  const grupos = agruparPorBanco([
    conta("1", "A", { banco: "Banco Xis", codigo_banco: null }),
    conta("2", "B", { banco: "banco xis" }),
    conta("3", "C", { banco: "Itaú", codigo_banco: "341" }),
    conta("4", "D", { tipo: "carteira" }),
  ]);
  expect(grupos.map((g) => [g.chave, g.contas.length])).toEqual([["nome:banco xis", 2], ["cod:341", 1], ["sem", 1]].sort((a, b) => 0) as never);
});
