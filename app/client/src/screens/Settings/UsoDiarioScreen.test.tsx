import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import { lerPreferenciasAplicativo } from "@/lib/preferencias-aplicativo";
import { NotificacoesPreferenciasScreen } from "./NotificacoesPreferenciasScreen";
import { UsoDiarioScreen } from "./UsoDiarioScreen";

beforeEach(() => {
  localStorage.clear();
  // O jsdom não traz matchMedia; `useIsDesktop` precisa dele. Aqui a tela é vista como desktop.
  window.matchMedia = ((consulta: string) => ({ matches: true, media: consulta, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, onchange: null, dispatchEvent: () => false })) as typeof window.matchMedia;
});

describe("telas de configuração novas", () => {
  it("Uso diário: trocar o que o Enter cria grava a preferência", () => {
    render(<MemoryRouter><UsoDiarioScreen /></MemoryRouter>);
    expect(screen.getByRole("heading", { name: "Uso diário" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Tarefa" }));
    expect(lerPreferenciasAplicativo().capturaEnter).toBe("tarefa");
  });

  it("Notificações: ligar o resumo e o silêncio habilita e grava os horários", () => {
    render(<MemoryRouter><NotificacoesPreferenciasScreen /></MemoryRouter>);
    const hora = screen.getByLabelText("Horário do resumo") as HTMLInputElement;
    expect(hora.disabled).toBe(true);
    fireEvent.click(screen.getByRole("switch", { name: "Resumo do dia" }));
    expect(hora.disabled).toBe(false);
    fireEvent.change(hora, { target: { value: "07:30" } });
    fireEvent.click(screen.getByRole("switch", { name: "Horário silencioso" }));
    const p = lerPreferenciasAplicativo();
    expect(p).toMatchObject({ resumoDiario: true, resumoHora: "07:30", silencioAtivo: true });
  });
});
