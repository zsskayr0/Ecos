import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { definirArvoreLateralVisivel, definirLarguraMenu, LARGURA_MENU_RECOLHIDO, useArvoreLateralVisivel, useLarguraMenu } from "./arvore-lateral";
import { tituloDaRota } from "./modules";
import { GuiasSlotContext, TabBar } from "./TabBar";
import { TabDragProvider } from "./tab-drag";
import { WorkspaceProvider, useWorkspace } from "./workspace-store";

afterEach(() => { cleanup(); localStorage.clear(); definirArvoreLateralVisivel(false); definirLarguraMenu(LARGURA_MENU_RECOLHIDO); });

function guardar(paineis: number) {
  const abas = (id: string, path: string) => ({ id, path });
  const panes = paineis === 1
    ? [{ id: "p1", size: 1, activeTabId: "a", tabs: [abas("a", "/agenda"), abas("b", "/notas")] }]
    : [{ id: "p1", size: 0.5, activeTabId: "a", tabs: [abas("a", "/agenda")] }, { id: "p2", size: 0.5, activeTabId: "b", tabs: [abas("b", "/notas")] }];
  localStorage.setItem("ecos.desktop.workspace.v1", JSON.stringify({ focusedPaneId: "p1", panes }));
}

function Paineis({ slot }: { slot: HTMLElement | null }) {
  const { state } = useWorkspace();
  return <GuiasSlotContext.Provider value={slot}>{state.panes.map((p) => <TabBar key={p.id} pane={p} />)}</GuiasSlotContext.Provider>;
}

function montar(paineis: number) {
  guardar(paineis);
  const barra = document.createElement("div");
  document.body.appendChild(barra);
  const vista = render(<WorkspaceProvider><TabDragProvider><Paineis slot={barra} /></TabDragProvider></WorkspaceProvider>);
  return { barra, vista };
}

describe("guias na barra do topo", () => {
  it("com um painel só, as guias vão para a barra e não sobra faixa própria", () => {
    const { barra, vista } = montar(1);
    expect(barra.querySelectorAll('[role="tab"]').length).toBe(2);
    expect(vista.container.querySelector('[role="tablist"]')).toBeNull();
    barra.remove();
  });

  it("com painéis divididos, cada painel mantém a sua faixa de guias", () => {
    const { barra, vista } = montar(2);
    expect(barra.querySelector('[role="tab"]')).toBeNull();
    expect(vista.container.querySelectorAll('[role="tablist"]').length).toBe(2);
    barra.remove();
  });

  it("sem lugar na barra (slot ausente), usa a faixa própria", () => {
    guardar(1);
    render(<WorkspaceProvider><TabDragProvider><Paineis slot={null} /></TabDragProvider></WorkspaceProvider>);
    expect(screen.getAllByRole("tab").length).toBe(2);
  });
});

describe("sinais do menu lateral", () => {
  function Leitor() { return <span data-testid="v">{String(useArvoreLateralVisivel())}|{useLarguraMenu()}</span>; }
  it("acompanham o que o menu publica", () => {
    render(<Leitor />);
    expect(screen.getByTestId("v").textContent).toBe(`false|${LARGURA_MENU_RECOLHIDO}`);
    act(() => { definirArvoreLateralVisivel(true); definirLarguraMenu(288); });
    expect(screen.getByTestId("v").textContent).toBe("true|288");
  });
});

describe("título da guia de Arquivos", () => {
  it("mostra o nome da pasta aberta; sem pasta, continua Arquivos", () => {
    expect(tituloDaRota("/arquivos")).toBe("Arquivos");
    expect(tituloDaRota("/arquivos?pasta=Dev%2FEcos%20App")).toBe("Ecos App");
  });
});
