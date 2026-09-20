import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/use-espaco-filtro", () => ({ useEspacoFiltro: () => undefined }));
vi.mock("@/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...original,
    tarefas: { ...original.tarefas, listar: vi.fn(), capacidade: vi.fn(), atualizar: vi.fn() },
    agenda: { blocos: vi.fn() },
    rotina: { ...original.rotina, listar: vi.fn() },
  };
});

import { agenda, rotina, tarefas } from "@/lib/api";
import { RefreshProvider } from "@/lib/refresh-bus";
import { AgendaScreen } from "./AgendaScreen";

// Hoje = terça 22/09/2026 10:30 (Brasília). Só o Date é falso, para o waitFor seguir normal.
const AGORA = new Date("2026-09-22T13:30:00Z");

async function abrir(modo: string, dia: string) {
  localStorage.setItem("ecos:agenda:visualizacao", JSON.stringify({ modo, dia }));
  vi.mocked(tarefas.listar).mockResolvedValue({ items: [], next_cursor: null } as never);
  vi.mocked(agenda.blocos).mockResolvedValue([]);
  vi.mocked(tarefas.capacidade).mockResolvedValue({ data: dia, total_dia_min: 0, consumido_rotina_min: 0, consumido_eventos_externos_min: 0, consumido_tarefas_min: 0, disponivel_producao_min: 0, tempo_livre_min: 0, estourado: false });
  vi.mocked(rotina.listar).mockResolvedValue([]);
  render(<MemoryRouter><RefreshProvider><AgendaScreen /></RefreshProvider></MemoryRouter>);
  await screen.findAllByRole("button", { name: "Hoje" });
}
const clicarHoje = () => fireEvent.click(screen.getAllByRole("button", { name: "Hoje" })[0]);
const salvo = () => JSON.parse(localStorage.getItem("ecos:agenda:visualizacao")!) as { dia: string };

beforeEach(() => {
  window.matchMedia = ((q: string) => ({ matches: true, media: q, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false })) as never;
  localStorage.clear();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(AGORA);
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); localStorage.clear(); });

describe('botão "Hoje" é consistente em todas as visões', () => {
  // [modo, um dia dentro do período que contém hoje, um dia de outro período]
  const CASOS: [string, string, string][] = [
    ["dia", "2026-09-22", "2026-09-10"],
    ["tres_dias", "2026-09-21", "2026-09-01"],
    ["semana", "2026-09-20", "2026-08-30"],
    ["quinzenal", "2026-09-24", "2026-08-30"],
    ["mes", "2026-09-01", "2026-06-15"],
    ["seis_meses", "2026-07-01", "2027-03-01"],
    ["anual", "2026-01-10", "2025-05-05"],
  ];
  for (const [modo, dentro, fora] of CASOS) {
    it(`${modo}: período já contém hoje → abre o popup do dia`, async () => {
      await abrir(modo, dentro);
      clicarHoje();
      expect(await screen.findByRole("dialog", { name: /Tarefas de/ })).toBeTruthy();
    });
    it(`${modo}: período sem hoje → navega até ele, sem abrir popup`, async () => {
      await abrir(modo, fora);
      clicarHoje();
      await waitFor(() => expect(salvo().dia).toBe("2026-09-22"));
      expect(screen.queryByRole("dialog", { name: /Tarefas de/ })).toBeNull();
      clicarHoje(); // agora o período contém hoje: abre o popup
      expect(await screen.findByRole("dialog", { name: /Tarefas de/ })).toBeTruthy();
    });
  }

  it("nas visões de tempo, ao navegar a grade rola até o horário atual (10:30 − 1h)", async () => {
    const rolagens: number[] = [];
    const original = Object.getOwnPropertyDescriptor(Element.prototype, "scrollTop");
    Object.defineProperty(Element.prototype, "scrollTop", { configurable: true, get() { return 0; }, set(v: number) { rolagens.push(v); } });
    try {
      await abrir("semana", "2026-08-30");
      rolagens.length = 0;
      clicarHoje();
      await waitFor(() => expect(rolagens.at(-1)).toBeCloseTo((10 * 60 + 30 - 60) * (64 / 60), 0));
    } finally {
      if (original) Object.defineProperty(Element.prototype, "scrollTop", original); else delete (Element.prototype as { scrollTop?: number }).scrollTop;
    }
  });
});

describe("clicar num dia não move o período", () => {
  for (const modo of ["dia", "tres_dias", "semana", "quinzenal"]) {
    it(`${modo}: o número abre o popup e as colunas visíveis continuam as mesmas`, async () => {
      await abrir(modo, "2026-09-21");
      const antes = [...document.querySelectorAll("[data-cabecalho-dia]")].map((e) => (e as HTMLElement).dataset.cabecalhoDia);
      const alvo = document.querySelector<HTMLElement>(`[data-cabecalho-dia="${antes.at(-1)}"] button`)!;
      fireEvent.click(alvo);
      expect(await screen.findByRole("dialog", { name: /Tarefas de/ })).toBeTruthy();
      expect([...document.querySelectorAll("[data-cabecalho-dia]")].map((e) => (e as HTMLElement).dataset.cabecalhoDia)).toEqual(antes);
      expect(salvo().dia).toBe("2026-09-21");
    });
  }
});
