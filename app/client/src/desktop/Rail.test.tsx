import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CHAVE_PREFERENCIAS_APLICATIVO } from "@/lib/preferencias-aplicativo";
import { registrarNavegacao } from "./navegacao-abas";
import { Rail } from "./Rail";
import { WorkspaceProvider } from "./workspace-store";

vi.mock("./ExploradorLateral", () => ({ ExploradorLateral: () => <div role="tree" aria-label="Pastas" /> }));

afterEach(() => localStorage.clear());

it("abre a raiz em Arquivos e recolhe a árvore apenas pela seta", () => {
  localStorage.setItem(CHAVE_PREFERENCIAS_APLICATIVO, JSON.stringify({ modoExplorador: true }));
  localStorage.setItem("ecos.desktop.rail.expandida", "1");
  localStorage.setItem("ecos.desktop.workspace.v1", JSON.stringify({
    focusedPaneId: "p1",
    panes: [{ id: "p1", size: 1, activeTabId: "a", tabs: [{ id: "a", path: "/arquivos?pasta=Projetos" }] }],
  }));
  const navegar = vi.fn();
  const desregistrar = registrarNavegacao("aba:a", { ir: vi.fn(), podeVoltar: () => false, podeAvancar: () => false, navegar });
  try {
    render(<WorkspaceProvider><Rail abrirCofre={vi.fn()} /></WorkspaceProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Arquivos" }));
    expect(navegar).toHaveBeenCalledWith("/arquivos");
    expect(screen.getByRole("tree", { name: "Pastas" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Recolher Arquivos" }));
    expect(screen.queryByRole("tree", { name: "Pastas" })).toBeNull();
    expect(navegar).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "Arquivos" }));
    expect(screen.getByRole("tree", { name: "Pastas" })).toBeTruthy();
    expect(navegar).toHaveBeenCalledTimes(2);
  } finally {
    desregistrar();
  }
});
