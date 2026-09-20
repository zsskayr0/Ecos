import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TarefaResumo } from "@/lib/api";

vi.mock("@/lib/use-espaco-filtro", () => ({ useEspacoFiltro: () => undefined }));
vi.mock("@/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...original,
    tarefas: { ...original.tarefas, listar: vi.fn(), capacidade: vi.fn() },
    agenda: { blocos: vi.fn() },
    rotina: { ...original.rotina, listar: vi.fn() },
  };
});

import { agenda, rotina, tarefas } from "@/lib/api";
import { RefreshProvider } from "@/lib/refresh-bus";
import { AppUIProvider } from "@/lib/ui-context";
import { AgendaScreen } from "./AgendaScreen";

const concluida = (id: string, titulo: string, concluida_em: string): TarefaResumo => ({
  id, caminho_arquivo: `Tarefas/${id}.md`, titulo, status: "concluida", scheduled_at: null, duration_min: null, due_date: null, espaco: "pessoal",
  criado_em: "2026-09-01T10:00:00Z", prioridade: "baixa", criado_por: null, criado_por_nome: null, concluida_em,
});

async function abrir(modo: string) {
  localStorage.setItem("ecos:agenda:visualizacao", JSON.stringify({ modo, dia: "2026-09-20" }));
  // Só a busca por conclusão devolve as tarefas; a de agendadas vem vazia.
  vi.mocked(tarefas.listar).mockImplementation(async (p) => ({ items: p?.concluida_de ? [
    concluida("a", "Pagar boleto", "2026-09-19T12:05:00Z"),
    concluida("b", "Enviar relatório", "2026-09-20T02:30:00Z"), // 23:30 do dia 19 em Brasília
    concluida("c", "Revisar PR", "2026-09-21T15:00:00Z"),
  ] : [], next_cursor: null }) as never);
  vi.mocked(agenda.blocos).mockResolvedValue([]);
  vi.mocked(rotina.listar).mockResolvedValue([]);
  vi.mocked(tarefas.capacidade).mockResolvedValue({ data: "2026-09-20", total_dia_min: 0, consumido_rotina_min: 0, consumido_eventos_externos_min: 0, consumido_tarefas_min: 0, disponivel_producao_min: 0, tempo_livre_min: 0, estourado: false });
  render(<MemoryRouter><AppUIProvider><RefreshProvider><AgendaScreen /></RefreshProvider></AppUIProvider></MemoryRouter>);
  await waitFor(() => expect(document.querySelector("[data-concluidas]")).toBeTruthy());
}
const marca = (iso: string) => document.querySelector<HTMLElement>(`[data-dia-mes="${iso}"] [data-concluidas]`);

beforeEach(() => {
  window.matchMedia = ((q: string) => ({ matches: true, media: q, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false })) as never;
  localStorage.clear();
});
afterEach(() => { localStorage.clear(); vi.clearAllMocks(); });

describe("dia de conclusão marcado no calendário", () => {
  it("visão mensal: marca cada dia local de conclusão, com a contagem e os horários no título", async () => {
    await abrir("mes");
    expect(marca("2026-09-19")?.getAttribute("data-concluidas")).toBe("2");
    expect(marca("2026-09-19")?.getAttribute("title")).toBe("Concluídas: 09:05 Pagar boleto · 23:30 Enviar relatório");
    expect(marca("2026-09-21")?.getAttribute("data-concluidas")).toBe("1");
    expect(marca("2026-09-20")).toBeNull();
  });

  it("pede ao servidor só as concluídas do mês, com 1 dia de margem, no fuso do cliente", async () => {
    await abrir("mes");
    expect(tarefas.listar).toHaveBeenCalledWith(expect.objectContaining({ concluida_de: "2026-08-31", concluida_ate: "2026-10-01", status: "concluida", tz: -180 }));
  });

  it("6 meses: o dia ganha o check e o texto de ajuda informa a conclusão", async () => {
    await abrir("seis_meses");
    expect(screen.getByTitle(/19 de setembro.*2 concluídas/)).toBeTruthy();
  });
});

describe("dia de conclusão nas visões de horário", () => {
  const selo = (iso: string) => document.querySelector<HTMLElement>(`[data-cabecalho-dia="${iso}"] [data-concluidas]`);

  it.each(["semana", "tres_dias", "dia"])("%s: selo no cabeçalho do dia e ✓ na hora exata (fuso local)", async (modo) => {
    localStorage.setItem("ecos:agenda:visualizacao", JSON.stringify({ modo, dia: "2026-09-19" }));
    vi.mocked(tarefas.listar).mockImplementation(async (p) => ({ items: p?.concluida_de ? [
      concluida("a", "Pagar boleto", "2026-09-19T12:05:00Z"),
      concluida("b", "Enviar relatório", "2026-09-20T02:30:00Z"),
    ] : [], next_cursor: null }) as never);
    vi.mocked(agenda.blocos).mockResolvedValue([]);
    vi.mocked(rotina.listar).mockResolvedValue([]);
    vi.mocked(tarefas.capacidade).mockResolvedValue({ data: "2026-09-19", total_dia_min: 0, consumido_rotina_min: 0, consumido_eventos_externos_min: 0, consumido_tarefas_min: 0, disponivel_producao_min: 0, tempo_livre_min: 0, estourado: false });
    render(<MemoryRouter><AppUIProvider><RefreshProvider><AgendaScreen /></RefreshProvider></AppUIProvider></MemoryRouter>);
    await waitFor(() => expect(selo("2026-09-19")).toBeTruthy());
    expect(selo("2026-09-19")?.getAttribute("data-concluidas")).toBe("2"); // 09:05 e 23:30 locais
    expect(selo("2026-09-19")?.getAttribute("title")).toBe("Concluídas: 09:05 Pagar boleto · 23:30 Enviar relatório");
    const y = (id: string) => document.querySelector<HTMLElement>(`[data-coluna-dia="2026-09-19"] [data-concluida-em="${id}"]`)!.style.top;
    expect(y("a")).toBe(`${(9 * 60 + 5) * (64 / 60)}px`);
    expect(y("b")).toBe(`${(23 * 60 + 30) * (64 / 60)}px`);
  });
});

describe("texto do dia vazio no popup", () => {
  async function abrirPopup(dia: string, itens: TarefaResumo[]) {
    localStorage.setItem("ecos:agenda:visualizacao", JSON.stringify({ modo: "mes", dia }));
    vi.mocked(tarefas.listar).mockImplementation(async (p) => ({ items: p?.concluida_de ? itens : [], next_cursor: null }) as never);
    vi.mocked(agenda.blocos).mockResolvedValue([]);
    vi.mocked(rotina.listar).mockResolvedValue([]);
    vi.mocked(tarefas.capacidade).mockResolvedValue({ data: dia, total_dia_min: 0, consumido_rotina_min: 0, consumido_eventos_externos_min: 0, consumido_tarefas_min: 0, disponivel_producao_min: 0, tempo_livre_min: 0, estourado: false });
    render(<MemoryRouter><AppUIProvider><RefreshProvider><AgendaScreen /></RefreshProvider></AppUIProvider></MemoryRouter>);
    await waitFor(() => expect(document.querySelector("[data-dia-mes]")).toBeTruthy());
    fireEvent.click(document.querySelector(`[data-dia-mes="${dia}"] button`)!);
    await screen.findByRole("dialog");
  }

  it("dia passado com conclusões: sem 'Dia livre'; mostra a lista com a contagem", async () => {
    await abrirPopup("2026-09-19", [concluida("a", "Pagar boleto", "2026-09-19T12:05:00Z"), concluida("b", "Revisar PR", "2026-09-19T15:00:00Z")]);
    await screen.findByText(/Concluídas neste dia · 2/);
    expect(screen.queryByText("Dia livre.")).toBeNull();
    expect(screen.queryByText(/aproveite ou capture/)).toBeNull();
  });

  it("dia passado sem nada: diz que nada foi agendado nem concluído", async () => {
    await abrirPopup("2026-09-10", []);
    await screen.findByText("Nada agendado neste dia.");
  });

  it("dia futuro sem nada mantém 'Dia livre.'", async () => {
    await abrirPopup("2099-01-10", []);
    await screen.findByText("Dia livre.");
  });
});

describe("Agenda no celular (< 1024 px): mesmas visões do desktop, adaptadas", () => {
  async function abrirMobile(modo: string, dia = "2026-09-19") {
    window.matchMedia = ((q: string) => ({ matches: false, media: q, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false })) as never;
    localStorage.setItem("ecos:agenda:visualizacao", JSON.stringify({ modo, dia }));
    vi.mocked(tarefas.listar).mockImplementation(async (p) => ({ items: p?.concluida_de ? [concluida("a", "Pagar boleto", "2026-09-19T12:05:00Z")] : [], next_cursor: null }) as never);
    vi.mocked(agenda.blocos).mockResolvedValue([]);
    vi.mocked(rotina.listar).mockResolvedValue([]);
    vi.mocked(tarefas.capacidade).mockResolvedValue({ data: dia, total_dia_min: 0, consumido_rotina_min: 0, consumido_eventos_externos_min: 0, consumido_tarefas_min: 0, disponivel_producao_min: 0, tempo_livre_min: 0, estourado: false });
    render(<MemoryRouter><AppUIProvider><RefreshProvider><AgendaScreen /></RefreshProvider></AppUIProvider></MemoryRouter>);
  }

  it("tem a barra de período (menu de visões, anterior/próximo, Hoje, Evento) e não a pílula antiga", async () => {
    await abrirMobile("mes");
    await screen.findByLabelText("Escolher período da agenda");
    expect(screen.getByLabelText("Período anterior")).toBeTruthy();
    expect(screen.getByLabelText("Próximo período")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Hoje/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Novo evento/ })).toBeTruthy();
  });

  it("mês: grade de dias com a marca de conclusão; tocar no dia abre a folha (dialog) com as concluídas, sem 'Dia livre'", async () => {
    await abrirMobile("mes");
    await waitFor(() => expect(marca("2026-09-19")).toBeTruthy());
    fireEvent.click(document.querySelector('[data-dia-mes="2026-09-19"] button')!);
    const folha = await screen.findByRole("dialog");
    expect(folha.getAttribute("aria-modal")).toBe("true");
    expect(folha.textContent).toMatch(/Concluídas neste dia · 1/);
    expect(folha.textContent).not.toMatch(/Dia livre/);
    fireEvent.click(screen.getByLabelText("Fechar tarefas"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it.each(["dia", "tres_dias", "semana"])("%s: usa a grade de horários com o ✓ na hora certa", async (modo) => {
    await abrirMobile(modo);
    await waitFor(() => expect(document.querySelector('[data-coluna-dia="2026-09-19"] [data-concluida-em="a"]')).toBeTruthy());
  });
});
