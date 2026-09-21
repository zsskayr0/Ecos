import { afterEach, describe, expect, it } from "vitest";
import type { BlocoPlanejado, TarefaResumo } from "@/lib/api";
import {
  ENCAIXE_PADRAO, HORA_PADRAO_MIN, MINUTOS_DIA, PX_POR_MINUTO, acaoDaTecla, aplicarAcao, aplicarPayloadNoBloco, arredondar, capacidadesDo, concluidasPorDia, dataLocalISO, descreverPosicao,
  diaEMinutosLocais, diasEntre, distribuirColunas, duracaoDoPonteiro, duracaoParaAlocar, horaLocal, instanteLocalISO, itemDoBloco, itensDaTarefa, payloadDoBloco, posicaoDoPonteiro,
  somarDiasISO, type Posicao,
} from "./agenda-tempo";

function tarefa(p: Partial<TarefaResumo> = {}): TarefaResumo {
  return { id: "t1", caminho_arquivo: "Tarefas/a.md", titulo: "Tarefa", status: "pendente", scheduled_at: null, duration_min: 45, due_date: null, espaco: "pessoal", criado_em: "2026-09-01T10:00:00Z", prioridade: "baixa", criado_por: null, criado_por_nome: null, ...p };
}

const fusoOriginal = process.env.TZ;
function comFuso<T>(fuso: string, fn: () => T): T {
  process.env.TZ = fuso;
  return fn();
}
afterEach(() => { process.env.TZ = fusoOriginal; });

describe("fuso e datas", () => {
  it("o fuso de teste é o de Brasília (UTC-3)", () => {
    expect(new Date("2026-09-19T12:00:00Z").getHours()).toBe(9);
  });

  it("22:30 em Brasília ainda é o dia 19 (em UTC já seria o 20)", () => {
    const instante = "2026-09-20T01:30:00.000Z";
    expect(instante.slice(0, 10)).toBe("2026-09-20"); // o erro clássico: toISOString().slice(0, 10)
    expect(diaEMinutosLocais(instante)).toEqual({ dia: "2026-09-19", minutos: 22 * 60 + 30 });
    expect(dataLocalISO(new Date(instante))).toBe("2026-09-19");
  });

  it("dia local + minutos vira o instante UTC que o servidor guarda, e volta igual", () => {
    expect(instanteLocalISO("2026-09-19", 22 * 60 + 30)).toBe("2026-09-20T01:30:00.000Z");
    expect(instanteLocalISO("2026-09-19", 0)).toBe("2026-09-19T03:00:00.000Z");
    for (const minutos of [0, 5, 545, 1439]) expect(diaEMinutosLocais(instanteLocalISO("2026-09-19", minutos))).toEqual({ dia: "2026-09-19", minutos });
  });

  it("soma de dias e diferença entre dias contam dias de calendário", () => {
    expect(somarDiasISO("2026-09-30", 1)).toBe("2026-10-01");
    expect(somarDiasISO("2026-01-01", -1)).toBe("2025-12-31");
    expect(diasEntre("2026-09-19", "2026-09-26")).toBe(7);
  });

  it("virada de horário de verão (Nova York, 08/03/2026): 12:00 local muda de UTC, o dia não desliza", () => {
    comFuso("America/New_York", () => {
      expect(new Date("2026-03-08T16:00:00Z").getHours()).toBe(12); // só passa se o fuso realmente trocou (EDT = UTC-4)
      expect(instanteLocalISO("2026-03-07", 12 * 60)).toBe("2026-03-07T17:00:00.000Z"); // EST = UTC-5
      expect(instanteLocalISO("2026-03-08", 12 * 60)).toBe("2026-03-08T16:00:00.000Z"); // EDT = UTC-4
      expect(diaEMinutosLocais("2026-03-08T16:00:00.000Z")).toEqual({ dia: "2026-03-08", minutos: 720 });
      expect(diasEntre("2026-03-07", "2026-03-09")).toBe(2); // 47 h no relógio, 2 dias no calendário
      expect(somarDiasISO("2026-03-07", 1)).toBe("2026-03-08");
    });
  });

  it("em um fuso a leste de UTC (Tóquio), 08:00 local ainda é o dia anterior em UTC — e o dia local continua certo", () => {
    comFuso("Asia/Tokyo", () => {
      expect(instanteLocalISO("2026-09-19", 8 * 60)).toBe("2026-09-18T23:00:00.000Z");
      expect(diaEMinutosLocais("2026-09-18T23:00:00.000Z")).toEqual({ dia: "2026-09-19", minutos: 480 });
    });
  });
});

describe("encaixe (snap)", () => {
  it.each([[5, 7, 5], [5, 8, 10], [15, 7, 0], [15, 8, 15], [15, 22, 15], [30, 44, 30], [30, 46, 60], [60, 89, 60]])("encaixe de %i min: %i min vira %i", (encaixe, minutos, esperado) => {
    expect(arredondar(minutos, encaixe)).toBe(esperado);
  });
});

describe("tarefa -> itens da grade (agendamento × prazo)", () => {
  const com = { mostrarPrazos: true };
  const sem = { mostrarPrazos: false };

  it("agendada: um cartão com o dia e a hora LOCAIS e a duração da tarefa", () => {
    const itens = itensDaTarefa(tarefa({ scheduled_at: "2026-09-20T01:30:00Z", duration_min: 45 }), com);
    expect(itens).toHaveLength(1);
    expect(itens[0]).toMatchObject({ chave: "tarefa:t1", tipo: "tarefa", dia: "2026-09-19", inicioMin: 22 * 60 + 30, duracaoMin: 45 });
    expect(itens[0].comPrazo).toBeUndefined();
  });

  it("só com prazo e prazos ligados: uma marca de prazo na faixa 'O dia todo' — nunca um cartão de tarefa", () => {
    const itens = itensDaTarefa(tarefa({ due_date: "2026-09-21" }), com);
    expect(itens).toHaveLength(1);
    expect(itens[0]).toMatchObject({ chave: "prazo:t1", tipo: "prazo", dia: "2026-09-21", inicioMin: null });
    expect(itens[0].classe).toContain("warning"); // cor própria, distinta do agendamento
  });

  it("com prazos desligados a marca NÃO aparece: tarefa só com prazo some da grade", () => {
    expect(itensDaTarefa(tarefa({ due_date: "2026-09-21" }), sem)).toEqual([]);
  });

  it("agendada COM prazo no mesmo dia: UM cartão só, com a marca de prazo nele (sem cartão duplicado)", () => {
    const itens = itensDaTarefa(tarefa({ scheduled_at: "2026-09-21T13:00:00Z", due_date: "2026-09-21" }), com);
    expect(itens).toHaveLength(1);
    expect(itens[0]).toMatchObject({ tipo: "tarefa", dia: "2026-09-21", comPrazo: true });
  });

  it("agendada com prazo em OUTRO dia: o cartão fica no agendamento e o prazo é só uma marca no outro dia", () => {
    const itens = itensDaTarefa(tarefa({ scheduled_at: "2026-09-21T13:00:00Z", due_date: "2026-09-25" }), com);
    expect(itens.map((i) => [i.tipo, i.dia, i.inicioMin])).toEqual([["tarefa", "2026-09-21", 600], ["prazo", "2026-09-25", null]]);
    expect(itens[0].comPrazo).toBeUndefined();
    expect(new Set(itens.map((i) => i.chave)).size).toBe(2); // chaves distintas
  });

  it("agendada com prazo, prazos desligados: só o agendamento, sem marca nenhuma", () => {
    const itens = itensDaTarefa(tarefa({ scheduled_at: "2026-09-21T13:00:00Z", due_date: "2026-09-21" }), sem);
    expect(itens).toHaveLength(1);
    expect(itens[0].comPrazo).toBeUndefined();
    expect(itensDaTarefa(tarefa({ scheduled_at: "2026-09-21T13:00:00Z", due_date: "2026-09-25" }), sem)).toHaveLength(1);
  });

  it("o 'mesmo dia' é o dia LOCAL: 22:30 em Brasília com prazo naquele dia continua sendo um cartão só, mesmo já sendo o dia seguinte em UTC", () => {
    const itens = itensDaTarefa(tarefa({ scheduled_at: "2026-09-20T01:30:00Z", due_date: "2026-09-19" }), com);
    expect(itens).toHaveLength(1);
    expect(itens[0]).toMatchObject({ dia: "2026-09-19", comPrazo: true });
  });

  it("o prazo é uma data sem fuso: não desliza de dia", () => {
    expect(itensDaTarefa(tarefa({ due_date: "2026-09-21" }), com)[0].dia).toBe("2026-09-21");
  });

  it("sem data nenhuma: nada, com ou sem prazos", () => {
    expect(itensDaTarefa(tarefa(), com)).toEqual([]);
    expect(itensDaTarefa(tarefa(), sem)).toEqual([]);
  });

  it("sem duração cadastrada usa um valor só de exibição", () => {
    expect(itensDaTarefa(tarefa({ scheduled_at: "2026-09-19T12:00:00Z", duration_min: null }), com)[0].duracaoMin).toBe(30);
  });

  it("prioridade alta ganha a cor de alerta no agendamento; a marca de prazo mantém a sua", () => {
    expect(itensDaTarefa(tarefa({ scheduled_at: "2026-09-21T13:00:00Z", prioridade: "alta" }), com)[0].classe).toContain("error");
    expect(itensDaTarefa(tarefa({ due_date: "2026-09-21", prioridade: "alta" }), com)[0].classe).toContain("warning");
  });

  it("o agendamento não é movível (só o bloco de tempo é); a marca de prazo só pode ser levada a um horário, onde vira bloco", () => {
    const [agendada, prazo] = itensDaTarefa(tarefa({ scheduled_at: "2026-09-21T13:00:00Z", due_date: "2026-09-25" }), com);
    expect(capacidadesDo(agendada)).toEqual({ mover: false, redimensionar: false, diaInteiro: false, remover: false });
    expect(capacidadesDo(prazo)).toEqual({ mover: true, redimensionar: false, diaInteiro: false, remover: false });
  });
});

function bloco(p: Partial<BlocoPlanejado> = {}): BlocoPlanejado {
  return { id: "b1", tarefa_id: "t1", tipo: "planejado", inicio_em: "2026-09-22T13:00:00+00:00", duracao_min: 45, foco: "", titulo: "Relatório", status: "pendente", prioridade: "baixa", tarefa_duration_min: 45, ...p };
}

describe("bloco de tempo alocado", () => {
  it("vira um item com o dia e a hora LOCAIS (10:00 em Brasília, não 13:00 UTC) e aponta para a tarefa dona", () => {
    expect(itemDoBloco(bloco())).toMatchObject({ chave: "bloco:b1", tipo: "bloco", id: "b1", tarefaId: "t1", dia: "2026-09-22", inicioMin: 600, duracaoMin: 45 });
  });
  it("à noite o dia é o local: 22:30 em Brasília ainda é o mesmo dia, embora em UTC já seja o seguinte", () => {
    expect(itemDoBloco(bloco({ inicio_em: "2026-09-23T01:30:00+00:00" }))).toMatchObject({ dia: "2026-09-22", inicioMin: 22 * 60 + 30 });
  });
  it("bloco ainda sem id definitivo (criando no servidor) fica marcado como 'salvando'", () => {
    expect(itemDoBloco(bloco({ id: "tmp-123" })).salvando).toBe(true);
    expect(itemDoBloco(bloco()).salvando).toBe(false);
  });

  const antes: Posicao = { dia: "2026-09-22", inicioMin: 600, duracaoMin: 45 };
  it("mover para outro dia manda só o início — a duração NÃO vai e a tarefa nem é citada", () => {
    const p = payloadDoBloco(antes, { ...antes, dia: "2026-09-24" });
    expect(p).toEqual({ inicio_em: "2026-09-24T13:00:00.000Z" });
    expect("duracao_min" in p).toBe(false);
  });
  it("mover de hora, no mesmo dia, manda só o início", () => {
    expect(payloadDoBloco(antes, { ...antes, inicioMin: 14 * 60 + 15 })).toEqual({ inicio_em: "2026-09-22T17:15:00.000Z" });
  });
  it("redimensionar manda só a duração — o início não vai", () => {
    expect(payloadDoBloco(antes, { ...antes, duracaoMin: 90 })).toEqual({ duracao_min: 90 });
  });
  it("mover E redimensionar juntos (menu) manda os dois", () => {
    expect(payloadDoBloco(antes, { dia: "2026-09-25", inicioMin: 540, duracaoMin: 60 })).toEqual({ inicio_em: "2026-09-25T12:00:00.000Z", duracao_min: 60 });
  });
  it("sem mudança nenhuma o payload é vazio", () => {
    expect(payloadDoBloco(antes, { ...antes })).toEqual({});
  });
  it("bloco nunca vai para a faixa 'O dia todo': destino sem horário não gera início", () => {
    expect(payloadDoBloco(antes, { ...antes, inicioMin: null })).toEqual({});
  });
  it("aplicar o payload no bloco em memória dá o que o servidor guardaria", () => {
    const novo = aplicarPayloadNoBloco(bloco(), payloadDoBloco(antes, { dia: "2026-09-23", inicioMin: 660, duracaoMin: 60 }));
    expect(novo).toMatchObject({ inicio_em: "2026-09-23T14:00:00.000Z", duracao_min: 60 });
    expect(itemDoBloco(novo)).toMatchObject({ dia: "2026-09-23", inicioMin: 660, duracaoMin: 60 });
  });
  it("mover não toca o bloco original (imutável)", () => {
    const original = bloco();
    aplicarPayloadNoBloco(original, { duracao_min: 5 });
    expect(original.duracao_min).toBe(45);
  });
});

describe("o que cada item da grade pode fazer", () => {
  it("bloco de tempo: move, redimensiona e remove, mas não vai para o dia inteiro", () => {
    expect(capacidadesDo({ tipo: "bloco" })).toEqual({ mover: true, redimensionar: true, diaInteiro: false, remover: true });
  });
  it("evento: move, redimensiona e pode ser dia inteiro", () => {
    expect(capacidadesDo({ tipo: "evento" })).toEqual({ mover: true, redimensionar: true, diaInteiro: true, remover: false });
  });
  it("tarefa com data própria: nada — a Agenda não muda a data de uma tarefa", () => {
    expect(capacidadesDo({ tipo: "tarefa" })).toEqual({ mover: false, redimensionar: false, diaInteiro: false, remover: false });
  });
  it("item ainda salvando fica parado", () => {
    expect(capacidadesDo({ tipo: "bloco", salvando: true })).toEqual({ mover: false, redimensionar: false, diaInteiro: false, remover: false });
  });
});

describe("quanto tempo alocar ao soltar uma tarefa", () => {
  it("é a estimativa da tarefa", () => {
    expect(duracaoParaAlocar(45)).toBe(45);
    expect(duracaoParaAlocar(5)).toBe(5);
  });
  it("sem estimativa (ou inválida) usa um padrão", () => {
    for (const v of [null, undefined, 0, -10]) expect(duracaoParaAlocar(v)).toBe(30);
  });
  it("nunca passa de um dia", () => {
    expect(duracaoParaAlocar(99999)).toBe(MINUTOS_DIA);
  });
});

describe("sobreposição", () => {
  const f = (chave: string, inicioMin: number, duracaoMin: number) => ({ chave, inicioMin, duracaoMin });
  it("blocos que não se tocam ocupam a largura toda", () => {
    const r = distribuirColunas([f("a", 0, 60), f("b", 60, 60)]);
    expect(r.get("a")).toEqual({ coluna: 0, colunas: 1 });
    expect(r.get("b")).toEqual({ coluna: 0, colunas: 1 });
  });
  it("dois blocos que se sobrepõem dividem em duas colunas", () => {
    const r = distribuirColunas([f("a", 60, 60), f("b", 90, 60)]);
    expect(r.get("a")).toEqual({ coluna: 0, colunas: 2 });
    expect(r.get("b")).toEqual({ coluna: 1, colunas: 2 });
  });
  it("um bloco longo com dois curtos: os curtos reaproveitam a 2ª coluna", () => {
    const r = distribuirColunas([f("longo", 60, 180), f("c1", 70, 30), f("c2", 120, 30)]);
    expect(r.get("longo")).toEqual({ coluna: 0, colunas: 2 });
    expect(r.get("c1")).toEqual({ coluna: 1, colunas: 2 });
    expect(r.get("c2")).toEqual({ coluna: 1, colunas: 2 });
  });
  it("três ao mesmo tempo viram três colunas, e um grupo depois volta a uma coluna", () => {
    const r = distribuirColunas([f("a", 60, 60), f("b", 60, 60), f("c", 60, 60), f("d", 300, 30)]);
    expect(new Set(["a", "b", "c"].map((k) => r.get(k)!.coluna))).toEqual(new Set([0, 1, 2]));
    expect(r.get("a")!.colunas).toBe(3);
    expect(r.get("d")).toEqual({ coluna: 0, colunas: 1 });
  });
  it("blocos de 5 min são tratados pelo tamanho mínimo legível: dois seguidos de 5 min não ficam um sobre o outro", () => {
    const r = distribuirColunas([f("a", 60, 5), f("b", 65, 5)]);
    expect(r.get("a")!.colunas).toBe(2);
  });
});

describe("do ponteiro para a posição", () => {
  const colunas = [
    { dia: "2026-09-19", left: 100, right: 200, top: 300 },
    { dia: "2026-09-20", left: 200, right: 300, top: 300 },
    { dia: "2026-09-21", left: 300, right: 400, top: 300 },
  ];
  const faixasDiaTodo = colunas.map((c) => ({ dia: c.dia, left: c.left, right: c.right, top: 240, bottom: 290 }));
  const base = { colunas, faixasDiaTodo, encaixe: 15, duracaoMin: 45, deslocamentoMin: 0 };
  const yDe = (minutos: number) => 300 + minutos * PX_POR_MINUTO;

  it("acha o dia pela coluna e o horário pela altura, com encaixe", () => {
    expect(posicaoDoPonteiro({ ...base, x: 250, y: yDe(600) })).toEqual({ dia: "2026-09-20", inicioMin: 600, duracaoMin: 45 });
    expect(posicaoDoPonteiro({ ...base, x: 250, y: yDe(607) })).toEqual({ dia: "2026-09-20", inicioMin: 600, duracaoMin: 45 });
    expect(posicaoDoPonteiro({ ...base, x: 250, y: yDe(608) })).toEqual({ dia: "2026-09-20", inicioMin: 615, duracaoMin: 45 });
  });
  it("mudar de dia arrastando não altera a duração", () => {
    const de = posicaoDoPonteiro({ ...base, x: 150, y: yDe(600) })!;
    const para = posicaoDoPonteiro({ ...base, x: 350, y: yDe(600) })!;
    expect(para.dia).not.toBe(de.dia);
    expect(para.duracaoMin).toBe(de.duracaoMin);
  });
  it("respeita onde o bloco foi agarrado: o topo não pula para debaixo do dedo", () => {
    // Agarrou 30 min abaixo do topo do bloco; com o dedo em 10:30 o bloco começa às 10:00.
    expect(posicaoDoPonteiro({ ...base, deslocamentoMin: 30, x: 150, y: yDe(630) })!.inicioMin).toBe(600);
  });
  it("nunca passa de 00:00 nem do último encaixe do dia", () => {
    expect(posicaoDoPonteiro({ ...base, x: 150, y: 0 })!.inicioMin).toBe(0);
    expect(posicaoDoPonteiro({ ...base, x: 150, y: 99999 })!.inicioMin).toBe(MINUTOS_DIA - 15);
  });
  it("sobre a faixa 'O dia todo' vira dia inteiro naquele dia", () => {
    expect(posicaoDoPonteiro({ ...base, x: 350, y: 260 })).toEqual({ dia: "2026-09-21", inicioMin: null, duracaoMin: 45 });
  });
  it("com dia inteiro proibido (bloco de tempo) a faixa é ignorada: o ponteiro sobre ela vira 00:00 e nunca 'dia inteiro'", () => {
    const p = posicaoDoPonteiro({ ...base, permiteDiaInteiro: false, x: 350, y: 260 })!;
    expect(p.inicioMin).toBe(0);
    expect(p.dia).toBe("2026-09-21");
  });
  it("com o ponteiro fora da grade, usa a coluna mais próxima em vez de largar o gesto", () => {
    expect(posicaoDoPonteiro({ ...base, x: 20, y: yDe(600) })!.dia).toBe("2026-09-19");
    expect(posicaoDoPonteiro({ ...base, x: 900, y: yDe(600) })!.dia).toBe("2026-09-21");
  });
  it("encaixe configurável muda a granularidade", () => {
    expect(posicaoDoPonteiro({ ...base, encaixe: 5, x: 150, y: yDe(607) })!.inicioMin).toBe(605);
    expect(posicaoDoPonteiro({ ...base, encaixe: 60, x: 150, y: yDe(631) })!.inicioMin).toBe(600 + 60);
  });
  it("redimensionar: a duração é o fim (encaixado) menos o início, no mínimo um encaixe e sem passar da meia-noite", () => {
    const g = { colunaTop: 300, inicioMin: 600, encaixe: 15 };
    expect(duracaoDoPonteiro({ ...g, y: yDe(690) })).toBe(90);
    expect(duracaoDoPonteiro({ ...g, y: yDe(601) })).toBe(15);
    expect(duracaoDoPonteiro({ ...g, y: yDe(300) })).toBe(15);
    expect(duracaoDoPonteiro({ ...g, y: 99999 })).toBe(MINUTOS_DIA - 600);
  });
});

describe("teclado e menu", () => {
  const pos: Posicao = { dia: "2026-09-19", inicioMin: 600, duracaoMin: 45 };
  it("setas movem: cima/baixo por um encaixe, esquerda/direita por um dia — sem mudar a duração", () => {
    const tecla = (key: string, shiftKey = false) => acaoDaTecla({ key, shiftKey })!;
    expect(aplicarAcao(pos, tecla("ArrowDown"), 15)).toEqual({ ...pos, inicioMin: 615 });
    expect(aplicarAcao(pos, tecla("ArrowUp"), 30)).toEqual({ ...pos, inicioMin: 570 });
    expect(aplicarAcao(pos, tecla("ArrowRight"), 15)).toEqual({ ...pos, dia: "2026-09-20" });
    expect(aplicarAcao(pos, tecla("ArrowLeft"), 15)).toEqual({ ...pos, dia: "2026-09-18" });
    for (const k of ["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"]) expect(aplicarAcao(pos, tecla(k), 15).duracaoMin).toBe(45);
  });
  it("Shift + setas redimensionam, sem mexer no início", () => {
    expect(aplicarAcao(pos, acaoDaTecla({ key: "ArrowDown", shiftKey: true })!, 15)).toEqual({ ...pos, duracaoMin: 60 });
    expect(aplicarAcao(pos, acaoDaTecla({ key: "ArrowUp", shiftKey: true })!, 15)).toEqual({ ...pos, duracaoMin: 30 });
  });
  it("não passa dos limites: nem antes de 00:00, nem depois do fim do dia, nem duração abaixo de um encaixe", () => {
    expect(aplicarAcao({ ...pos, inicioMin: 0 }, { tipo: "mover", dDias: 0, dEncaixes: -1 }, 15).inicioMin).toBe(0);
    expect(aplicarAcao({ ...pos, inicioMin: MINUTOS_DIA - 15 }, { tipo: "mover", dDias: 0, dEncaixes: 1 }, 15).inicioMin).toBe(MINUTOS_DIA - 15);
    expect(aplicarAcao({ ...pos, duracaoMin: 15 }, { tipo: "redimensionar", dEncaixes: -1 }, 15).duracaoMin).toBe(15);
    expect(aplicarAcao({ ...pos, inicioMin: 1400, duracaoMin: 30 }, { tipo: "redimensionar", dEncaixes: 10 }, 15).duracaoMin).toBe(MINUTOS_DIA - 1400);
  });
  it("'A' alterna dia inteiro nos dois sentidos, sem tocar a duração", () => {
    const diaInteiro = aplicarAcao(pos, { tipo: "alternarDiaInteiro" }, 15);
    expect(diaInteiro).toEqual({ ...pos, inicioMin: null });
    expect(aplicarAcao(diaInteiro, { tipo: "alternarDiaInteiro" }, 15)).toEqual({ ...pos, inicioMin: HORA_PADRAO_MIN });
  });
  it("quando dia inteiro é proibido (bloco de tempo), 'A' não faz nada", () => {
    expect(aplicarAcao(pos, { tipo: "alternarDiaInteiro" }, 15, false)).toEqual(pos);
  });
  it("item de dia inteiro só anda entre dias; cima/baixo e redimensionar não fazem nada", () => {
    const d: Posicao = { dia: "2026-09-19", inicioMin: null, duracaoMin: 45 };
    expect(aplicarAcao(d, { tipo: "mover", dDias: 0, dEncaixes: 1 }, 15)).toEqual(d);
    expect(aplicarAcao(d, { tipo: "redimensionar", dEncaixes: 1 }, 15)).toEqual(d);
    expect(aplicarAcao(d, { tipo: "mover", dDias: 1, dEncaixes: 0 }, 15).dia).toBe("2026-09-20");
  });
  it("teclas com Ctrl/Alt/Meta ficam para o navegador; outras teclas não são nossas", () => {
    expect(acaoDaTecla({ key: "ArrowDown", shiftKey: false, ctrlKey: true })).toBeNull();
    expect(acaoDaTecla({ key: "ArrowDown", shiftKey: false, altKey: true })).toBeNull();
    expect(acaoDaTecla({ key: "x", shiftKey: false })).toBeNull();
  });
  it("descreve a posição em português para leitor de tela", () => {
    expect(descreverPosicao(pos)).toMatch(/10:00 às 10:45/);
    expect(descreverPosicao({ ...pos, inicioMin: null })).toMatch(/dia inteiro/);
  });
  it("encaixe padrão é 15 min", () => {
    expect(ENCAIXE_PADRAO).toBe(15);
  });
});

describe("concluidasPorDia", () => {
  it("agrupa pelo dia local da conclusão (23:30 em Brasília é o dia 19, não o 20 de UTC), em ordem de horário", () => {
    const mapa = concluidasPorDia([
      tarefa({ id: "b", status: "concluida", concluida_em: "2026-09-20T02:30:00Z" }),
      tarefa({ id: "a", status: "concluida", concluida_em: "2026-09-19T12:00:00Z" }),
      tarefa({ id: "c", status: "concluida", concluida_em: "2026-09-20T15:00:00Z" }),
    ]);
    expect(mapa.get("2026-09-19")?.map((t) => t.id)).toEqual(["a", "b"]);
    expect(mapa.get("2026-09-20")?.map((t) => t.id)).toEqual(["c"]);
  });

  it("ignora pendentes (reabertas) e concluídas sem instante", () => {
    const mapa = concluidasPorDia([
      tarefa({ id: "x", status: "pendente", concluida_em: "2026-09-19T12:00:00Z" }),
      tarefa({ id: "y", status: "concluida", concluida_em: null }),
    ]);
    expect(mapa.size).toBe(0);
  });

  it("horaLocal mostra o horário do relógio local", () => {
    expect(horaLocal("2026-09-19T12:05:00Z")).toBe("09:05");
  });
});
