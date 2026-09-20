import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BlocoPlanejado, Evento, TarefaResumo } from "@/lib/api";

vi.mock("@/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...original,
    tarefas: {
      ...original.tarefas, listar: vi.fn(), capacidade: vi.fn(), atualizar: vi.fn(), atualizarStatus: vi.fn(),
      timeEntries: { ...original.tarefas.timeEntries, criar: vi.fn() },
    },
    agenda: { blocos: vi.fn() },
    rotina: { ...original.rotina, listar: vi.fn() },
    eventos: { ...original.eventos, listar: vi.fn() },
  };
});

import { agenda, eventos as eventosApi, rotina, tarefas } from "@/lib/api";
import { RefreshProvider, useRefreshBus } from "@/lib/refresh-bus";
import { AppUIProvider } from "@/lib/ui-context";
import { TodayScreen } from "./TodayScreen";

vi.mock("@/lib/documento-popup", () => ({ useAbrirDocumento: () => vi.fn() }));
vi.mock("@/screens/Eventos/EventoDialog", () => ({ EventoDialog: ({ aberto, eventoId }: { aberto: boolean; eventoId: string | null }) => aberto ? <div data-evento-aberto={eventoId}>Editor de evento</div> : null }));

// Hoje = terça 22/09/2026 10:30 (Brasília).
const AGORA = new Date("2026-09-22T13:30:00Z");
const HOJE = "2026-09-22";
const t = (id: string, o: Partial<TarefaResumo> = {}): TarefaResumo => ({ id, caminho_arquivo: `T/${id}.md`, titulo: `Tarefa ${id}`, status: "pendente", scheduled_at: null, duration_min: null, due_date: null, espaco: "pessoal", criado_em: "2026-09-01T10:00:00Z", prioridade: "baixa", criado_por: null, criado_por_nome: null, ...o });
const CAPACIDADE = { data: HOJE, total_dia_min: 960, consumido_rotina_min: 0, consumido_eventos_externos_min: 0, consumido_tarefas_min: 90, disponivel_producao_min: 300, tempo_livre_min: 0, estourado: false };

let doDia: TarefaResumo[] = [];
let atrasadas: TarefaResumo[] = [];
let blocos: BlocoPlanejado[] = [];
let eventosDoServidor: Evento[] = [];
let concluidas: TarefaResumo[] = [];

/** Evento do servidor de HOJE (horário local), como a tela recebe da API. `minutos: null` = dia inteiro. */
function eventoHoje(id: number, titulo: string, minutos: number | null, duracaoMin = 60): Evento {
  const [a, m, d] = HOJE.split("-").map(Number);
  const inicio = new Date(a, m - 1, d, 0, minutos ?? 0);
  const fim = minutos === null ? new Date(a, m - 1, d + 1) : new Date(inicio.getTime() + duracaoMin * 60_000);
  return { id: String(id), titulo, inicio: inicio.toISOString(), fim: fim.toISOString(), dia_inteiro: minutos === null, fuso: null, local: null, categoria_id: null, categoria: null, visibilidade: "privado", rrule: null, espaco: "pessoal", origem_google: false, sync_pendente: false, criado_em: "2026-09-01T00:00:00Z", atualizado_em: "2026-09-01T00:00:00Z", tarefas: [], notas: [] };
}

function Sonda() { const { versao, notificar } = useRefreshBus(); return <><span data-testid="versao">{versao}</span><button type="button" onClick={notificar}>avisar-refresh</button></>; }
function montar() {
  render(<MemoryRouter><AppUIProvider><RefreshProvider><Sonda /><TodayScreen /></RefreshProvider></AppUIProvider></MemoryRouter>);
}
const grupo = (id: string) => document.querySelector<HTMLElement>(`[data-grupo="${id}"]`);
const itensDe = (id: string) => [...(grupo(id)?.querySelectorAll("[data-item-dia]") ?? [])].map((e) => (e as HTMLElement).dataset.itemDia);

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  doDia = []; atrasadas = []; blocos = []; eventosDoServidor = []; concluidas = [];
  vi.mocked(eventosApi.listar).mockImplementation(async () => eventosDoServidor);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(AGORA);
  vi.mocked(tarefas.listar).mockImplementation((async (p: { data_ate?: string; status?: string }) => ({ items: p.status === "concluida" ? concluidas : p.data_ate === HOJE ? doDia : atrasadas, next_cursor: null })) as never);
  vi.mocked(agenda.blocos).mockImplementation(async () => blocos);
  vi.mocked(tarefas.capacidade).mockResolvedValue(CAPACIDADE);
  vi.mocked(rotina.listar).mockResolvedValue([{ id: "r", tipo: "sono", hora_inicio: "23:00", hora_fim: "07:00", dias_semana: "diario", classificacao: "sono" }] as never);
  vi.mocked(tarefas.atualizar).mockResolvedValue({ id: "x" });
  vi.mocked(tarefas.atualizarStatus).mockResolvedValue({ id: "x", status: "concluida" });
  vi.mocked(tarefas.timeEntries.criar).mockResolvedValue({ id: "e" });
});
afterEach(() => { vi.useRealTimers(); });

describe("Hoje como planejamento diário", () => {
  it("combina agendadas, prazos, eventos, atrasadas e blocos em grupos distintos e ordenados", async () => {
    doDia = [t("tarde", { scheduled_at: "2026-09-22T19:00:00Z" }), t("cedo", { scheduled_at: "2026-09-22T12:00:00Z" }), t("prazo", { due_date: HOJE })];
    atrasadas = [t("velha", { due_date: "2026-09-15" })];
    blocos = [{ id: "b1", tarefa_id: "x", tipo: "planejado", inicio_em: "2026-09-22T15:00:00+00:00", duracao_min: 60, foco: "", titulo: "Foco", status: "pendente", prioridade: "baixa" } as unknown as BlocoPlanejado];
    eventosDoServidor = [eventoHoje(7, "Reunião", 13 * 60), eventoHoje(8, "Feriado", null)];
    montar();
    await screen.findByText("Tarefa velha");
    expect(itensDe("atrasadas")).toEqual(["tarefa:velha"]);
    expect(itensDe("dia-todo")).toEqual([`evento:8@${HOJE}`]);
    expect(itensDe("cronograma")).toEqual(["tarefa:cedo", "bloco:b1", `evento:7@${HOJE}`, "tarefa:tarde"]); // 09:00, 12:00, 13:00, 16:00
    expect(itensDe("sem-horario")).toEqual(["tarefa:prazo"]);
    expect(document.querySelector("[data-capacidade]")?.textContent).toMatch(/5h/);
  });

  it("tarefa com prazo e horário hoje aparece uma única vez, com a marca de prazo", async () => {
    doDia = [t("a", { scheduled_at: "2026-09-22T17:00:00Z", due_date: HOJE })];
    montar();
    await screen.findByText("Tarefa a");
    expect(document.querySelectorAll('[data-item-dia$=":a"]').length).toBe(1);
    expect(itensDe("cronograma")).toEqual(["tarefa:a"]);
    expect(itensDe("sem-horario")).toEqual([]);
    expect(screen.getByText("Prazo hoje")).toBeTruthy();
  });

  it("atrasadas e sem horário são grupos distintos", async () => {
    doDia = [t("s", { due_date: HOJE })];
    atrasadas = [t("v", { due_date: "2026-09-20" })];
    montar();
    await screen.findByText("Tarefa v");
    expect(grupo("atrasadas")?.textContent).toMatch(/Atrasadas/);
    expect(grupo("sem-horario")?.textContent).toMatch(/Sem horário/);
    expect(grupo("atrasadas")).not.toBe(grupo("sem-horario"));
  });

  it("estado vazio considera eventos: com um evento hoje o dia NÃO está livre", async () => {
    eventosDoServidor = [eventoHoje(1, "Dentista", 600)];
    montar();
    await screen.findByText("Dentista");
    expect(screen.queryByText("Seu dia está livre.")).toBeNull();
  });

  it("mostra as tarefas concluídas hoje em um grupo próprio e permite abri-las", async () => {
    concluidas = [t("feita", { titulo: "Tarefa feita", status: "concluida", concluida_em: "2026-09-22T13:00:00Z" })];
    montar();
    expect(await screen.findByText("Concluídas neste dia")).toBeTruthy();
    expect(document.querySelector('[data-grupo="concluidas"] [data-item-concluida="feita"]')).toBeTruthy();
    expect(screen.getByRole("button", { name: "Abrir tarefa concluída Tarefa feita" })).toBeTruthy();
    expect(screen.queryByText("Seu dia está livre.")).toBeNull();
  });

  it("as tarefas e os eventos podem ser abertos pela própria linha", async () => {
    doDia = [t("a", { due_date: HOJE })];
    eventosDoServidor = [eventoHoje(9, "Consulta", 600)];
    montar();
    await screen.findByText("Consulta");
    expect(screen.getByRole("button", { name: "Abrir tarefa Tarefa a" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Abrir evento Consulta" }));
    expect(await screen.findByText("Editor de evento")).toBeTruthy();
    expect(document.querySelector("[data-evento-aberto]")?.getAttribute("data-evento-aberto")).toBe("9");
  });

  it("estado vazio considera a rotina: mostra o tempo livre dela, ou pede para configurar", async () => {
    montar();
    expect(await screen.findByText("Seu dia está livre.")).toBeTruthy();
    expect(await screen.findByText(/5h livres na sua rotina/)).toBeTruthy();
  });
  it("sem rotina configurada, o estado vazio sugere configurá-la", async () => {
    vi.mocked(rotina.listar).mockResolvedValue([]);
    montar();
    expect(await screen.findByText(/Configure sua rotina/)).toBeTruthy();
  });

  describe("ações rápidas (refletem na Agenda via RefreshBus)", () => {
    it("concluir: chama o servidor, some na hora e avisa a Agenda", async () => {
      doDia = [t("a", { due_date: HOJE })];
      montar();
      await screen.findByText("Tarefa a");
      const antes = Number(screen.getByTestId("versao").textContent);
      fireEvent.click(screen.getByRole("button", { name: "Concluir Tarefa a" }));
      expect(screen.queryByText("Tarefa a")).toBeNull();
      await waitFor(() => expect(Number(screen.getByTestId("versao").textContent)).toBeGreaterThan(antes));
      expect(tarefas.atualizarStatus).toHaveBeenCalledWith("a", "concluida");
    });

    it("tempo alocado de uma tarefa com prazo hoje: um item só, com ações; concluir tira tarefa e bloco", async () => {
      doDia = [t("a", { due_date: HOJE })];
      blocos = [{ id: "b1", tarefa_id: "a", tipo: "planejado", inicio_em: "2026-09-22T15:00:00+00:00", duracao_min: 60, foco: "", titulo: "Tarefa a", status: "pendente", prioridade: "baixa" } as unknown as BlocoPlanejado];
      montar();
      await screen.findByText("Prazo hoje");
      expect(itensDe("cronograma")).toEqual(["bloco:b1"]);
      expect(itensDe("sem-horario")).toEqual([]); // o prazo não se repete
      expect(screen.queryByRole("button", { name: "Encaixar tempo para Tarefa a" })).toBeNull(); // já tem tempo
      fireEvent.click(screen.getByRole("button", { name: "Concluir Tarefa a" }));
      expect(screen.queryByText("Tarefa a")).toBeNull();
      expect(tarefas.atualizarStatus).toHaveBeenCalledWith("a", "concluida");
    });

    it("reagendar para amanhã: prazo vai para amanhã; agendada mantém o horário no novo dia", async () => {
      doDia = [t("p", { due_date: HOJE }), t("g", { scheduled_at: "2026-09-22T17:00:00Z" })];
      montar();
      await screen.findByText("Tarefa p");
      fireEvent.click(screen.getByRole("button", { name: "Reagendar Tarefa p" }));
      fireEvent.click(within(screen.getByRole("group", { name: "Reagendar Tarefa p" })).getByRole("button", { name: "Amanhã" }));
      await waitFor(() => expect(tarefas.atualizar).toHaveBeenCalledWith("p", { due_date: "2026-09-23" }));
      fireEvent.click(screen.getByRole("button", { name: "Reagendar Tarefa g" }));
      fireEvent.click(within(screen.getByRole("group", { name: "Reagendar Tarefa g" })).getByRole("button", { name: "Amanhã" }));
      await waitFor(() => expect(tarefas.atualizar).toHaveBeenCalledWith("g", { scheduled_at: "2026-09-23T17:00:00.000Z" }));
    });

    it("encaixar tempo: cria um bloco planejado no próximo horário livre, sem mexer na data da tarefa", async () => {
      doDia = [t("a", { due_date: HOJE, duration_min: 45 })];
      montar();
      await screen.findByText("Tarefa a");
      fireEvent.click(screen.getByRole("button", { name: "Encaixar tempo para Tarefa a" }));
      await waitFor(() => expect(tarefas.timeEntries.criar).toHaveBeenCalledTimes(1));
      // agora = 10:30, livre → 10:30 local = 13:30Z
      expect(tarefas.timeEntries.criar).toHaveBeenCalledWith("a", { tipo: "planejado", inicio_em: "2026-09-22T13:30:00.000Z", duracao_min: 45 });
      expect(tarefas.atualizar).not.toHaveBeenCalled();
    });

    it("falha do servidor avisa e a lista é recarregada (desfaz o otimismo)", async () => {
      doDia = [t("a", { due_date: HOJE })];
      vi.mocked(tarefas.atualizarStatus).mockRejectedValue(new Error("rede"));
      montar();
      await screen.findByText("Tarefa a");
      fireEvent.click(screen.getByRole("button", { name: "Concluir Tarefa a" }));
      expect(await screen.findByText("Tarefa a")).toBeTruthy();
      expect((await screen.findAllByRole("alert"))[0].textContent).toMatch(/Não foi possível concluir/);
    });
  });

  it("um evento criado depois aparece quando o RefreshBus avisa (mesmo caminho da Agenda)", async () => {
    montar();
    await screen.findByText("Seu dia está livre.");
    eventosDoServidor = [eventoHoje(3, "Almoço", 720)];
    fireEvent.click(screen.getByRole("button", { name: "avisar-refresh" }));
    expect(await screen.findByText("Almoço")).toBeTruthy();
    expect(screen.queryByText("Seu dia está livre.")).toBeNull();
  });
});
