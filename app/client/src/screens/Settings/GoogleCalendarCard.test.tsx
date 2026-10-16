import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api")>();
  return { ...original, calendario: { config: vi.fn(), conectar: vi.fn(), sincronizar: vi.fn(), desconectar: vi.fn() } };
});

import { calendario, type CalendarioConectado } from "@/lib/api";
import { RefreshProvider } from "@/lib/refresh-bus";
import { GoogleCalendarCard } from "./GoogleCalendarCard";

const conexao = (extra: Partial<CalendarioConectado> = {}): CalendarioConectado => ({ provider: "google", conectado_em: "2026-09-20T10:00:00Z", email: "eu@gmail.com", ultima_sync_em: "2026-09-20T12:00:00Z", ultimo_erro: null, precisa_reconectar: false, ...extra });
const desenhar = () => render(<RefreshProvider><GoogleCalendarCard intervaloPollMs={10} /></RefreshProvider>);

describe("GoogleCalendarCard", () => {
  beforeEach(() => { vi.mocked(calendario.config).mockReset(); vi.spyOn(window, "open").mockReturnValue(null); });
  afterEach(() => vi.restoreAllMocks());

  it("sem credenciais no servidor explica o que falta e não deixa conectar", async () => {
    vi.mocked(calendario.config).mockResolvedValue({ conectados: [], google_configurado: false });
    desenhar();
    expect(await screen.findByText(/GOOGLE_CLIENT_ID/)).toBeTruthy();
    expect((screen.getByRole("button", { name: /Conectar/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("conectar abre o Google e fica esperando até a conexão aparecer no servidor", async () => {
    vi.mocked(calendario.config)
      .mockResolvedValueOnce({ conectados: [], google_configurado: true })
      .mockResolvedValueOnce({ conectados: [], google_configurado: true })
      .mockResolvedValue({ conectados: [conexao()], google_configurado: true });
    vi.mocked(calendario.conectar).mockResolvedValue({ url: "https://accounts.example/auth?state=x" });
    desenhar();
    fireEvent.click(await screen.findByRole("button", { name: /Conectar/ }));
    await waitFor(() => expect(window.open).toHaveBeenCalledWith("https://accounts.example/auth?state=x", "_blank", "noopener,noreferrer"));
    expect(await screen.findByText(/Aguardando você autorizar/)).toBeTruthy();
    expect(await screen.findByText(/Conectado como eu@gmail.com/)).toBeTruthy();
    expect(screen.getByText(/A primeira sincronização já começou/)).toBeTruthy();
    expect(screen.queryByText(/Aguardando você autorizar/)).toBeNull();
  });

  it("erro ao iniciar (ex.: aberto por IP da LAN) mostra a mensagem do servidor", async () => {
    vi.mocked(calendario.config).mockResolvedValue({ conectados: [], google_configurado: true });
    const { ApiError } = await import("@/lib/api");
    vi.mocked(calendario.conectar).mockRejectedValue(new ApiError("VALIDATION_ERROR", "x", 422, [{ campo: "host", motivo: "abra o Ecos por http://localhost:PORTA" }]));
    desenhar();
    fireEvent.click(await screen.findByRole("button", { name: /Conectar/ }));
    expect((await screen.findByRole("alert")).textContent).toContain("localhost");
  });

  it("conectado: mostra a conta e a última sincronização, e 'sincronizar agora' resume o resultado", async () => {
    vi.mocked(calendario.config).mockResolvedValue({ conectados: [conexao()], google_configurado: true });
    vi.mocked(calendario.sincronizar).mockResolvedValue({ criados: 2, atualizados: 1, removidos: 0, inalterados: 5, conflitos_mantidos_locais: 0, excecoes_ignoradas: 1, completa: false });
    desenhar();
    expect(await screen.findByText(/Conectado como eu@gmail.com/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Sincronizar agora/ }));
    const lista = (await screen.findByRole("list", { name: "Resultado da sincronização" })).textContent ?? "";
    expect(lista).toContain("2 eventos criados a partir do Google");
    expect(lista).toContain("1 evento atualizado a partir do Google");
    expect(lista).toContain("1 ocorrência editada de série não importada");
    expect(calendario.sincronizar).toHaveBeenCalledTimes(1);
  });

  it("o resumo também conta o que foi enviado ao Google, o adiado e o recusado", async () => {
    vi.mocked(calendario.config).mockResolvedValue({ conectados: [conexao()], google_configurado: true });
    vi.mocked(calendario.sincronizar).mockResolvedValue({ criados: 0, atualizados: 0, removidos: 0, inalterados: 3, conflitos_mantidos_locais: 0, excecoes_ignoradas: 0, completa: false, enviados_criados: 2, enviados_atualizados: 1, removidos_no_google: 1, envios_adiados: 1, envios_com_erro: 2 });
    desenhar();
    fireEvent.click(await screen.findByRole("button", { name: /Sincronizar agora/ }));
    const texto = (await screen.findByRole("list", { name: "Resultado da sincronização" })).textContent ?? "";
    expect(texto).toContain("3 alterações enviadas ao Google");
    expect(texto).toContain("1 evento apagado no Google");
    expect(texto).toContain("1 envio adiado");
    expect(texto).toContain("2 problemas: o Google recusou");
  });

  it("sem nada a mudar, o resultado diz isso em vez de só 'Sincronizado'", async () => {
    vi.mocked(calendario.config).mockResolvedValue({ conectados: [conexao()], google_configurado: true, intervalo_secs: 300 });
    vi.mocked(calendario.sincronizar).mockResolvedValue({ criados: 0, atualizados: 0, removidos: 0, inalterados: 4, conflitos_mantidos_locais: 0, excecoes_ignoradas: 0, completa: false });
    desenhar();
    expect(await screen.findByText(/Automática a cada 5 min/)).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: /Sincronizar agora/ }));
    expect((await screen.findByRole("list", { name: "Resultado da sincronização" })).textContent).toContain("Nada mudou (4 eventos já em dia)");
  });

  it("acesso revogado pede reconexão e esconde 'sincronizar agora'", async () => {
    vi.mocked(calendario.config).mockResolvedValue({ conectados: [conexao({ precisa_reconectar: true })], google_configurado: true });
    desenhar();
    expect((await screen.findByRole("alert")).textContent).toContain("revogou");
    expect(screen.getByRole("button", { name: /Reconectar/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Sincronizar agora/ })).toBeNull();
  });

  it("desconectar pede confirmação, explica que os eventos ficam e só então chama o servidor", async () => {
    vi.mocked(calendario.config).mockResolvedValueOnce({ conectados: [conexao()], google_configurado: true }).mockResolvedValue({ conectados: [], google_configurado: true });
    vi.mocked(calendario.desconectar).mockResolvedValue({ ok: true });
    desenhar();
    fireEvent.click(await screen.findByRole("button", { name: "Desconectar" }));
    expect(calendario.desconectar).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog").textContent).toContain("continuam no Ecos");
    fireEvent.click(screen.getAllByRole("button", { name: "Desconectar" }).at(-1)!);
    await waitFor(() => expect(calendario.desconectar).toHaveBeenCalledWith("google"));
    expect(await screen.findByText(/continuam no Ecos, como privados/)).toBeTruthy();
    expect(await screen.findByRole("button", { name: /Conectar/ })).toBeTruthy();
  });
});
