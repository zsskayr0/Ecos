import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { BuscaExpansivel } from "./BuscaExpansivel";

function Controlado({ inicial = "", aoMudar }: { inicial?: string; aoMudar?: (v: string) => void }) {
  const [valor, setValor] = useState(inicial);
  return (
    <>
      <BuscaExpansivel valor={valor} onChange={(v) => { setValor(v); aoMudar?.(v); }} placeholder="Pesquisar em Trabalho…" rotulo="Pesquisar nas tarefas" />
      <button type="button" onClick={() => setValor("")}>apagar por fora</button>
      <span data-testid="valor">{valor}</span>
    </>
  );
}
const caixa = () => screen.getByRole("search");
const aberta = () => caixa().getAttribute("data-aberta") === "true";
const campo = () => screen.getByRole("searchbox", { hidden: true }) as HTMLInputElement;
const lupa = () => screen.getByRole("button", { name: "Pesquisar nas tarefas" });
const abrir = async () => { fireEvent.click(lupa()); await waitFor(() => expect(document.activeElement).toBe(campo())); };

describe("BuscaExpansivel", () => {
  it("começa recolhida: só a lupa, com o campo escondido dos leitores de tela e fora da ordem de tabulação", () => {
    render(<Controlado />);
    expect(aberta()).toBe(false);
    expect(lupa().getAttribute("aria-expanded")).toBe("false");
    expect(campo().getAttribute("aria-hidden")).toBe("true");
    expect(campo().tabIndex).toBe(-1);
  });

  it("clicar na lupa abre a barra e leva o foco para o campo", async () => {
    render(<Controlado />);
    await abrir();
    expect(aberta()).toBe(true);
    expect(lupa().getAttribute("aria-expanded")).toBe("true");
    expect(campo().getAttribute("aria-hidden")).toBe("false");
    expect(campo().placeholder).toBe("Pesquisar em Trabalho…");
  });

  it("digitar chama onChange a cada tecla e mostra o botão de limpar; limpar apaga e mantém aberta e com foco", async () => {
    const aoMudar = vi.fn();
    render(<Controlado aoMudar={aoMudar} />);
    await abrir();
    const limpar = screen.getByRole("button", { name: "Limpar pesquisa", hidden: true });
    expect(limpar.getAttribute("data-visivel")).toBe("false");
    fireEvent.change(campo(), { target: { value: "rel" } });
    expect(aoMudar).toHaveBeenLastCalledWith("rel");
    expect(limpar.getAttribute("data-visivel")).toBe("true");
    fireEvent.click(limpar);
    expect(screen.getByTestId("valor").textContent).toBe("");
    expect(aberta()).toBe(true);
    expect(document.activeElement).toBe(campo());
  });

  it("Esc apaga o texto primeiro; com o campo vazio, recolhe", async () => {
    render(<Controlado inicial="relatório" />);
    await abrir();
    fireEvent.keyDown(campo(), { key: "Escape" });
    expect(screen.getByTestId("valor").textContent).toBe("");
    expect(aberta()).toBe(true);
    fireEvent.keyDown(campo(), { key: "Escape" });
    await waitFor(() => expect(aberta()).toBe(false));
  });

  it("sair do campo vazio recolhe; sair com texto mantém aberta (a busca está valendo)", async () => {
    render(<Controlado />);
    await abrir();
    fireEvent.blur(campo());
    await waitFor(() => expect(aberta()).toBe(false));

    await abrir();
    fireEvent.change(campo(), { target: { value: "ana" } });
    fireEvent.blur(campo());
    expect(aberta()).toBe(true);
  });

  it("com um texto já salvo nasce aberta, sem roubar o foco da tela", () => {
    render(<Controlado inicial="relatório" />);
    expect(aberta()).toBe(true);
    expect(campo().value).toBe("relatório");
    expect(document.activeElement).not.toBe(campo());
  });

  it("o texto apagado por fora (botão 'Limpar' da barra de filtros) recolhe a busca", async () => {
    render(<Controlado inicial="relatório" />);
    expect(aberta()).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "apagar por fora" }));
    await waitFor(() => expect(aberta()).toBe(false));
  });

  it("clicar de novo na lupa com a barra aberta e vazia recolhe; com texto só devolve o foco", async () => {
    render(<Controlado />);
    await abrir();
    fireEvent.click(lupa());
    await waitFor(() => expect(aberta()).toBe(false));

    await abrir();
    fireEvent.change(campo(), { target: { value: "x" } });
    campo().blur();
    fireEvent.click(lupa());
    expect(aberta()).toBe(true);
    await waitFor(() => expect(document.activeElement).toBe(campo()));
  });
});
