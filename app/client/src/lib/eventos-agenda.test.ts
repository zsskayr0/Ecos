import { describe, expect, it } from "vitest";
import type { Evento } from "@/lib/api";
import { COR_EVENTO_PADRAO, eventoParaItens, intervaloDoDestino, janelaDosDias, ocorrenciaEfetiva } from "./eventos-agenda";

const L = (a: number, m: number, d: number, h = 0, mi = 0) => new Date(a, m - 1, d, h, mi);
const evento = (extra: Partial<Evento> = {}): Evento => ({
  id: "e1", titulo: "Reunião", inicio: L(2026, 9, 21, 13).toISOString(), fim: L(2026, 9, 21, 14, 30).toISOString(), dia_inteiro: false, fuso: null, local: null,
  categoria_id: null, categoria: null, visibilidade: "privado", rrule: null, espaco: "pessoal", origem_google: false, sync_pendente: false,
  criado_em: "2026-09-01T00:00:00Z", atualizado_em: "2026-09-01T00:00:00Z", tarefas: [], notas: [], ...extra,
});
const janela = { de: L(2026, 9, 1), ate: L(2026, 11, 1) };

describe("eventoParaItens", () => {
  it("evento simples vira um item no dia local, com minutos do dia e a cor da categoria", () => {
    const itens = eventoParaItens(evento({ categoria: { id: "c", nome: "Foco", cor: "#22AA55", icone: null } }), janela.de, janela.ate);
    expect(itens).toHaveLength(1);
    expect(itens[0]).toMatchObject({ id: "e1@2026-09-21", servidorId: "e1", inicio: "2026-09-21", minutos: 13 * 60, duracaoMin: 90, corHex: "#22AA55", movivel: true, visibilidade: "privado" });
  });

  it("sem categoria usa a cor padrão", () => {
    expect(eventoParaItens(evento(), janela.de, janela.ate)[0].corHex).toBe(COR_EVENTO_PADRAO);
  });

  it("evento fora da janela não gera item", () => {
    expect(eventoParaItens(evento(), L(2026, 10, 1), L(2026, 11, 1))).toEqual([]);
  });

  it("dia inteiro vira um item sem horário, e vários dias viram um por dia (não movíveis)", () => {
    const um = eventoParaItens(evento({ dia_inteiro: true, inicio: L(2026, 9, 22).toISOString(), fim: L(2026, 9, 23).toISOString() }), janela.de, janela.ate);
    expect(um).toHaveLength(1);
    expect(um[0]).toMatchObject({ inicio: "2026-09-22", minutos: null, movivel: true });
    const tres = eventoParaItens(evento({ dia_inteiro: true, inicio: L(2026, 9, 22).toISOString(), fim: L(2026, 9, 25).toISOString() }), janela.de, janela.ate);
    expect(tres.map((i) => i.inicio)).toEqual(["2026-09-22", "2026-09-23", "2026-09-24"]);
    expect(tres.every((i) => i.movivel === false && i.minutos === null)).toBe(true);
  });

  it("evento que atravessa a meia-noite é cortado em dois dias", () => {
    const itens = eventoParaItens(evento({ inicio: L(2026, 9, 21, 22).toISOString(), fim: L(2026, 9, 22, 1, 30).toISOString() }), janela.de, janela.ate);
    expect(itens.map((i) => [i.inicio, i.minutos, i.duracaoMin])).toEqual([["2026-09-21", 22 * 60, 120], ["2026-09-22", 0, 90]]);
    expect(itens.every((i) => i.movivel === false)).toBe(true);
  });

  it("série quinzenal é expandida na janela; cada ocorrência é movível e sabe qual é (o início original)", () => {
    const e = evento({ rrule: "RRULE:FREQ=WEEKLY;WKST=SU;INTERVAL=2;BYDAY=MO", inicio: L(2026, 9, 14, 10).toISOString(), fim: L(2026, 9, 14, 11).toISOString() });
    const itens = eventoParaItens(e, L(2026, 9, 1), L(2026, 11, 1));
    expect(itens.map((i) => i.inicio)).toEqual(["2026-09-14", "2026-09-28", "2026-10-12", "2026-10-26"]);
    expect(itens.every((i) => i.movivel === true && i.servidorId === "e1")).toBe(true);
    expect(itens.map((i) => i.ocorrencia)).toEqual([L(2026, 9, 14, 10), L(2026, 9, 28, 10), L(2026, 10, 12, 10), L(2026, 10, 26, 10)].map((d) => d.toISOString()));
    expect(new Set(itens.map((i) => i.id)).size).toBe(4);
  });

  it("aniversário anual de dia inteiro, criado anos atrás, aparece no ano corrente", () => {
    const e = evento({ dia_inteiro: true, rrule: "RRULE:FREQ=YEARLY", inicio: L(1995, 5, 10).toISOString(), fim: L(1995, 5, 11).toISOString() });
    const itens = eventoParaItens(e, L(2026, 5, 1), L(2026, 6, 1));
    expect(itens.map((i) => [i.inicio, i.minutos])).toEqual([["2026-05-10", null]]);
  });

  it("regra que não sabemos expandir mostra só a ocorrência original em vez de inventar datas", () => {
    const e = evento({ rrule: "RRULE:FREQ=MONTHLY;BYDAY=2MO" });
    expect(eventoParaItens(e, janela.de, janela.ate).map((i) => i.inicio)).toEqual(["2026-09-21"]);
  });
});

describe("intervaloDoDestino", () => {
  it("evento com hora: novo início no dia/minuto soltos e a nova duração", () => {
    const r = intervaloDoDestino(evento(), { dia: "2026-09-23", inicioMin: 9 * 60 + 30, duracaoMin: 45 });
    expect(r.inicio).toBe(L(2026, 9, 23, 9, 30).toISOString());
    expect(r.fim).toBe(L(2026, 9, 23, 10, 15).toISOString());
  });

  it("dia inteiro: vai para a meia-noite do dia solto e mantém a quantidade de dias", () => {
    const e = evento({ dia_inteiro: true, inicio: L(2026, 9, 22).toISOString(), fim: L(2026, 9, 24).toISOString() });
    const r = intervaloDoDestino(e, { dia: "2026-09-30", inicioMin: null, duracaoMin: 60 });
    expect([r.inicio, r.fim]).toEqual([L(2026, 9, 30).toISOString(), L(2026, 10, 2).toISOString()]);
  });
});

describe("janelaDosDias", () => {
  it("dá 1 dia de folga antes e 2 depois (fim exclusivo + folga)", () => {
    const j = janelaDosDias("2026-09-20", "2026-09-26");
    expect([j.de.getDate(), j.ate.getDate()]).toEqual([19, 28]);
  });
});

const exc = (original: Date, extra: Partial<import("@/lib/api").ExcecaoEvento> = {}): import("@/lib/api").ExcecaoEvento => ({
  original: original.toISOString(), cancelada: false, titulo: null, inicio: null, fim: null, local: null, descricao: null, sync_pendente: false, ...extra,
});
const semanal = (extra: Partial<Evento> = {}) => evento({ rrule: "RRULE:FREQ=WEEKLY;BYDAY=MO", inicio: L(2026, 9, 14, 10).toISOString(), fim: L(2026, 9, 14, 11).toISOString(), ...extra });
const diasDe = (itens: ReturnType<typeof eventoParaItens>) => itens.map((i) => i.inicio);

describe("séries com exceções", () => {
  const janelaSet = { de: L(2026, 9, 14), ate: L(2026, 10, 6) }; // segundas: 14, 21, 28 e 5/10

  it("ocorrência cancelada some; as outras continuam", () => {
    const itens = eventoParaItens(semanal({ excecoes: [exc(L(2026, 9, 21, 10), { cancelada: true })] }), janelaSet.de, janelaSet.ate);
    expect(diasDe(itens)).toEqual(["2026-09-14", "2026-09-28", "2026-10-05"]);
  });

  it("ocorrência remarcada aparece no novo dia/horário, com o título dela, e só ela", () => {
    const e = semanal({ excecoes: [exc(L(2026, 9, 21, 10), { titulo: "Só hoje", inicio: L(2026, 9, 22, 15).toISOString(), local: "Sala 9" })] });
    const itens = eventoParaItens(e, janelaSet.de, janelaSet.ate);
    expect(diasDe(itens)).toEqual(["2026-09-14", "2026-09-22", "2026-09-28", "2026-10-05"]);
    const remarcada = itens.find((i) => i.inicio === "2026-09-22")!;
    expect(remarcada).toMatchObject({ titulo: "Só hoje", minutos: 15 * 60, duracaoMin: 60, local: "Sala 9", movivel: true });
    expect(remarcada.ocorrencia).toBe(L(2026, 9, 21, 10).toISOString()); // continua sendo a ocorrência de 21/09
    expect(itens.find((i) => i.inicio === "2026-09-28")!.titulo).toBe("Reunião");
  });

  it("duração própria da exceção vale só para ela", () => {
    const e = semanal({ excecoes: [exc(L(2026, 9, 28, 10), { fim: L(2026, 9, 28, 12).toISOString() })] });
    const itens = eventoParaItens(e, janelaSet.de, janelaSet.ate);
    expect(itens.find((i) => i.inicio === "2026-09-28")!.duracaoMin).toBe(120);
    expect(itens.find((i) => i.inicio === "2026-10-05")!.duracaoMin).toBe(60);
  });

  it("uma exceção remarcada PARA dentro da janela aparece mesmo que a original esteja fora dela", () => {
    const e = semanal({ excecoes: [exc(L(2026, 10, 12, 10), { inicio: L(2026, 10, 1, 9).toISOString() })] });
    const itens = eventoParaItens(e, janelaSet.de, janelaSet.ate);
    expect(diasDe(itens)).toEqual(["2026-09-14", "2026-09-21", "2026-09-28", "2026-10-01", "2026-10-05"]);
  });

  it("uma exceção remarcada PARA FORA da janela some daqui (a original não conta mais)", () => {
    const e = semanal({ excecoes: [exc(L(2026, 9, 21, 10), { inicio: L(2026, 11, 3, 10).toISOString() })] });
    expect(diasDe(eventoParaItens(e, janelaSet.de, janelaSet.ate))).toEqual(["2026-09-14", "2026-09-28", "2026-10-05"]);
  });

  it("EXDATE tira a data da série (UTC e hora local)", () => {
    const e = semanal({ recorrencia_extra: [`EXDATE:${L(2026, 9, 21, 10).toISOString().replace(/[-:]|\.\d{3}/g, "")}`, "EXDATE;TZID=America/Sao_Paulo:20261005T100000"] });
    expect(diasDe(eventoParaItens(e, janelaSet.de, janelaSet.ate))).toEqual(["2026-09-14", "2026-09-28"]);
  });

  it("ids não colidem quando uma exceção cai no mesmo dia de outra ocorrência", () => {
    const e = semanal({ excecoes: [exc(L(2026, 9, 21, 10), { inicio: L(2026, 9, 28, 16).toISOString() })] });
    const ids = eventoParaItens(e, janelaSet.de, janelaSet.ate).map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(eventoParaItens(e, janelaSet.de, janelaSet.ate).filter((i) => i.inicio === "2026-09-28")).toHaveLength(2);
  });

  it("série de dia inteiro com exceção cancelada", () => {
    const e = evento({ dia_inteiro: true, rrule: "RRULE:FREQ=YEARLY", inicio: L(1995, 5, 10).toISOString(), fim: L(1995, 5, 11).toISOString(), excecoes: [exc(L(2026, 5, 10), { cancelada: true })] });
    expect(eventoParaItens(e, L(2026, 5, 1), L(2026, 6, 1))).toEqual([]);
  });
});

describe("ocorrenciaEfetiva", () => {
  it("sem exceção é a série; com exceção, as mudanças dela por cima (e local vazio apaga)", () => {
    const e = semanal({ local: "Sala 1", descricao: "pauta" });
    expect(ocorrenciaEfetiva(e, L(2026, 9, 28, 10).toISOString())).toMatchObject({ titulo: "Reunião", local: "Sala 1", descricao: "pauta", inicio: L(2026, 9, 28, 10).toISOString(), fim: L(2026, 9, 28, 11).toISOString() });
    const com = semanal({ local: "Sala 1", descricao: "pauta", excecoes: [exc(L(2026, 9, 28, 10), { titulo: "X", local: "", inicio: L(2026, 9, 28, 14).toISOString() })] });
    expect(ocorrenciaEfetiva(com, L(2026, 9, 28, 10).toISOString())).toMatchObject({ titulo: "X", local: null, descricao: "pauta", inicio: L(2026, 9, 28, 14).toISOString(), fim: L(2026, 9, 28, 15).toISOString() });
  });
});
