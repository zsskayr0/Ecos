import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@/lib/api", async (importOriginal) => {
  const o = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...o,
    vault: {
      ...o.vault,
      anexos: { conteudo: vi.fn(), listar: vi.fn(), miniatura: vi.fn() },
      transacoes: { obter: vi.fn(), atualizar: vi.fn(), excluir: vi.fn() },
      categorias: { listar: vi.fn(), criar: vi.fn() },
      contas: { listar: vi.fn() },
      beneficiarios: { listar: vi.fn(), criarOuEncontrar: vi.fn() },
    },
  };
});
import { vault, type TransacaoApi } from "@/lib/api";
import { RefreshProvider } from "@/lib/refresh-bus";
import { AppUIProvider } from "@/lib/ui-context";
import { ComprovanteViewer } from "./ComprovanteViewer";

const pdf = { id: "a1", nome_arquivo: "pix.pdf", mime_type: "application/pdf", tamanho_bytes: 2048 };
const foto = { id: "a2", nome_arquivo: "foto.png", mime_type: "image/png", tamanho_bytes: 4096 };
const lancamento: TransacaoApi = {
  id: "t1", tipo: "saida", valor_centavos: 12990, moeda: "BRL", data: "2026-09-30", descricao: "Compra no mercado", categoria_id: null, conta_id: null,
  beneficiario_id: null, forma_pagamento: null, status: "efetivada", observacoes: null, origem: "manual", espaco: "pessoal", criado_em: "", atualizado_em: "",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:t"), revokeObjectURL: vi.fn() }));
  window.matchMedia = vi.fn((q: string) => ({ matches: true, media: q, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), onchange: null, dispatchEvent: vi.fn() })) as unknown as typeof window.matchMedia;
  vi.mocked(vault.anexos.conteudo).mockResolvedValue(new Blob(["x"], { type: "image/png" }));
  vi.mocked(vault.anexos.listar).mockResolvedValue([]);
  vi.mocked(vault.anexos.miniatura).mockResolvedValue(null);
  vi.mocked(vault.transacoes.obter).mockResolvedValue(lancamento);
  vi.mocked(vault.transacoes.atualizar).mockResolvedValue(lancamento);
  vi.mocked(vault.transacoes.excluir).mockResolvedValue({ ok: true });
  vi.mocked(vault.categorias.listar).mockResolvedValue([]);
  vi.mocked(vault.contas.listar).mockResolvedValue([]);
  vi.mocked(vault.beneficiarios.listar).mockResolvedValue([]);
});

/** O app real tem estes provedores por cima do Cofre; o editor do lançamento usa o de atualização. */
const renderizar = (ui: React.ReactElement) => render(<RefreshProvider><AppUIProvider>{ui}</AppUIProvider></RefreshProvider>);

const painel = () => document.getElementById("painel-lancamento")!;
const alternar = (nome: string) => fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${nome}`) }));

it("sem lançamento ligado (anexo de um lançamento já aberto), não há botão nem painel", () => {
  renderizar(<ComprovanteViewer arquivo={pdf} onFechar={vi.fn()} />);
  expect(screen.queryByRole("button", { name: /lançamento/ })).toBeNull();
  expect(painel()).toBeNull();
});

it("o painel começa fechado e escondido de teclado e leitor de tela", () => {
  renderizar(<ComprovanteViewer arquivo={pdf} lancamentoId="t1" onFechar={vi.fn()} />);
  const botao = screen.getByRole("button", { name: "Abrir lançamento" });
  expect(botao.getAttribute("aria-expanded")).toBe("false");
  expect(painel().getAttribute("aria-hidden")).toBe("true");
  expect(painel().hasAttribute("inert")).toBe(true);
  expect(vault.transacoes.obter).not.toHaveBeenCalled(); // nem carrega o lançamento antes de pedir
});

it("Abrir lançamento abre o lançamento NA MESMA JANELA, ao lado do comprovante", async () => {
  renderizar(<ComprovanteViewer arquivo={pdf} lancamentoId="t1" onFechar={vi.fn()} />);
  alternar("Abrir lançamento");
  await screen.findByDisplayValue("Compra no mercado");
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  const dialogo = screen.getByRole("dialog");
  expect(dialogo.getAttribute("data-lancamento")).toBe("aberto");
  expect(within(dialogo).getByRole("button", { name: /^Ocultar lançamento/ }).getAttribute("aria-expanded")).toBe("true");
  expect(painel().getAttribute("aria-hidden")).toBe("false");
  expect(painel().hasAttribute("inert")).toBe(false);
  expect(painel().contains(screen.getByDisplayValue("Compra no mercado"))).toBe(true);
  expect(vault.transacoes.obter).toHaveBeenCalledWith("t1");
  // O comprovante continua na janela, ao lado.
  expect(dialogo.querySelector(".cofre-viewer-body")).not.toBeNull();
});

it("o mesmo botão fecha o painel, e o editor continua montado para a animação de fechar não esvaziar", async () => {
  renderizar(<ComprovanteViewer arquivo={pdf} lancamentoId="t1" onFechar={vi.fn()} />);
  alternar("Abrir lançamento");
  await screen.findByDisplayValue("Compra no mercado");
  alternar("Ocultar lançamento");
  const dialogo = screen.getByRole("dialog");
  expect(dialogo.getAttribute("data-lancamento")).toBe("fechado");
  expect(painel().getAttribute("aria-hidden")).toBe("true");
  expect(screen.getByDisplayValue("Compra no mercado")).toBeTruthy();
  // Reabrir não busca o lançamento de novo.
  alternar("Abrir lançamento");
  expect(vault.transacoes.obter).toHaveBeenCalledTimes(1);
});

it("Esc fecha primeiro o painel e só depois o visualizador", async () => {
  const onFechar = vi.fn();
  renderizar(<ComprovanteViewer arquivo={pdf} lancamentoId="t1" onFechar={onFechar} />);
  alternar("Abrir lançamento");
  await screen.findByDisplayValue("Compra no mercado");
  fireEvent.keyDown(window, { key: "Escape" });
  expect(screen.getByRole("dialog").getAttribute("data-lancamento")).toBe("fechado");
  expect(onFechar).not.toHaveBeenCalled();
  fireEvent.keyDown(window, { key: "Escape" });
  expect(onFechar).toHaveBeenCalledOnce();
});

it("salvar o lançamento no painel avisa a lista, fecha só o painel e deixa o comprovante aberto", async () => {
  const aoMudar = vi.fn();
  const onFechar = vi.fn();
  renderizar(<ComprovanteViewer arquivo={pdf} lancamentoId="t1" onFechar={onFechar} aoMudar={aoMudar} />);
  alternar("Abrir lançamento");
  await screen.findByDisplayValue("Compra no mercado");
  fireEvent.change(screen.getByDisplayValue("Compra no mercado"), { target: { value: "Mercado do bairro" } });
  fireEvent.click(screen.getByRole("button", { name: /Salvar alterações/ }));
  await waitFor(() => expect(vault.transacoes.atualizar).toHaveBeenCalledWith("t1", expect.objectContaining({ descricao: "Mercado do bairro" })));
  await waitFor(() => expect(screen.getByRole("dialog").getAttribute("data-lancamento")).toBe("fechado"));
  expect(aoMudar).toHaveBeenCalled();
  expect(onFechar).not.toHaveBeenCalled();
});

it("apagar o lançamento pelo painel fecha o visualizador inteiro (o comprovante vai junto)", async () => {
  const aoMudar = vi.fn();
  const onFechar = vi.fn();
  renderizar(<ComprovanteViewer arquivo={pdf} lancamentoId="t1" onFechar={onFechar} aoMudar={aoMudar} />);
  alternar("Abrir lançamento");
  await screen.findByDisplayValue("Compra no mercado");
  fireEvent.click(screen.getByRole("button", { name: "Apagar" }));
  const alerta = await screen.findByRole("alert");
  fireEvent.click(within(alerta).getAllByRole("button").at(-1)!);
  await waitFor(() => expect(vault.transacoes.excluir).toHaveBeenCalledWith("t1"));
  await waitFor(() => expect(onFechar).toHaveBeenCalled());
  expect(aoMudar).toHaveBeenCalled();
});

it("a lista de comprovantes do lançamento não se repete dentro do painel (o arquivo já está ao lado)", async () => {
  renderizar(<ComprovanteViewer arquivo={foto} lancamentoId="t1" onFechar={vi.fn()} />);
  alternar("Abrir lançamento");
  await screen.findByDisplayValue("Compra no mercado");
  expect(screen.queryByRole("region", { name: "Comprovantes do lançamento" })).toBeNull();
});

it("a imagem do comprovante aparece na janela", async () => {
  renderizar(<ComprovanteViewer arquivo={foto} lancamentoId="t1" onFechar={vi.fn()} />);
  expect((await screen.findByRole("img", { name: "Comprovante foto.png" })).getAttribute("src")).toBe("blob:t");
});

const nav = (extra: Partial<NonNullable<React.ComponentProps<typeof ComprovanteViewer>["navegacao"]>> = {}) => ({
  posicao: "2 de 3", temAnterior: true, temProximo: true, anterior: vi.fn(), proximo: vi.fn(), ...extra,
});

it("sem navegação (um anexo só) não há setas", () => {
  renderizar(<ComprovanteViewer arquivo={foto} onFechar={vi.fn()} />);
  expect(screen.queryByRole("button", { name: "Próximo anexo" })).toBeNull();
});

it("setas e posição aparecem quando há vários anexos e respeitam os extremos", () => {
  const n = nav({ posicao: "1 de 3", temAnterior: false });
  renderizar(<ComprovanteViewer arquivo={foto} onFechar={vi.fn()} navegacao={n} />);
  expect(screen.getByText("1 de 3")).toBeTruthy();
  expect((screen.getByRole("button", { name: "Anexo anterior" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Próximo anexo" }));
  expect(n.proximo).toHaveBeenCalledOnce();
});

it("as setas do teclado passam de um anexo para o outro", () => {
  const n = nav();
  renderizar(<ComprovanteViewer arquivo={foto} onFechar={vi.fn()} navegacao={n} />);
  fireEvent.keyDown(window, { key: "ArrowRight" });
  fireEvent.keyDown(window, { key: "ArrowLeft" });
  expect(n.proximo).toHaveBeenCalledOnce();
  expect(n.anterior).toHaveBeenCalledOnce();
});

it("no extremo, a seta do teclado não faz nada", () => {
  const n = nav({ temAnterior: false, temProximo: false });
  renderizar(<ComprovanteViewer arquivo={foto} onFechar={vi.fn()} navegacao={n} />);
  fireEvent.keyDown(window, { key: "ArrowRight" });
  fireEvent.keyDown(window, { key: "ArrowLeft" });
  expect(n.proximo).not.toHaveBeenCalled();
  expect(n.anterior).not.toHaveBeenCalled();
});

it("quem está digitando não perde a seta: dentro de um campo, ← → não trocam de anexo", () => {
  const n = nav();
  renderizar(<ComprovanteViewer arquivo={foto} onFechar={vi.fn()} navegacao={n} />);
  const campo = document.createElement("input");
  document.body.appendChild(campo);
  fireEvent.keyDown(campo, { key: "ArrowRight" });
  expect(n.proximo).not.toHaveBeenCalled();
  campo.remove();
});
