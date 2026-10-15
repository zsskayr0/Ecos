import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { Dialog } from "./Dialog";
import { ArmadilhaFoco } from "./ArmadilhaFoco";

function Exemplo() {
  const [aberto, setAberto] = useState(false);
  return (
    <>
      <ArmadilhaFoco />
      <button onClick={() => setAberto(true)}>Abrir</button>
      <button>Fundo</button>
      {aberto && (
        <Dialog rotulo="Exemplo" onFechar={() => setAberto(false)}>
          <div className="card">
            <button>Primeiro</button>
            <button>Ultimo</button>
          </div>
        </Dialog>
      )}
    </>
  );
}

describe("Dialog", () => {
  // jsdom não faz layout: getClientRects() vem vazio e a armadilha trataria tudo como invisível.
  beforeAll(() => { HTMLElement.prototype.getClientRects = function () { return [{}] as unknown as DOMRectList; }; });

  it("expõe role, nome e aria-modal", () => {
    render(<Exemplo />);
    fireEvent.click(screen.getByText("Abrir"));
    const d = screen.getByRole("dialog", { name: "Exemplo" });
    expect(d.getAttribute("aria-modal")).toBe("true");
  });

  it("o foco entra no diálogo", async () => {
    render(<Exemplo />);
    const gatilho = screen.getByText("Abrir");
    gatilho.focus();
    fireEvent.click(gatilho);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByText("Primeiro")));
  });

  it("Tab circula dentro do diálogo", async () => {
    render(<Exemplo />);
    fireEvent.click(screen.getByText("Abrir"));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByText("Primeiro")));
    screen.getByText("Ultimo").focus();
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByText("Primeiro"));
  });

  it("Esc fecha e o foco volta ao gatilho", async () => {
    render(<Exemplo />);
    const gatilho = screen.getByText("Abrir");
    gatilho.focus();
    fireEvent.click(gatilho);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByText("Primeiro")));
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(gatilho));
  });

  it("clique no scrim fecha; clique no conteúdo não", () => {
    render(<Exemplo />);
    fireEvent.click(screen.getByText("Abrir"));
    fireEvent.mouseDown(screen.getByText("Primeiro"));
    expect(screen.queryByRole("dialog")).not.toBeNull();
    fireEvent.mouseDown(screen.getByRole("dialog"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
