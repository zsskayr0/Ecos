import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { MenuCriar } from "./MenuCriar";

const abrirCaptura = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ui-context", () => ({ useAppUI: () => ({ abrirCaptura, diaCofre: null }) }));

it("Criar oferece Evento no desktop e abre o editor de eventos", () => {
  render(<MenuCriar />);
  fireEvent.click(screen.getByRole("button", { name: "Criar" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Evento" }));
  expect(abrirCaptura).toHaveBeenCalledWith("evento", null);
});
