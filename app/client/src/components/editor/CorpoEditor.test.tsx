import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, it, vi } from "vitest";
import { CorpoEditor } from "./CorpoEditor";

vi.mock("@/lib/use-viewport", () => ({ useIsMobile: () => true, useIsDesktop: () => false }));
vi.mock("@/lib/tinta/use-tinta", () => ({ useTinta: () => ({ carregado: true, tracos: [], largura: null }) }));
vi.mock("./EditorVivo", () => ({ EditorVivo: () => null }));

it("abre os comandos extras no menu e separa o modo de escrita da formatação (sem prévia em nota com escrita)", () => {
  render(<MemoryRouter><CorpoEditor corpo="" onCorpoChange={vi.fn()} tipo="nota" tintaNotaId="nota" layout="document" /></MemoryRouter>);
  const barra = within(screen.getByRole("toolbar", { name: "Formatação da descrição" }));
  const modos = within(screen.getByRole("group", { name: "Modo do editor" }));
  expect(modos.queryByRole("button", { name: "Pré-visualizar descrição" })).toBeNull();
  expect(modos.getByRole("button", { name: "Modo de escrita" })).toBeTruthy();
  expect(barra.queryByRole("button", { name: "Pré-visualizar descrição" })).toBeNull();
  expect(barra.getByRole("button", { name: /Negrito/ })).toBeTruthy();
  expect(barra.queryByRole("button", { name: "Checklist" })).toBeNull();
  fireEvent.click(barra.getByRole("button", { name: "Mais opções de formatação" }));
  expect(screen.getByRole("menuitem", { name: "Checklist" })).toBeTruthy();
  fireEvent.click(screen.getByRole("menuitem", { name: "Emoji" }));
  expect(screen.getByRole("dialog", { name: "Escolher emoji" })).toBeTruthy();
});
