import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, expect, it } from "vitest";
import { TabBar } from "./TabBar";
import { TabDragProvider } from "./tab-drag";
import { WorkspaceProvider, useWorkspace } from "./workspace-store";

function Cena() {
  const { state } = useWorkspace();
  return (
    <>
      {state.panes.map((p) => <TabBar key={p.id} pane={p} />)}
      <div data-testid="ordem">{state.panes.map((p) => p.tabs.map((t) => t.path).join(",")).join(" | ")}</div>
    </>
  );
}
function Montar() {
  return <WorkspaceProvider><TabDragProvider><Cena /></TabDragProvider></WorkspaceProvider>;
}
const abrir = () => {
  localStorage.clear();
  localStorage.setItem(
    "ecos.desktop.workspace.v1",
    JSON.stringify({ focusedPaneId: "p1", panes: [{ id: "p1", size: 1, activeTabId: "a", tabs: [{ id: "a", path: "/notas" }, { id: "b", path: "/agenda" }, { id: "c", path: "/busca" }] }] }),
  );
};
const ordem = () => screen.getByTestId("ordem").textContent;

beforeEach(abrir);

it("Ctrl+Shift+seta reordena a aba e anuncia a nova posição", () => {
  render(<Montar />);
  const abas = screen.getAllByRole("tab");
  expect(ordem()).toBe("/notas,/agenda,/busca");
  fireEvent.keyDown(abas[0], { key: "ArrowRight", ctrlKey: true, shiftKey: true });
  expect(ordem()).toBe("/agenda,/notas,/busca");
  expect(screen.getByRole("status").textContent).toMatch(/posição 2 de 3/);
});

it("o menu Mover para... (Shift+F10) leva a aba ao fim e anuncia", () => {
  render(<Montar />);
  const [primeira] = screen.getAllByRole("tab");
  fireEvent.keyDown(primeira, { key: "F10", shiftKey: true });
  const menu = screen.getByRole("menu");
  fireEvent.click(within(menu).getByRole("menuitem", { name: "Mover para o fim" }));
  expect(screen.queryByRole("menu")).toBeNull();
  expect(screen.getByRole("status").textContent).toMatch(/movida para o fim/);
  expect(ordem()).toBe("/agenda,/busca,/notas");
});
