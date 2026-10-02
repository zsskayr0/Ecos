import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@/lib/api", async (importOriginal) => {
  const o = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...o,
    vault: {
      ...o.vault,
      categorias: { listar: vi.fn(), criar: vi.fn() },
      contas: { listar: vi.fn() },
      beneficiarios: { listar: vi.fn(), criarOuEncontrar: vi.fn() },
      anexos: { conteudo: vi.fn() },
      comprovantes: { rascunhos: { obter: vi.fn(), conteudo: vi.fn(), reprocessar: vi.fn(), descartar: vi.fn(), confirmar: vi.fn() } },
    },
  };
});
import { vault, type RascunhoApi } from "@/lib/api";
import { RevisarComprovante, camposParaConferir } from "./comprovantes/RevisarComprovante";

const base: RascunhoApi = { id: "r1", nome_arquivo: "pix.png", mime_type: "image/png", tamanho_bytes: 1000, criado_em: "2026-10-02 10:00:00", ocr_status: "pronto", tem_miniatura: true };
const lido: RascunhoApi = {
  ...base,
  sugestao: {
    descricao: "Pix para Maria Aparecida da Silva", valor_centavos: 123456, data: "2026-09-30", tipo: "saida", forma_pagamento: "pix",
    beneficiario_nome: "Maria Aparecida da Silva", documento: null, confianca: { valor: 0.9, data: 0.9, tipo: 0.85, beneficiario: 0.8, geral: 0.9 },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:teste"), revokeObjectURL: vi.fn() }));
  // O formulário só anima o "lançar" quando a pessoa não pediu menos movimento.
  window.matchMedia = vi.fn((q: string) => ({ matches: true, media: q, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), onchange: null, dispatchEvent: vi.fn() })) as unknown as typeof window.matchMedia;
  vi.mocked(vault.categorias.listar).mockResolvedValue([]);
  vi.mocked(vault.contas.listar).mockResolvedValue([]);
  vi.mocked(vault.anexos.conteudo).mockResolvedValue(null);
  vi.mocked(vault.comprovantes.rascunhos.conteudo).mockResolvedValue(new Blob(["x"], { type: "image/png" }));
  vi.mocked(vault.beneficiarios.criarOuEncontrar).mockResolvedValue({ id: "b1", nome: "Maria Aparecida da Silva", novo: true });
});

it("camposParaConferir aponta o que a leitura não cravou", () => {
  expect(camposParaConferir(lido)).toEqual([]);
  expect(camposParaConferir({ ...lido, sugestao: { ...lido.sugestao!, valor_centavos: 5000, confianca: { ...lido.sugestao!.confianca, valor: 0.5, tipo: 0.3 }, beneficiario_nome: null } })).toEqual(["valor", "se é despesa ou receita", "quem pagou ou recebeu"]);
  expect(camposParaConferir({ ...base, sugestao: null })).toEqual([]);
});

it("preenche o formulário com o que foi lido e só cria o lançamento ao confirmar", async () => {
  vi.mocked(vault.comprovantes.rascunhos.obter).mockResolvedValue(lido);
  vi.mocked(vault.comprovantes.rascunhos.confirmar).mockResolvedValue({ id: "t1", data: "2026-09-30", descricao: "Pix para Maria Aparecida da Silva" } as never);
  const onMudou = vi.fn();
  const onFechar = vi.fn();
  render(<RevisarComprovante id="r1" onFechar={onFechar} onMudou={onMudou} />);
  expect(await screen.findByDisplayValue("Pix para Maria Aparecida da Silva")).toBeTruthy();
  expect(screen.getByDisplayValue(/1\.234,56/)).toBeTruthy();
  expect(screen.getByDisplayValue("Maria Aparecida da Silva")).toBeTruthy();
  expect(screen.getByRole("status").textContent).toContain("Dados lidos do comprovante");
  expect(vault.comprovantes.rascunhos.confirmar).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: /Confirmar e guardar/ }));
  await waitFor(() => expect(vault.comprovantes.rascunhos.confirmar).toHaveBeenCalledOnce());
  expect(vault.comprovantes.rascunhos.confirmar).toHaveBeenCalledWith("r1", expect.objectContaining({
    tipo: "saida", valor_centavos: 123456, data: "2026-09-30", descricao: "Pix para Maria Aparecida da Silva", beneficiario_id: "b1", forma_pagamento: "pix", status: "efetivada",
  }));
  expect(onMudou).toHaveBeenCalledWith({ id: "t1", data: "2026-09-30", descricao: "Pix para Maria Aparecida da Silva" });
  expect(onFechar).toHaveBeenCalled();
});

it("confiança baixa destaca os campos a conferir", async () => {
  vi.mocked(vault.comprovantes.rascunhos.obter).mockResolvedValue({ ...lido, sugestao: { ...lido.sugestao!, confianca: { valor: 0.5, data: 0.9, tipo: 0.3, beneficiario: 0.8, geral: 0.5 } } });
  render(<RevisarComprovante id="r1" onFechar={vi.fn()} onMudou={vi.fn()} />);
  expect((await screen.findByText(/Confira com atenção/)).textContent).toContain("valor, se é despesa ou receita");
});

it("enquanto lê, mostra o andamento e permite preencher à mão sem esperar", async () => {
  vi.mocked(vault.comprovantes.rascunhos.obter).mockResolvedValue({ ...base, ocr_status: "processando" });
  render(<RevisarComprovante id="r1" onFechar={vi.fn()} onMudou={vi.fn()} />);
  expect((await screen.findByRole("status")).textContent).toContain("Lendo o comprovante");
  expect(screen.queryByRole("button", { name: /Confirmar e guardar/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Preencher manualmente" }));
  expect(await screen.findByRole("button", { name: /Confirmar e guardar/ })).toBeTruthy();
});

it("leitura que falhou explica e oferece ler de novo", async () => {
  vi.mocked(vault.comprovantes.rascunhos.obter).mockResolvedValue({ ...base, ocr_status: "falhou" });
  vi.mocked(vault.comprovantes.rascunhos.reprocessar).mockResolvedValue({ ocr_status: "processando" });
  render(<RevisarComprovante id="r1" onFechar={vi.fn()} onMudou={vi.fn()} />);
  expect((await screen.findByText(/A leitura automática falhou/)).textContent).toContain("Ler de novo");
  fireEvent.click(screen.getByRole("button", { name: "Ler de novo" }));
  await waitFor(() => expect(vault.comprovantes.rascunhos.reprocessar).toHaveBeenCalledWith("r1"));
});

it("avisa quando o mesmo comprovante já está em outro lançamento", async () => {
  vi.mocked(vault.comprovantes.rascunhos.obter).mockResolvedValue(lido);
  const abrirLancamento = vi.fn();
  render(<RevisarComprovante id="r1" jaAnexadoEm="t9" onFechar={vi.fn()} onMudou={vi.fn()} abrirLancamento={abrirLancamento} />);
  expect((await screen.findByText(/já está guardado em outro lançamento/)).textContent).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Abrir lançamento" }));
  expect(abrirLancamento).toHaveBeenCalledWith("t9");
});

it("descartar só apaga depois de confirmar", async () => {
  vi.mocked(vault.comprovantes.rascunhos.obter).mockResolvedValue(lido);
  vi.mocked(vault.comprovantes.rascunhos.descartar).mockResolvedValue({ ok: true });
  const confirmar = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
  const onFechar = vi.fn();
  render(<RevisarComprovante id="r1" onFechar={onFechar} onMudou={vi.fn()} />);
  await screen.findByDisplayValue(/1\.234,56/);
  fireEvent.click(screen.getByRole("button", { name: /Descartar comprovante/ }));
  expect(vault.comprovantes.rascunhos.descartar).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: /Descartar comprovante/ }));
  await waitFor(() => expect(vault.comprovantes.rascunhos.descartar).toHaveBeenCalledWith("r1"));
  expect(onFechar).toHaveBeenCalled();
  confirmar.mockRestore();
});

it("comprovante que sumiu da fila mostra mensagem clara", async () => {
  const { ApiError } = await import("@/lib/api");
  vi.mocked(vault.comprovantes.rascunhos.obter).mockRejectedValue(new ApiError("NOT_FOUND", "x", 404));
  render(<RevisarComprovante id="r1" onFechar={vi.fn()} onMudou={vi.fn()} />);
  expect((await screen.findByRole("alert")).textContent).toContain("não está mais na fila de revisão");
});

/** O X do diálogo vem primeiro no DOM; o formulário tem o seu próprio "Fechar", que também pergunta antes de sair. */
const clicarEmFechar = (indice = 0) => fireEvent.click(screen.getAllByRole("button", { name: "Fechar" })[indice]!);

const abrirPronto = async () => {
  vi.mocked(vault.comprovantes.rascunhos.obter).mockResolvedValue(lido);
  const onFechar = vi.fn();
  const onMudou = vi.fn();
  render(<RevisarComprovante id="r1" onFechar={onFechar} onMudou={onMudou} />);
  await screen.findByDisplayValue(/1\.234,56/);
  return { onFechar, onMudou };
};

it("sair pelo X do diálogo pergunta o que fazer, em vez de fechar direto", async () => {
  const { onFechar } = await abrirPronto();
  clicarEmFechar();
  const pergunta = screen.getByRole("alertdialog", { name: "Sair da revisão" });
  expect(pergunta.textContent).toContain("ainda não foi guardado");
  expect(onFechar).not.toHaveBeenCalled();
  expect(vault.comprovantes.rascunhos.descartar).not.toHaveBeenCalled();
});

it("sair pelo Esc também pergunta, e Esc de novo volta para a revisão", async () => {
  const { onFechar } = await abrirPronto();
  fireEvent.keyDown(window, { key: "Escape" });
  await screen.findByRole("alertdialog", { name: "Sair da revisão" });
  fireEvent.keyDown(window, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("alertdialog", { name: "Sair da revisão" })).toBeNull());
  expect(onFechar).not.toHaveBeenCalled();
});

it("“Deixar na fila para depois” fecha sem apagar nada", async () => {
  const { onFechar, onMudou } = await abrirPronto();
  clicarEmFechar();
  fireEvent.click(screen.getByRole("button", { name: "Deixar na fila para depois" }));
  expect(onFechar).toHaveBeenCalledOnce();
  expect(vault.comprovantes.rascunhos.descartar).not.toHaveBeenCalled();
  expect(onMudou).not.toHaveBeenCalled();
});

it("“Descartar” na pergunta apaga o comprovante sem pedir uma segunda confirmação", async () => {
  vi.mocked(vault.comprovantes.rascunhos.descartar).mockResolvedValue({ ok: true });
  const confirmar = vi.spyOn(window, "confirm");
  const { onFechar, onMudou } = await abrirPronto();
  clicarEmFechar();
  fireEvent.click(screen.getByRole("button", { name: "Descartar" }));
  await waitFor(() => expect(vault.comprovantes.rascunhos.descartar).toHaveBeenCalledWith("r1"));
  expect(confirmar).not.toHaveBeenCalled();
  expect(onMudou).toHaveBeenCalledWith();
  expect(onFechar).toHaveBeenCalled();
  confirmar.mockRestore();
});

it("“Continuar revisando” volta ao formulário com o que já estava preenchido", async () => {
  await abrirPronto();
  clicarEmFechar();
  fireEvent.click(screen.getByRole("button", { name: "Continuar revisando" }));
  expect(screen.queryByRole("alertdialog", { name: "Sair da revisão" })).toBeNull();
  expect(screen.getByDisplayValue(/1\.234,56/)).toBeTruthy();
});

it("se o comprovante nem carregou, o X fecha direto (não há o que decidir)", async () => {
  const { ApiError } = await import("@/lib/api");
  vi.mocked(vault.comprovantes.rascunhos.obter).mockRejectedValue(new ApiError("NOT_FOUND", "x", 404));
  const onFechar = vi.fn();
  render(<RevisarComprovante id="r1" onFechar={onFechar} onMudou={vi.fn()} />);
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
  expect(onFechar).toHaveBeenCalledOnce();
});

it("o Fechar do próprio formulário também pergunta antes de sair", async () => {
  const { onFechar } = await abrirPronto();
  clicarEmFechar(1);
  expect(screen.getByRole("alertdialog", { name: "Sair da revisão" })).toBeTruthy();
  expect(onFechar).not.toHaveBeenCalled();
});
