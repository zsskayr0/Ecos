import { describe, expect, it } from "vitest";
import type { AtividadeTimeline, TarefaResumo } from "@/lib/api";
import { instanteLocalISO } from "@/lib/agenda-tempo";
import { atrasadasAteOntem, janelaInicial, montarTimeline, nivelDeIntensidade, ramosDoRegistro, resumirDia, trechosDaTimeline } from "@/lib/timeline";

const tarefa = (p: Partial<TarefaResumo>): TarefaResumo => ({
  id: "t1", caminho_arquivo: "", titulo: "Tarefa", status: "pendente", scheduled_at: null, duration_min: null, due_date: null,
  espaco: "pessoal", criado_em: "2026-11-01T00:00:00Z", prioridade: "media", criado_por: null, criado_por_nome: null, ...p,
});

const agora = new Date(`2026-11-25T12:00:00`);

describe("janelaInicial", () => {
  it("vai de uma semana atrás a duas à frente", () => {
    expect(janelaInicial("2026-11-25")).toEqual({ de: "2026-11-18", ate: "2026-12-09" });
  });
});

describe("montarTimeline", () => {
  const janela = { de: "2026-11-25", ate: "2026-11-26" };

  it("marca em vermelho a tarefa cujo horário passou e não a futura", () => {
    const dias = montarTimeline({
      janela, agora, eventos: [], atividades: [],
      tarefas: [
        tarefa({ id: "passou", scheduled_at: instanteLocalISO("2026-11-25", 9 * 60) }),
        tarefa({ id: "depois", scheduled_at: instanteLocalISO("2026-11-25", 15 * 60) }),
        tarefa({ id: "feita", status: "concluida", scheduled_at: instanteLocalISO("2026-11-25", 8 * 60) }),
      ],
    });
    const hoje = dias[0].itens;
    expect(hoje.map((i) => [i.alvo?.id, i.situacao])).toEqual([["feita", "concluida"], ["passou", "atrasada"], ["depois", "normal"]]);
  });

  it("intercala registro de atividade por horário e não repete a conclusão de tarefa programada", () => {
    const atividades: AtividadeTimeline[] = [
      { tipo: "nota", id: "n1", titulo: "Ideias", acao: "criada", em: instanteLocalISO("2026-11-25", 10 * 60) },
      { tipo: "tarefa", id: "t1", titulo: "Tarefa", acao: "concluida", em: instanteLocalISO("2026-11-25", 11 * 60) },
    ];
    const dias = montarTimeline({ janela, agora, eventos: [], atividades, tarefas: [tarefa({ id: "t1", status: "concluida", scheduled_at: instanteLocalISO("2026-11-25", 9 * 60) })] });
    expect(dias[0].itens.map((i) => i.chave)).toEqual(["tarefa:t1", "atividade:nota:n1:criada"]);
    expect(dias[1].itens).toEqual([]);
  });

  it("prazo de dia anterior é atrasado; o de hoje ainda não", () => {
    const ontem = tarefa({ id: "a", due_date: "2026-11-24" });
    const hoje = tarefa({ id: "b", due_date: "2026-11-25" });
    expect(atrasadasAteOntem([ontem, hoje], agora).map((i) => i.alvo?.id)).toEqual(["a"]);
    expect(montarTimeline({ janela, agora, eventos: [], atividades: [], tarefas: [hoje] })[0].itens[0].situacao).toBe("normal");
  });
});

describe("resumirDia", () => {
  it("conta programadas, concluídas, atrasadas e soma o Cofre", () => {
    const [dia] = montarTimeline({
      janela: { de: "2026-11-25", ate: "2026-11-25" }, agora,
      tarefas: [tarefa({ id: "a", scheduled_at: instanteLocalISO("2026-11-25", 9 * 60) }), tarefa({ id: "b", status: "concluida", due_date: "2026-11-25" })],
      eventos: [{ id: "transacao:x", transacaoId: "x", titulo: "Mercado", inicio: "2026-11-25", minutos: null, duracaoMin: 60, cor: "", valorCentavos: -5000 }],
      atividades: [{ tipo: "nota", id: "n", titulo: "N", acao: "criada", em: instanteLocalISO("2026-11-25", 8 * 60) }],
    });
    expect(resumirDia(dia, 2)).toMatchObject({ programadas: 2, concluidas: 1, atrasadas: 3, notasCriadas: 1, saidasCentavos: 5000, entradasCentavos: 0 });
  });
});

describe("ramosDoRegistro", () => {
  it("o ramo entra no primeiro registro, atravessa o meio e sai no último", () => {
    const r = ramosDoRegistro([{ natureza: "programado" }, { natureza: "registro" }, { natureza: "programado" }, { natureza: "registro" }, { natureza: "programado" }]);
    expect(r.map((x) => [x.entra, x.cima, x.baixo, x.sai, x.ponto])).toEqual([
      [false, false, false, false, false],
      [true, false, true, false, true],
      [false, true, true, false, false],
      [false, true, false, true, true],
      [false, false, false, false, false],
    ]);
  });
  it("o trilho da programação some em todo o trecho em que o ramo desvia", () => {
    const r = ramosDoRegistro([{ natureza: "programado" }, { natureza: "registro" }, { natureza: "programado" }, { natureza: "registro" }, { natureza: "programado" }]);
    expect(r.map((x) => x.trilho)).toEqual([true, false, false, false, true]);
    expect(r.every((x) => x.porLinha)).toBe(true);
    expect(ramosDoRegistro([{ natureza: "programado" }])[0]!.porLinha).toBe(false);
  });
  it("sem registro não há ramo", () => {
    expect(ramosDoRegistro([{ natureza: "programado" }]).every((x) => !x.entra && !x.sai && !x.cima)).toBe(true);
  });
});

describe("nivelDeIntensidade", () => {
  it("vai de 0 a 4 relativo ao máximo", () => {
    expect([0, 1, 5, 10].map((q) => nivelDeIntensidade(q, 10))).toEqual([0, 1, 2, 4]);
  });
});

describe("trechosDaTimeline", () => {
  it("esconde passado vazio, mantém hoje e junta futuro vazio em faixas", () => {
    const d = (dia: string, n = 0) => ({ dia, itens: Array.from({ length: n }, () => ({}) as never) });
    const t = trechosDaTimeline([d("2026-11-24"), d("2026-11-25"), d("2026-11-26"), d("2026-11-27"), d("2026-11-28", 1), d("2026-11-29")], "2026-11-25");
    expect(t.map((x) => x.tipo === "dia" ? x.dia.dia : `${x.de}..${x.ate}`)).toEqual(["2026-11-25", "2026-11-26..2026-11-27", "2026-11-28", "2026-11-29..2026-11-29"]);
  });
});

describe("trechosDaTimeline ao lado do mês", () => {
  it("com todosOsDias, cada dia vazio (passado ou futuro) aparece como dia próprio", () => {
    const dias = ["2026-11-25", "2026-11-26", "2026-11-27", "2026-11-28", "2026-11-29"].map((dia) => ({ dia, itens: [] }));
    expect(trechosDaTimeline(dias, "2026-11-27", true).map((t) => (t.tipo === "dia" ? t.dia.dia : "vazio"))).toEqual(["2026-11-25", "2026-11-26", "2026-11-27", "2026-11-28", "2026-11-29"]);
    expect(trechosDaTimeline(dias, "2026-11-27").map((t) => t.tipo)).toEqual(["dia", "vazio"]);
  });
});
