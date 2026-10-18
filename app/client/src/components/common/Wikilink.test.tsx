import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MarkdownPreview } from "@/lib/markdown-mini";
import { DocumentoPopupContext } from "@/lib/documento-popup";
import { esquecerWikilinksResolvidos } from "@/lib/wikilinks";

const resolver = vi.fn();
vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  links: { resolver: (...a: unknown[]) => resolver(...a), de: vi.fn(), sugestoes: vi.fn() },
}));

beforeEach(() => { resolver.mockReset(); esquecerWikilinksResolvidos(); });

describe("Wikilink na leitura", () => {
  it("resolve em lote, mostra o apelido e abre o destino ao clicar", async () => {
    resolver.mockResolvedValue({ resolvidos: { "Projeto X": { tipo: "nota", id: "n1", titulo: "Projeto X" }, "tarefa:Pagar luz": { tipo: "tarefa", id: "t1", titulo: "Pagar luz" } } });
    const abrir = vi.fn();
    render(<DocumentoPopupContext.Provider value={abrir}><MarkdownPreview corpo={"Veja [[Projeto X|aqui]] e [[tarefa:Pagar luz]]."} itemId="n0" tipo="nota" /></DocumentoPopupContext.Provider>);
    const nota = await screen.findByRole("button", { name: "aqui" });
    await waitFor(() => expect(nota.getAttribute("title")).toBe("Abrir nota: Projeto X"));
    expect(resolver).toHaveBeenCalledTimes(1);
    expect(resolver.mock.calls[0][0]).toEqual(["Projeto X", "tarefa:Pagar luz"]);
    expect(resolver.mock.calls[0][1]).toEqual({ tipo: "nota", id: "n0" });
    fireEvent.click(nota);
    expect(abrir).toHaveBeenCalledWith("/notas/nota/n1", false);
    fireEvent.click(await screen.findByRole("button", { name: "Pagar luz" }));
    expect(abrir).toHaveBeenCalledWith("/tarefa/t1", false);
  });

  it("sem destino fica desabilitado", async () => {
    resolver.mockResolvedValue({ resolvidos: { Fantasma: null } });
    render(<MarkdownPreview corpo="[[Fantasma]]" />);
    const botao = await screen.findByRole("button", { name: "Fantasma" });
    await waitFor(() => expect((botao as HTMLButtonElement).disabled).toBe(true));
  });
});
