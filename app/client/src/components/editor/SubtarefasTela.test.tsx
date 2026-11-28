import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SubtarefasTela, adicionarNoBloco, agruparSubtarefas } from "./SubtarefasTela";

const LISTA = [
  { id: "a", titulo: "Migrar banco", concluida: true, bloco: "Fase 2" },
  { id: "b", titulo: "Pedir docs", concluida: false },
  { id: "c", titulo: "Testar backup", concluida: false, bloco: "Fase 2" },
];

describe("agruparSubtarefas", () => {
  it("agrupa por bloco com o padrão primeiro, preservando os índices", () => {
    const g = agruparSubtarefas(LISTA);
    expect(g.map((x) => x.bloco)).toEqual([null, "Fase 2"]);
    expect(g[1].itens.map((i) => i.indice)).toEqual([0, 2]);
  });
});

describe("adicionarNoBloco", () => {
  it("insere logo depois do último item do bloco", () => {
    expect(adicionarNoBloco(LISTA, "Fase 2", "Novo").map((s) => s.titulo)).toEqual(["Migrar banco", "Pedir docs", "Testar backup", "Novo"]);
    expect(adicionarNoBloco(LISTA, null, "Novo").map((s) => s.titulo)).toEqual(["Migrar banco", "Pedir docs", "Novo", "Testar backup"]);
  });
  it("bloco novo vai para o fim da lista com o nome do bloco", () => {
    const r = adicionarNoBloco(LISTA, "Fase 3", "X");
    expect(r[3]).toEqual({ titulo: "X", concluida: false, bloco: "Fase 3" });
  });
});

describe("SubtarefasTela", () => {
  it("marca, oculta concluídas e adiciona no bloco", () => {
    const onChange = vi.fn();
    render(<SubtarefasTela titulo="Roadmap" subtarefas={LISTA} onChange={onChange} onFechar={() => {}} />);
    expect(screen.getByText("de 3", { exact: false })).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Concluir Pedir docs"));
    expect(onChange.mock.calls[0][0][1].concluida).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /Ocultar concluídas|Concluídas/ }));
    expect(screen.queryByText("Migrar banco")).toBeNull();
    const campo = screen.getByLabelText("Adicionar subtarefa em Fase 2");
    fireEvent.change(campo, { target: { value: "Validar" } });
    fireEvent.keyDown(campo, { key: "Enter" });
    expect(onChange.mock.calls[1][0].map((s: { titulo: string }) => s.titulo)).toEqual(["Migrar banco", "Pedir docs", "Testar backup", "Validar"]);
  });
});

describe("BlocoSubtarefas no preview", () => {
  it("desenha só os itens do bloco do marcador e marca pelo contexto", async () => {
    const { MarkdownPreview } = await import("@/lib/markdown-mini");
    const { SubtarefasCorpoContext } = await import("./BlocoSubtarefas");
    const onChange = vi.fn();
    render(<SubtarefasCorpoContext.Provider value={{ subtarefas: LISTA, onChange }}><MarkdownPreview tipo="tarefa" corpo={"Intro\n\n::: subtarefas Fase 2\n\nFim"} /></SubtarefasCorpoContext.Provider>);
    expect(screen.getByText("Testar backup")).toBeTruthy();
    expect(screen.queryByText("Pedir docs")).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: /Testar backup/ }));
    expect(onChange.mock.calls[0][0][2].concluida).toBe(true);
  });
  it("em nota o marcador é texto comum", async () => {
    const { MarkdownPreview } = await import("@/lib/markdown-mini");
    render(<MarkdownPreview tipo="nota" corpo={"::: subtarefas Fase 2"} />);
    expect(screen.getByText("::: subtarefas Fase 2")).toBeTruthy();
  });
});
