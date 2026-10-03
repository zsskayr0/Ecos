import { escolher, opcoesDe } from "@/test-helpers/escolher";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@/lib/api", async (importOriginal) => {
  const o = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...o,
    vault: {
      ...o.vault,
      beneficiarios: { listar: vi.fn(), criarOuEncontrar: vi.fn() },
      contas: { listar: vi.fn() },
      categorias: { listar: vi.fn(), criar: vi.fn() },
      comprovantes: { listar: vi.fn(), receber: vi.fn(), rascunhos: { listar: vi.fn(), obter: vi.fn(), conteudo: vi.fn(), miniatura: vi.fn(), reprocessar: vi.fn(), descartar: vi.fn(), confirmar: vi.fn() } },
      anexos: { listar: vi.fn(), enviar: vi.fn(), excluir: vi.fn(), conteudo: vi.fn(), miniatura: vi.fn() },
      transacoes: { obter: vi.fn(), atualizar: vi.fn(), excluir: vi.fn() },
    },
  };
});
vi.mock("@/components/common/PdfReader", () => ({ PdfReader: ({ nome }: { nome: string }) => <div data-testid="leitor-pdf">{nome}</div> }));
import { vault, ANEXO_TAMANHO_MAXIMO_BYTES, type ComprovanteApi } from "@/lib/api";
import { RefreshProvider } from "@/lib/refresh-bus";
import { AppUIProvider } from "@/lib/ui-context";
import { enfileirarComprovantes, limparFilaDeComprovantes, quantosEsperando } from "@/lib/fila-comprovantes";
import { VaultComprovantes } from "./VaultComprovantes";
import { ComprovantesDaTransacao } from "./comprovantes/ComprovantesDaTransacao";
import { ComprovanteViewer } from "./comprovantes/ComprovanteViewer";

const periodo = { data_de: "2026-09-01", data_ate: "2026-09-30" };
const categorias = [{ id: "c1", nome: "Mercado", tipo: "saida" as const, icone: null, cor: "#44aa77", padrao: false, espaco: "pessoal" }];
const comprovante: ComprovanteApi = {
  id: "a1", tipo: "comprovante", nome_arquivo: "pix.pdf", mime_type: "application/pdf", tamanho_bytes: 2048, criado_em: "2026-09-30 10:00:00",
  transacao: { id: "t1", data: "2026-09-30", descricao: "Compra no mercado", tipo: "saida", valor_centavos: 12990, categoria_id: "c1", beneficiario_id: "b1", conta_id: null },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:teste"), revokeObjectURL: vi.fn() }));
  vi.mocked(vault.beneficiarios.listar).mockResolvedValue([{ id: "b1", nome: "Supermercado Bom Preço", documento: null, observacoes: null }]);
  vi.mocked(vault.contas.listar).mockResolvedValue([]);
  vi.mocked(vault.categorias.listar).mockResolvedValue([]);
  window.matchMedia = vi.fn((q: string) => ({ matches: true, media: q, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), onchange: null, dispatchEvent: vi.fn() })) as unknown as typeof window.matchMedia;
  vi.mocked(vault.comprovantes.listar).mockResolvedValue({ items: [comprovante] });
  vi.mocked(vault.comprovantes.rascunhos.listar).mockResolvedValue({ items: [] });
  vi.mocked(vault.anexos.miniatura).mockResolvedValue(null);
  vi.mocked(vault.comprovantes.rascunhos.conteudo).mockResolvedValue(null);
  vi.mocked(vault.comprovantes.rascunhos.miniatura).mockResolvedValue(null);
  vi.mocked(vault.anexos.conteudo).mockResolvedValue(Object.assign(new Blob(["x"], { type: "application/pdf" }), { arrayBuffer: async () => new ArrayBuffer(8) }));
  vi.mocked(vault.anexos.listar).mockResolvedValue([]);
});

it("lista os comprovantes com os dados da transação e abre o lançamento a partir do visualizador", async () => {
  const abrir = vi.fn();
  render(<RefreshProvider><AppUIProvider><VaultComprovantes recarregar={0} periodo={periodo} categorias={categorias} abrir={abrir} /></AppUIProvider></RefreshProvider>);
  const cartao = await screen.findByRole("button", { name: "Abrir comprovante de Compra no mercado" });
  expect(cartao.textContent).toContain("30/09/2026");
  expect(cartao.textContent).toContain("Supermercado Bom Preço");
  expect(cartao.textContent).toContain("Mercado");
  fireEvent.click(cartao);
  expect((await screen.findByTestId("leitor-pdf")).textContent).toBe("pix.pdf"); // o PDF abre no leitor, sem baixar
  // "Abrir lançamento" abre o lançamento num painel à direita, na mesma janela (não navega, não fecha o comprovante).
  vi.mocked(vault.transacoes.obter).mockResolvedValue({ id: "t1", tipo: "saida", valor_centavos: 12990, moeda: "BRL", data: "2026-09-30", descricao: "Compra no mercado", categoria_id: "c1", conta_id: null, beneficiario_id: "b1", forma_pagamento: null, status: "efetivada", observacoes: null, origem: "manual", espaco: "pessoal", criado_em: "", atualizado_em: "" });
  fireEvent.click(screen.getByRole("button", { name: /^Abrir lançamento/ }));
  await waitFor(() => expect(vault.transacoes.obter).toHaveBeenCalledWith("t1"));
  expect(screen.getByRole("dialog").getAttribute("data-lancamento")).toBe("aberto");
  expect(abrir).not.toHaveBeenCalled();
});

it("os filtros vão para o servidor e a ausência de resultado explica o que fazer", async () => {
  render(<VaultComprovantes recarregar={0} periodo={periodo} categorias={categorias} abrir={vi.fn()} />);
  await screen.findByText("Compra no mercado");
  vi.mocked(vault.comprovantes.listar).mockResolvedValue({ items: [] });
  escolher("Filtrar por categoria", "Mercado");
  await screen.findByText("Nada encontrado com esses filtros", {}, { timeout: 4000 });
  expect(vault.comprovantes.listar).toHaveBeenLastCalledWith(expect.objectContaining({ categoria_id: "c1", data_de: "2026-09-01", data_ate: "2026-09-30" }));
  escolher("Filtrar por categoria", "Todas as categorias");
  await screen.findByText("Nenhum comprovante neste período", {}, { timeout: 4000 });
});

it("mostra o erro de carregamento com nova tentativa", async () => {
  vi.mocked(vault.comprovantes.listar).mockRejectedValueOnce(new Error("Cofre indisponível no momento."));
  render(<VaultComprovantes recarregar={0} periodo={periodo} categorias={categorias} abrir={vi.fn()} />);
  expect((await screen.findByRole("alert")).textContent).toContain("Cofre indisponível no momento.");
  fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
  await screen.findByText("Compra no mercado");
});

const anexo = { id: "x1", nome_arquivo: "luz.pdf", mime_type: "application/pdf", tamanho_bytes: 500, checksum_sha256: "h", criado_em: "2026-09-30", tipo: "comprovante" as const };

it("não envia arquivo acima de 8 MB e avisa antes", async () => {
  vi.mocked(vault.anexos.listar).mockResolvedValue([]);
  render(<ComprovantesDaTransacao transacaoId="t1" />);
  await screen.findByText(/Nenhum comprovante neste lançamento/);
  const grande = new File(["x"], "enorme.pdf", { type: "application/pdf" });
  Object.defineProperty(grande, "size", { value: ANEXO_TAMANHO_MAXIMO_BYTES + 1 });
  fireEvent.change(screen.getByLabelText("Escolher arquivos de comprovante"), { target: { files: [grande] } });
  expect((await screen.findByRole("alert")).textContent).toContain("passa de 8 MB");
  expect(vault.anexos.enviar).not.toHaveBeenCalled();
});

it("anexa, avisa quando o arquivo já estava em outro lançamento e recarrega a lista", async () => {
  vi.mocked(vault.anexos.listar).mockResolvedValueOnce([]).mockResolvedValue([anexo]);
  vi.mocked(vault.anexos.enviar).mockResolvedValue({ id: "x1", nome_arquivo: "luz.pdf", tamanho_bytes: 500, duplicado_em: "t9" });
  const aoMudar = vi.fn();
  render(<ComprovantesDaTransacao transacaoId="t1" aoMudar={aoMudar} />);
  await screen.findByText(/Nenhum comprovante neste lançamento/);
  fireEvent.change(screen.getByLabelText("Escolher arquivos de comprovante"), { target: { files: [new File(["pdf"], "luz.pdf", { type: "application/pdf" })] } });
  await screen.findByText(/já estava anexado a outro lançamento/);
  await screen.findByRole("button", { name: "Abrir luz.pdf" });
  expect(vault.anexos.enviar).toHaveBeenCalledWith("t1", expect.any(File), "comprovante");
  expect(aoMudar).toHaveBeenCalled();
});

it("só remove depois de confirmar", async () => {
  vi.mocked(vault.anexos.listar).mockResolvedValueOnce([anexo]).mockResolvedValue([]);
  vi.mocked(vault.anexos.excluir).mockResolvedValue({ ok: true });
  const confirmar = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
  render(<ComprovantesDaTransacao transacaoId="t1" />);
  const remover = await screen.findByRole("button", { name: "Remover luz.pdf" });
  fireEvent.click(remover);
  expect(vault.anexos.excluir).not.toHaveBeenCalled();
  fireEvent.click(remover);
  await waitFor(() => expect(vault.anexos.excluir).toHaveBeenCalledWith("x1"));
  await screen.findByText(/Nenhum comprovante neste lançamento/);
  confirmar.mockRestore();
});

it("imagem aparece no visualizador e some da memória ao fechar", async () => {
  vi.mocked(vault.anexos.conteudo).mockResolvedValue(new Blob(["img"], { type: "image/png" }));
  const fechar = vi.fn();
  const { unmount } = render(<ComprovanteViewer arquivo={{ id: "i1", nome_arquivo: "foto.png", mime_type: "image/png", tamanho_bytes: 10 }} onFechar={fechar} />);
  const img = await screen.findByRole("img", { name: "Comprovante foto.png" });
  expect(img.getAttribute("src")).toBe("blob:teste");
  fireEvent.keyDown(window, { key: "Escape" });
  expect(fechar).toHaveBeenCalled();
  unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:teste");
});

it("comprovantes compartilhados que esperavam o Cofre abrir são enviados ao abrir a aba e a revisão do primeiro aparece", async () => {
  limparFilaDeComprovantes();
  const arq = new File(["%PDF-1.7"], "pix.pdf", { type: "application/pdf" });
  enfileirarComprovantes([arq]);
  vi.mocked(vault.comprovantes.receber).mockResolvedValue({ id: "r1", nome_arquivo: "pix.pdf", mime_type: "application/pdf", tamanho_bytes: 8, reaproveitado: false, ja_anexado_em: null, ocr_status: "processando" });
  vi.mocked(vault.comprovantes.rascunhos.obter).mockResolvedValue({ id: "r1", nome_arquivo: "pix.pdf", mime_type: "application/pdf", tamanho_bytes: 8, criado_em: "2026-10-02 10:00:00", ocr_status: "indisponivel", tem_miniatura: false });
  render(<VaultComprovantes recarregar={0} periodo={periodo} categorias={categorias} abrir={vi.fn()} />);
  await screen.findByRole("dialog", { name: "Revisar comprovante" });
  expect(vault.comprovantes.receber).toHaveBeenCalledWith(arq, "comprovante");
  expect(quantosEsperando()).toBe(0);
});

it("o que for compartilhado com a aba já aberta também é enviado, e uma foto acima de 8 MB não passa sem ser reduzida", async () => {
  limparFilaDeComprovantes();
  vi.mocked(vault.comprovantes.receber).mockResolvedValue({ id: "r2", nome_arquivo: "x.pdf", mime_type: "application/pdf", tamanho_bytes: 8, reaproveitado: false, ja_anexado_em: null, ocr_status: "processando" });
  vi.mocked(vault.comprovantes.rascunhos.obter).mockResolvedValue({ id: "r2", nome_arquivo: "x.pdf", mime_type: "application/pdf", tamanho_bytes: 8, criado_em: "2026-10-02 10:00:00", ocr_status: "indisponivel", tem_miniatura: false });
  render(<VaultComprovantes recarregar={0} periodo={periodo} categorias={categorias} abrir={vi.fn()} />);
  await screen.findByText("Compra no mercado");
  const grande = new File(["x"], "extrato.pdf", { type: "application/pdf" });
  Object.defineProperty(grande, "size", { value: ANEXO_TAMANHO_MAXIMO_BYTES + 1 });
  enfileirarComprovantes([grande]);
  expect((await screen.findByRole("alert")).textContent).toContain("passa de 8 MB");
  expect(vault.comprovantes.receber).not.toHaveBeenCalled();
  enfileirarComprovantes([new File(["%PDF-1.7"], "x.pdf", { type: "application/pdf" })]);
  await screen.findByRole("dialog", { name: "Revisar comprovante" });
});

function colarNaJanela(arquivos: File[], types = ["Files"], alvo: EventTarget = document.body) {
  const ev = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "clipboardData", { value: { files: arquivos, types } });
  alvo.dispatchEvent(ev);
  return ev;
}

it("Ctrl+V na aba Comprovantes envia a imagem copiada, sem passar por arquivo no disco, e abre a revisão", async () => {
  vi.mocked(vault.comprovantes.receber).mockResolvedValue({ id: "r1", nome_arquivo: "colado.png", mime_type: "image/png", tamanho_bytes: 1, reaproveitado: false, ja_anexado_em: null, ocr_status: "processando" });
  vi.mocked(vault.comprovantes.rascunhos.obter).mockResolvedValue({ id: "r1", nome_arquivo: "colado.png", mime_type: "image/png", tamanho_bytes: 1, criado_em: "2026-10-02 10:00:00", ocr_status: "indisponivel", tem_miniatura: false });
  render(<VaultComprovantes recarregar={0} periodo={periodo} categorias={categorias} abrir={vi.fn()} />);
  await screen.findByText("Compra no mercado");
  const ev = colarNaJanela([new File(["png"], "image.png", { type: "image/png" })]);
  expect(ev.defaultPrevented).toBe(true);
  await screen.findByRole("dialog", { name: "Revisar comprovante" });
  const enviado = vi.mocked(vault.comprovantes.receber).mock.calls[0][0] as File;
  expect(enviado.name).toMatch(/^colado-\d{4}-\d{2}-\d{2}-\d{6}\.png$/);
});

it("colar texto na aba não vira comprovante e não é bloqueado", async () => {
  render(<VaultComprovantes recarregar={0} periodo={periodo} categorias={categorias} abrir={vi.fn()} />);
  await screen.findByText("Compra no mercado");
  const ev = colarNaJanela([], ["text/plain"]);
  expect(ev.defaultPrevented).toBe(false);
  expect(vault.comprovantes.receber).not.toHaveBeenCalled();
});

it("com a revisão aberta, Ctrl+V de imagem não cria outro comprovante", async () => {
  vi.mocked(vault.comprovantes.rascunhos.listar).mockResolvedValue({ items: [{ id: "r9", nome_arquivo: "fila.png", mime_type: "image/png", tamanho_bytes: 1, criado_em: "2026-10-02 10:00:00", ocr_status: "indisponivel", tem_miniatura: false }] });
  vi.mocked(vault.comprovantes.rascunhos.obter).mockResolvedValue({ id: "r9", nome_arquivo: "fila.png", mime_type: "image/png", tamanho_bytes: 1, criado_em: "2026-10-02 10:00:00", ocr_status: "indisponivel", tem_miniatura: false });
  render(<VaultComprovantes recarregar={0} periodo={periodo} categorias={categorias} abrir={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "Revisar fila.png" }));
  await screen.findByRole("dialog", { name: "Revisar comprovante" });
  colarNaJanela([new File(["png"], "image.png", { type: "image/png" })]);
  await new Promise((r) => setTimeout(r, 30));
  expect(vault.comprovantes.receber).not.toHaveBeenCalled();
});

it("botão Colar sem permissão mostra a orientação em vez de falhar calado", async () => {
  vi.stubGlobal("navigator", { clipboard: { read: async () => { throw new DOMException("negado", "NotAllowedError"); } } });
  render(<VaultComprovantes recarregar={0} periodo={periodo} categorias={categorias} abrir={vi.fn()} />);
  await screen.findByText("Compra no mercado");
  fireEvent.click(screen.getByRole("button", { name: /Colar/ }));
  expect((await screen.findByRole("alert")).textContent).toContain("Ctrl+V");
});

async function guardarComprovanteDe(dataLida: string, irParaData: (d: string) => void) {
  limparFilaDeComprovantes();
  vi.mocked(vault.comprovantes.receber).mockResolvedValue({ id: "r1", nome_arquivo: "pix.png", mime_type: "image/png", tamanho_bytes: 1, reaproveitado: false, ja_anexado_em: null, ocr_status: "pronto" });
  vi.mocked(vault.comprovantes.rascunhos.obter).mockResolvedValue({
    id: "r1", nome_arquivo: "pix.png", mime_type: "image/png", tamanho_bytes: 1, criado_em: "2026-10-02 10:00:00", ocr_status: "pronto", tem_miniatura: false,
    sugestao: { descricao: "Pix para Ana", valor_centavos: 5000, data: dataLida, tipo: "saida", forma_pagamento: "pix", beneficiario_nome: null, documento: null, confianca: { valor: 0.9, data: 0.9, tipo: 0.85, beneficiario: 0, geral: 0.9 } },
  });
  vi.mocked(vault.comprovantes.rascunhos.conteudo).mockResolvedValue(null);
  vi.mocked(vault.comprovantes.rascunhos.confirmar).mockResolvedValue({ id: "t7", data: dataLida, descricao: "Pix para Ana" } as never);
  render(<VaultComprovantes recarregar={0} periodo={periodo} categorias={categorias} abrir={vi.fn()} irParaData={irParaData} />);
  await screen.findByText("Compra no mercado");
  enfileirarComprovantes([new File(["png"], "pix.png", { type: "image/png" })]);
  await screen.findByDisplayValue("Pix para Ana");
  fireEvent.click(screen.getByRole("button", { name: /Confirmar e guardar/ }));
  return await screen.findByText(/Comprovante guardado em/);
}

it("guardar um comprovante de OUTRO mês leva a lista até esse mês e avisa (senão ele 'sumia')", async () => {
  const irParaData = vi.fn();
  const aviso = await guardarComprovanteDe("2026-08-15", irParaData);
  expect(irParaData).toHaveBeenCalledWith("2026-08-15");
  expect(aviso.textContent).toContain("“Pix para Ana” (15/08/2026)");
  expect(aviso.textContent).toContain("A lista foi para o mês desse lançamento");
});

it("comprovante dentro do período em tela não muda o mês, mas o aviso e o atalho aparecem", async () => {
  const irParaData = vi.fn();
  const aviso = await guardarComprovanteDe("2026-09-20", irParaData);
  expect(irParaData).not.toHaveBeenCalled();
  expect(aviso.textContent).not.toContain("A lista foi para o mês");
  expect(within(aviso).getByRole("button", { name: "Abrir lançamento" })).toBeTruthy();
});

it("o container de anexos mostra o PRÓPRIO comprovante em miniatura e clicar nele abre o visualizador com a imagem", async () => {
  vi.mocked(vault.anexos.listar).mockResolvedValue([{ id: "x1", nome_arquivo: "pix.png", mime_type: "image/png", tamanho_bytes: 500, checksum_sha256: "h", criado_em: "", tipo: "comprovante" as const }]);
  vi.mocked(vault.anexos.miniatura).mockResolvedValue(new Blob(["m"], { type: "image/jpeg" }));
  vi.mocked(vault.anexos.conteudo).mockResolvedValue(new Blob(["i"], { type: "image/png" }));
  render(<ComprovantesDaTransacao transacaoId="t1" />);
  const tile = await screen.findByRole("button", { name: "Abrir pix.png" });
  await waitFor(() => expect(tile.querySelector("img")).not.toBeNull()); // a miniatura do servidor, não um ícone
  expect(vault.anexos.miniatura).toHaveBeenCalledWith("x1");
  fireEvent.click(tile);
  expect((await screen.findByRole("img", { name: "Comprovante pix.png" })).getAttribute("src")).toBe("blob:teste");
});

it("PDF no container aparece como ícone de documento (sem pedir miniatura) e o tile Anexar sempre existe", async () => {
  vi.mocked(vault.anexos.listar).mockResolvedValue([{ id: "p1", nome_arquivo: "extrato.pdf", mime_type: "application/pdf", tamanho_bytes: 500, checksum_sha256: "h", criado_em: "", tipo: "comprovante" as const }]);
  render(<ComprovantesDaTransacao transacaoId="t1" />);
  const tile = await screen.findByRole("button", { name: "Abrir extrato.pdf" });
  expect(tile.querySelector("img")).toBeNull();
  expect(vault.anexos.miniatura).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: /Anexar/ })).toBeTruthy();
});

const nota = { ...anexo, id: "n1", nome_arquivo: "nota.pdf", checksum_sha256: "h2", tipo: "nota_fiscal" as const };

it("nota fiscal: cada tipo tem o seu container no lançamento, só lista o que é dele e envia com o tipo certo", async () => {
  vi.mocked(vault.anexos.listar).mockResolvedValue([anexo, nota]);
  vi.mocked(vault.anexos.enviar).mockResolvedValue({ id: "n2", nome_arquivo: "nf2.pdf", tamanho_bytes: 500, duplicado_em: null });
  render(<><ComprovantesDaTransacao transacaoId="t1" /><ComprovantesDaTransacao transacaoId="t1" tipo="nota_fiscal" /></>);
  const comprovantes = await screen.findByRole("region", { name: "Comprovantes do lançamento" });
  const notas = await screen.findByRole("region", { name: "Notas fiscais do lançamento" });
  await waitFor(() => expect(notas.textContent).toContain("nota.pdf"));
  expect(comprovantes.textContent).toContain("luz.pdf");
  expect(comprovantes.textContent).not.toContain("nota.pdf");
  expect(notas.textContent).not.toContain("luz.pdf");
  fireEvent.change(screen.getByLabelText("Escolher arquivos de nota fiscal"), { target: { files: [new File(["pdf"], "nf2.pdf", { type: "application/pdf" })] } });
  await waitFor(() => expect(vault.anexos.enviar).toHaveBeenCalledWith("t1", expect.any(File), "nota_fiscal"));
});

it("nota fiscal sem arquivos explica o que anexar", async () => {
  vi.mocked(vault.anexos.listar).mockResolvedValue([anexo]);
  render(<ComprovantesDaTransacao transacaoId="t1" tipo="nota_fiscal" />);
  expect(await screen.findByText(/Nenhuma nota fiscal neste lançamento/)).toBeTruthy();
});

it("aba Comprovantes: o filtro de tipo vai ao servidor, e Adicionar nota fiscal envia como nota fiscal", async () => {
  vi.mocked(vault.comprovantes.receber).mockResolvedValue({ id: "r1", nome_arquivo: "nf.pdf", mime_type: "application/pdf", tamanho_bytes: 8, reaproveitado: false, ja_anexado_em: null, ocr_status: "processando" });
  vi.mocked(vault.comprovantes.rascunhos.obter).mockResolvedValue({ id: "r1", nome_arquivo: "nf.pdf", mime_type: "application/pdf", tamanho_bytes: 8, criado_em: "2026-10-02 10:00:00", ocr_status: "indisponivel", tem_miniatura: false });
  render(<RefreshProvider><AppUIProvider><VaultComprovantes recarregar={0} periodo={periodo} categorias={categorias} abrir={vi.fn()} /></AppUIProvider></RefreshProvider>);
  await screen.findByText("Compra no mercado");
  fireEvent.click(screen.getByRole("button", { name: "Notas fiscais" }));
  await waitFor(() => expect(vault.comprovantes.listar).toHaveBeenLastCalledWith(expect.objectContaining({ tipo: "nota_fiscal" })));
  fireEvent.click(screen.getByRole("button", { name: "Todos" }));
  await waitFor(() => expect(vault.comprovantes.listar).toHaveBeenLastCalledWith(expect.not.objectContaining({ tipo: expect.anything() })));

  const arq = new File(["%PDF-1.7"], "nf.pdf", { type: "application/pdf" });
  fireEvent.change(screen.getByLabelText("Escolher notas fiscais para adicionar"), { target: { files: [arq] } });
  await waitFor(() => expect(vault.comprovantes.receber).toHaveBeenCalledWith(arq, "nota_fiscal"));
});

it("aba Comprovantes: vendo só notas fiscais, o que for colado entra como nota fiscal", async () => {
  vi.mocked(vault.comprovantes.receber).mockResolvedValue({ id: "r1", nome_arquivo: "colado.png", mime_type: "image/png", tamanho_bytes: 1, reaproveitado: false, ja_anexado_em: null, ocr_status: "processando" });
  vi.mocked(vault.comprovantes.rascunhos.obter).mockResolvedValue({ id: "r1", nome_arquivo: "colado.png", mime_type: "image/png", tamanho_bytes: 1, criado_em: "2026-10-02 10:00:00", ocr_status: "indisponivel", tem_miniatura: false });
  render(<RefreshProvider><AppUIProvider><VaultComprovantes recarregar={0} periodo={periodo} categorias={categorias} abrir={vi.fn()} /></AppUIProvider></RefreshProvider>);
  await screen.findByText("Compra no mercado");
  fireEvent.click(screen.getByRole("button", { name: "Notas fiscais" }));
  const imagem = new File([new Uint8Array([137, 80, 78, 71])], "colado.png", { type: "image/png" });
  colarNaJanela([imagem]);
  await waitFor(() => expect(vault.comprovantes.receber).toHaveBeenCalledWith(imagem, "nota_fiscal"));
});

it("o cartão de uma nota fiscal avisa que é nota fiscal", async () => {
  vi.mocked(vault.comprovantes.listar).mockResolvedValue({ items: [{ ...comprovante, id: "n1", tipo: "nota_fiscal" }] });
  render(<RefreshProvider><AppUIProvider><VaultComprovantes recarregar={0} periodo={periodo} categorias={categorias} abrir={vi.fn()} /></AppUIProvider></RefreshProvider>);
  const cartao = await screen.findByRole("button", { name: "Abrir nota fiscal de Compra no mercado" });
  expect(cartao.textContent).toContain("Nota fiscal");
});

it("recarregar a aba Comprovantes (depois de guardar/editar) mantém os cartões na tela, sem 'Carregando'", async () => {
  const aba = (n: number) => <RefreshProvider><AppUIProvider><VaultComprovantes recarregar={n} periodo={periodo} categorias={categorias} abrir={vi.fn()} /></AppUIProvider></RefreshProvider>;
  const { rerender } = render(aba(0));
  await screen.findByText("Compra no mercado");
  const chamadas = vi.mocked(vault.comprovantes.listar).mock.calls.length;
  let liberar!: (v: { items: ComprovanteApi[] }) => void;
  vi.mocked(vault.comprovantes.listar).mockImplementationOnce(() => new Promise((r) => { liberar = r; }));
  rerender(aba(1));
  await waitFor(() => expect(vault.comprovantes.listar).toHaveBeenCalledTimes(chamadas + 1));
  expect(screen.getByText("Compra no mercado")).toBeTruthy();
  expect(screen.queryByText("Carregando comprovantes…")).toBeNull();
  await act(async () => { liberar({ items: [{ ...comprovante, transacao: { ...comprovante.transacao, descricao: "Compra atualizada" } }] }); });
  expect(await screen.findByText("Compra atualizada")).toBeTruthy();
});
