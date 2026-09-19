import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PX_POR_MINUTO, type ItemAgenda, type Posicao } from "@/lib/agenda-tempo";
import { EVENTO_ARRASTE_TAREFA, type TarefaArrastavel } from "@/lib/arraste-tarefa";
import { GradeTempo, LONGO_TOQUE_MS, type GradeTempoProps } from "./GradeTempo";

const D1 = "2026-09-21";
const D2 = "2026-09-22";
const D3 = "2026-09-23";
const DIAS = [D1, D2, D3];

/** Por padrão um BLOCO de tempo (o que se move e redimensiona); `tipo` muda o comportamento. */
function item(p: Partial<ItemAgenda> & { id: string }): ItemAgenda {
  const tipo = p.tipo ?? "bloco";
  return { chave: `${tipo}:${p.id}`, tipo, titulo: `Tarefa ${p.id}`, classe: "bg-cyan/15 text-cyan", concluida: false, dia: D1, inicioMin: 600, duracaoMin: 60, ...p };
}

// --- Layout falso: o jsdom não calcula geometria. Rolagem em y 100–700; cabeçalho 100–160; faixa "O dia todo" 160–204; horas a partir de 204.
// Colunas de 100 px (D1 em 100–200, D2 200–300, D3 300–400); a coluna das horas fica em x < 100.
const TOPO_HORAS = 204;
const yDe = (minutos: number) => TOPO_HORAS + minutos * PX_POR_MINUTO;
const xDaColuna = (i: number) => 150 + i * 100;
const Y_FAIXA = 180;
const Y_CABECALHO = 130;

function retangulo(left: number, top: number, right: number, bottom: number): DOMRect {
  return { left, top, right, bottom, x: left, y: top, width: right - left, height: bottom - top, toJSON: () => ({}) } as DOMRect;
}

beforeEach(() => {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const el = this as HTMLElement;
    if (el.dataset.colunaDia) { const i = DIAS.indexOf(el.dataset.colunaDia); return retangulo(100 + i * 100, TOPO_HORAS, 200 + i * 100, TOPO_HORAS + 24 * 64); }
    if (el.dataset.faixaDia) { const i = DIAS.indexOf(el.dataset.faixaDia); return retangulo(100 + i * 100, 160, 200 + i * 100, 204); }
    if (el.getAttribute("data-testid") === "grade-rolagem") return retangulo(0, 100, 800, 700);
    if (el.dataset.item) {
      const dentro = el.closest("[data-coluna-dia]") as HTMLElement | null;
      if (dentro) {
        const i = DIAS.indexOf(dentro.dataset.colunaDia as string);
        const topo = TOPO_HORAS + parseFloat(el.style.top || "0");
        return retangulo(100 + i * 100, topo, 200 + i * 100, topo + parseFloat(el.style.height || "22"));
      }
      return retangulo(100, 165, 200, 190); // chip da faixa "O dia todo"
    }
    return retangulo(0, 0, 0, 0);
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

function montar(itens: ItemAgenda[], props: Partial<GradeTempoProps> = {}) {
  const onMover = vi.fn();
  const onAbrirItem = vi.fn();
  const onMudarEncaixe = vi.fn();
  const onSelecionarDia = vi.fn();
  const onRemover = vi.fn();
  const onAlocarTarefa = vi.fn();
  const utils = render(<GradeTempo dias={DIAS} hoje={D2} itens={itens} encaixe={15} onMudarEncaixe={onMudarEncaixe} onSelecionarDia={onSelecionarDia} onAbrirItem={onAbrirItem} onMover={onMover} onRemover={onRemover} onAlocarTarefa={onAlocarTarefa} agora={new Date(2026, 8, 22, 15, 0)} {...props} />);
  return { ...utils, onMover, onAbrirItem, onMudarEncaixe, onSelecionarDia, onRemover, onAlocarTarefa };
}
const bloco = (id: string) => document.querySelector<HTMLElement>(`[data-item$=":${id}"]`)!;
const ponteiro = (tipo: "mouse" | "touch" | "pen" = "mouse", id = 1) => ({ pointerId: id, pointerType: tipo, isPrimary: true, button: 0 });
const mover = (x: number, y: number, tipo: "mouse" | "touch" | "pen" = "mouse", id = 1) => fireEvent.pointerMove(window, { ...ponteiro(tipo, id), clientX: x, clientY: y });
const soltar = (x: number, y: number, tipo: "mouse" | "touch" | "pen" = "mouse", id = 1) => fireEvent.pointerUp(window, { ...ponteiro(tipo, id), clientX: x, clientY: y });
const destinoDe = (chamada: unknown[]) => chamada[1] as Posicao;

describe("mouse", () => {
  it("arrastar um bloco para outro dia e horário move e NÃO altera a duração", () => {
    const A = item({ id: "A", dia: D1, inicioMin: 600, duracaoMin: 45 });
    const { onMover } = montar([A]);
    fireEvent.pointerDown(bloco("A"), { ...ponteiro(), clientX: xDaColuna(0), clientY: yDe(600) + 10 });
    mover(xDaColuna(1), yDe(720) + 10);
    soltar(xDaColuna(1), yDe(720) + 10);
    expect(onMover).toHaveBeenCalledTimes(1);
    expect(destinoDe(onMover.mock.calls[0])).toEqual({ dia: D2, inicioMin: 720, duracaoMin: 45 });
    expect(onMover.mock.calls[0][2]).toBe("ponteiro");
  });

  it("mudar só de dia (mesma hora) mantém a duração e a hora", () => {
    const { onMover } = montar([item({ id: "A", inicioMin: 600, duracaoMin: 90 })]);
    fireEvent.pointerDown(bloco("A"), { ...ponteiro(), clientX: xDaColuna(0), clientY: yDe(630) });
    mover(xDaColuna(2), yDe(630));
    soltar(xDaColuna(2), yDe(630));
    expect(destinoDe(onMover.mock.calls[0])).toEqual({ dia: D3, inicioMin: 600, duracaoMin: 90 });
  });

  it("mostra uma prévia enquanto arrasta, e o bloco de origem fica esmaecido", () => {
    montar([item({ id: "A" })]);
    fireEvent.pointerDown(bloco("A"), { ...ponteiro(), clientX: xDaColuna(0), clientY: yDe(620) });
    mover(xDaColuna(1), yDe(800));
    expect(document.querySelector("[data-previa='mover']")).toBeTruthy();
    expect(bloco("A").className).toContain("opacity-40");
    soltar(xDaColuna(1), yDe(800));
    expect(document.querySelector("[data-previa='mover']")).toBeNull();
  });

  it("um clique sem mover (abaixo do limiar) não vira arrasto: abre o item", () => {
    const { onMover, onAbrirItem } = montar([item({ id: "A" })]);
    fireEvent.pointerDown(bloco("A"), { ...ponteiro(), clientX: 150, clientY: yDe(620) });
    mover(152, yDe(620) + 1);
    soltar(152, yDe(620) + 1);
    fireEvent.click(bloco("A"));
    expect(onMover).not.toHaveBeenCalled();
    expect(onAbrirItem).toHaveBeenCalledTimes(1);
  });

  it("soltar exatamente onde estava não dispara mudança", () => {
    const { onMover } = montar([item({ id: "A", inicioMin: 600 })]);
    fireEvent.pointerDown(bloco("A"), { ...ponteiro(), clientX: xDaColuna(0), clientY: yDe(620) });
    mover(xDaColuna(0) + 30, yDe(620) + 20);
    soltar(xDaColuna(0), yDe(620));
    expect(onMover).not.toHaveBeenCalled();
  });

  it("depois de arrastar, o clique que o navegador dispara ao soltar não abre o item", () => {
    vi.useFakeTimers();
    const { onAbrirItem } = montar([item({ id: "A" })]);
    fireEvent.pointerDown(bloco("A"), { ...ponteiro(), clientX: 150, clientY: yDe(620) });
    mover(250, yDe(700));
    soltar(250, yDe(700));
    fireEvent.click(bloco("A")); // o clique "fantasma" logo depois do pointerup
    expect(onAbrirItem).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(5); });
    fireEvent.click(bloco("A")); // um clique de verdade, depois, volta a funcionar
    expect(onAbrirItem).toHaveBeenCalledTimes(1);
  });

  it("Esc no meio do arrasto cancela e nada é salvo", () => {
    const { onMover } = montar([item({ id: "A" })]);
    fireEvent.pointerDown(bloco("A"), { ...ponteiro(), clientX: 150, clientY: yDe(620) });
    mover(250, yDe(800));
    fireEvent.keyDown(window, { key: "Escape" });
    soltar(250, yDe(800));
    expect(onMover).not.toHaveBeenCalled();
    expect(document.querySelector("[data-previa='mover']")).toBeNull();
  });

  it("botão do meio/direito não inicia arrasto", () => {
    const { onMover } = montar([item({ id: "A" })]);
    fireEvent.pointerDown(bloco("A"), { ...ponteiro(), button: 2, clientX: 150, clientY: yDe(620) });
    mover(250, yDe(800));
    soltar(250, yDe(800));
    expect(onMover).not.toHaveBeenCalled();
  });

  it("caneta funciona como mouse", () => {
    const { onMover } = montar([item({ id: "A", inicioMin: 600 })]);
    fireEvent.pointerDown(bloco("A"), { ...ponteiro("pen"), clientX: 150, clientY: yDe(600) });
    mover(150, yDe(660), "pen");
    soltar(150, yDe(660), "pen");
    expect(destinoDe(onMover.mock.calls[0]).inicioMin).toBe(660);
  });

  it("soltar sobre o cabeçalho dos dias não muda nada (o horário 'de baixo' está escondido atrás dele)", () => {
    const { onMover } = montar([item({ id: "A" })]);
    fireEvent.pointerDown(bloco("A"), { ...ponteiro(), clientX: 150, clientY: yDe(620) });
    mover(250, Y_CABECALHO);
    expect(document.querySelector("[data-previa='mover']")!.getAttribute("style")).toContain(`top: ${600 * PX_POR_MINUTO}px`); // a prévia volta para onde o bloco está
    soltar(250, Y_CABECALHO);
    expect(onMover).not.toHaveBeenCalled();
  });
});

describe("encaixe (snap)", () => {
  it("usa o encaixe recebido: 30 min arredonda para meia hora", () => {
    const { onMover } = montar([item({ id: "A", inicioMin: 600 })], { encaixe: 30 });
    fireEvent.pointerDown(bloco("A"), { ...ponteiro(), clientX: 150, clientY: yDe(600) });
    mover(150, yDe(731));
    soltar(150, yDe(731));
    expect(destinoDe(onMover.mock.calls[0]).inicioMin).toBe(720);
  });
  it("com 5 min o gesto é fino", () => {
    const { onMover } = montar([item({ id: "A", inicioMin: 600 })], { encaixe: 5 });
    fireEvent.pointerDown(bloco("A"), { ...ponteiro(), clientX: 150, clientY: yDe(600) });
    mover(150, yDe(637));
    soltar(150, yDe(637));
    expect(destinoDe(onMover.mock.calls[0]).inicioMin).toBe(635);
  });
  it("o seletor lista as opções e avisa a mudança", () => {
    const { onMudarEncaixe } = montar([]);
    const seletor = screen.getByLabelText("Encaixe ao arrastar") as HTMLSelectElement;
    expect([...seletor.options].map((o) => o.value)).toEqual(["5", "10", "15", "30", "60"]);
    fireEvent.change(seletor, { target: { value: "30" } });
    expect(onMudarEncaixe).toHaveBeenCalledWith(30);
  });
});

describe("redimensionar", () => {
  it("puxar a borda de baixo muda a duração e mantém o início", () => {
    const { onMover } = montar([item({ id: "A", dia: D1, inicioMin: 600, duracaoMin: 60 })]);
    const alca = bloco("A").querySelector("[data-resize]")!;
    fireEvent.pointerDown(alca, { ...ponteiro(), clientX: 150, clientY: yDe(660) - 2 });
    mover(150, yDe(690));
    soltar(150, yDe(690));
    expect(destinoDe(onMover.mock.calls[0])).toEqual({ dia: D1, inicioMin: 600, duracaoMin: 90 });
  });
  it("nunca fica menor que um encaixe", () => {
    const { onMover } = montar([item({ id: "A", inicioMin: 600, duracaoMin: 60 })]);
    fireEvent.pointerDown(bloco("A").querySelector("[data-resize]")!, { ...ponteiro(), clientX: 150, clientY: yDe(660) });
    mover(150, yDe(500));
    soltar(150, yDe(500));
    expect(destinoDe(onMover.mock.calls[0]).duracaoMin).toBe(15);
  });
  it("durante o gesto a altura do bloco já acompanha", () => {
    montar([item({ id: "A", inicioMin: 600, duracaoMin: 60 })]);
    fireEvent.pointerDown(bloco("A").querySelector("[data-resize]")!, { ...ponteiro(), clientX: 150, clientY: yDe(660) });
    mover(150, yDe(720));
    expect(parseFloat(bloco("A").style.height)).toBeCloseTo(120 * PX_POR_MINUTO);
    soltar(150, yDe(720));
  });
  it("redimensionar não abre o item nem move de dia", () => {
    const { onMover, onAbrirItem } = montar([item({ id: "A", inicioMin: 600, duracaoMin: 60 })]);
    fireEvent.pointerDown(bloco("A").querySelector("[data-resize]")!, { ...ponteiro(), clientX: 150, clientY: yDe(660) });
    mover(350, yDe(700)); // ponteiro escapou para outra coluna: continua sendo só duração
    soltar(350, yDe(700));
    expect(onAbrirItem).not.toHaveBeenCalled();
    expect(destinoDe(onMover.mock.calls[0]).dia).toBe(D1);
  });
});

describe("toque", () => {
  beforeEach(() => { vi.useFakeTimers(); });

  it("segurar e arrastar move o bloco (pressão longa)", () => {
    const { onMover } = montar([item({ id: "A", dia: D1, inicioMin: 600, duracaoMin: 60 })]);
    fireEvent.pointerDown(bloco("A"), { ...ponteiro("touch"), clientX: 150, clientY: yDe(620) });
    expect(document.querySelector("[data-previa='mover']")).toBeNull(); // ainda não "pegou"
    act(() => { vi.advanceTimersByTime(LONGO_TOQUE_MS + 10); });
    mover(250, yDe(740), "touch");
    expect(document.querySelector("[data-previa='mover']")).toBeTruthy();
    soltar(250, yDe(740), "touch");
    expect(destinoDe(onMover.mock.calls[0])).toEqual({ dia: D2, inicioMin: 720, duracaoMin: 60 });
  });

  it("mexer o dedo ANTES da pressão longa é rolagem: nada é movido", () => {
    const { onMover } = montar([item({ id: "A" })]);
    fireEvent.pointerDown(bloco("A"), { ...ponteiro("touch"), clientX: 150, clientY: yDe(620) });
    mover(150, yDe(620) + 30, "touch");
    act(() => { vi.advanceTimersByTime(LONGO_TOQUE_MS + 100); });
    mover(250, yDe(800), "touch");
    soltar(250, yDe(800), "touch");
    expect(onMover).not.toHaveBeenCalled();
    expect(document.querySelector("[data-previa='mover']")).toBeNull();
  });

  it("um toque rápido abre o item e não move nada", () => {
    const { onMover, onAbrirItem } = montar([item({ id: "A" })]);
    fireEvent.pointerDown(bloco("A"), { ...ponteiro("touch"), clientX: 150, clientY: yDe(620) });
    act(() => { vi.advanceTimersByTime(120); });
    soltar(150, yDe(620), "touch");
    fireEvent.click(bloco("A"));
    act(() => { vi.advanceTimersByTime(LONGO_TOQUE_MS * 2); });
    expect(onMover).not.toHaveBeenCalled();
    expect(onAbrirItem).toHaveBeenCalledTimes(1);
  });

  it("soltar o dedo antes da pressão longa cancela o temporizador (nenhum arrasto 'fantasma' depois)", () => {
    const { onMover } = montar([item({ id: "A" })]);
    fireEvent.pointerDown(bloco("A"), { ...ponteiro("touch"), clientX: 150, clientY: yDe(620) });
    soltar(150, yDe(620), "touch");
    act(() => { vi.advanceTimersByTime(LONGO_TOQUE_MS * 3); });
    expect(document.querySelector("[data-previa='mover']")).toBeNull();
    expect(onMover).not.toHaveBeenCalled();
  });

  it("o navegador cancelando o gesto (pointercancel, ex.: rolagem) desfaz tudo", () => {
    const { onMover } = montar([item({ id: "A" })]);
    fireEvent.pointerDown(bloco("A"), { ...ponteiro("touch"), clientX: 150, clientY: yDe(620) });
    act(() => { vi.advanceTimersByTime(LONGO_TOQUE_MS + 10); });
    mover(250, yDe(800), "touch");
    fireEvent.pointerCancel(window, { ...ponteiro("touch") });
    soltar(250, yDe(800), "touch");
    expect(onMover).not.toHaveBeenCalled();
  });

  it("depois de pegar o bloco, a rolagem nativa é bloqueada durante o gesto", () => {
    montar([item({ id: "A" })]);
    fireEvent.pointerDown(bloco("A"), { ...ponteiro("touch"), clientX: 150, clientY: yDe(620) });
    act(() => { vi.advanceTimersByTime(LONGO_TOQUE_MS + 10); });
    const toqueMove = new Event("touchmove", { cancelable: true, bubbles: true });
    window.dispatchEvent(toqueMove);
    expect(toqueMove.defaultPrevented).toBe(true);
    soltar(150, yDe(620), "touch");
    const depois = new Event("touchmove", { cancelable: true, bubbles: true });
    window.dispatchEvent(depois);
    expect(depois.defaultPrevented).toBe(false); // fora do gesto, a rolagem volta ao normal
  });

  it("a alça de redimensionar funciona de imediato no toque, sem pressão longa", () => {
    const { onMover } = montar([item({ id: "A", inicioMin: 600, duracaoMin: 60 })]);
    fireEvent.pointerDown(bloco("A").querySelector("[data-resize]")!, { ...ponteiro("touch"), clientX: 150, clientY: yDe(660) });
    mover(150, yDe(720), "touch");
    soltar(150, yDe(720), "touch");
    expect(destinoDe(onMover.mock.calls[0])).toEqual({ dia: D1, inicioMin: 600, duracaoMin: 120 });
  });

  it("um segundo dedo (outro pointerId) não interfere no gesto do primeiro", () => {
    const { onMover } = montar([item({ id: "A", inicioMin: 600 })]);
    fireEvent.pointerDown(bloco("A"), { ...ponteiro("touch", 1), clientX: 150, clientY: yDe(600) });
    act(() => { vi.advanceTimersByTime(LONGO_TOQUE_MS + 10); });
    mover(300, 50, "touch", 2);
    soltar(300, 50, "touch", 2);
    mover(150, yDe(660), "touch", 1);
    soltar(150, yDe(660), "touch", 1);
    expect(destinoDe(onMover.mock.calls[0]).inicioMin).toBe(660);
  });
});

describe("dia inteiro: só eventos entram e saem da faixa 'O dia todo'", () => {
  it("arrastar um evento para a faixa vira dia inteiro naquele dia, duração intacta", () => {
    const { onMover } = montar([item({ id: "A", tipo: "evento", dia: D1, inicioMin: 600, duracaoMin: 45 })]);
    fireEvent.pointerDown(bloco("A"), { ...ponteiro(), clientX: 150, clientY: yDe(620) });
    mover(350, Y_FAIXA);
    expect(document.querySelector(`[data-faixa-dia='${D3}']`)!.className).toContain("ring-cyan");
    soltar(350, Y_FAIXA);
    expect(destinoDe(onMover.mock.calls[0])).toEqual({ dia: D3, inicioMin: null, duracaoMin: 45 });
  });

  it("um evento de dia inteiro arrastado para a grade ganha horário e mantém a duração", () => {
    const { onMover } = montar([item({ id: "C", tipo: "evento", dia: D2, inicioMin: null, duracaoMin: 45 })]);
    fireEvent.pointerDown(bloco("C"), { ...ponteiro(), clientX: 250, clientY: Y_FAIXA });
    mover(350, yDe(540));
    soltar(350, yDe(540));
    expect(destinoDe(onMover.mock.calls[0])).toEqual({ dia: D3, inicioMin: 540, duracaoMin: 45 });
  });

  it("um evento de dia inteiro arrastado entre dias continua de dia inteiro", () => {
    const { onMover } = montar([item({ id: "C", tipo: "evento", dia: D2, inicioMin: null })]);
    fireEvent.pointerDown(bloco("C"), { ...ponteiro(), clientX: 250, clientY: Y_FAIXA });
    mover(150, Y_FAIXA + 2);
    soltar(150, Y_FAIXA + 2);
    expect(destinoDe(onMover.mock.calls[0])).toEqual({ dia: D1, inicioMin: null, duracaoMin: 60 });
  });

  it("um BLOCO de tempo NÃO entra na faixa: soltar sobre ela não muda nada", () => {
    const { onMover } = montar([item({ id: "A", dia: D1, inicioMin: 600 })]);
    fireEvent.pointerDown(bloco("A"), { ...ponteiro(), clientX: 150, clientY: yDe(620) });
    mover(350, Y_FAIXA);
    expect(document.querySelector(`[data-faixa-dia='${D3}']`)!.className).not.toContain("ring-cyan");
    soltar(350, Y_FAIXA);
    expect(onMover).not.toHaveBeenCalled();
  });

  it("eventos de dia inteiro aparecem na faixa, e os de horário na grade", () => {
    montar([item({ id: "C", tipo: "evento", dia: D2, inicioMin: null }), item({ id: "A", dia: D2, inicioMin: 600 })]);
    expect(document.querySelector(`[data-faixa-dia='${D2}'] [data-item$=':C']`)).toBeTruthy();
    expect(document.querySelector(`[data-coluna-dia='${D2}'] [data-item$=':A']`)).toBeTruthy();
    expect(screen.getByText("O dia todo")).toBeTruthy();
  });
});

describe("tarefa com data própria e prazo: só aparecem, a Agenda não os move", () => {
  const agendada = () => item({ id: "T", tipo: "tarefa", dia: D2, inicioMin: 600 });
  const prazo = () => item({ id: "P", tipo: "prazo", dia: D2, inicioMin: null, classe: "bg-warning/15 text-warning" });

  it("arrastar uma tarefa agendada não faz nada (sem prévia, sem mudança)", () => {
    const { onMover } = montar([agendada()]);
    fireEvent.pointerDown(bloco("T"), { ...ponteiro(), clientX: 250, clientY: yDe(620) });
    mover(350, yDe(800));
    expect(document.querySelector("[data-previa='mover']")).toBeNull();
    soltar(350, yDe(800));
    expect(onMover).not.toHaveBeenCalled();
  });

  it("não tem alça de redimensionar nem botão de menu", () => {
    montar([agendada(), prazo()]);
    expect(bloco("T").querySelector("[data-resize]")).toBeNull();
    expect(bloco("T").querySelector("[data-acao]")).toBeNull();
    expect(bloco("P").querySelector("[data-acao]")).toBeNull();
  });

  it("as setas, 'A', 'M' e Delete não mexem nelas — só Enter/Espaço abrem", () => {
    const { onMover, onAbrirItem, onRemover } = montar([agendada(), prazo()]);
    for (const c of ["T", "P"]) for (const key of ["ArrowDown", "ArrowRight", "a", "m", "Delete"]) fireEvent.keyDown(bloco(c), { key });
    fireEvent.keyDown(bloco("T"), { key: "ArrowDown", shiftKey: true });
    expect(onMover).not.toHaveBeenCalled();
    expect(onRemover).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.keyDown(bloco("T"), { key: "Enter" });
    fireEvent.keyDown(bloco("P"), { key: " " });
    expect(onAbrirItem).toHaveBeenCalledTimes(2);
  });

  it("clicar abre a tarefa", () => {
    const { onAbrirItem } = montar([agendada()]);
    fireEvent.click(bloco("T"));
    expect(onAbrirItem).toHaveBeenCalledTimes(1);
  });

  it("dizem no rótulo que a Agenda não os move", () => {
    montar([agendada(), prazo()]);
    expect(bloco("T").getAttribute("aria-label")).toMatch(/não a move/);
    expect(bloco("P").getAttribute("aria-label")).toMatch(/prazo em .*22.*não o move/i);
  });
});

describe("marca de prazo", () => {
  it("prazo sozinho é uma marca na faixa 'O dia todo', com bandeira e texto para leitor de tela", () => {
    montar([item({ id: "P", tipo: "prazo", dia: D2, inicioMin: null, titulo: "Entregar relatório", classe: "bg-warning/15 text-warning" })]);
    const marca = document.querySelector(`[data-faixa-dia='${D2}'] [data-item='prazo:P']`) as HTMLElement;
    expect(marca).toBeTruthy();
    expect(marca.className).toContain("text-warning");
    expect(marca.querySelector("svg")).toBeTruthy();
    expect(marca.textContent).toContain("Prazo:");
    expect(marca.textContent).toContain("Entregar relatório");
  });

  it("agendada COM prazo no dia: um cartão só, com o selo 'Prazo hoje' dentro dele", () => {
    montar([item({ id: "T", tipo: "tarefa", dia: D2, inicioMin: 600, comPrazo: true })]);
    expect(document.querySelectorAll("[data-item$=':T']")).toHaveLength(1);
    expect(bloco("T").querySelector("[data-marca-prazo]")!.textContent).toContain("Prazo hoje");
    expect(bloco("T").getAttribute("aria-label")).toMatch(/com prazo neste dia/);
  });

  it("agendada sem prazo no dia não tem selo", () => {
    montar([item({ id: "T", tipo: "tarefa", dia: D2, inicioMin: 600 })]);
    expect(bloco("T").querySelector("[data-marca-prazo]")).toBeNull();
  });

  it("agendada e prazo em dias diferentes: dois itens de chaves distintas, cada um uma vez", () => {
    montar([item({ id: "T", tipo: "tarefa", dia: D1, inicioMin: 600 }), item({ id: "T", tipo: "prazo", dia: D3, inicioMin: null, classe: "bg-warning/15 text-warning" })]);
    expect(document.querySelectorAll("[data-item='tarefa:T']")).toHaveLength(1);
    expect(document.querySelectorAll("[data-item='prazo:T']")).toHaveLength(1);
    expect(document.querySelector(`[data-coluna-dia='${D1}'] [data-item='tarefa:T']`)).toBeTruthy();
    expect(document.querySelector(`[data-faixa-dia='${D3}'] [data-item='prazo:T']`)).toBeTruthy();
  });
});

describe("rolagem inicial e as 24 horas", () => {
  let definidos: number[];
  let original: PropertyDescriptor | undefined;
  beforeEach(() => {
    definidos = [];
    original = Object.getOwnPropertyDescriptor(Element.prototype, "scrollTop");
    Object.defineProperty(Element.prototype, "scrollTop", { configurable: true, get() { return (this as { __st?: number }).__st ?? 0; }, set(v: number) { (this as { __st?: number }).__st = v; definidos.push(v); } });
  });
  afterEach(() => {
    if (original) Object.defineProperty(Element.prototype, "scrollTop", original);
    else delete (Element.prototype as { scrollTop?: number }).scrollTop;
  });
  const rolagem = () => screen.getByTestId("grade-rolagem") as HTMLElement & { __st?: number };

  it("vem rolada até o horário configurado: 06:00 = 6 horas de altura", () => {
    montar([], { inicioMin: 6 * 60 });
    expect(rolagem().__st).toBeCloseTo(6 * 64);
  });

  it("usa o horário recebido (08:30) — não um valor fixo", () => {
    montar([], { inicioMin: 8 * 60 + 30 });
    expect(rolagem().__st).toBeCloseTo(8.5 * 64);
  });

  it("sem preferência usa o padrão de 06:00", () => {
    montar([]);
    expect(rolagem().__st).toBeCloseTo(6 * 64);
  });

  it("00:00 começa no topo, sem rolar", () => {
    montar([], { inicioMin: 0 });
    expect(rolagem().__st).toBe(0);
  });

  it("as 24 horas continuam todas na grade, de 00:00 a 23:00, independente do início", () => {
    montar([], { inicioMin: 9 * 60 });
    const rotulos = [...document.querySelectorAll("div")].filter((d) => d.classList.contains("text-[11px]")).map((d) => d.textContent ?? "");
    expect(rotulos).toEqual(Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, "0")}:00`));
    expect((document.querySelector("[data-coluna-dia]") as HTMLElement).style.height || "").toBe(""); // a altura vem do grid pai
    expect((screen.getByTestId("grade-rolagem").firstElementChild!.lastElementChild as HTMLElement).style.height).toBe(`${24 * 64}px`);
  });

  it("mudar o início reaplica a rolagem na hora (sem recarregar)", () => {
    const { rerender, onMover, onAbrirItem, onMudarEncaixe, onSelecionarDia } = montar([], { inicioMin: 6 * 60 });
    rerender(<GradeTempo dias={DIAS} hoje={D2} itens={[]} encaixe={15} inicioMin={10 * 60} onMudarEncaixe={onMudarEncaixe} onSelecionarDia={onSelecionarDia} onAbrirItem={onAbrirItem} onMover={onMover} />);
    expect(rolagem().__st).toBeCloseTo(10 * 64);
  });

  it("uma nova renderização com o mesmo início NÃO desfaz a rolagem que a pessoa fez", () => {
    const { rerender, onMover, onAbrirItem, onMudarEncaixe, onSelecionarDia } = montar([], { inicioMin: 6 * 60 });
    rolagem().__st = 900; // a pessoa rolou
    definidos.length = 0;
    rerender(<GradeTempo dias={DIAS} hoje={D2} itens={[item({ id: "A" })]} encaixe={15} inicioMin={6 * 60} onMudarEncaixe={onMudarEncaixe} onSelecionarDia={onSelecionarDia} onAbrirItem={onAbrirItem} onMover={onMover} />);
    expect(definidos).toEqual([]);
    expect(rolagem().__st).toBe(900);
  });

  it("ao trocar de período volta ao início configurado", () => {
    const { rerender, onMover, onAbrirItem, onMudarEncaixe, onSelecionarDia } = montar([], { inicioMin: 6 * 60 });
    rolagem().__st = 900;
    rerender(<GradeTempo dias={["2026-09-28", "2026-09-29", "2026-09-30"]} hoje={D2} itens={[]} encaixe={15} inicioMin={6 * 60} onMudarEncaixe={onMudarEncaixe} onSelecionarDia={onSelecionarDia} onAbrirItem={onAbrirItem} onMover={onMover} />);
    expect(rolagem().__st).toBeCloseTo(6 * 64);
  });

  it("valores absurdos ficam dentro do dia (nunca rola além das 24 h nem para o negativo)", () => {
    montar([], { inicioMin: 99999 });
    expect(rolagem().__st).toBeCloseTo(24 * 64);
    montar([], { inicioMin: -50 });
    expect(definidos[definidos.length - 1]).toBe(0);
  });
});

describe("teclado", () => {
  const tecla = (el: HTMLElement, key: string, extra: Partial<KeyboardEventInit> = {}) => fireEvent.keyDown(el, { key, ...extra });

  it("seta para baixo/cima move por um encaixe", () => {
    const { onMover } = montar([item({ id: "A", inicioMin: 600, duracaoMin: 60 })]);
    tecla(bloco("A"), "ArrowDown");
    expect(destinoDe(onMover.mock.calls[0])).toEqual({ dia: D1, inicioMin: 615, duracaoMin: 60 });
    tecla(bloco("A"), "ArrowUp");
    expect(destinoDe(onMover.mock.calls[1]).inicioMin).toBe(585);
    expect(onMover.mock.calls[0][2]).toBe("teclado");
  });
  it("setas laterais mudam de dia sem alterar hora nem duração", () => {
    const { onMover } = montar([item({ id: "A", dia: D2, inicioMin: 600, duracaoMin: 75 })]);
    tecla(bloco("A"), "ArrowRight");
    tecla(bloco("A"), "ArrowLeft");
    expect(destinoDe(onMover.mock.calls[0])).toEqual({ dia: D3, inicioMin: 600, duracaoMin: 75 });
    expect(destinoDe(onMover.mock.calls[1])).toEqual({ dia: D1, inicioMin: 600, duracaoMin: 75 });
  });
  it("Shift + setas mudam a duração", () => {
    const { onMover } = montar([item({ id: "A", inicioMin: 600, duracaoMin: 60 })]);
    tecla(bloco("A"), "ArrowDown", { shiftKey: true });
    tecla(bloco("A"), "ArrowUp", { shiftKey: true });
    expect(destinoDe(onMover.mock.calls[0])).toEqual({ dia: D1, inicioMin: 600, duracaoMin: 75 });
    expect(destinoDe(onMover.mock.calls[1]).duracaoMin).toBe(45);
  });
  it("respeita o encaixe configurado", () => {
    const { onMover } = montar([item({ id: "A", inicioMin: 600 })], { encaixe: 30 });
    tecla(bloco("A"), "ArrowDown");
    expect(destinoDe(onMover.mock.calls[0]).inicioMin).toBe(630);
  });
  it("'A' alterna dia inteiro para EVENTOS, nos dois sentidos", () => {
    const { onMover } = montar([item({ id: "A", tipo: "evento", inicioMin: 600 }), item({ id: "C", tipo: "evento", dia: D2, inicioMin: null })]);
    tecla(bloco("A"), "a");
    expect(destinoDe(onMover.mock.calls[0]).inicioMin).toBeNull();
    tecla(bloco("C"), "A");
    expect(destinoDe(onMover.mock.calls[1])).toEqual({ dia: D2, inicioMin: 540, duracaoMin: 60 });
  });
  it("'A' não faz nada num BLOCO de tempo (ele sempre tem horário)", () => {
    const { onMover } = montar([item({ id: "A", inicioMin: 600 })]);
    tecla(bloco("A"), "a");
    expect(onMover).not.toHaveBeenCalled();
  });
  it("no limite do dia a tecla não faz nada (sem salvar à toa)", () => {
    const { onMover } = montar([item({ id: "A", inicioMin: 0 })]);
    tecla(bloco("A"), "ArrowUp");
    expect(onMover).not.toHaveBeenCalled();
  });
  it("Enter e Espaço abrem o item", () => {
    const { onAbrirItem } = montar([item({ id: "A" })]);
    tecla(bloco("A"), "Enter");
    tecla(bloco("A"), " ");
    expect(onAbrirItem).toHaveBeenCalledTimes(2);
  });
  it("teclas com Ctrl/Alt não são capturadas", () => {
    const { onMover } = montar([item({ id: "A" })]);
    tecla(bloco("A"), "ArrowDown", { ctrlKey: true });
    tecla(bloco("A"), "ArrowRight", { altKey: true });
    expect(onMover).not.toHaveBeenCalled();
  });
  it("o bloco é focável e descreve as teclas para leitor de tela", () => {
    montar([item({ id: "A" })]);
    expect(bloco("A").tabIndex).toBe(0);
    expect(bloco("A").getAttribute("aria-label")).toMatch(/Setas movem/);
  });
  it("anuncia a mudança em uma região aria-live", () => {
    montar([item({ id: "A", inicioMin: 600, duracaoMin: 60 })]);
    tecla(bloco("A"), "ArrowDown");
    expect(screen.getByRole("status").textContent).toMatch(/Tarefa A.*10:15 às 11:15/);
  });
  it("Delete e Backspace removem um BLOCO; num evento não fazem nada", () => {
    const { onRemover } = montar([item({ id: "A" }), item({ id: "E", tipo: "evento" })]);
    tecla(bloco("A"), "Delete");
    tecla(bloco("A"), "Backspace");
    tecla(bloco("E"), "Delete");
    expect(onRemover).toHaveBeenCalledTimes(2);
    expect(onRemover.mock.calls[0][0].chave).toBe("bloco:A");
  });
});

describe("menu (alternativa a arrastar)", () => {
  it("abre pelo botão, pela tecla M e pelo botão direito", () => {
    montar([item({ id: "A" })]);
    fireEvent.click(within(bloco("A")).getByLabelText(/Mover ou redimensionar Tarefa A/));
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.keyDown(bloco("A"), { key: "m" });
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    fireEvent.contextMenu(bloco("A"));
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("muda data, horário e duração de uma vez", () => {
    const { onMover } = montar([item({ id: "A", dia: D1, inicioMin: 600, duracaoMin: 60 })]);
    fireEvent.keyDown(bloco("A"), { key: "m" });
    fireEvent.change(screen.getByLabelText("Data"), { target: { value: D3 } });
    fireEvent.change(screen.getByLabelText("Início"), { target: { value: "14:20" } });
    fireEvent.change(screen.getByLabelText("Duração (min)"), { target: { value: "95" } });
    fireEvent.click(screen.getByRole("button", { name: "Aplicar" }));
    expect(destinoDe(onMover.mock.calls[0])).toEqual({ dia: D3, inicioMin: 14 * 60 + 20, duracaoMin: 95 });
    expect(onMover.mock.calls[0][2]).toBe("menu");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("no menu de um BLOCO não há 'Dia inteiro' e ele avisa que só o tempo alocado muda", () => {
    montar([item({ id: "A" })]);
    fireEvent.keyDown(bloco("A"), { key: "m" });
    expect(screen.queryByLabelText("Dia inteiro")).toBeNull();
    expect(screen.getByRole("dialog").textContent).toMatch(/data da tarefa não é alterada/);
  });

  it("evento: marcar 'Dia inteiro' leva para a faixa e desabilita o horário", () => {
    const { onMover } = montar([item({ id: "A", tipo: "evento", dia: D1, inicioMin: 600, duracaoMin: 60 })]);
    fireEvent.keyDown(bloco("A"), { key: "m" });
    fireEvent.click(screen.getByLabelText("Dia inteiro"));
    expect((screen.getByLabelText("Início") as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Aplicar" }));
    expect(destinoDe(onMover.mock.calls[0])).toEqual({ dia: D1, inicioMin: null, duracaoMin: 60 });
  });

  it("evento de dia inteiro ganha horário desmarcando 'Dia inteiro'", () => {
    const { onMover } = montar([item({ id: "C", tipo: "evento", dia: D2, inicioMin: null, duracaoMin: 45 })]);
    fireEvent.keyDown(bloco("C"), { key: "m" });
    fireEvent.click(screen.getByLabelText("Dia inteiro"));
    fireEvent.change(screen.getByLabelText("Início"), { target: { value: "08:30" } });
    fireEvent.click(screen.getByRole("button", { name: "Aplicar" }));
    expect(destinoDe(onMover.mock.calls[0])).toEqual({ dia: D2, inicioMin: 510, duracaoMin: 45 });
  });

  it("'Remover bloco' remove o bloco (e só ele tem esse botão)", () => {
    const { onRemover } = montar([item({ id: "A" }), item({ id: "E", tipo: "evento" })]);
    fireEvent.keyDown(bloco("E"), { key: "m" });
    expect(screen.queryByRole("button", { name: /Remover bloco/ })).toBeNull();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    fireEvent.keyDown(bloco("A"), { key: "m" });
    fireEvent.click(screen.getByRole("button", { name: /Remover bloco/ }));
    expect(onRemover).toHaveBeenCalledTimes(1);
    expect(onRemover.mock.calls[0][0].chave).toBe("bloco:A");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("recusa valores inválidos e explica", () => {
    const { onMover } = montar([item({ id: "A" })]);
    fireEvent.keyDown(bloco("A"), { key: "m" });
    fireEvent.change(screen.getByLabelText("Duração (min)"), { target: { value: "0" } });
    expect(screen.getByRole("alert").textContent).toMatch(/1 a 1440/);
    expect((screen.getByRole("button", { name: "Aplicar" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Duração (min)"), { target: { value: "30" } });
    fireEvent.change(screen.getByLabelText("Data"), { target: { value: "" } });
    expect(screen.getByRole("alert").textContent).toMatch(/data/i);
    expect(onMover).not.toHaveBeenCalled();
  });

  it("cancelar não muda nada", () => {
    const { onMover } = montar([item({ id: "A" })]);
    fireEvent.keyDown(bloco("A"), { key: "m" });
    fireEvent.change(screen.getByLabelText("Duração (min)"), { target: { value: "120" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(onMover).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("aplicar sem mudar nada não dispara salvamento", () => {
    const { onMover } = montar([item({ id: "A" })]);
    fireEvent.keyDown(bloco("A"), { key: "m" });
    fireEvent.click(screen.getByRole("button", { name: "Aplicar" }));
    expect(onMover).not.toHaveBeenCalled();
  });
});

describe("sobreposição legível", () => {
  it("dois blocos no mesmo horário dividem a largura em vez de ficar um sobre o outro", () => {
    montar([item({ id: "A", inicioMin: 600, duracaoMin: 60 }), item({ id: "B", inicioMin: 630, duracaoMin: 60 })]);
    expect(bloco("A").dataset.colunas).toBe("2");
    expect(bloco("B").dataset.colunas).toBe("2");
    expect(new Set([bloco("A").dataset.coluna, bloco("B").dataset.coluna])).toEqual(new Set(["0", "1"]));
    expect(bloco("A").style.width).toContain("50%");
    expect(bloco("A").style.left).not.toBe(bloco("B").style.left);
  });
  it("uma tarefa agendada e um bloco no mesmo horário também dividem a largura", () => {
    montar([item({ id: "T", tipo: "tarefa", inicioMin: 600 }), item({ id: "A", inicioMin: 600 })]);
    expect(bloco("T").dataset.colunas).toBe("2");
    expect(bloco("A").dataset.colunas).toBe("2");
  });
  it("blocos em horários diferentes ou dias diferentes ocupam a largura toda", () => {
    montar([item({ id: "A", inicioMin: 600, duracaoMin: 60 }), item({ id: "B", inicioMin: 660, duracaoMin: 60 }), item({ id: "C", dia: D2, inicioMin: 600 })]);
    for (const c of ["A", "B", "C"]) expect(bloco(c).dataset.colunas).toBe("1");
  });
  it("blocos curtos têm altura mínima legível", () => {
    montar([item({ id: "A", inicioMin: 600, duracaoMin: 5 })]);
    expect(parseFloat(bloco("A").style.height)).toBeGreaterThanOrEqual(22 * PX_POR_MINUTO);
  });
  it("o bloco vem com título completo no tooltip e cada um é focável", () => {
    montar([item({ id: "A", titulo: "Reunião muito longa de planejamento", inicioMin: 600 })]);
    expect(bloco("A").title).toMatch(/Reunião muito longa de planejamento/);
  });
});

describe("dias: só o NÚMERO abre o popup do dia", () => {
  const numero = (dia: string) => document.querySelector<HTMLElement>(`[data-cabecalho-dia='${dia}'] button`)!;

  it("clicar no número seleciona o dia, ancorando o popup na célula do dia", () => {
    const { onSelecionarDia } = montar([]);
    fireEvent.click(numero(D2));
    expect(onSelecionarDia).toHaveBeenCalledTimes(1);
    expect(onSelecionarDia).toHaveBeenCalledWith(D2, document.querySelector(`[data-cabecalho-dia='${D2}']`));
  });

  it("clicar no resto do cabeçalho, na coluna ou na faixa 'O dia todo' NÃO abre nada", () => {
    const { onSelecionarDia } = montar([item({ id: "A", dia: D2, inicioMin: 600 })]);
    fireEvent.click(document.querySelector(`[data-cabecalho-dia='${D2}']`)!);
    fireEvent.click(document.querySelector(`[data-cabecalho-dia='${D2}'] span`)!); // o dia da semana
    fireEvent.click(document.querySelector(`[data-coluna-dia='${D2}']`)!);
    fireEvent.click(document.querySelector(`[data-faixa-dia='${D2}']`)!);
    fireEvent.click(bloco("A"));
    expect(onSelecionarDia).not.toHaveBeenCalled();
  });

  it("o cabeçalho de cada dia não é um botão; o único botão dele é o número", () => {
    montar([]);
    for (const dia of DIAS) {
      const cabecalho = document.querySelector(`[data-cabecalho-dia='${dia}']`)!;
      expect(cabecalho.tagName).toBe("DIV");
      expect(cabecalho.querySelectorAll("button")).toHaveLength(1);
    }
  });

  it("o número fica no topo da coluna e no meio (horizontal), com o dia da semana logo abaixo", () => {
    montar([]);
    const cabecalho = document.querySelector(`[data-cabecalho-dia='${D2}']`) as HTMLElement;
    expect(cabecalho.className).toMatch(/\bitems-center\b/); // centralizado na horizontal
    expect(cabecalho.className).toMatch(/\bjustify-start\b/); // e no topo, não no meio da altura
    expect(cabecalho.className).toMatch(/\btext-center\b/);
    const filhos = [...cabecalho.children] as HTMLElement[];
    expect(filhos[0].tagName).toBe("BUTTON"); // o número vem primeiro, em cima
    expect(filhos[0].textContent).toBe("22");
    expect(filhos[1].tagName).toBe("SPAN"); // o dia da semana embaixo
  });

  it("o número tem um rótulo acessível com o dia por extenso", () => {
    montar([]);
    expect(numero(D2).getAttribute("aria-label")).toMatch(/Ver tarefas de .*22 de setembro/i);
  });

  it("o dia de hoje tem o número destacado", () => {
    montar([]);
    expect(numero(D2).className).toContain("bg-steel-500");
    expect(numero(D1).className).not.toContain("bg-steel-500");
  });
});

describe("tarefa arrastada de uma lista para a grade (alocar tempo)", () => {
  const TAREFA: TarefaArrastavel = { id: "t9", titulo: "Escrever relatório", duracaoMin: 45, prioridade: "alta" };
  const emitir = (fase: "mover" | "soltar" | "cancelar", x: number, y: number, tarefa: TarefaArrastavel = TAREFA) =>
    act(() => { window.dispatchEvent(new CustomEvent(EVENTO_ARRASTE_TAREFA, { detail: { fase, tarefa, x, y } })); });

  it("sobre uma coluna, mostra onde o tempo dela ficaria (com o nome e o intervalo), no encaixe", () => {
    montar([]);
    emitir("mover", xDaColuna(1), yDe(307));
    const previa = document.querySelector("[data-previa='alocar']") as HTMLElement;
    expect(previa).toBeTruthy();
    expect(document.querySelector(`[data-coluna-dia='${D2}'] [data-previa='alocar']`)).toBe(previa);
    expect(previa.textContent).toContain("Escrever relatório");
    expect(previa.textContent).toContain("05:00–05:45"); // 45 min de tempo, começando no encaixe de 15 min
    expect(parseFloat(previa.style.height)).toBeCloseTo(45 * PX_POR_MINUTO);
  });

  it("ao soltar, pede para alocar naquele dia e horário com a duração da tarefa — sem mover nada", () => {
    const { onAlocarTarefa, onMover } = montar([]);
    emitir("mover", xDaColuna(2), yDe(420));
    emitir("soltar", xDaColuna(2), yDe(420));
    expect(onAlocarTarefa).toHaveBeenCalledTimes(1);
    expect(onAlocarTarefa).toHaveBeenCalledWith(TAREFA, { dia: D3, inicioMin: 420, duracaoMin: 45 });
    expect(onMover).not.toHaveBeenCalled();
    expect(document.querySelector("[data-previa='alocar']")).toBeNull();
  });

  it("tarefa sem estimativa aloca o tempo padrão (30 min)", () => {
    const { onAlocarTarefa } = montar([]);
    emitir("soltar", xDaColuna(0), yDe(300), { ...TAREFA, duracaoMin: null });
    expect(destinoDe(onAlocarTarefa.mock.calls[0]).duracaoMin).toBe(30);
  });

  it("respeita o encaixe configurado", () => {
    const { onAlocarTarefa } = montar([], { encaixe: 30 });
    emitir("soltar", xDaColuna(0), yDe(331));
    expect(destinoDe(onAlocarTarefa.mock.calls[0]).inicioMin).toBe(330);
  });

  it("soltar sobre o cabeçalho, a faixa 'O dia todo' ou a coluna das horas NÃO aloca", () => {
    const { onAlocarTarefa } = montar([]);
    for (const [x, y] of [[xDaColuna(1), Y_CABECALHO], [xDaColuna(1), Y_FAIXA], [50, yDe(300)], [900, yDe(300)], [xDaColuna(1), 9999]]) {
      emitir("mover", x, y);
      expect(document.querySelector("[data-previa='alocar']")).toBeNull();
      emitir("soltar", x, y);
    }
    expect(onAlocarTarefa).not.toHaveBeenCalled();
  });

  it("cancelar (Esc, pointercancel) apaga a prévia e não aloca", () => {
    const { onAlocarTarefa } = montar([]);
    emitir("mover", xDaColuna(1), yDe(300));
    expect(document.querySelector("[data-previa='alocar']")).toBeTruthy();
    emitir("cancelar", xDaColuna(1), yDe(300));
    expect(document.querySelector("[data-previa='alocar']")).toBeNull();
    expect(onAlocarTarefa).not.toHaveBeenCalled();
  });

  it("arrastar para fora da grade depois de estar sobre ela apaga a prévia", () => {
    montar([]);
    emitir("mover", xDaColuna(1), yDe(300));
    emitir("mover", 950, yDe(300));
    expect(document.querySelector("[data-previa='alocar']")).toBeNull();
  });

  it("a prévia não faz os blocos que já estão lá mudarem de lugar", () => {
    montar([item({ id: "A", dia: D2, inicioMin: 600, duracaoMin: 60 })]);
    const antes = bloco("A").getAttribute("style");
    emitir("mover", xDaColuna(1), yDe(300));
    expect(bloco("A").getAttribute("style")).toBe(antes);
  });

  it("sem `onAlocarTarefa` a grade ignora o arrasto de tarefas", () => {
    montar([], { onAlocarTarefa: undefined });
    emitir("mover", xDaColuna(1), yDe(300));
    expect(document.querySelector("[data-previa='alocar']")).toBeNull();
  });

  it("anuncia a alocação para leitor de tela", () => {
    montar([]);
    emitir("soltar", xDaColuna(1), yDe(300));
    expect(screen.getByRole("status").textContent).toMatch(/Escrever relatório.*05:00 às 05:45/);
  });
});
