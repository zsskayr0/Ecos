import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@/lib/api", async (importOriginal) => {
  const o = await importOriginal<typeof import("@/lib/api")>();
  return { ...o, vault: { ...o.vault, anexos: { enviar: vi.fn() } } };
});
import { vault, ANEXO_TAMANHO_MAXIMO_BYTES } from "@/lib/api";
import { AnexosPendentes, enviarAnexosPendentes } from "./AnexosPendentes";

const arq = (nome: string, tipo: string, tamanho?: number) => {
  const f = new File(["x"], nome, { type: tipo });
  if (tamanho) Object.defineProperty(f, "size", { value: tamanho });
  return f;
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn((f: File) => `blob:${f.name}`), revokeObjectURL: vi.fn() }));
  vi.mocked(vault.anexos.enviar).mockResolvedValue({ id: "x", nome_arquivo: "a", tamanho_bytes: 1, duplicado_em: null });
});

/** O componente é controlado pelo CreateFlow; aqui um pai mínimo guarda a lista. */
function Pai({ inicial = [], aoMudar }: { inicial?: File[]; aoMudar?: (f: File[]) => void }) {
  const [lista, setLista] = useState<File[]>(inicial);
  return <AnexosPendentes arquivos={lista} onChange={(f) => { setLista(f); aoMudar?.(f); }} />;
}
const escolher = (...arquivos: File[]) => fireEvent.change(screen.getByLabelText("Escolher anexos do lançamento"), { target: { files: arquivos } });

it("começa vazio, opcional, e explica que só salva com o lançamento", () => {
  render(<Pai />);
  expect(screen.getByText("Anexos")).toBeTruthy();
  expect(screen.getByText(/Os anexos são guardados quando você salvar o lançamento/)).toBeTruthy();
});

it("anexar mostra o comprovante como miniatura, com contagem e botão de tirar", () => {
  const aoMudar = vi.fn();
  render(<Pai aoMudar={aoMudar} />);
  escolher(arq("pix.png", "image/png"), arq("extrato.pdf", "application/pdf"));
  expect(aoMudar).toHaveBeenLastCalledWith([expect.objectContaining({ name: "pix.png" }), expect.objectContaining({ name: "extrato.pdf" })]);
  expect(document.querySelector('img[src="blob:pix.png"]')).not.toBeNull(); // a imagem aparece
  expect(document.querySelector('img[src="blob:extrato.pdf"]')).toBeNull(); // PDF mostra ícone, não imagem
  expect(screen.getByText("pix.png")).toBeTruthy();
  expect(screen.getByText("2")).toBeTruthy();
  expect(screen.queryByText(/Os anexos são guardados quando/)).toBeNull();
});

it("tirar um anexo remove só aquele", () => {
  render(<Pai inicial={[arq("a.png", "image/png"), arq("b.png", "image/png")]} />);
  fireEvent.click(screen.getByRole("button", { name: "Tirar a.png" }));
  expect(screen.queryByText("a.png")).toBeNull();
  expect(screen.getByText("b.png")).toBeTruthy();
});

it("tipo que o Cofre não guarda é recusado com explicação", () => {
  const aoMudar = vi.fn();
  render(<Pai aoMudar={aoMudar} />);
  escolher(arq("planilha.xlsx", "application/vnd.ms-excel"));
  expect(screen.getByRole("alert").textContent).toContain("não pode ser anexado");
  expect(aoMudar).not.toHaveBeenCalled();
});

it("PDF acima de 8 MB é recusado já; foto grande passa porque é reduzida na hora de enviar", () => {
  const aoMudar = vi.fn();
  render(<Pai aoMudar={aoMudar} />);
  escolher(arq("grande.pdf", "application/pdf", ANEXO_TAMANHO_MAXIMO_BYTES + 1));
  expect(screen.getByRole("alert").textContent).toContain("passa de 8 MB");
  expect(aoMudar).not.toHaveBeenCalled();
  escolher(arq("foto-grande.jpg", "image/jpeg", ANEXO_TAMANHO_MAXIMO_BYTES + 1));
  expect(screen.queryByRole("alert")).toBeNull();
  expect(aoMudar).toHaveBeenCalledOnce();
});

it("as pré-visualizações são soltas da memória ao sair", () => {
  const { unmount } = render(<Pai inicial={[arq("pix.png", "image/png")]} />);
  unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:pix.png");
});

it("enviarAnexosPendentes sobe todos no lançamento criado e devolve vazio quando tudo dá certo", async () => {
  const a = arq("a.png", "image/png");
  const b = arq("b.pdf", "application/pdf");
  expect(await enviarAnexosPendentes("t9", [a, b])).toEqual([]);
  expect(vault.anexos.enviar).toHaveBeenNthCalledWith(1, "t9", a);
  expect(vault.anexos.enviar).toHaveBeenNthCalledWith(2, "t9", b);
});

it("uma falha não impede os outros anexos e é devolvida para avisar a pessoa", async () => {
  vi.mocked(vault.anexos.enviar).mockRejectedValueOnce(new Error("Cofre indisponível")).mockResolvedValue({ id: "x", nome_arquivo: "b", tamanho_bytes: 1, duplicado_em: null });
  const falhas = await enviarAnexosPendentes("t9", [arq("a.png", "image/png"), arq("b.png", "image/png")]);
  expect(falhas).toEqual(["Cofre indisponível"]);
  expect(vault.anexos.enviar).toHaveBeenCalledTimes(2);
});

it("PDF grande que passou despercebido é recusado no envio, sem derrubar o resto", async () => {
  const grande = arq("grande.pdf", "application/pdf", ANEXO_TAMANHO_MAXIMO_BYTES + 1);
  const falhas = await enviarAnexosPendentes("t9", [grande, arq("ok.png", "image/png")]);
  expect(falhas).toHaveLength(1);
  expect(falhas[0]).toContain("grande.pdf");
  await waitFor(() => expect(vault.anexos.enviar).toHaveBeenCalledTimes(1));
});
