import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const estado = vi.hoisted(() => ({ perfil: { cofre_ativado: true } as { cofre_ativado: boolean } | null }));
vi.mock("@/lib/auth-context", () => ({ useAuth: () => ({ perfil: estado.perfil }) }));
import { limparFilaDeComprovantes, quantosEsperando, tomarComprovantes } from "@/lib/fila-comprovantes";
import { SoltarNoCofre, ehArquivoDoCofre } from "./SoltarNoCofre";

const arq = (nome: string, tipo: string) => new File(["x"], nome, { type: tipo });

/** jsdom não tem DragEvent nem DataTransfer: monta o mínimo que o componente lê. */
function arrastar(tipo: "dragenter" | "dragover" | "drop" | "dragend", opcoes: { arquivos?: File[]; types?: string[]; itens?: { kind: string; type: string }[]; alvo?: EventTarget; jaTratado?: boolean } = {}) {
  const arquivos = opcoes.arquivos ?? [];
  const ev = new Event(tipo, { bubbles: true, cancelable: true });
  const dataTransfer = {
    types: opcoes.types ?? (arquivos.length || opcoes.itens ? ["Files"] : []),
    items: opcoes.itens ?? arquivos.map((a) => ({ kind: "file", type: a.type })),
    files: arquivos,
    dropEffect: "none",
  };
  Object.defineProperty(ev, "dataTransfer", { value: dataTransfer });
  if (opcoes.jaTratado) ev.preventDefault(); // alguém (ex.: importação de .md) já assumiu o evento
  act(() => { (opcoes.alvo ?? window).dispatchEvent(ev); });
  return ev;
}

beforeEach(() => {
  vi.useFakeTimers();
  limparFilaDeComprovantes();
  estado.perfil = { cofre_ativado: true };
});
afterEach(() => vi.useRealTimers());

it("reconhece PDF e imagem pelo tipo, ou pela extensão quando o sistema não informa o tipo", () => {
  expect(ehArquivoDoCofre(arq("a.pdf", "application/pdf"))).toBe(true);
  expect(ehArquivoDoCofre(arq("a.png", "image/png"))).toBe(true);
  expect(ehArquivoDoCofre(arq("FOTO.HEIC", ""))).toBe(true);
  expect(ehArquivoDoCofre(arq("a.zip", "application/zip"))).toBe(false);
  expect(ehArquivoDoCofre(arq("pasta", ""))).toBe(false);
  expect(ehArquivoDoCofre(arq("nota.md", "text/markdown"))).toBe(false);
  expect(ehArquivoDoCofre(arq("a.exe", "image/png.exe"))).toBe(false);
});

it("arrastar arquivo por cima de qualquer parte da janela mostra o aviso, e ele some quando o arrasto para", () => {
  render(<div><SoltarNoCofre /><main data-testid="miolo">tela qualquer</main></div>);
  expect(screen.queryByRole("status")).toBeNull();
  arrastar("dragenter", { arquivos: [arq("pix.pdf", "application/pdf")], alvo: screen.getByTestId("miolo") });
  expect(screen.getByRole("status").textContent).toContain("Solte para guardar no Cofre");
  act(() => { vi.advanceTimersByTime(200); });
  arrastar("dragover", { arquivos: [arq("pix.pdf", "application/pdf")] });
  act(() => { vi.advanceTimersByTime(300); });
  expect(screen.getByRole("status")).toBeTruthy(); // o dragover manteve vivo
  act(() => { vi.advanceTimersByTime(500); });
  expect(screen.queryByRole("status")).toBeNull();
});

it("arrasto que não é de arquivo (cartão do calendário, texto) passa batido: sem aviso, sem preventDefault", () => {
  render(<SoltarNoCofre />);
  const ev = arrastar("dragover", { types: ["text/plain"] });
  expect(screen.queryByRole("status")).toBeNull();
  expect(ev.defaultPrevented).toBe(false);
  const soltou = arrastar("drop", { types: ["text/plain"] });
  expect(soltou.defaultPrevented).toBe(false);
  expect(quantosEsperando()).toBe(0);
});

it("arquivo de tipo que o Cofre não guarda não mostra o aviso de soltar (o cursor indica que não pode)", () => {
  render(<SoltarNoCofre />);
  const ev = arrastar("dragover", { arquivos: [arq("a.zip", "application/zip")] });
  expect(screen.queryByRole("status")).toBeNull();
  expect(ev.defaultPrevented).toBe(false);
});

it("soltar entrega só PDF e imagens à fila, avisa dos ignorados e impede o WebView de abrir o arquivo", () => {
  render(<SoltarNoCofre />);
  arrastar("dragenter", { arquivos: [arq("a.pdf", "application/pdf")] });
  const ev = arrastar("drop", { arquivos: [arq("a.pdf", "application/pdf"), arq("b.jpg", "image/jpeg"), arq("c.zip", "application/zip")] });
  expect(ev.defaultPrevented).toBe(true);
  expect(tomarComprovantes().map((f) => f.name)).toEqual(["a.pdf", "b.jpg"]);
  expect(screen.queryByText("Solte para guardar no Cofre")).toBeNull();
  expect(screen.getByRole("status").textContent).toContain("1 arquivo ignorado");
});

it("só arquivos que o Cofre não guarda: explica e não enfileira nada", () => {
  render(<SoltarNoCofre />);
  const ev = arrastar("drop", { arquivos: [arq("backup.zip", "application/zip")] });
  expect(ev.defaultPrevented).toBe(true);
  expect(screen.getByRole("alert").textContent).toContain("Só PDF e imagens");
  expect(quantosEsperando()).toBe(0);
});

it("conta sem Cofre ativado: avisa com clareza e não guarda o arquivo na fila", () => {
  estado.perfil = { cofre_ativado: false };
  render(<SoltarNoCofre />);
  arrastar("drop", { arquivos: [arq("pix.pdf", "application/pdf")] });
  expect(screen.getByRole("alert").textContent).toContain("O Cofre não está ativado");
  expect(quantosEsperando()).toBe(0);
});

it("quem já tratou o evento (importação de .md nas Notas) fica com ele: nada vai para o Cofre", () => {
  render(<SoltarNoCofre />);
  arrastar("dragenter", { arquivos: [arq("nota.md", "text/markdown")], jaTratado: true });
  expect(screen.queryByRole("status")).toBeNull();
  arrastar("drop", { arquivos: [arq("nota.md", "text/markdown"), arq("a.pdf", "application/pdf")], jaTratado: true });
  expect(quantosEsperando()).toBe(0);
});

it("o aviso de erro some sozinho depois de alguns segundos", () => {
  render(<SoltarNoCofre />);
  arrastar("drop", { arquivos: [arq("x.zip", "application/zip")] });
  expect(screen.getByRole("alert")).toBeTruthy();
  act(() => { vi.advanceTimersByTime(6100); });
  expect(screen.queryByRole("alert")).toBeNull();
});

it("depois de desmontar, não escuta mais nada", () => {
  const { unmount } = render(<SoltarNoCofre />);
  unmount();
  const ev = arrastar("drop", { arquivos: [arq("a.pdf", "application/pdf")] });
  expect(ev.defaultPrevented).toBe(false);
  expect(quantosEsperando()).toBe(0);
});
