import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@/lib/api", async (importOriginal) => {
  const o = await importOriginal<typeof import("@/lib/api")>();
  return { ...o, notas: { ...o.notas, importar: vi.fn() } };
});
vi.mock("@/lib/refresh-bus", () => ({ useRefreshBus: () => ({ notificar: vi.fn() }) }));
import { notas } from "@/lib/api";
import { SoltarMarkdown } from "./SoltarMarkdown";

function dt(arquivos: File[], itens?: { kind: string; type: string }[]) {
  return { types: ["Files"], files: arquivos, items: itens ?? arquivos.map((a) => ({ kind: "file", type: a.type })), dropEffect: "none" };
}
/** jsdom não implementa `File.text()`, que a importação usa. */
const md = () => Object.assign(new File(["# oi"], "nota.md", { type: "text/markdown" }), { text: async () => "# oi" });
const pdf = () => new File(["%PDF"], "pix.pdf", { type: "application/pdf" });

beforeEach(() => { vi.clearAllMocks(); vi.mocked(notas.importar).mockResolvedValue({} as never); });

it("arrastar .md mostra o aviso de importar e soltar importa a nota", async () => {
  render(<SoltarMarkdown><p>conteúdo</p></SoltarMarkdown>);
  const zona = screen.getByText("conteúdo").parentElement!;
  fireEvent.dragEnter(zona, { dataTransfer: dt([md()]) });
  expect(screen.getByText(/Solte os arquivos .md/)).toBeTruthy();
  fireEvent.drop(zona, { dataTransfer: dt([md()]) });
  await waitFor(() => expect(notas.importar).toHaveBeenCalledWith({ nome: "nota.md", conteudo: "# oi", pasta: undefined }));
});

it("PDF ou imagem por cima das Notas: sem aviso de .md e a soltura segue adiante para o Cofre (sem preventDefault)", () => {
  render(<SoltarMarkdown><p>conteúdo</p></SoltarMarkdown>);
  const zona = screen.getByText("conteúdo").parentElement!;
  const entrou = fireEvent.dragEnter(zona, { dataTransfer: dt([pdf()]) });
  expect(entrou).toBe(true); // true = ninguém chamou preventDefault
  expect(screen.queryByText(/Solte os arquivos .md/)).toBeNull();
  const soltou = fireEvent.drop(zona, { dataTransfer: dt([pdf()]) });
  expect(soltou).toBe(true);
  expect(notas.importar).not.toHaveBeenCalled();
});

it("tipo desconhecido durante o arrasto (comum para .md no Windows) ainda mostra o aviso de .md", () => {
  render(<SoltarMarkdown><p>conteúdo</p></SoltarMarkdown>);
  const zona = screen.getByText("conteúdo").parentElement!;
  fireEvent.dragEnter(zona, { dataTransfer: dt([new File(["x"], "n.md", { type: "" })], [{ kind: "file", type: "" }]) });
  expect(screen.getByText(/Solte os arquivos .md/)).toBeTruthy();
});
