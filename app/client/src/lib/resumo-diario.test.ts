import { describe, expect, it } from "vitest";
import { PADRAO_PREFERENCIAS_APLICATIVO as P } from "./preferencias-aplicativo";
import { deveEnviarResumo, emSilencio, minutosDoHorario, textoDoResumo } from "./resumo-diario";

const em = (hhmm: string, dia = "2026-10-08") => new Date(`${dia}T${hhmm}:00`);

describe("horário silencioso", () => {
  const noturno = { silencioAtivo: true, silencioInicio: "22:00", silencioFim: "07:00" };
  it("vira a meia-noite", () => {
    expect(emSilencio(em("23:30"), noturno)).toBe(true);
    expect(emSilencio(em("03:00"), noturno)).toBe(true);
    expect(emSilencio(em("07:00"), noturno)).toBe(false);
    expect(emSilencio(em("12:00"), noturno)).toBe(false);
  });
  it("no mesmo dia e desligado", () => {
    expect(emSilencio(em("13:30"), { silencioAtivo: true, silencioInicio: "13:00", silencioFim: "14:00" })).toBe(true);
    expect(emSilencio(em("23:30"), { ...noturno, silencioAtivo: false })).toBe(false);
    expect(emSilencio(em("10:00"), { silencioAtivo: true, silencioInicio: "09:00", silencioFim: "09:00" })).toBe(false);
  });
  it("lê HH:MM e rejeita lixo", () => {
    expect(minutosDoHorario("08:30")).toBe(510);
    expect(minutosDoHorario("25:00")).toBeNull();
    expect(minutosDoHorario("oito")).toBeNull();
  });
});

describe("quando o resumo diário sai", () => {
  const ligado = { ...P, resumoDiario: true, resumoHora: "08:00" };
  it("só depois da hora, uma vez por dia", () => {
    expect(deveEnviarResumo(em("07:59"), ligado, null)).toBe(false);
    expect(deveEnviarResumo(em("08:00"), ligado, null)).toBe(true);
    expect(deveEnviarResumo(em("15:00"), ligado, null)).toBe(true); // abriu o app tarde: sai na hora
    expect(deveEnviarResumo(em("15:00"), ligado, "2026-10-08")).toBe(false);
    expect(deveEnviarResumo(em("08:00", "2026-10-09"), ligado, "2026-10-08")).toBe(true);
  });
  it("respeita o desligado e o silêncio", () => {
    expect(deveEnviarResumo(em("09:00"), { ...ligado, resumoDiario: false }, null)).toBe(false);
    expect(deveEnviarResumo(em("23:00"), { ...ligado, silencioAtivo: true }, null)).toBe(false);
  });
});

describe("texto do resumo", () => {
  const agora = em("08:00");
  it("conta as de hoje e as atrasadas, ignora concluídas e sem data", () => {
    const tarefas = [
      { status: "pendente" as const, scheduled_at: null, due_date: "2026-10-08" },
      { status: "pendente" as const, scheduled_at: "2026-10-08T15:00:00", due_date: null },
      { status: "pendente" as const, scheduled_at: null, due_date: "2026-10-05" },
      { status: "concluida" as const, scheduled_at: null, due_date: "2026-10-08" },
      { status: "pendente" as const, scheduled_at: null, due_date: null },
      { status: "pendente" as const, scheduled_at: null, due_date: "2026-10-20" },
    ];
    expect(textoDoResumo(tarefas, agora)).toBe("2 tarefas para hoje · 1 atrasada");
  });
  it("dia livre", () => expect(textoDoResumo([], agora)).toBe("Nada marcado para hoje."));
});
