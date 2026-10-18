import { useContext } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { AbaTarefa } from "./AbaTarefa";
import { ModoFocusDocumentoContext, PainelFocusControleContext } from "@/lib/documento-popup";

function Sonda() {
  const focus = useContext(ModoFocusDocumentoContext);
  const painel = useContext(PainelFocusControleContext);
  return <button type="button" onClick={painel.alternar}>focus:{String(focus)} painel:{String(painel.aberto)}</button>;
}

describe("AbaTarefa", () => {
  it("tarefa fixada como aba ganha o layout do Focus embutido, com painel aberto e recolhível", () => {
    render(<MemoryRouter initialEntries={["/tarefa/1"]}><AbaTarefa><Sonda /></AbaTarefa></MemoryRouter>);
    expect(document.querySelector("[data-aba-tarefa]")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "focus:true painel:true" }));
    expect(screen.getByRole("button", { name: "focus:true painel:false" })).toBeTruthy();
  });

  it("outras telas ficam como estavam", () => {
    render(<MemoryRouter initialEntries={["/notas"]}><AbaTarefa><Sonda /></AbaTarefa></MemoryRouter>);
    expect(document.querySelector("[data-aba-tarefa]")).toBeNull();
    expect(screen.getByRole("button", { name: "focus:false painel:true" })).toBeTruthy();
  });
});
