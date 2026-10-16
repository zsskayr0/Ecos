import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", async () => {
  const real = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...real,
    problemasSync: { listar: vi.fn(), tentarTodos: vi.fn(), agir: vi.fn() },
    calendario: { ...real.calendario, config: vi.fn(), conectar: vi.fn() },
  };
});
vi.mock("@/lib/refresh-bus", () => ({ useRefreshBus: () => ({ versao: 0, notificar: vi.fn() }) }));

import { ApiError, calendario, problemasSync, type ProblemaSync } from "@/lib/api";
import { ProblemasSincronizacaoScreen } from "./ProblemasSincronizacaoScreen";

const problema = (extra: Partial<ProblemaSync> = {}): ProblemaSync => ({
  id: "P1", item_tipo: "evento", item_id: "EV1", item_titulo: "Dentista", direcao: "envio", operacao: "atualizar", provider: "google",
  codigo: "conflito_edicao", titulo: "Editado nos dois lugares", explicacao: "Nada foi sobrescrito. Escolha qual versão vale.",
  acoes: ["abrir", "manter_ambos", "manter_local", "manter_google", "ignorar"], http_status: 412, motivo_google: null, tentativas: 3,
  primeira_vez: "2026-10-01T10:00:00+00:00", ultima_vez: "2026-10-01T10:20:00+00:00", ...extra,
});
const conexao = { provider: "google", conectado_em: "x", email: null, ultima_sync_em: null, ultimo_erro: null, precisa_reconectar: false };

const abrir = () => render(<MemoryRouter><ProblemasSincronizacaoScreen /></MemoryRouter>);

describe("ProblemasSincronizacaoScreen", () => {
  beforeEach(() => {
    vi.mocked(problemasSync.listar).mockReset();
    vi.mocked(problemasSync.agir).mockReset();
    vi.mocked(calendario.config).mockResolvedValue({ conectados: [conexao], google_configurado: true });
  });

  it("estado vazio claro quando não há problemas", async () => {
    vi.mocked(problemasSync.listar).mockResolvedValue({ items: [], ignorados: 0 });
    abrir();
    expect(await screen.findByText("Nenhum problema de sincronização.")).toBeTruthy();
  });

  it("mostra item, motivo traduzido e ações; ação que sobrescreve pede confirmação antes de chamar o servidor", async () => {
    vi.mocked(problemasSync.listar).mockResolvedValueOnce({ items: [problema()], ignorados: 0 }).mockResolvedValue({ items: [], ignorados: 0 });
    vi.mocked(problemasSync.agir).mockResolvedValue({ ok: true, estado: "resolvido", problemas_abertos: 0, resumo: null });
    abrir();
    expect(await screen.findByText("Dentista")).toBeTruthy();
    expect(screen.getByText("Editado nos dois lugares")).toBeTruthy();
    expect(screen.getByText(/Nada foi sobrescrito/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Guardar as duas versões" }));
    expect(problemasSync.agir).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog").textContent).toContain("(versão local)");
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(problemasSync.agir).toHaveBeenCalledWith("P1", "manter_ambos", true));
    expect(await screen.findByText("Nenhum problema de sincronização.")).toBeTruthy();
  });

  it("cancelar a confirmação não altera nada; ignorar não pede confirmação", async () => {
    vi.mocked(problemasSync.listar).mockResolvedValue({ items: [problema()], ignorados: 0 });
    vi.mocked(problemasSync.agir).mockResolvedValue({ ok: true, estado: "ignorado", problemas_abertos: 0, resumo: null });
    abrir();
    fireEvent.click(await screen.findByRole("button", { name: "Manter o do Google" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(problemasSync.agir).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Ignorar" }));
    await waitFor(() => expect(problemasSync.agir).toHaveBeenCalledWith("P1", "ignorar"));
  });

  it("erro do servidor aparece sem trocar a lista; acesso revogado oferece reautorizar sem prometer mais que isso", async () => {
    vi.mocked(calendario.config).mockResolvedValue({ conectados: [{ ...conexao, precisa_reconectar: true }], google_configurado: true });
    vi.mocked(problemasSync.listar).mockResolvedValue({ items: [problema()], ignorados: 0 });
    vi.mocked(problemasSync.agir).mockRejectedValue(new ApiError("INTERNAL_ERROR", "falhou", 500));
    abrir();
    expect(await screen.findByText(/O Google revogou o acesso do Ecos/)).toBeTruthy();
    expect(screen.getByText(/modo de teste/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reautorizar o Google" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Ignorar" }));
    await waitFor(() => expect(screen.getAllByRole("alert").length).toBeGreaterThan(1));
    expect(screen.getByText("Dentista")).toBeTruthy();
  });
});
