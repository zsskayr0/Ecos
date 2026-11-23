import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const de = vi.fn();
const titulos = vi.fn();
vi.mock("@/lib/api", () => ({ links: { de: (...a: unknown[]) => de(...a), titulos: (...a: unknown[]) => titulos(...a) } }));
vi.mock("@/lib/wikilinks", () => ({ useAbrirDestino: () => vi.fn(), useAbrirCaminho: () => vi.fn() }));
vi.mock("@/screens/Grafico/MiniGrafo", () => ({ MiniGrafo: () => null }));

import { Conexoes } from "./Conexoes";

const externos = (n: number) => Array.from({ length: n }, (_, i) => ({ url: `https://site${i}.com/artigo`, texto: i === 1 ? "Texto escrito" : null }));

describe("conexões — links externos", () => {
  beforeEach(() => { de.mockReset(); titulos.mockReset(); });
  afterEach(cleanup);

  it("lista os links externos com o título da página, o texto escrito ou o endereço curto, e abre em nova aba", async () => {
    de.mockResolvedValue({ entrada: [], saida: [], externos: externos(3) });
    titulos.mockResolvedValue({ titulos: { "https://site0.com/artigo": "Guia completo de Rust", "https://site1.com/artigo": null, "https://site2.com/artigo": null } });
    render(<Conexoes tipo="nota" id="n1" />);
    expect(await screen.findByRole("group", { name: "Links externos" })).toBeTruthy();
    const link = await screen.findByRole("link", { name: /Guia completo de Rust/ });
    expect(link.getAttribute("href")).toBe("https://site0.com/artigo");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(screen.getByRole("link", { name: /Texto escrito/ })).toBeTruthy(); // sem título buscado: o texto do link
    expect(screen.getByRole("link", { name: /site2\.com\/artigo/ })).toBeTruthy(); // sem nada: endereço curto, nunca a URL inteira
    expect(titulos).toHaveBeenCalledWith(["https://site0.com/artigo", "https://site1.com/artigo", "https://site2.com/artigo"]);
    // Só links externos: nada de "nenhuma conexão" nem a dica de `[[`.
    expect(screen.queryByText(/Digite/)).toBeNull();
  });

  it("mostra 5 e recolhe o resto em 'Ver mais'", async () => {
    de.mockResolvedValue({ entrada: [], saida: [], externos: externos(8) });
    titulos.mockResolvedValue({ titulos: {} });
    render(<Conexoes tipo="tarefa" id="t1" />);
    await screen.findByRole("group", { name: "Links externos" });
    expect(screen.getAllByRole("link")).toHaveLength(5);
    fireEvent.click(screen.getByRole("button", { name: "Ver mais 3" }));
    expect(screen.getAllByRole("link")).toHaveLength(8);
    fireEvent.click(screen.getByRole("button", { name: "Ver menos" }));
    expect(screen.getAllByRole("link")).toHaveLength(5);
  });

  it("servidor antigo (sem `externos`) ou falha na busca de títulos não quebram a seção", async () => {
    de.mockResolvedValue({ entrada: [], saida: [] });
    render(<Conexoes tipo="nota" id="n1" />);
    await waitFor(() => expect(screen.getByText(/Digite/)).toBeTruthy());
    expect(screen.queryByRole("group", { name: "Links externos" })).toBeNull();
    expect(titulos).not.toHaveBeenCalled();

    cleanup();
    de.mockResolvedValue({ entrada: [], saida: [], externos: externos(1) });
    titulos.mockRejectedValue(new Error("rede"));
    render(<Conexoes tipo="nota" id="n2" />);
    expect(await screen.findByRole("link", { name: /site0\.com\/artigo/ })).toBeTruthy();
  });
});
