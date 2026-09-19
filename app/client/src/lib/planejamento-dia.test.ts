import { describe, expect, it } from "vitest";
import type { BlocoPlanejado, TarefaResumo } from "@/lib/api";
import type { EventoLocal } from "@/lib/eventos-locais";
import { montarPlanejamento, proximoHorarioLivre } from "./planejamento-dia";

const HOJE = "2026-09-22";
const t = (id: string, o: Partial<TarefaResumo> = {}): TarefaResumo => ({ id, caminho_arquivo: `T/${id}.md`, titulo: id, status: "pendente", scheduled_at: null, duration_min: null, due_date: null, espaco: "pessoal", criado_em: "2026-09-01T10:00:00Z", prioridade: "baixa", criado_por: null, criado_por_nome: null, ...o });
const plano = (tarefas: TarefaResumo[], blocos: BlocoPlanejado[] = [], eventos: EventoLocal[] = []) => montarPlanejamento({ hoje: HOJE, tarefas, blocos, eventos });
const chaves = (l: { chave: string }[]) => l.map((i) => i.chave);

describe("montarPlanejamento", () => {
  it("tarefa com prazo E horário hoje aparece uma vez, no cronograma, com marca de prazo", () => {
    const p = plano([t("a", { scheduled_at: "2026-09-22T17:00:00Z", due_date: HOJE })]);
    expect(chaves(p.cronograma)).toEqual(["tarefa:a"]);
    expect(p.cronograma[0].comPrazo).toBe(true);
    expect(p.semHorario).toEqual([]);
    expect(p.total).toBe(1);
  });
  it("atrasadas (prazo ou agendamento passado) ficam num grupo à parte de 'sem horário' e nunca se repetem", () => {
    const p = plano([t("v", { due_date: "2026-09-20" }), t("g", { scheduled_at: "2026-09-21T13:00:00Z", due_date: HOJE }), t("s", { due_date: HOJE })]);
    expect(p.atrasadas.map((i) => i.tarefa!.id).sort()).toEqual(["g", "v"]);
    expect(p.semHorario.map((i) => i.tarefa!.id)).toEqual(["s"]);
    expect(p.cronograma).toEqual([]);
    expect(p.total).toBe(3);
  });
  it("atrasadas: mais antigas primeiro; no mesmo dia, prioridade alta antes", () => {
    const p = plano([t("b", { due_date: "2026-09-20" }), t("c", { due_date: "2026-09-10" }), t("a", { due_date: "2026-09-20", prioridade: "alta" })]);
    expect(p.atrasadas.map((i) => i.tarefa!.id)).toEqual(["c", "a", "b"]);
  });
  it("cronograma junta tarefas, blocos e eventos por horário (fuso local)", () => {
    const bloco = { id: "b1", tarefa_id: "x", tipo: "planejado", inicio_em: "2026-09-22T12:00:00+00:00", duracao_min: 30, foco: "", titulo: "Bloco", status: "pendente", prioridade: "baixa" } as unknown as BlocoPlanejado;
    const ev: EventoLocal = { id: 1, titulo: "Evento", inicio: HOJE, cor: "", minutos: 8 * 60, duracaoMin: 60 };
    const p = plano([t("a", { scheduled_at: "2026-09-22T17:00:00Z" })], [bloco], [ev]);
    expect(chaves(p.cronograma)).toEqual(["evento:1", "bloco:b1", "tarefa:a"]); // 08:00, 09:00, 14:00
  });
  it("evento de dia inteiro vai para 'dia todo'; evento de outro dia e tarefa concluída não entram", () => {
    const p = plano([t("z", { status: "concluida", due_date: HOJE })], [], [{ id: 1, titulo: "Feriado", inicio: HOJE, cor: "", minutos: null, duracaoMin: 60 }, { id: 2, titulo: "Amanhã", inicio: "2026-09-23", cor: "", minutos: 600, duracaoMin: 60 }]);
    expect(chaves(p.diaTodo)).toEqual(["evento:1"]);
    expect(p.total).toBe(1);
  });
  it("dia vazio: total 0", () => { expect(plano([]).total).toBe(0); });
});

describe("proximoHorarioLivre", () => {
  it("arredonda para o passo", () => { expect(proximoHorarioLivre([], 10 * 60 + 5, 30)).toBe(10 * 60 + 15); });
  it("pula ocupações e não sobrepõe", () => {
    expect(proximoHorarioLivre([{ inicioMin: 600, duracaoMin: 60 }, { inicioMin: 660, duracaoMin: 30 }], 600, 30)).toBe(690);
  });
  it("encaixa antes de um compromisso quando cabe", () => { expect(proximoHorarioLivre([{ inicioMin: 660, duracaoMin: 60 }], 600, 60)).toBe(600); });
  it("devolve null se não couber no dia", () => { expect(proximoHorarioLivre([], 23 * 60 + 30, 60)).toBeNull(); });
});
