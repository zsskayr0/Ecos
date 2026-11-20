import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, it, vi } from "vitest";
import { CorpoEditor } from "./CorpoEditor";

vi.mock("@/lib/use-viewport", () => ({ useIsMobile: () => true, useIsDesktop: () => false }));
vi.mock("@/lib/tinta/use-tinta", () => ({ useTinta: () => ({ carregado: true, tracos: [], largura: null }) }));
class RO { observe() {} unobserve() {} disconnect() {} }
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= RO;
vi.mock("./EditorVivo", () => ({ EditorVivo: () => null }));
vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });

it("abre os comandos extras no menu e põe o botão do modo de escrita na paleta flutuante (sem prévia em nota com escrita)", () => {
  render(<MemoryRouter><CorpoEditor corpo="" onCorpoChange={vi.fn()} tipo="nota" tintaNotaId="nota" layout="document" /></MemoryRouter>);
  const barra = within(screen.getByRole("toolbar", { name: "Formatação da descrição" }));
  expect(screen.queryByRole("group", { name: "Modo do editor" })).toBeNull();
  expect(barra.getByRole("button", { name: "Escrever à mão" })).toBeTruthy();
  expect(barra.queryByRole("button", { name: "Pré-visualizar descrição" })).toBeNull();
  expect(barra.getByRole("button", { name: /Negrito/ })).toBeTruthy();
  expect(barra.queryByRole("button", { name: "Checklist" })).toBeNull();
  fireEvent.click(barra.getByRole("button", { name: "Mais opções de formatação" }));
  expect(screen.getByRole("menuitem", { name: "Checklist" })).toBeTruthy();
  fireEvent.click(screen.getByRole("menuitem", { name: "Emoji" }));
  expect(screen.getByRole("dialog", { name: "Escolher emoji" })).toBeTruthy();
});
