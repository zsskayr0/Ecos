import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { VisualizadorDeAnexos } from "./VisualizadorDeAnexos";

const itens = [
  { nome: "captura.png", url: "/media/captura.png", imagem: true },
  { nome: "contrato.pdf", url: "/media/contrato.pdf", imagem: false },
  { nome: "dados.zip", url: "/media/dados.zip", imagem: false },
];

describe("VisualizadorDeAnexos", () => {
  it("mostra a imagem, o contador e navega pelas setas e pelo teclado", () => {
    render(<VisualizadorDeAnexos itens={itens} onFechar={vi.fn()} />);
    expect(screen.getByRole("img", { name: "captura.png" })).toBeTruthy();
    expect(screen.getByText("1 de 3")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Próximo anexo" }));
    expect(document.querySelector("iframe[title=\"contrato.pdf\"]")).toBeTruthy(); // PDF embutido
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "ArrowRight" });
    expect(screen.getByText("Sem pré-visualização para este tipo de arquivo.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Próximo anexo" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "ArrowLeft" });
    expect(screen.getByText("2 de 3")).toBeTruthy();
  });

  it("zoom muda a porcentagem e ajustar volta a 100%", () => {
    render(<VisualizadorDeAnexos itens={itens} onFechar={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Aumentar zoom" }));
    expect(screen.getByRole("button", { name: "Ajustar à tela" }).textContent).toBe("125%");
    fireEvent.click(screen.getByRole("button", { name: "Ajustar à tela" }));
    expect(screen.getByRole("button", { name: "Ajustar à tela" }).textContent).toBe("100%");
  });

  it("Esc fecha só o visualizador, sem propagar para quem está por baixo", () => {
    const fechar = vi.fn();
    const porBaixo = vi.fn();
    render(<div onKeyDown={porBaixo}><VisualizadorDeAnexos itens={itens} onFechar={fechar} /></div>);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(fechar).toHaveBeenCalledTimes(1);
    expect(porBaixo).not.toHaveBeenCalled();
  });
});
