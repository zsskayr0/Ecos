import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

const avisar = vi.hoisted(() => vi.fn());
vi.mock("@/lib/toast", () => ({ avisar }));
vi.mock("@/lib/api", async (importOriginal) => {
  const o = await importOriginal<typeof import("@/lib/api")>();
  return { ...o, vault: { ...o.vault, anexos: { listar: vi.fn(), enviar: vi.fn(), conteudo: vi.fn(), miniatura: vi.fn() } } };
});
import { vault, ANEXO_TAMANHO_MAXIMO_BYTES, type AnexoApi } from "@/lib/api";
import { BotaoAnexos } from "./BotaoAnexos";

const anexo = (id: string, nome: string, mime = "image/png"): AnexoApi => ({ id, nome_arquivo: nome, mime_type: mime, tamanho_bytes: 100, checksum_sha256: "h", criado_em: "2026-10-02", tipo: "comprovante" });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:t"), revokeObjectURL: vi.fn() }));
  vi.mocked(vault.anexos.conteudo).mockResolvedValue(new Blob(["x"], { type: "image/png" }));
  vi.mocked(vault.anexos.listar).mockResolvedValue([]);
  vi.mocked(vault.anexos.enviar).mockResolvedValue({ id: "novo", nome_arquivo: "n.png", tamanho_bytes: 1, duplicado_em: null });
});

/** Dentro de uma "linha" clicável, como na lista: clicar nela abre o lançamento. */
function naLinha(props: Partial<React.ComponentProps<typeof BotaoAnexos>> = {}) {
  const abrirLancamento = vi.fn();
  const aoMudar = vi.fn();
  const r = render(
    <div className="cofre-app" onClick={abrirLancamento} data-testid="linha">
      <BotaoAnexos transacaoId="t1" quantidade={0} descricao="Mercado" aoMudar={aoMudar} {...props} />
    </div>,
  );
  return { abrirLancamento, aoMudar, ...r };
}

it("sem anexos o clipe convida a anexar; com anexos fica marcado e a contagem vai só na dica (sem número no ícone)", () => {
  const { unmount } = naLinha({ quantidade: 0 });
  expect(screen.getByRole("button", { name: "Anexar comprovante a Mercado" })).toBeTruthy();
  unmount();
  naLinha({ quantidade: 3 });
  const botao = screen.getByRole("button", { name: "3 comprovantes de Mercado" });
  expect(botao.textContent).toBe("");
  expect(botao.getAttribute("title")).toContain("3 comprovantes");
  expect(botao.getAttribute("data-tem")).toBe("true");
});

it("a nota fiscal tem o próprio ícone, só lista as notas e envia como nota fiscal", async () => {
  vi.mocked(vault.anexos.listar).mockResolvedValue([anexo("a1", "pix.png"), { ...anexo("n1", "nota.png"), tipo: "nota_fiscal" }]);
  const { unmount } = naLinha({ quantidade: 1, tipo: "nota_fiscal" });
  fireEvent.click(screen.getByRole("button", { name: "1 nota fiscal de Mercado" }));
  await screen.findByRole("img", { name: "Comprovante nota.png" });
  expect(screen.queryByText("1 de 2")).toBeNull(); // o comprovante comum não entra na navegação das notas
  unmount();
  naLinha({ quantidade: 0, tipo: "nota_fiscal" });
  fireEvent.change(screen.getByLabelText("Escolher nota fiscal para Mercado"), { target: { files: [new File(["x"], "n.png", { type: "image/png" })] } });
  await waitFor(() => expect(vault.anexos.enviar).toHaveBeenCalledWith("t1", expect.any(File), "nota_fiscal"));
});

it("no singular fala em 1 anexo", () => {
  naLinha({ quantidade: 1 });
  expect(screen.getByRole("button", { name: "1 comprovante de Mercado" })).toBeTruthy();
});

it("com anexos, clicar MOSTRA O COMPROVANTE no visualizador, com o lançamento disponível ao lado", async () => {
  vi.mocked(vault.anexos.listar).mockResolvedValue([anexo("a1", "pix.png")]);
  const { abrirLancamento } = naLinha({ quantidade: 1 });
  fireEvent.click(screen.getByRole("button", { name: "1 comprovante de Mercado" }));
  const imagem = await screen.findByRole("img", { name: "Comprovante pix.png" });
  expect(imagem.getAttribute("src")).toBe("blob:t");
  expect(vault.anexos.listar).toHaveBeenCalledWith("t1");
  expect(screen.getByRole("button", { name: "Abrir lançamento" })).toBeTruthy();
  expect(abrirLancamento).not.toHaveBeenCalled(); // o clique no clipe não abre o lançamento da linha
});

it("vários anexos: setas passam de um para o outro e mostram a posição", async () => {
  vi.mocked(vault.anexos.listar).mockResolvedValue([anexo("a1", "um.png"), anexo("a2", "dois.png")]);
  naLinha({ quantidade: 2 });
  fireEvent.click(screen.getByRole("button", { name: "2 comprovantes de Mercado" }));
  await screen.findByRole("img", { name: "Comprovante um.png" });
  expect(screen.getByText("1 de 2")).toBeTruthy();
  expect((screen.getByRole("button", { name: "Anexo anterior" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Próximo anexo" }));
  await screen.findByRole("img", { name: "Comprovante dois.png" });
  expect(screen.getByText("2 de 2")).toBeTruthy();
  expect((screen.getByRole("button", { name: "Próximo anexo" }) as HTMLButtonElement).disabled).toBe(true);
});

it("clicar dentro do visualizador (inclusive no fundo) nunca abre o lançamento da linha", async () => {
  vi.mocked(vault.anexos.listar).mockResolvedValue([anexo("a1", "pix.png")]);
  const { abrirLancamento } = naLinha({ quantidade: 1 });
  fireEvent.click(screen.getByRole("button", { name: "1 comprovante de Mercado" }));
  await screen.findByRole("img", { name: "Comprovante pix.png" });
  fireEvent.click(screen.getByRole("img", { name: "Comprovante pix.png" }));
  fireEvent.click(document.querySelector(".cofre-viewer-backdrop")!); // fecha o visualizador
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(abrirLancamento).not.toHaveBeenCalled();
});

it("sem anexos, clicar abre a escolha de arquivo, envia, avisa a lista e mostra o comprovante recém-enviado", async () => {
  const clicar = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
  vi.mocked(vault.anexos.listar).mockResolvedValue([anexo("a1", "antigo.png"), anexo("a2", "novo.png")]);
  const { abrirLancamento, aoMudar } = naLinha({ quantidade: 0 });
  fireEvent.click(screen.getByRole("button", { name: "Anexar comprovante a Mercado" }));
  expect(clicar).toHaveBeenCalled();
  expect(abrirLancamento).not.toHaveBeenCalled();
  const arquivo = new File(["png"], "novo.png", { type: "image/png" });
  fireEvent.change(screen.getByLabelText("Escolher comprovante para Mercado"), { target: { files: [arquivo] } });
  await waitFor(() => expect(vault.anexos.enviar).toHaveBeenCalledWith("t1", arquivo, "comprovante"));
  expect(aoMudar).toHaveBeenCalled();
  await screen.findByRole("img", { name: "Comprovante novo.png" }); // abre direto no último, o que acabou de entrar
  expect(screen.getByText("2 de 2")).toBeTruthy();
  clicar.mockRestore();
});

it("a escolha de arquivo não vaza o clique para a linha", () => {
  const { abrirLancamento } = naLinha({ quantidade: 0 });
  fireEvent.click(screen.getByLabelText("Escolher comprovante para Mercado"));
  expect(abrirLancamento).not.toHaveBeenCalled();
});

it("arquivo acima de 8 MB é recusado antes de enviar", async () => {
  naLinha({ quantidade: 0 });
  const grande = new File(["x"], "enorme.pdf", { type: "application/pdf" });
  Object.defineProperty(grande, "size", { value: ANEXO_TAMANHO_MAXIMO_BYTES + 1 });
  fireEvent.change(screen.getByLabelText("Escolher comprovante para Mercado"), { target: { files: [grande] } });
  await waitFor(() => expect(avisar).toHaveBeenCalledWith(expect.stringContaining("passa de 8 MB")));
  expect(vault.anexos.enviar).not.toHaveBeenCalled();
});

it("falha ao enviar avisa e não abre visualizador nem muda a lista", async () => {
  vi.mocked(vault.anexos.enviar).mockRejectedValue(new Error("Cofre indisponível"));
  const { aoMudar } = naLinha({ quantidade: 0 });
  fireEvent.change(screen.getByLabelText("Escolher comprovante para Mercado"), { target: { files: [new File(["x"], "a.png", { type: "image/png" })] } });
  await waitFor(() => expect(avisar).toHaveBeenCalled());
  expect(aoMudar).not.toHaveBeenCalled();
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("contagem desatualizada (lista diz que há anexo, mas já não há): avisa em vez de abrir vazio", async () => {
  vi.mocked(vault.anexos.listar).mockResolvedValue([]);
  naLinha({ quantidade: 1 });
  fireEvent.click(screen.getByRole("button", { name: "1 comprovante de Mercado" }));
  await waitFor(() => expect(avisar).toHaveBeenCalledWith("Este lançamento não tem comprovantes."));
  expect(screen.queryByRole("dialog")).toBeNull();
});
