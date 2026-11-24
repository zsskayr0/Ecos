import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const de = vi.fn();
const titulos = vi.fn();
const abrir = vi.fn();
vi.mock("@/lib/api", () => ({
  links: { de: (...a: unknown[]) => de(...a), titulos: (...a: unknown[]) => titulos(...a) },
  notas: { obter: vi.fn().mockResolvedValue({ titulo: "Projeto Ecos", tags: ["jogos", "minecraft"] }) },
  tarefas: { obter: vi.fn().mockResolvedValue({ titulo: "Tarefa X" }) },
}));
vi.mock("@/lib/refresh-bus", () => ({ useRefreshBus: () => ({ versao: 0 }) }));
vi.mock("@/lib/wikilinks", () => ({ caminhoDe: (t: string, id: string) => (t === "tarefa" ? `/tarefa/${id}` : `/notas/nota/${id}`), useAbrirCaminho: () => abrir }));

import { limparCacheConexoes } from "@/lib/conexoes-cache";
import { consumirPedido } from "@/lib/ir-para";
import { ConexoesScreen } from "./ConexoesScreen";

function montar() {
  return render(<MemoryRouter initialEntries={["/conexoes/nota/n1"]}><Routes><Route path="/conexoes/:tipo/:id" element={<ConexoesScreen />} /></Routes></MemoryRouter>);
}

describe("tela de conexões", () => {
  beforeEach(() => {
    limparCacheConexoes();
    de.mockReset(); titulos.mockReset(); abrir.mockReset();
    de.mockResolvedValue({
      entrada: [{ id: "n2", titulo: "Quem me cita", tipo: "nota" }],
      saida: [{ id: "t1", titulo: "Pagar luz", tipo: "tarefa" }],
      externos: [{ url: "https://exemplo.com/a", texto: null }],
    });
    titulos.mockResolvedValue({ titulos: { "https://exemplo.com/a": "Guia de Exemplo" } });
  });
  afterEach(cleanup);

  it("mostra o item no centro, quem cita, o que cita e os links externos com título", async () => {
    montar();
    expect(await screen.findByTitle("Abrir nota: Projeto Ecos")).toBeTruthy();
    expect(screen.getByRole("group", { name: "Mencionada em" }).textContent).toContain("Quem me cita");
    expect(screen.getByRole("group", { name: "Menciona" }).textContent).toContain("Pagar luz");
    const link = await screen.findByRole("link", { name: /^Guia de Exemplo/ });
    expect(link.getAttribute("href")).toBe("https://exemplo.com/a");
    expect(link.getAttribute("target")).toBe("_blank");
    // O botão de abrir do cartão também leva ao link.
    expect(screen.getByRole("link", { name: "Abrir o link Guia de Exemplo" }).getAttribute("href")).toBe("https://exemplo.com/a");
  });

  it("as tags do item ficam num recipiente acima dele", async () => {
    montar();
    const grupo = await screen.findByRole("group", { name: "Tags" });
    expect(grupo.textContent).toContain("#jogos");
    expect(grupo.textContent).toContain("#minecraft");
  });

  it("otimista: na segunda abertura mostra o que foi visto na hora e depois troca só se mudou", async () => {
    const primeira = montar();
    await screen.findByTitle("Abrir nota: Projeto Ecos");
    primeira.unmount();

    let resolver!: (v: unknown) => void;
    de.mockReturnValueOnce(new Promise((r) => { resolver = r; }));
    montar();
    // Sem esperar o servidor: já está na tela.
    expect(screen.getByTitle("Abrir nota: Projeto Ecos")).toBeTruthy();
    expect(screen.getByRole("group", { name: "Menciona" }).textContent).toContain("Pagar luz");

    resolver({ entrada: [], saida: [{ id: "t9", titulo: "Tarefa nova", tipo: "tarefa" }], externos: [] });
    await waitFor(() => expect(screen.getByRole("group", { name: "Menciona" }).textContent).toContain("Tarefa nova"));
    expect(screen.getByRole("group", { name: "Menciona" }).textContent).not.toContain("Pagar luz");
  });

  it("a cópia guardada vence em 5 minutos", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const { guardarConexoes, lerConexoes } = await import("@/lib/conexoes-cache");
      guardarConexoes("nota", "x", { dados: { entrada: [], saida: [] } as never, titulo: "X" });
      vi.advanceTimersByTime(5 * 60 * 1000 - 1);
      expect(lerConexoes("nota", "x")).toBeTruthy();
      vi.advanceTimersByTime(2);
      expect(lerConexoes("nota", "x")).toBeUndefined();
    } finally { vi.useRealTimers(); }
  });

  it("clicar no cartão abre o item; o alvo abre o documento certo e pede o scroll até o trecho", async () => {
    montar();
    await screen.findByTitle("Abrir nota: Projeto Ecos");

    // Um clique só centraliza; abrir é pelo botão do cartão ou por dois cliques.
    fireEvent.click(screen.getByTitle("Abrir tarefa: Pagar luz"), { clientX: 10, clientY: 10 });
    expect(abrir).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Abrir Pagar luz" }));
    expect(abrir).toHaveBeenLastCalledWith("/tarefa/t1", expect.anything());
    // Dois cliques seguidos no mesmo ponto abrem, mesmo que o item já tenha saído de baixo do mouse.
    abrir.mockClear();
    fireEvent.click(screen.getByTitle("Abrir tarefa: Pagar luz"), { clientX: 50, clientY: 50 });
    fireEvent.click(screen.getByRole("group", { name: "Menciona" }), { clientX: 52, clientY: 49 });
    expect(abrir).toHaveBeenCalledTimes(1);
    expect(abrir).toHaveBeenLastCalledWith("/tarefa/t1", expect.anything());
    abrir.mockClear();
    fireEvent.click(screen.getByTitle("Abrir nota: Projeto Ecos"), { clientX: 300, clientY: 300 });
    fireEvent.click(screen.getByTitle("Abrir nota: Projeto Ecos"), { clientX: 300, clientY: 300 });
    expect(abrir).toHaveBeenCalledTimes(1);
    expect(abrir).toHaveBeenLastCalledWith("/notas/nota/n1", expect.anything());

    // Item que eu menciono: a posição está no MEU texto.
    fireEvent.click(screen.getByRole("button", { name: "Ver onde Pagar luz aparece no texto" }));
    expect(abrir).toHaveBeenLastCalledWith("/notas/nota/n1", expect.anything());
    expect(consumirPedido("n1")).toEqual({ wikilink: "Pagar luz" });

    // Quem me menciona: a posição está no texto DELE, procurando pelo meu título.
    fireEvent.click(screen.getByRole("button", { name: "Ver onde Quem me cita aparece no texto" }));
    expect(abrir).toHaveBeenLastCalledWith("/notas/nota/n2", expect.anything());
    expect(consumirPedido("n2")).toEqual({ wikilink: "Projeto Ecos" });

    // Link externo: a posição está no meu texto, pela URL.
    await waitFor(() => expect(screen.getByRole("button", { name: "Ver onde Guia de Exemplo aparece no texto" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Ver onde Guia de Exemplo aparece no texto" }));
    expect(consumirPedido("n1")).toEqual({ url: "https://exemplo.com/a" });
  });
});
