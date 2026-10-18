import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RefreshProvider } from "@/lib/refresh-bus";
import { PRAZO_CARGA_MS } from "@/components/common/FalhaCarga";
import { TaskDetailScreen } from "./TaskDetailScreen";

const TAREFA = { id: "t1", titulo: "Pagar boleto", corpo: "", status: "pendente", scheduled_at: null, duration_min: 5, due_date: null, pasta: null, espaco: "pessoal", criado_em: "2026-10-01T00:00:00Z", atualizado_em: "2026-10-01T00:00:00Z", concluida_em: null, tags: [], prioridade: "baixa", subtarefas: [], serie: null };
const json = (corpo: unknown) => new Response(JSON.stringify(corpo), { status: 200, headers: { "content-type": "application/json" } });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  window.matchMedia = ((q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as typeof window.matchMedia;
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

function montar() {
  return render(
    <RefreshProvider>
      <MemoryRouter initialEntries={["/tarefa/t1"]}>
        <Routes><Route path="/tarefa/:id" element={<TaskDetailScreen />} /></Routes>
      </MemoryRouter>
    </RefreshProvider>,
  );
}

it("depois de 8 s sem resposta o skeleton vira erro com 'Tentar de novo', que refaz a carga", async () => {
  let chamadas = 0;
  vi.stubGlobal("fetch", vi.fn((url: RequestInfo | URL) => {
    if (!String(url).endsWith("/tarefas/t1")) return Promise.resolve(json([]));
    chamadas++;
    return chamadas === 1 ? new Promise<Response>(() => {}) : Promise.resolve(json(TAREFA)); // 1ª nunca responde
  }));
  montar();
  expect(screen.queryByText("Tentar de novo")).toBeNull();
  await act(async () => { await vi.advanceTimersByTimeAsync(PRAZO_CARGA_MS + 50); });
  const botao = screen.getByText("Tentar de novo");
  fireEvent.click(botao);
  await act(async () => { await vi.advanceTimersByTimeAsync(50); });
  expect(screen.getByDisplayValue("Pagar boleto")).toBeTruthy();
  expect(screen.queryByText("Tentar de novo")).toBeNull();
});
