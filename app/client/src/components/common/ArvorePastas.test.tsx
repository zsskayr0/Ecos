import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ArvorePastas } from "./ArvorePastas";

const opcoes = ["Trabalho/Projeto/Referências", "Casa/Projeto", "Vazia"].map((valor) => ({ valor, rotulo: valor, pasta: true }));

describe("árvore de pastas", () => {
  it("expande vários níveis sem selecionar e distingue nomes repetidos pelo caminho", () => {
    const selecionar = vi.fn();
    render(<ArvorePastas opcoes={opcoes} valores={[]} onSelect={selecionar} />);
    expect(screen.queryByRole("menuitemradio", { name: "Projeto" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Expandir Trabalho" }));
    expect(selecionar).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Projeto" }));
    expect(selecionar).toHaveBeenLastCalledWith("Trabalho/Projeto");
    fireEvent.keyDown(screen.getByRole("button", { name: "Expandir Projeto" }), { key: "ArrowRight" });
    expect(screen.getByRole("menuitemradio", { name: "Referências" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Expandir Casa" }));
    expect(screen.getAllByRole("menuitemradio", { name: "Projeto" })).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Recolher Trabalho" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Projeto" }));
    expect(selecionar).toHaveBeenLastCalledWith("Casa/Projeto");
    expect(screen.queryByRole("button", { name: "Expandir Vazia" })).toBeNull();
  });

  it("revela a pasta selecionada e pesquisa descendentes sem exigir expansão manual", () => {
    const { rerender } = render(<ArvorePastas opcoes={opcoes} valores={["Trabalho/Projeto/Referências"]} onSelect={vi.fn()} />);
    expect(screen.getByRole("menuitemradio", { name: "Referências" }).getAttribute("aria-checked")).toBe("true");
    rerender(<ArvorePastas opcoes={opcoes} valores={[]} onSelect={vi.fn()} busca="referencias" multipla />);
    expect(screen.getByRole("menuitemcheckbox", { name: "Referências" })).toBeTruthy();
    expect(screen.getByRole("menuitemcheckbox", { name: "Trabalho" })).toBeTruthy();
    expect(screen.queryByRole("menuitemcheckbox", { name: "Casa" })).toBeNull();
  });
});
