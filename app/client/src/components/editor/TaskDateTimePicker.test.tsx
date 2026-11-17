import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TaskDateTimePicker, interpretarHorario } from "./TaskDateTimePicker";

afterEach(() => { cleanup(); vi.useRealTimers(); });

function Teste({ inicial = { data: "", horario: "" }, aoMudar }: { inicial?: { data: string; horario: string }; aoMudar?: (d: string, h: string) => void }) {
  const [v, setV] = useState(inicial);
  return <TaskDateTimePicker data={v.data} horario={v.horario} onChange={(data, horario) => { setV({ data, horario }); aoMudar?.(data, horario); }} />;
}

describe("interpretarHorario", () => {
  it.each([["14", "14:00"], ["14h", "14:00"], ["1430", "14:30"], ["14:30", "14:30"], ["14h30", "14:30"], ["9.15", "09:15"], [" 7 ", "07:00"]])("lê %s como %s", (texto, esperado) => {
    expect(interpretarHorario(texto)).toBe(esperado);
  });
  it.each(["25", "24:00", "12:60", "abc", ""])("recusa %s", (texto) => { expect(interpretarHorario(texto)).toBeNull(); });
});

describe("TaskDateTimePicker", () => {
  it("abre sem recorte: o popover é fixo e traz atalhos, a grade do mês e o horário", () => {
    render(<Teste />);
    fireEvent.click(screen.getByRole("button", { name: /Definir/ }));
    const dialogo = screen.getByRole("dialog", { name: "Escolher data e horário" });
    expect(dialogo.style.position).toBe("fixed");
    expect(screen.getByRole("button", { name: "Hoje" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Amanhã" })).toBeTruthy();
    expect(screen.getByLabelText(/Horário/)).toBeTruthy();
    // Nada para limpar quando o campo está vazio.
    expect(screen.queryByRole("button", { name: "Limpar" })).toBeNull();
    expect(screen.queryByText(/vale para hoje/)).toBeNull();
  });

  it("marca o dia de hoje na grade", () => {
    render(<Teste />);
    fireEvent.click(screen.getByRole("button", { name: /Definir/ }));
    expect(document.querySelector('[aria-current="date"]')).toBeTruthy();
  });

  it("escolher um dia aplica e fecha", async () => {
    const aoMudar = vi.fn();
    render(<Teste aoMudar={aoMudar} />);
    fireEvent.click(screen.getByRole("button", { name: /Definir/ }));
    fireEvent.click(screen.getByRole("button", { name: "Amanhã" }));
    expect(aoMudar).toHaveBeenCalledOnce();
    expect(aoMudar.mock.calls[0][0]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(aoMudar.mock.calls[0][1]).toBe("");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("horário digitado com Enter é normalizado, aplicado e fecha", async () => {
    const aoMudar = vi.fn();
    render(<Teste inicial={{ data: "2026-11-20", horario: "" }} aoMudar={aoMudar} />);
    fireEvent.click(screen.getByRole("button", { name: /20 de nov|qui|sex|sáb/i }));
    const campo = screen.getByLabelText(/Horário/);
    fireEvent.change(campo, { target: { value: "1430" } });
    fireEvent.keyDown(campo, { key: "Enter" });
    expect(aoMudar).toHaveBeenLastCalledWith("2026-11-20", "14:30");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("horário inválido avisa e não altera nada", () => {
    const aoMudar = vi.fn();
    render(<Teste inicial={{ data: "2026-11-20", horario: "" }} aoMudar={aoMudar} />);
    fireEvent.click(screen.getByRole("button", { name: /20 de nov|qui|sex|sáb/i }));
    const campo = screen.getByLabelText(/Horário/);
    fireEvent.change(campo, { target: { value: "99" } });
    fireEvent.keyDown(campo, { key: "Enter" });
    expect(screen.getByRole("alert").textContent).toMatch(/Não entendi/);
    expect(aoMudar).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("sugestão de horário sem dia escolhido vale para hoje", () => {
    const aoMudar = vi.fn();
    render(<Teste aoMudar={aoMudar} />);
    fireEvent.click(screen.getByRole("button", { name: /Definir/ }));
    fireEvent.click(screen.getByRole("button", { name: "14:00" }));
    expect(aoMudar.mock.calls[0][0]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(aoMudar.mock.calls[0][1]).toBe("14:00");
  });

  it("Limpar zera data e horário; Sem horário mantém o dia", async () => {
    const aoMudar = vi.fn();
    render(<Teste inicial={{ data: "2026-11-20", horario: "09:00" }} aoMudar={aoMudar} />);
    fireEvent.click(screen.getByRole("button", { name: /09:00/ }));
    fireEvent.click(screen.getByRole("button", { name: "Sem horário" }));
    expect(aoMudar).toHaveBeenLastCalledWith("2026-11-20", "");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: /20 de nov/i }));
    fireEvent.click(screen.getByRole("button", { name: "Limpar" }));
    expect(aoMudar).toHaveBeenLastCalledWith("", "");
  });

  it("Esc fecha e devolve o foco ao campo", async () => {
    render(<Teste />);
    const campo = screen.getByRole("button", { name: /Definir/ });
    fireEvent.click(campo);
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(campo);
  });
});
