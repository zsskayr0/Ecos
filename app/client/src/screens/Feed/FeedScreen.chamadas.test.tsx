import { act, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  listarMinhas: vi.fn(),
  feed: vi.fn(),
  notas: vi.fn(),
  tarefas: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...original,
    equipes: { ...original.equipes, listarMinhas: api.listarMinhas },
    feed: { obter: api.feed },
    notas: { ...original.notas, listar: api.notas },
    tarefas: { ...original.tarefas, listar: api.tarefas },
  };
});
const auth = vi.hoisted(() => ({ valor: { perfil: { id: "u1", nome_usuario: "ana", nome: "Ana", equipes: [] } } }));
vi.mock("@/lib/auth-context", () => ({ useAuth: () => auth.valor, nomeExibicao: () => "Ana" }));
const ui = vi.hoisted(() => ({ valor: { filtroEquipeId: null, espacoAtivo: "pessoal", intercalarEquipes: false, abrirCaptura: () => undefined } }));
vi.mock("@/lib/ui-context", () => ({ useAppUI: () => ui.valor }));
vi.mock("@/components/feed/CapturaRapida", () => ({ CapturaRapida: () => null }));
vi.mock("@/components/common/PullToRefresh", () => ({ PullToRefresh: ({ children }: { children: React.ReactNode }) => <>{children}</> }));

import { RefreshProvider, useRefreshBus } from "@/lib/refresh-bus";
import { useMinhasEquipes } from "@/lib/use-minhas-equipes";
import { FeedScreen, INTERVALO_POLL_MS } from "./FeedScreen";

let notificarFora: () => void = () => undefined;
function Outro() {
  useMinhasEquipes(); // simula Topbar e demais consumidores do hook
  notificarFora = useRefreshBus().notificar;
  return null;
}

beforeEach(() => {
  vi.clearAllMocks();
  api.listarMinhas.mockImplementation(() => new Promise((r) => setTimeout(() => r([{ id: "e1", nome: "Eq", cargo: "dono", tipo: "pessoal", membros: 1 }]), 20)));
  api.feed.mockResolvedValue({ items: [], next_cursor: null });
  api.notas.mockResolvedValue({ items: [], next_cursor: null });
  api.tarefas.mockResolvedValue({ items: [], next_cursor: null });
});

const total = () => api.listarMinhas.mock.calls.length + api.feed.mock.calls.length + api.notas.mock.calls.length + api.tarefas.mock.calls.length;

describe("Feed — contagem de chamadas", () => {
  it("monta com uma carga e cada notificar() refaz o mínimo", async () => {
    render(<MemoryRouter><RefreshProvider><Outro /><Outro /><Outro /><FeedScreen /></RefreshProvider></MemoryRouter>);
    await waitFor(() => expect(api.feed).toHaveBeenCalled());
    await act(async () => { await new Promise((r) => setTimeout(r, 120)); });
    console.log("[perf] chamadas na montagem:", { equipes: api.listarMinhas.mock.calls.length, feed: api.feed.mock.calls.length, notas: api.notas.mock.calls.length, tarefas: api.tarefas.mock.calls.length, total: total() });
    expect(api.listarMinhas).toHaveBeenCalledTimes(1);
    expect(api.feed).toHaveBeenCalledTimes(1);
    expect(api.notas).toHaveBeenCalledTimes(1);
    expect(api.tarefas).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();
    await act(async () => { notificarFora(); await new Promise((r) => setTimeout(r, 120)); });
    console.log("[perf] chamadas por notificar():", { equipes: api.listarMinhas.mock.calls.length, feed: api.feed.mock.calls.length, total: total() });
    expect(api.listarMinhas.mock.calls.length).toBeLessThanOrEqual(1);
    expect(api.feed.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it("poll de 30 s pausa com a janela oculta e atualiza ao voltar", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let visibilidade: DocumentVisibilityState = "visible";
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibilidade });
      render(<MemoryRouter><RefreshProvider><FeedScreen /></RefreshProvider></MemoryRouter>);
      for (let i = 0; i < 40 && api.feed.mock.calls.length === 0; i++) await vi.advanceTimersByTimeAsync(50);
      const inicio = api.feed.mock.calls.length;
      expect(inicio).toBe(1);

      await vi.advanceTimersByTimeAsync(INTERVALO_POLL_MS - 3000);
      expect(api.feed).toHaveBeenCalledTimes(1); // 10 s depois do início não há poll: o intervalo é 30 s
      await vi.advanceTimersByTimeAsync(4000);
      expect(api.feed).toHaveBeenCalledTimes(2);

      visibilidade = "hidden";
      await vi.advanceTimersByTimeAsync(INTERVALO_POLL_MS * 2);
      expect(api.feed).toHaveBeenCalledTimes(2); // oculta: nada

      visibilidade = "visible";
      await act(async () => { document.dispatchEvent(new Event("visibilitychange")); await vi.advanceTimersByTimeAsync(50); });
      expect(api.feed).toHaveBeenCalledTimes(3); // voltou: uma atualização imediata
    } finally {
      vi.useRealTimers();
      delete (document as unknown as Record<string, unknown>).visibilityState;
    }
  });
});
