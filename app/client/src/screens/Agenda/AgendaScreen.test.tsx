import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BlocoPlanejado, TarefaResumo } from "@/lib/api";

vi.mock("@/lib/use-espaco-filtro", () => ({ useEspacoFiltro: () => undefined }));
vi.mock("@/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...original,
    tarefas: {
      ...original.tarefas, listar: vi.fn(), capacidade: vi.fn(), atualizar: vi.fn(),
      timeEntries: { ...original.tarefas.timeEntries, criar: vi.fn(), atualizar: vi.fn(), excluir: vi.fn() },
    },
    agenda: { blocos: vi.fn() },
    rotina: { ...original.rotina, listar: vi.fn() },
  };
});

import { agenda, ApiError, rotina, tarefas } from "@/lib/api";
import { EVENTO_ARRASTE_TAREFA } from "@/lib/arraste-tarefa";
import { CHAVE_PREFERENCIAS_CALENDARIO, salvarPreferenciasCalendario } from "@/lib/preferencias-calendario";
import { RefreshProvider } from "@/lib/refresh-bus";
import { AgendaScreen } from "./AgendaScreen";

// Semana de 20 (dom) a 26/09/2026 (sáb). Brasília = UTC-3. Terça 22/09.
const DIAS_SEMANA = ["2026-09-20", "2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25", "2026-09-26"];

const TAREFA_AGENDADA: TarefaResumo = {
  id: "t1", caminho_arquivo: "Tarefas/a.md", titulo: "Reunião de time", status: "pendente", scheduled_at: "2026-09-22T13:00:00Z", duration_min: 45, due_date: null,
  espaco: "pessoal", criado_em: "2026-09-01T10:00:00Z", prioridade: "baixa", criado_por: null, criado_por_nome: null,
};
const BLOCO: BlocoPlanejado = { id: "b1", tarefa_id: "t1", tipo: "planejado", inicio_em: "2026-09-22T13:00:00+00:00", duracao_min: 45, foco: "", titulo: "Relatório", status: "pendente", prioridade: "baixa", tarefa_duration_min: 45 };

const listar = vi.mocked(tarefas.listar);
const atualizarTarefa = vi.mocked(tarefas.atualizar);
const criarBloco = vi.mocked(tarefas.timeEntries.criar);
const atualizarBloco = vi.mocked(tarefas.timeEntries.atualizar);
const excluirBloco = vi.mocked(tarefas.timeEntries.excluir);
const buscarBlocos = vi.mocked(agenda.blocos);

let blocosDoServidor: BlocoPlanejado[] = [];

function telaLarga() {
  window.matchMedia = ((q: string) => ({ matches: true, media: q, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false })) as typeof window.matchMedia;
}

function retangulo(left: number, top: number, right: number, bottom: number): DOMRect {
  return { left, top, right, bottom, x: left, y: top, width: right - left, height: bottom - top, toJSON: () => ({}) } as DOMRect;
}
// Layout falso (o jsdom não calcula geometria): rolagem y 100–700, cabeçalho 100–160, faixa "O dia todo" 160–204, horas a partir de 204; colunas de 100 px.
const TOPO_HORAS = 204;
const yDe = (m: number) => TOPO_HORAS + m * (64 / 60);
const xDoDia = (dia: string) => 150 + DIAS_SEMANA.indexOf(dia) * 100;
function simularLayout() {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const el = this as HTMLElement;
    if (el.dataset.colunaDia) { const i = DIAS_SEMANA.indexOf(el.dataset.colunaDia); return retangulo(100 + i * 100, TOPO_HORAS, 200 + i * 100, TOPO_HORAS + 24 * 64); }
    if (el.dataset.faixaDia) { const i = DIAS_SEMANA.indexOf(el.dataset.faixaDia); return retangulo(100 + i * 100, 160, 200 + i * 100, 204); }
    if (el.getAttribute("data-testid") === "grade-rolagem") return retangulo(0, 100, 900, 700);
    if (el.dataset.item) {
      const dentro = el.closest("[data-coluna-dia]") as HTMLElement | null;
      if (dentro) { const i = DIAS_SEMANA.indexOf(dentro.dataset.colunaDia as string); const topo = TOPO_HORAS + parseFloat(el.style.top || "0"); return retangulo(100 + i * 100, topo, 200 + i * 100, topo + parseFloat(el.style.height || "22")); }
    }
    return retangulo(0, 0, 0, 0);
  });
}

// scrollTop do jsdom não guarda valor: registra o que a grade define.
let rolagens: number[] = [];
let descritorScrollTop: PropertyDescriptor | undefined;
function registrarScrollTop() {
  rolagens = [];
  descritorScrollTop = Object.getOwnPropertyDescriptor(Element.prototype, "scrollTop");
  Object.defineProperty(Element.prototype, "scrollTop", { configurable: true, get() { return (this as { __st?: number }).__st ?? 0; }, set(v: number) { (this as { __st?: number }).__st = v; rolagens.push(v); } });
}
const rolagem = () => (screen.getByTestId("grade-rolagem") as HTMLElement & { __st?: number }).__st;

async function abrirAgenda(opcoes: { tarefasDoServidor?: TarefaResumo[]; modo?: string; dia?: string; blocos?: BlocoPlanejado[] } = {}) {
  const { tarefasDoServidor = [TAREFA_AGENDADA], modo = "semana", dia = "2026-09-22" } = opcoes;
  blocosDoServidor = opcoes.blocos ?? [BLOCO];
  localStorage.setItem("ecos:agenda:visualizacao", JSON.stringify({ modo, dia }));
  listar.mockResolvedValue({ items: tarefasDoServidor, next_cursor: null } as never);
  buscarBlocos.mockImplementation(async () => blocosDoServidor);
  vi.mocked(tarefas.capacidade).mockResolvedValue({ data: dia, total_dia_min: 0, consumido_rotina_min: 0, consumido_eventos_externos_min: 0, consumido_tarefas_min: 0, disponivel_producao_min: 0, tempo_livre_min: 0, estourado: false });
  vi.mocked(rotina.listar).mockResolvedValue([]);
  render(<MemoryRouter><RefreshProvider><AgendaScreen /></RefreshProvider></MemoryRouter>);
  // Espera a visão montar: nas de horário, o seletor de encaixe da grade; no mês, as células dos dias.
  if (modo === "mes") return await waitFor(() => { const c = document.querySelector<HTMLElement>("[data-dia-mes]"); expect(c).toBeTruthy(); return c!; });
  return await screen.findByLabelText("Encaixe ao arrastar");
}
const item = (chave: string) => document.querySelector<HTMLElement>(`[data-item="${chave}"]`)!;
const bloco = () => item("bloco:b1");
const emitir = (fase: "mover" | "soltar" | "cancelar", x: number, y: number, tarefa = { id: "t9", titulo: "Escrever relatório", duracaoMin: 45, prioridade: "alta" }) =>
  act(() => { window.dispatchEvent(new CustomEvent(EVENTO_ARRASTE_TAREFA, { detail: { fase, tarefa, x, y } })); });

beforeEach(() => {
  telaLarga();
  localStorage.clear();
  registrarScrollTop();
  for (const f of [atualizarTarefa, criarBloco, atualizarBloco, excluirBloco, listar, buscarBlocos]) f.mockReset();
});
afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  if (descritorScrollTop) Object.defineProperty(Element.prototype, "scrollTop", descritorScrollTop);
  else delete (Element.prototype as { scrollTop?: number }).scrollTop;
});

describe("blocos de tempo na grade", () => {
  it("o bloco aparece na coluna e no horário locais (10:00, não 13:00 UTC), e a tarefa agendada aparece à parte", async () => {
    await abrirAgenda();
    await screen.findByRole("button", { name: /^Relatório,/ });
    expect(bloco().getAttribute("aria-label")).toMatch(/10:00 às 10:45/);
    expect(bloco().closest("[data-coluna-dia]")!.getAttribute("data-coluna-dia")).toBe("2026-09-22");
    expect(item("tarefa:t1")).toBeTruthy();
  });

  it("busca os blocos do período (com 1 dia de margem) no fuso do cliente", async () => {
    await abrirAgenda();
    await waitFor(() => expect(buscarBlocos).toHaveBeenCalled());
    expect(buscarBlocos).toHaveBeenCalledWith({ data_de: "2026-09-19", data_ate: "2026-09-27", tz: -180 });
  });

  it("teclado: o bloco muda na hora e o servidor recebe SÓ o novo início (sem duração) — e a tarefa nunca é atualizada", async () => {
    atualizarBloco.mockResolvedValue({ id: "b1" });
    await abrirAgenda();
    await screen.findByRole("button", { name: /^Relatório,/ });
    fireEvent.keyDown(bloco(), { key: "ArrowDown" });
    expect(bloco().getAttribute("aria-label")).toMatch(/10:15 às 11:00/); // otimista
    expect(atualizarBloco).not.toHaveBeenCalled();
    await waitFor(() => expect(atualizarBloco).toHaveBeenCalledTimes(1), { timeout: 2000 });
    expect(atualizarBloco).toHaveBeenCalledWith("t1", "b1", { inicio_em: "2026-09-22T13:15:00.000Z" });
    expect("duracao_min" in atualizarBloco.mock.calls[0][2]).toBe(false);
    expect(atualizarTarefa).not.toHaveBeenCalled(); // a data da tarefa não é tocada
  });

  it("várias teclas seguidas viram um único PATCH com o resultado final", async () => {
    atualizarBloco.mockResolvedValue({ id: "b1" });
    await abrirAgenda();
    await screen.findByRole("button", { name: /^Relatório,/ });
    for (let i = 0; i < 4; i++) fireEvent.keyDown(bloco(), { key: "ArrowDown" });
    fireEvent.keyDown(bloco(), { key: "ArrowRight" });
    await waitFor(() => expect(atualizarBloco).toHaveBeenCalledTimes(1), { timeout: 2000 });
    expect(atualizarBloco).toHaveBeenCalledWith("t1", "b1", { inicio_em: "2026-09-23T14:00:00.000Z" }); // 11:00 do dia 23
  });

  it("mudar de dia por teclado não altera a duração", async () => {
    atualizarBloco.mockResolvedValue({ id: "b1" });
    await abrirAgenda();
    await screen.findByRole("button", { name: /^Relatório,/ });
    fireEvent.keyDown(bloco(), { key: "ArrowRight" });
    await waitFor(() => expect(atualizarBloco).toHaveBeenCalled(), { timeout: 2000 });
    expect(atualizarBloco.mock.calls[0][2]).toEqual({ inicio_em: "2026-09-23T13:00:00.000Z" });
    expect(bloco().getAttribute("aria-label")).toMatch(/10:00 às 10:45/);
  });

  it("redimensionar por teclado envia só a duração", async () => {
    atualizarBloco.mockResolvedValue({ id: "b1" });
    await abrirAgenda();
    await screen.findByRole("button", { name: /^Relatório,/ });
    fireEvent.keyDown(bloco(), { key: "ArrowDown", shiftKey: true });
    await waitFor(() => expect(atualizarBloco).toHaveBeenCalled(), { timeout: 2000 });
    expect(atualizarBloco).toHaveBeenCalledWith("t1", "b1", { duracao_min: 60 });
  });

  it("se o servidor recusar, o bloco volta ao lugar e a pessoa é avisada", async () => {
    atualizarBloco.mockRejectedValue(new ApiError("VALIDATION_ERROR", "Duração inválida.", 422));
    await abrirAgenda();
    await screen.findByRole("button", { name: /^Relatório,/ });
    fireEvent.keyDown(bloco(), { key: "ArrowRight" });
    expect(bloco().closest("[data-coluna-dia]")!.getAttribute("data-coluna-dia")).toBe("2026-09-23"); // otimista
    const alerta = await screen.findByRole("alert", undefined, { timeout: 2500 });
    expect(alerta.textContent).toMatch(/Duração inválida.*desfeita/);
    await waitFor(() => expect(bloco().closest("[data-coluna-dia]")!.getAttribute("data-coluna-dia")).toBe("2026-09-22")); // rollback
    expect(bloco().getAttribute("aria-label")).toMatch(/10:00 às 10:45/);
  });

  it("falha de rede também desfaz, com mensagem genérica", async () => {
    atualizarBloco.mockRejectedValue(new TypeError("Failed to fetch"));
    await abrirAgenda();
    await screen.findByRole("button", { name: /^Relatório,/ });
    fireEvent.keyDown(bloco(), { key: "ArrowDown" });
    expect((await screen.findByRole("alert", undefined, { timeout: 2500 })).textContent).toMatch(/desfeita/);
    await waitFor(() => expect(bloco().getAttribute("aria-label")).toMatch(/10:00 às 10:45/));
  });

  it("depois de salvar, recarrega os blocos do servidor (a verdade é a dele)", async () => {
    atualizarBloco.mockResolvedValue({ id: "b1" });
    await abrirAgenda();
    await screen.findByRole("button", { name: /^Relatório,/ });
    const antes = buscarBlocos.mock.calls.length;
    fireEvent.keyDown(bloco(), { key: "ArrowDown" });
    await waitFor(() => expect(buscarBlocos.mock.calls.length).toBeGreaterThan(antes), { timeout: 2500 });
  });

  it("Delete remove o bloco na hora e o servidor apaga só o bloco (a tarefa fica)", async () => {
    excluirBloco.mockResolvedValue({ ok: true });
    await abrirAgenda();
    await screen.findByRole("button", { name: /^Relatório,/ });
    fireEvent.keyDown(bloco(), { key: "Delete" });
    expect(item("bloco:b1")).toBeNull();
    await waitFor(() => expect(excluirBloco).toHaveBeenCalledWith("t1", "b1"));
    expect(item("tarefa:t1")).toBeTruthy();
  });

  it("se apagar falhar, o bloco volta e aparece o aviso", async () => {
    excluirBloco.mockRejectedValue(new TypeError("Failed to fetch"));
    await abrirAgenda();
    await screen.findByRole("button", { name: /^Relatório,/ });
    fireEvent.keyDown(bloco(), { key: "Delete" });
    expect((await screen.findByRole("alert")).textContent).toMatch(/voltou/);
    await waitFor(() => expect(item("bloco:b1")).toBeTruthy());
  });

  it("tarefa com data própria não se move: as setas não chamam nada", async () => {
    await abrirAgenda();
    fireEvent.keyDown(item("tarefa:t1"), { key: "ArrowDown" });
    fireEvent.keyDown(item("tarefa:t1"), { key: "ArrowRight" });
    await new Promise((r) => setTimeout(r, 450));
    expect(atualizarBloco).not.toHaveBeenCalled();
    expect(atualizarTarefa).not.toHaveBeenCalled();
    expect(item("tarefa:t1").closest("[data-coluna-dia]")!.getAttribute("data-coluna-dia")).toBe("2026-09-22");
  });

  it("à noite (22:30 em Brasília, já dia seguinte em UTC) o bloco aparece no dia LOCAL", async () => {
    await abrirAgenda({ blocos: [{ ...BLOCO, inicio_em: "2026-09-23T01:30:00+00:00" }] });
    await screen.findByRole("button", { name: /^Relatório,/ });
    expect(bloco().closest("[data-coluna-dia]")!.getAttribute("data-coluna-dia")).toBe("2026-09-22");
    expect(bloco().getAttribute("aria-label")).toMatch(/22:30/);
  });

  it("o encaixe escolhido é lembrado entre visitas", async () => {
    await abrirAgenda();
    fireEvent.change(screen.getByLabelText("Encaixe ao arrastar"), { target: { value: "30" } });
    expect(localStorage.getItem("ecos:agenda:encaixe")).toBe("30");
  });

  it("evento local também pode ser movido (só nesta sessão, sem chamar o servidor)", async () => {
    await abrirAgenda({ blocos: [] });
    fireEvent.click(screen.getByRole("button", { name: /Evento/ }));
    fireEvent.change(screen.getByPlaceholderText(/Reunião de planejamento/), { target: { value: "Almoço" } });
    fireEvent.click(screen.getByRole("button", { name: /Criar evento/ }));
    const evento = await screen.findByRole("button", { name: /^Almoço,/ });
    fireEvent.keyDown(evento, { key: "ArrowDown" });
    expect(screen.getByRole("button", { name: /^Almoço,/ }).getAttribute("aria-label")).toMatch(/09:15 às 10:15/);
    expect(atualizarBloco).not.toHaveBeenCalled();
    expect(atualizarTarefa).not.toHaveBeenCalled();
  });
});

describe("arrastar uma tarefa da lista para o calendário (aloca tempo, não muda a data)", () => {
  beforeEach(() => simularLayout());

  it("soltar numa coluna cria um bloco com a duração da tarefa — e a tarefa NÃO é atualizada", async () => {
    let resolver!: (v: { id: string }) => void;
    criarBloco.mockImplementation(() => new Promise((ok) => { resolver = ok; }));
    await abrirAgenda();
    await screen.findByRole("button", { name: /^Relatório,/ });
    emitir("soltar", xDoDia("2026-09-23"), yDe(300)); // 05:00 de quarta
    expect(item("bloco:tmp-" + "")).toBeNull(); // (a chave real tem sufixo aleatório: procuramos pelo prefixo)
    const provisorio = document.querySelector<HTMLElement>("[data-item^='bloco:tmp-']")!;
    expect(provisorio).toBeTruthy(); // otimista: já aparece
    expect(provisorio.getAttribute("aria-label")).toMatch(/05:00 às 05:45/);
    expect(criarBloco).toHaveBeenCalledWith("t9", { tipo: "planejado", inicio_em: "2026-09-23T08:00:00.000Z", duracao_min: 45 });
    expect(atualizarTarefa).not.toHaveBeenCalled();
    blocosDoServidor = [...blocosDoServidor, { ...BLOCO, id: "novo", tarefa_id: "t9", titulo: "Escrever relatório", inicio_em: "2026-09-23T08:00:00+00:00" }];
    await act(async () => { resolver({ id: "novo" }); });
    await waitFor(() => expect(item("bloco:novo")).toBeTruthy());
    expect(document.querySelector("[data-item^='bloco:tmp-']")).toBeNull(); // o provisório deu lugar ao definitivo
  });

  it("enquanto grava, o bloco provisório fica parado (sem id definitivo não se mexe)", async () => {
    criarBloco.mockImplementation(() => new Promise(() => {}));
    await abrirAgenda({ blocos: [] });
    emitir("soltar", xDoDia("2026-09-22"), yDe(300));
    const provisorio = document.querySelector<HTMLElement>("[data-item^='bloco:tmp-']")!;
    fireEvent.keyDown(provisorio, { key: "ArrowDown" });
    fireEvent.keyDown(provisorio, { key: "Delete" });
    await new Promise((r) => setTimeout(r, 450));
    expect(atualizarBloco).not.toHaveBeenCalled();
    expect(excluirBloco).not.toHaveBeenCalled();
    expect(document.querySelector("[data-item^='bloco:tmp-']")).toBeTruthy();
  });

  it("se o servidor recusar, o bloco some e a pessoa é avisada", async () => {
    criarBloco.mockRejectedValue(new ApiError("NOT_FOUND", "Tarefa não encontrada.", 404));
    await abrirAgenda({ blocos: [] });
    emitir("soltar", xDoDia("2026-09-22"), yDe(300));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Tarefa não encontrada.*não foi alocado/);
    expect(document.querySelector("[data-item^='bloco:tmp-']")).toBeNull();
  });

  it("falha de rede: mensagem genérica e nada fica na tela", async () => {
    criarBloco.mockRejectedValue(new TypeError("Failed to fetch"));
    await abrirAgenda({ blocos: [] });
    emitir("soltar", xDoDia("2026-09-22"), yDe(300));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Nada foi alterado/);
    expect(document.querySelector("[data-item^='bloco:tmp-']")).toBeNull();
  });

  it("enquanto arrasta sobre a grade mostra a prévia; soltar fora dela não cria nada", async () => {
    await abrirAgenda({ blocos: [] });
    emitir("mover", xDoDia("2026-09-24"), yDe(300));
    expect(document.querySelector("[data-previa='alocar']")).toBeTruthy();
    emitir("soltar", 5, 5); // fora da grade
    expect(criarBloco).not.toHaveBeenCalled();
    expect(document.querySelector("[data-previa='alocar']")).toBeNull();
  });
});

describe("alocar tempo por diálogo (sem arrastar)", () => {
  it("escolhe a tarefa, o dia e a hora e cria o bloco com a duração dela", async () => {
    criarBloco.mockResolvedValue({ id: "novo" });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-22T13:07:00Z")); // o diálogo começa em hoje
    await abrirAgenda({ blocos: [] });
    fireEvent.click(screen.getByRole("button", { name: /Alocar tempo/ }));
    const dialogo = await screen.findByRole("dialog", { name: /Alocar tempo/ });
    await within(dialogo).findByRole("option", { name: "Reunião de time" });
    expect((within(dialogo).getByLabelText("Tempo (min)") as HTMLInputElement).value).toBe("45"); // a estimativa da tarefa
    fireEvent.click(within(dialogo).getByRole("button", { name: "Início" }));
    fireEvent.click(within(dialogo).getByRole("button", { name: "Hora 14" }));
    fireEvent.click(within(dialogo).getByRole("button", { name: "Minuto 30" }));
    fireEvent.click(within(dialogo).getByRole("button", { name: "Alocar" }));
    await waitFor(() => expect(criarBloco).toHaveBeenCalledWith("t1", { tipo: "planejado", inicio_em: "2026-09-22T17:30:00.000Z", duracao_min: 45 }));
    expect(atualizarTarefa).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: /Alocar tempo/ })).toBeNull();
    vi.useRealTimers();
  });
});

describe("o popup do dia só abre pelo NÚMERO", () => {
  it("grade: clicar no cabeçalho, na coluna ou num bloco não abre; o número abre", async () => {
    await abrirAgenda();
    await screen.findByRole("button", { name: /^Relatório,/ });
    fireEvent.click(document.querySelector("[data-cabecalho-dia='2026-09-22']")!);
    fireEvent.click(document.querySelector("[data-coluna-dia='2026-09-22']")!);
    fireEvent.click(document.querySelector("[data-faixa-dia='2026-09-22']")!);
    expect(screen.queryByRole("dialog", { name: /Tarefas de/ })).toBeNull();
    fireEvent.click(document.querySelector("[data-cabecalho-dia='2026-09-22'] button")!);
    expect(await screen.findByRole("dialog", { name: /Tarefas de/ })).toBeTruthy();
  });

  it("mês: clicar na célula não abre; o número dentro dela abre", async () => {
    await abrirAgenda({ modo: "mes", blocos: [] });
    const celula = await waitFor(() => { const c = document.querySelector<HTMLElement>("[data-dia-mes='2026-09-15']"); expect(c).toBeTruthy(); return c!; });
    fireEvent.click(celula);
    expect(screen.queryByRole("dialog", { name: /Tarefas de/ })).toBeNull();
    fireEvent.click(within(celula).getByRole("button", { name: /Ver tarefas de .*15 de setembro/ }));
    expect(await screen.findByRole("dialog", { name: /Tarefas de/ })).toBeTruthy();
  });

  it("mês: o número fica no topo e no meio da célula", async () => {
    await abrirAgenda({ modo: "mes", blocos: [] });
    const celula = await waitFor(() => { const c = document.querySelector<HTMLElement>("[data-dia-mes='2026-09-15']"); expect(c).toBeTruthy(); return c!; });
    const numero = within(celula).getByRole("button", { name: /Ver tarefas de/ });
    expect(celula.firstElementChild).toBe(numero); // primeiro filho = em cima
    expect(numero.className).toMatch(/\bmx-auto\b/); // centralizado na horizontal
  });

  it("mês: soltar uma tarefa numa célula aloca o tempo dela às 09:00 daquele dia", async () => {
    criarBloco.mockResolvedValue({ id: "novo" });
    await abrirAgenda({ modo: "mes", blocos: [] });
    const celula = await waitFor(() => { const c = document.querySelector<HTMLElement>("[data-dia-mes='2026-09-15']"); expect(c).toBeTruthy(); return c!; });
    const original = document.elementsFromPoint;
    document.elementsFromPoint = () => [celula];
    try {
      emitir("mover", 10, 10);
      expect(celula.className).toContain("ring-cyan"); // destaque enquanto a tarefa passa por cima
      emitir("soltar", 10, 10);
    } finally {
      document.elementsFromPoint = original;
    }
    expect(criarBloco).toHaveBeenCalledWith("t9", { tipo: "planejado", inicio_em: "2026-09-15T12:00:00.000Z", duracao_min: 45 });
    expect(atualizarTarefa).not.toHaveBeenCalled();
    await waitFor(() => expect(celula.className).not.toContain("ring-cyan"));
  });
});

describe("preferências: início do dia e prazos (refletem sem recarregar)", () => {
  const TAREFA_PRAZO: TarefaResumo = { ...TAREFA_AGENDADA, id: "t2", titulo: "Entregar o relatório", scheduled_at: null, due_date: "2026-09-22" };
  const TAREFA_AGENDADA_COM_PRAZO: TarefaResumo = { ...TAREFA_AGENDADA, id: "t3", titulo: "Reunião com prazo", scheduled_at: "2026-09-22T13:00:00Z", due_date: "2026-09-22" };
  const MODOS = ["dia", "tres_dias", "semana", "quinzenal"] as const;

  describe("início do dia", () => {
    it.each(MODOS)("aplica na visão '%s': a grade vem rolada até 06:00 (padrão) e mantém as 24 horas", async (modo) => {
      await abrirAgenda({ modo, blocos: [] });
      expect(rolagem()).toBeCloseTo(6 * 64);
      const horas = [...document.querySelectorAll("div")].filter((d) => d.classList.contains("text-[11px]")).map((d) => d.textContent);
      expect(horas).toHaveLength(24);
      expect(horas[0]).toBe("00:00");
      expect(horas[23]).toBe("23:00");
    });

    it.each(MODOS)("aplica o horário configurado (08:30) na visão '%s'", async (modo) => {
      salvarPreferenciasCalendario({ inicio: "08:30" });
      await abrirAgenda({ modo, blocos: [] });
      expect(rolagem()).toBeCloseTo(8.5 * 64);
    });

    it("mudar o início em Configurações reflete na hora, sem recarregar", async () => {
      await abrirAgenda({ blocos: [] });
      expect(rolagem()).toBeCloseTo(6 * 64);
      act(() => salvarPreferenciasCalendario({ inicio: "11:15" }));
      expect(rolagem()).toBeCloseTo(11.25 * 64);
      act(() => salvarPreferenciasCalendario({ inicio: "00:00" }));
      expect(rolagem()).toBe(0);
    });

    it("mudança vinda de outra janela (evento storage) também reflete", async () => {
      await abrirAgenda({ blocos: [] });
      act(() => {
        localStorage.setItem(CHAVE_PREFERENCIAS_CALENDARIO, JSON.stringify({ inicio: "09:00" }));
        window.dispatchEvent(new StorageEvent("storage", { key: CHAVE_PREFERENCIAS_CALENDARIO }));
      });
      expect(rolagem()).toBeCloseTo(9 * 64);
    });

    it("mudar a preferência de PRAZOS não desfaz a rolagem que a pessoa fez", async () => {
      await abrirAgenda({ blocos: [] });
      (screen.getByTestId("grade-rolagem") as HTMLElement & { __st?: number }).__st = 800;
      act(() => salvarPreferenciasCalendario({ deadlines: false }));
      expect(rolagem()).toBe(800);
    });

    it("um início inválido salvo cai no padrão 06:00 em vez de quebrar a rolagem", async () => {
      localStorage.setItem(CHAVE_PREFERENCIAS_CALENDARIO, JSON.stringify({ inicio: "abc" }));
      await abrirAgenda({ blocos: [] });
      expect(rolagem()).toBeCloseTo(6 * 64);
    });
  });

  describe("prazos", () => {
    const marcasDePrazo = () => document.querySelectorAll("[data-item^='prazo:']");

    it.each(MODOS)("ligado (padrão): a tarefa com due_date ganha uma marca de prazo na visão '%s'", async (modo) => {
      await abrirAgenda({ modo, dia: "2026-09-22", tarefasDoServidor: [TAREFA_PRAZO], blocos: [] });
      const marca = await waitFor(() => { const m = item("prazo:t2"); expect(m).toBeTruthy(); return m; });
      expect(marca.closest("[data-faixa-dia]")!.getAttribute("data-faixa-dia")).toBe("2026-09-22");
      expect(marca.textContent).toContain("Prazo:");
      expect(marca.className).toContain("text-warning"); // distinta do agendamento (que é ciano)
    });

    it("a marca de prazo é distinta do horário agendado: outra chave, outra faixa, outra cor", async () => {
      await abrirAgenda({ tarefasDoServidor: [{ ...TAREFA_AGENDADA, due_date: "2026-09-25" }], blocos: [] });
      await waitFor(() => expect(item("prazo:t1")).toBeTruthy());
      expect(item("tarefa:t1").closest("[data-coluna-dia]")!.getAttribute("data-coluna-dia")).toBe("2026-09-22");
      expect(item("prazo:t1").closest("[data-faixa-dia]")!.getAttribute("data-faixa-dia")).toBe("2026-09-25");
      expect(item("tarefa:t1").className).toContain("text-cyan");
      expect(item("prazo:t1").className).toContain("text-warning");
    });

    it("prazo e agendamento no MESMO dia: um cartão só, com o selo 'Prazo hoje' — sem cartão duplicado", async () => {
      await abrirAgenda({ tarefasDoServidor: [TAREFA_AGENDADA_COM_PRAZO], blocos: [] });
      await waitFor(() => expect(item("tarefa:t3")).toBeTruthy());
      expect(document.querySelectorAll("[data-item$=':t3']")).toHaveLength(1);
      expect(item("tarefa:t3").querySelector("[data-marca-prazo]")).toBeTruthy();
      expect(marcasDePrazo()).toHaveLength(0);
    });

    it("desligar em Configurações tira as marcas na hora, sem recarregar", async () => {
      await abrirAgenda({ tarefasDoServidor: [TAREFA_PRAZO, TAREFA_AGENDADA_COM_PRAZO], blocos: [] });
      await waitFor(() => expect(item("prazo:t2")).toBeTruthy());
      expect(item("tarefa:t3").querySelector("[data-marca-prazo]")).toBeTruthy();
      act(() => salvarPreferenciasCalendario({ deadlines: false }));
      expect(marcasDePrazo()).toHaveLength(0);
      expect(item("tarefa:t3").querySelector("[data-marca-prazo]")).toBeNull();
      expect(item("tarefa:t3")).toBeTruthy(); // o agendamento continua lá
    });

    it("religar traz as marcas de volta, também sem recarregar", async () => {
      salvarPreferenciasCalendario({ deadlines: false });
      await abrirAgenda({ tarefasDoServidor: [TAREFA_PRAZO], blocos: [] });
      expect(marcasDePrazo()).toHaveLength(0);
      act(() => salvarPreferenciasCalendario({ deadlines: true }));
      expect(item("prazo:t2")).toBeTruthy();
    });

    it("desligado, a tarefa com prazo continua disponível no popup do dia (só a marca some do calendário)", async () => {
      salvarPreferenciasCalendario({ deadlines: false });
      await abrirAgenda({ dia: "2026-09-22", tarefasDoServidor: [TAREFA_PRAZO], blocos: [] });
      expect(marcasDePrazo()).toHaveLength(0);
      fireEvent.click(document.querySelector("[data-cabecalho-dia='2026-09-22'] button")!);
      const popup = await screen.findByRole("dialog", { name: /Tarefas de/ });
      expect(await within(popup).findByText("Entregar o relatório")).toBeTruthy();
    });

    it("desligado, a tarefa continua sendo buscada normalmente (as listas não dependem da preferência)", async () => {
      salvarPreferenciasCalendario({ deadlines: false });
      await abrirAgenda({ tarefasDoServidor: [TAREFA_PRAZO], blocos: [] });
      await waitFor(() => expect(listar).toHaveBeenCalled());
      expect(listar.mock.calls.every((c) => c[0] && "data_de" in c[0])).toBe(true);
    });

    it("mês: com prazos ligados a célula do dia do prazo mostra a marca com bandeira; desligado, some", async () => {
      await abrirAgenda({ modo: "mes", tarefasDoServidor: [TAREFA_PRAZO], blocos: [] });
      const celula = await waitFor(() => { const c = document.querySelector<HTMLElement>("[data-dia-mes='2026-09-22']"); expect(c).toBeTruthy(); return c!; });
      await waitFor(() => expect(celula.querySelector("[data-marca='prazo']")).toBeTruthy());
      expect(celula.textContent).toContain("Entregar o relatório");
      act(() => salvarPreferenciasCalendario({ deadlines: false }));
      expect(celula.querySelector("[data-marca='prazo']")).toBeNull();
      expect(celula.textContent).not.toContain("Entregar o relatório");
    });

    it("prazo de tarefa concluída aparece esmaecido (riscado), não some", async () => {
      await abrirAgenda({ tarefasDoServidor: [{ ...TAREFA_PRAZO, status: "concluida" }], blocos: [] });
      const marca = await waitFor(() => { const m = item("prazo:t2"); expect(m).toBeTruthy(); return m; });
      expect(marca.innerHTML).toContain("line-through");
    });
  });
});
