import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TaskListRow } from "@/components/cards/TaskListRow";
import type { Tarefa } from "@/lib/types";
import { ArrasteTarefaProvider, EVENTO_ARRASTE_TAREFA, LONGO_TOQUE_TAREFA_MS, useArrasteTarefa, useOuvirArrasteTarefa, type EventoArrasteTarefa, type TarefaArrastavel } from "./arraste-tarefa";

const TAREFA: TarefaArrastavel = { id: "t1", titulo: "Escrever relatório", duracaoMin: 45, prioridade: "alta" };

function Origem({ tarefa = TAREFA, aoClicar }: { tarefa?: TarefaArrastavel; aoClicar?: () => void }) {
  const { aoPressionarTarefa } = useArrasteTarefa();
  return <button data-testid="origem" onPointerDown={(e) => aoPressionarTarefa(e, tarefa)} onClick={aoClicar}>{tarefa.titulo}</button>;
}

let eventos: EventoArrasteTarefa[] = [];
function Ouvinte() {
  useOuvirArrasteTarefa((e) => eventos.push(e));
  return null;
}

const ponteiro = (tipo: "mouse" | "touch" | "pen" = "mouse", id = 1) => ({ pointerId: id, pointerType: tipo, isPrimary: true, button: 0 });
const mover = (x: number, y: number, tipo: "mouse" | "touch" | "pen" = "mouse", id = 1) => fireEvent.pointerMove(window, { ...ponteiro(tipo, id), clientX: x, clientY: y });
const soltar = (x: number, y: number, tipo: "mouse" | "touch" | "pen" = "mouse", id = 1) => fireEvent.pointerUp(window, { ...ponteiro(tipo, id), clientX: x, clientY: y });
const fases = () => eventos.map((e) => e.fase);
const fantasma = () => document.querySelector<HTMLElement>(".pointer-events-none.fixed");

function montar(aoClicar?: () => void) {
  return render(<ArrasteTarefaProvider><Ouvinte /><Origem aoClicar={aoClicar} /></ArrasteTarefaProvider>);
}
const origem = () => screen.getByTestId("origem");

beforeEach(() => { eventos = []; });
afterEach(() => { vi.useRealTimers(); document.body.style.cssText = ""; });

describe("mouse e caneta", () => {
  it("arrastar avisa cada fase com a tarefa e as coordenadas do ponteiro, e mostra um fantasma que segue o ponteiro", () => {
    montar();
    fireEvent.pointerDown(origem(), { ...ponteiro(), clientX: 10, clientY: 10 });
    mover(60, 80);
    expect(fases()).toEqual(["mover"]);
    expect(eventos[0]).toMatchObject({ tarefa: TAREFA, x: 60, y: 80 });
    expect(fantasma()!.textContent).toContain("Escrever relatório");
    expect(fantasma()!.textContent).toContain("45 min");
    expect(fantasma()!.style.left).toBe("72px"); // ponteiro + 12
    mover(100, 120);
    expect(fantasma()!.style.top).toBe("132px");
    soltar(100, 120);
    expect(fases()).toEqual(["mover", "mover", "soltar"]);
    expect(eventos[2]).toMatchObject({ x: 100, y: 120, tarefa: TAREFA });
    expect(fantasma()).toBeNull();
  });

  it("movimentos abaixo de 6 px não iniciam nada: continua sendo um clique", () => {
    const aoClicar = vi.fn();
    montar(aoClicar);
    fireEvent.pointerDown(origem(), { ...ponteiro(), clientX: 10, clientY: 10 });
    mover(13, 12);
    soltar(13, 12);
    fireEvent.click(origem());
    expect(eventos).toEqual([]);
    expect(fantasma()).toBeNull();
    expect(aoClicar).toHaveBeenCalledTimes(1);
  });

  it("o clique que o navegador dispara ao soltar NÃO abre a tarefa; um clique depois, sim", () => {
    vi.useFakeTimers();
    const aoClicar = vi.fn();
    montar(aoClicar);
    fireEvent.pointerDown(origem(), { ...ponteiro(), clientX: 10, clientY: 10 });
    mover(80, 80);
    soltar(80, 80);
    fireEvent.click(origem());
    expect(aoClicar).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(5); });
    fireEvent.click(origem());
    expect(aoClicar).toHaveBeenCalledTimes(1);
  });

  it("Esc cancela: avisa 'cancelar', some o fantasma e soltar depois não vira 'soltar'", () => {
    montar();
    fireEvent.pointerDown(origem(), { ...ponteiro(), clientX: 10, clientY: 10 });
    mover(80, 80);
    fireEvent.keyDown(window, { key: "Escape" });
    soltar(80, 80);
    expect(fases()).toEqual(["mover", "cancelar"]);
    expect(fantasma()).toBeNull();
  });

  it("pointercancel também cancela", () => {
    montar();
    fireEvent.pointerDown(origem(), { ...ponteiro(), clientX: 10, clientY: 10 });
    mover(80, 80);
    fireEvent.pointerCancel(window, { ...ponteiro() });
    expect(fases()).toEqual(["mover", "cancelar"]);
  });

  it("botão do meio/direito não inicia arrasto", () => {
    montar();
    fireEvent.pointerDown(origem(), { ...ponteiro(), button: 2, clientX: 10, clientY: 10 });
    mover(80, 80);
    soltar(80, 80);
    expect(eventos).toEqual([]);
  });

  it("caneta funciona como mouse", () => {
    montar();
    fireEvent.pointerDown(origem(), { ...ponteiro("pen"), clientX: 10, clientY: 10 });
    mover(80, 80, "pen");
    soltar(80, 80, "pen");
    expect(fases()).toEqual(["mover", "soltar"]);
  });

  it("outro ponteiro (outro pointerId) não interfere no gesto", () => {
    montar();
    fireEvent.pointerDown(origem(), { ...ponteiro("mouse", 1), clientX: 10, clientY: 10 });
    mover(500, 500, "mouse", 2);
    soltar(500, 500, "mouse", 2);
    expect(eventos).toEqual([]);
    mover(80, 80, "mouse", 1);
    soltar(80, 80, "mouse", 1);
    expect(fases()).toEqual(["mover", "soltar"]);
    expect(eventos[1]).toMatchObject({ x: 80, y: 80 });
  });

  it("durante o arrasto o cursor vira 'agarrando' e o texto não é selecionado; ao fim tudo volta", () => {
    montar();
    fireEvent.pointerDown(origem(), { ...ponteiro(), clientX: 10, clientY: 10 });
    mover(80, 80);
    expect(document.body.style.cursor).toBe("grabbing");
    expect(document.body.style.userSelect).toBe("none");
    soltar(80, 80);
    expect(document.body.style.cursor).toBe("");
    expect(document.body.style.userSelect).toBe("");
  });

  it("desmontar no meio do arrasto limpa os ouvintes e o estilo do corpo (sem vazamento)", () => {
    const { unmount } = montar();
    fireEvent.pointerDown(origem(), { ...ponteiro(), clientX: 10, clientY: 10 });
    mover(80, 80);
    unmount();
    expect(document.body.style.cursor).toBe("");
    eventos = [];
    mover(120, 120);
    soltar(120, 120);
    expect(eventos).toEqual([]);
  });

  it("um novo arrasto cancela o anterior que ficou pendurado", () => {
    montar();
    fireEvent.pointerDown(origem(), { ...ponteiro(), clientX: 10, clientY: 10 });
    mover(80, 80);
    fireEvent.pointerDown(origem(), { ...ponteiro(), clientX: 20, clientY: 20 });
    expect(fases()).toEqual(["mover", "cancelar"]);
  });
});

describe("toque (pressão longa, para não brigar com a rolagem da lista)", () => {
  beforeEach(() => { vi.useFakeTimers(); });

  it("segurar e arrastar leva a tarefa; antes da pressão longa nada aparece", () => {
    montar();
    fireEvent.pointerDown(origem(), { ...ponteiro("touch"), clientX: 10, clientY: 10 });
    expect(fantasma()).toBeNull();
    act(() => { vi.advanceTimersByTime(LONGO_TOQUE_TAREFA_MS + 10); });
    expect(fantasma()).not.toBeNull();
    mover(80, 90, "touch");
    soltar(80, 90, "touch");
    expect(fases()).toEqual(["mover", "soltar"]);
    expect(eventos[1]).toMatchObject({ x: 80, y: 90 });
  });

  it("mexer o dedo ANTES da pressão longa é rolagem da lista: desiste, sem eventos", () => {
    montar();
    fireEvent.pointerDown(origem(), { ...ponteiro("touch"), clientX: 10, clientY: 10 });
    mover(10, 40, "touch");
    act(() => { vi.advanceTimersByTime(LONGO_TOQUE_TAREFA_MS * 2); });
    mover(80, 90, "touch");
    soltar(80, 90, "touch");
    expect(eventos).toEqual([]);
    expect(fantasma()).toBeNull();
  });

  it("um toque rápido não arrasta e ainda abre a tarefa", () => {
    const aoClicar = vi.fn();
    montar(aoClicar);
    fireEvent.pointerDown(origem(), { ...ponteiro("touch"), clientX: 10, clientY: 10 });
    act(() => { vi.advanceTimersByTime(100); });
    soltar(10, 10, "touch");
    fireEvent.click(origem());
    act(() => { vi.advanceTimersByTime(LONGO_TOQUE_TAREFA_MS * 2); });
    expect(eventos).toEqual([]);
    expect(aoClicar).toHaveBeenCalledTimes(1);
  });

  it("soltar o dedo antes da pressão longa cancela o temporizador", () => {
    montar();
    fireEvent.pointerDown(origem(), { ...ponteiro("touch"), clientX: 10, clientY: 10 });
    soltar(10, 10, "touch");
    act(() => { vi.advanceTimersByTime(LONGO_TOQUE_TAREFA_MS * 3); });
    expect(fantasma()).toBeNull();
    expect(eventos).toEqual([]);
  });

  it("depois de pegar a tarefa a rolagem nativa é bloqueada; ao soltar, volta ao normal", () => {
    montar();
    fireEvent.pointerDown(origem(), { ...ponteiro("touch"), clientX: 10, clientY: 10 });
    act(() => { vi.advanceTimersByTime(LONGO_TOQUE_TAREFA_MS + 10); });
    const durante = new Event("touchmove", { cancelable: true, bubbles: true });
    window.dispatchEvent(durante);
    expect(durante.defaultPrevented).toBe(true);
    soltar(10, 10, "touch");
    const depois = new Event("touchmove", { cancelable: true, bubbles: true });
    window.dispatchEvent(depois);
    expect(depois.defaultPrevented).toBe(false);
  });

  it("o navegador cancelando o gesto (pointercancel) desfaz tudo", () => {
    montar();
    fireEvent.pointerDown(origem(), { ...ponteiro("touch"), clientX: 10, clientY: 10 });
    act(() => { vi.advanceTimersByTime(LONGO_TOQUE_TAREFA_MS + 10); });
    mover(80, 80, "touch");
    fireEvent.pointerCancel(window, { ...ponteiro("touch") });
    expect(fases()).toEqual(["mover", "cancelar"]);
  });
});

describe("fora do provider e como origem real", () => {
  it("sem provider, a origem não quebra nem arrasta (no-op)", () => {
    render(<Origem />);
    expect(() => {
      fireEvent.pointerDown(origem(), { ...ponteiro(), clientX: 10, clientY: 10 });
      mover(80, 80);
      soltar(80, 80);
    }).not.toThrow();
  });

  it("o evento é um CustomEvent de window com o nome público", () => {
    const recebidos: Event[] = [];
    window.addEventListener(EVENTO_ARRASTE_TAREFA, (e) => recebidos.push(e), { once: true });
    montar();
    fireEvent.pointerDown(origem(), { ...ponteiro(), clientX: 10, clientY: 10 });
    mover(80, 80);
    expect(recebidos).toHaveLength(1);
    expect((recebidos[0] as CustomEvent<EventoArrasteTarefa>).detail.fase).toBe("mover");
    soltar(80, 80);
  });

  const tarefaDaLista = { id: "t7", titulo: "Pagar boleto", status: "pendente", prioridade: "media", durationMin: 20, dono: { nome: "Eu" } } as unknown as Tarefa;

  it("a linha de tarefa das listas (TaskListRow) é origem: manda id, título e a estimativa — e não usa o arrasto nativo", () => {
    render(<MemoryRouter><ArrasteTarefaProvider><Ouvinte /><TaskListRow tarefa={tarefaDaLista} /></ArrasteTarefaProvider></MemoryRouter>);
    const linha = screen.getByRole("button", { name: /Pagar boleto/ });
    expect(linha.getAttribute("draggable")).toBeNull();
    fireEvent.pointerDown(linha, { ...ponteiro(), clientX: 10, clientY: 10 });
    mover(90, 90);
    soltar(90, 90);
    expect(eventos[0].tarefa).toEqual({ id: "t7", titulo: "Pagar boleto", duracaoMin: 20, prioridade: "media" });
    expect(fases()).toEqual(["mover", "soltar"]);
  });
});
