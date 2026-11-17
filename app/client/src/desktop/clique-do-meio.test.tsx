import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DocumentoPopupContext, useAbrirDocumento } from "@/lib/documento-popup";
import { MemoryRouter } from "react-router-dom";
import { useCliqueDoMeio } from "./clique-do-meio";

afterEach(cleanup);

function Item({ aoConcluir }: { aoConcluir: () => void }) {
  const abrir = useAbrirDocumento();
  useCliqueDoMeio();
  return (
    <div>
      <button type="button" onClick={(e) => abrir("/tarefa/1", e)}>Minha tarefa</button>
      <button type="button" aria-label="Concluir" onClick={aoConcluir}><svg /></button>
      <input aria-label="campo" />
    </div>
  );
}

function montar() {
  const abrirPopup = vi.fn(); const concluir = vi.fn();
  render(<MemoryRouter><DocumentoPopupContext.Provider value={abrirPopup}><Item aoConcluir={concluir} /></DocumentoPopupContext.Provider></MemoryRouter>);
  return { abrirPopup, concluir };
}

describe("clique do meio", () => {
  it("abre o item em uma guia", () => {
    const { abrirPopup } = montar();
    fireEvent(screen.getByText("Minha tarefa"), new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 1 }));
    expect(abrirPopup).toHaveBeenCalledWith("/tarefa/1", "segundo-plano");
  });
  it("não dispara botões só de ícone nem campos", () => {
    const { abrirPopup, concluir } = montar();
    fireEvent(screen.getByLabelText("Concluir"), new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 1 }));
    fireEvent(screen.getByLabelText("campo"), new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 1 }));
    expect(concluir).not.toHaveBeenCalled();
    expect(abrirPopup).not.toHaveBeenCalled();
  });
  it("o clique normal continua abrindo a janela, não a guia", () => {
    const { abrirPopup } = montar();
    fireEvent.click(screen.getByText("Minha tarefa"));
    expect(abrirPopup).toHaveBeenCalledWith("/tarefa/1", false);
  });
});
