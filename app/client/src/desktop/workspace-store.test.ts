import { describe, expect, it } from "vitest";
import { estadoInicial, reducer, ROTA_HOME } from "./workspace-store";

describe("workspace — Home como estado de repouso", () => {
  it("o estado inicial é só a Home", () => {
    const s = estadoInicial();
    expect(s.panes).toHaveLength(1);
    expect(s.panes[0].tabs.map((t) => t.path)).toEqual([ROTA_HOME]);
  });

  it("fechar a última aba abre a Home em vez de reabrir a aba fechada", () => {
    let s = reducer(estadoInicial(), { type: "open", path: "/agenda", where: "focused", reuse: "modulo" });
    const home = s.panes[0].tabs.find((t) => t.path === ROTA_HOME)!;
    s = reducer(s, { type: "close-tab", paneId: s.panes[0].id, tabId: home.id });
    const agenda = s.panes[0].tabs[0];
    expect(agenda.path).toBe("/agenda");
    s = reducer(s, { type: "close-tab", paneId: s.panes[0].id, tabId: agenda.id });
    expect(s.panes[0].tabs.map((t) => t.path)).toEqual([ROTA_HOME]);
  });

  it("abrir a Home de novo reaproveita a aba existente (sem duplicar)", () => {
    let s = reducer(estadoInicial(), { type: "open", path: "/agenda", where: "focused", reuse: "modulo" });
    s = reducer(s, { type: "open", path: ROTA_HOME, where: "focused", reuse: "modulo" });
    s = reducer(s, { type: "open", path: ROTA_HOME, where: "focused", reuse: "modulo" });
    expect(s.panes[0].tabs.filter((t) => t.path === ROTA_HOME)).toHaveLength(1);
  });

  it("fechar a Home quando ela é a única aba não faz nada", () => {
    const s = estadoInicial();
    expect(reducer(s, { type: "close-tab", paneId: s.panes[0].id, tabId: s.panes[0].tabs[0].id })).toBe(s);
  });
});
