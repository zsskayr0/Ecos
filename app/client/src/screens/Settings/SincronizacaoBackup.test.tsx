import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  status: vi.fn(), gerarCodigoPareamento: vi.fn(), confirmarPareamento: vi.fn(), atualizarDispositivo: vi.fn(), removerDispositivo: vi.fn(), definirModo: vi.fn(),
  config: vi.fn(), historico: vi.fn(), exportar: vi.fn(),
}));

vi.mock("@/lib/api", async () => {
  const real = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...real,
    sync: { status: m.status, gerarCodigoPareamento: m.gerarCodigoPareamento, confirmarPareamento: m.confirmarPareamento, atualizarDispositivo: m.atualizarDispositivo, removerDispositivo: m.removerDispositivo, definirModo: m.definirModo },
    vault: { backup: { config: m.config, historico: m.historico, exportar: m.exportar } },
  };
});

import { ApiError } from "@/lib/api";
import { SincronizacaoBackup } from "./SincronizacaoBackup";

const local = { modo: "local_unico", transporte: { ativo: false, estado: "nao_aplicavel", motivo: "Modo local: os dados ficam só neste servidor." }, ultima_sincronizacao: null, dispositivos: [] };
const configBackup = { frequencia: "diária", retencao: "7 diários", proxima_execucao_automatica: "2026-10-16T03:00:00+00:00" };

describe("SincronizacaoBackup: só estado real", () => {
  beforeEach(() => {
    Object.values(m).forEach((f) => f.mockReset());
    m.config.mockResolvedValue(configBackup);
    m.historico.mockResolvedValue([]);
  });

  it("modo local não diz que está sincronizado e não inventa armazenamento", async () => {
    m.status.mockResolvedValue(local);
    render(<SincronizacaoBackup />);
    await waitFor(() => expect(screen.getByText("Sem sincronização entre aparelhos")).toBeTruthy());
    expect(screen.queryByText(/Tudo sincronizado/i)).toBeNull();
    expect(screen.queryByText(/GB/)).toBeNull();
    expect(screen.getByText(/nenhuma registrada/)).toBeTruthy();
    expect(screen.getByText("Nenhum aparelho pareado.")).toBeTruthy();
  });

  it("LAN escolhida sem transporte aparece como indisponível, nunca como sucesso", async () => {
    m.status.mockResolvedValue({ ...local, modo: "direto_lan", transporte: { ativo: false, estado: "indisponivel", motivo: "O transporte ainda não foi implementado." } });
    render(<SincronizacaoBackup />);
    await waitFor(() => expect(screen.getByText("Sincronização indisponível")).toBeTruthy());
    expect(screen.queryByText(/Tudo sincronizado/i)).toBeNull();
    expect(screen.getByText("Em uso")).toBeTruthy();
  });

  it("falha ao consultar o status mostra erro com nova tentativa", async () => {
    m.status.mockRejectedValueOnce(new ApiError("INTERNAL_ERROR", "falhou", 500)).mockResolvedValue(local);
    render(<SincronizacaoBackup />);
    await waitFor(() => expect(screen.getAllByRole("alert").length).toBeGreaterThan(0));
    expect(screen.queryByText(/Tudo sincronizado/i)).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "Tentar de novo" })[0]);
    await waitFor(() => expect(screen.getByText("Sem sincronização entre aparelhos")).toBeTruthy());
  });

  it("lista aparelhos reais e remove com confirmação", async () => {
    m.status.mockResolvedValueOnce({ ...local, dispositivos: [{ id: "D1", nome: "Celular", papel: "primario", ultima_sincronizacao: null, push_tipo: "nenhum" }] })
      .mockResolvedValue(local);
    m.removerDispositivo.mockResolvedValue({ ok: true });
    render(<SincronizacaoBackup />);
    await waitFor(() => expect(screen.getByText("Celular")).toBeTruthy());
    expect(screen.getByText(/ainda não sincronizou/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remover" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Remover" })[0]);
    await waitFor(() => expect(m.removerDispositivo).toHaveBeenCalledWith("D1"));
    await waitFor(() => expect(screen.getByText("Nenhum aparelho pareado.")).toBeTruthy());
  });

  it("backup manual chama o servidor e recarrega o histórico", async () => {
    m.status.mockResolvedValue(local);
    m.historico.mockResolvedValueOnce([]).mockResolvedValue([{ nome: "cofre-2026-10-15.enc", tamanho_bytes: 2048 }]);
    m.exportar.mockResolvedValue({ ok: true, arquivo: "cofre-2026-10-15.enc" });
    render(<SincronizacaoBackup />);
    await waitFor(() => expect(screen.getByText("Nenhuma cópia gerada ainda.")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Fazer backup agora" }));
    await waitFor(() => expect(m.exportar).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText("2,0 KB")).toBeTruthy());
    expect(m.historico).toHaveBeenCalledTimes(2);
  });

  it("Cofre indisponível para backup mostra o erro, sem fingir cópia", async () => {
    m.status.mockResolvedValue(local);
    m.config.mockRejectedValue(new ApiError("VAULT_LOCKED", "O Cofre está bloqueado.", 423));
    render(<SincronizacaoBackup />);
    await waitFor(() => expect(screen.getByText(/Cofre.*bloqueado/i)).toBeTruthy());
    expect(screen.queryByText("Nenhuma cópia gerada ainda.")).toBeNull();
  });
});
