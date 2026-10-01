import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api")>();
  return { ...original, eventos: { ...original.eventos, obter: vi.fn(), criar: vi.fn(), atualizar: vi.fn(), excluir: vi.fn(), atualizarOcorrencia: vi.fn(), cancelarOcorrencia: vi.fn(), categorias: { ...original.eventos.categorias, listar: vi.fn() } } };
});

import { ApiError, eventos, type Evento } from "@/lib/api";
import { EventoDialog } from "./EventoDialog";
import { AppUIProvider } from "@/lib/ui-context";
import { RefreshProvider } from "@/lib/refresh-bus";

const ORIGINAL = "2026-09-22T13:00:00.000Z"; // terça 10:00 em Brasília
const CATEGORIAS = [{ id: "c1", espaco: "pessoal", nome: "Trabalho", cor: "#E11D48", icone: null }];

const serie = (extra: Partial<Evento> = {}): Evento => ({
  id: "s1", titulo: "Alinhamento", inicio: "2026-09-01T13:00:00Z", fim: "2026-09-01T14:00:00Z", dia_inteiro: false, fuso: null, local: null,
  categoria_id: null, categoria: null, cor: null, visibilidade: "google", rrule: "RRULE:FREQ=WEEKLY;BYDAY=TU", espaco: "pessoal", origem_google: true, sync_pendente: false,
  criado_em: "2026-09-01T00:00:00Z", atualizado_em: "2026-09-01T00:00:00Z", tarefas: [], notas: [], excecoes: [], descricao: "pauta", ...extra,
});
const simples = (extra: Partial<Evento> = {}): Evento => serie({ id: "e1", titulo: "Almoço", rrule: null, visibilidade: "privado", origem_google: false, inicio: "2026-09-23T16:00:00Z", fim: "2026-09-23T17:00:00Z", ...extra });

const onFechar = vi.fn();
const onSalvo = vi.fn();
function abrir(evento: Evento | null, ocorrencia?: string) {
  if (evento) vi.mocked(eventos.obter).mockResolvedValue(evento);
  render(<RefreshProvider><AppUIProvider><EventoDialog aberto eventoId={evento?.id ?? null} ocorrencia={ocorrencia ?? null} categorias={CATEGORIAS} diaInicial={new Date(2026, 8, 23)} onFechar={onFechar} onSalvo={onSalvo} /></AppUIProvider></RefreshProvider>);
}
const titulo = () => screen.findByLabelText("Título") as Promise<HTMLInputElement>;
const salvar = (nome: RegExp | string = /Salvar|Criar/) => fireEvent.click(screen.getByRole("button", { name: nome }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(eventos.criar).mockResolvedValue(simples());
  vi.mocked(eventos.atualizar).mockResolvedValue(simples());
  vi.mocked(eventos.excluir).mockResolvedValue({ ok: true });
  vi.mocked(eventos.atualizarOcorrencia).mockResolvedValue(serie());
  vi.mocked(eventos.cancelarOcorrencia).mockResolvedValue(serie());
  vi.mocked(eventos.categorias.listar).mockResolvedValue(CATEGORIAS);
});

describe("editor de evento — criar", () => {
  it("tem os blocos de sempre e os novos: categoria, sincronização e vínculos", async () => {
    abrir(null);
    await titulo();
    for (const rotulo of ["Quando", "Repetir", "Cor", "Local", "Descrição", "Categoria", "Sincronização", "Vínculos"]) expect(screen.getByText(rotulo), rotulo).toBeTruthy();
    expect(screen.getByPlaceholderText("Buscar tarefa ou nota para vincular")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Criar evento" })).toBeTruthy();
  });

  it("cria com categoria e Google; a cor segue a categoria (não vira cor própria)", async () => {
    abrir(null);
    fireEvent.change(await titulo(), { target: { value: "Reunião de time" } });
    expect(screen.getByText("#0891B2")).toBeTruthy(); // cor padrão
    fireEvent.click(screen.getByRole("button", { name: "Trabalho" }));
    expect(screen.getByText("#E11D48")).toBeTruthy(); // seguiu a categoria
    fireEvent.click(screen.getByRole("button", { name: "Google Calendar" }));
    salvar("Criar evento");
    await waitFor(() => expect(eventos.criar).toHaveBeenCalledTimes(1));
    expect(eventos.criar).toHaveBeenCalledWith(expect.objectContaining({
      titulo: "Reunião de time", inicio: "2026-09-23T12:00:00.000Z", fim: "2026-09-23T13:00:00.000Z", dia_inteiro: false,
      categoria_id: "c1", cor: null, visibilidade: "google", tarefas: [], notas: [],
    }));
    await waitFor(() => expect(onSalvo).toHaveBeenCalled());
  });

  it("por padrão é privado (só no Ecos) e dia inteiro vai como dia inteiro", async () => {
    abrir(null);
    fireEvent.change(await titulo(), { target: { value: "Feriado" } });
    fireEvent.click(screen.getByRole("switch", { name: /Dia inteiro/ }));
    salvar("Criar evento");
    await waitFor(() => expect(eventos.criar).toHaveBeenCalled());
    expect(eventos.criar).toHaveBeenCalledWith(expect.objectContaining({ dia_inteiro: true, visibilidade: "privado", inicio: new Date(2026, 8, 23).toISOString(), fim: new Date(2026, 8, 24).toISOString() }));
  });

  it("sem título não envia nada; erro do servidor aparece no rodapé e o editor continua aberto", async () => {
    abrir(null);
    await titulo();
    salvar("Criar evento");
    expect(eventos.criar).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Título"), { target: { value: "X" } });
    vi.mocked(eventos.criar).mockRejectedValue(new ApiError("VALIDATION_ERROR", "x", 422, [{ campo: "fim", motivo: "deve ser depois do início" }]));
    salvar("Criar evento");
    expect((await screen.findByRole("alert")).textContent).toContain("deve ser depois do início");
    expect(onSalvo).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Título")).toBeTruthy();
  });
});

describe("editor de evento — editar", () => {
  it("abre preenchido e manda só o que mudou", async () => {
    abrir(simples());
    expect((await titulo()).value).toBe("Almoço");
    fireEvent.change(screen.getByLabelText("Título"), { target: { value: "Almoço com o time" } });
    salvar("Salvar evento");
    await waitFor(() => expect(eventos.atualizar).toHaveBeenCalledWith("e1", { titulo: "Almoço com o time" }));
  });

  it("mandar para o Google, trocar categoria e cor próprias vão juntos; a cor própria vence a categoria", async () => {
    abrir(simples());
    await titulo();
    fireEvent.click(screen.getByRole("button", { name: "Google Calendar" }));
    fireEvent.click(screen.getByRole("button", { name: "Trabalho" }));
    salvar("Salvar evento");
    await waitFor(() => expect(eventos.atualizar).toHaveBeenCalledWith("e1", { visibilidade: "google", categoria_id: "c1" }));
  });

  it("evento que já está no Google avisa que tornar privado o apaga de lá", async () => {
    abrir(simples({ visibilidade: "google", origem_google: true }));
    await titulo();
    expect(screen.getByText(/Sincronizado com o Google Calendar/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Só no Ecos" }));
    expect(screen.getByText(/apagado do Google Calendar e continua só no Ecos/)).toBeTruthy();
  });

  it("excluir pede confirmação no próprio rodapé e chama o servidor", async () => {
    abrir(simples());
    await titulo();
    fireEvent.click(screen.getByRole("button", { name: "Excluir" }));
    expect(eventos.excluir).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar exclusão" }));
    await waitFor(() => expect(eventos.excluir).toHaveBeenCalledWith("e1"));
    expect(onSalvo).toHaveBeenCalled();
  });

  it("evento de vários dias trava o horário (vem do Google) mas o resto edita", async () => {
    abrir(simples({ dia_inteiro: true, inicio: new Date(2026, 8, 22).toISOString(), fim: new Date(2026, 8, 25).toISOString() }));
    await titulo();
    expect(screen.getByText(/Evento de vários dias/)).toBeTruthy();
    expect(screen.getByRole("switch", { name: /Dia inteiro/ }).matches(":disabled")).toBe(true); // travado pelo <fieldset disabled>
    fireEvent.change(screen.getByLabelText("Título"), { target: { value: "Viagem" } });
    salvar("Salvar evento");
    await waitFor(() => expect(eventos.atualizar).toHaveBeenCalledWith("e1", { titulo: "Viagem" })); // sem inicio/fim
  });
});

describe("editor de evento — só uma ocorrência da série", () => {
  it("mostra a ocorrência com o que a exceção já mudou e esconde o que é da série", async () => {
    const excecao = { original: ORIGINAL, cancelada: false, titulo: "Só hoje", inicio: "2026-09-22T15:00:00.000Z", fim: null, local: "Sala 9", descricao: null, sync_pendente: false };
    abrir(serie({ excecoes: [excecao] }), ORIGINAL);
    expect((await titulo()).value).toBe("Só hoje");
    expect(screen.getByText("Editar esta ocorrência")).toBeTruthy();
    expect(screen.getByText("12:00–13:00")).toBeTruthy(); // 15:00Z em Brasília
    expect(screen.getByText(/Só esta ocorrência muda/)).toBeTruthy();
    expect((screen.getByDisplayValue("Sala 9") as HTMLInputElement).value).toBe("Sala 9");
    for (const rotulo of ["Cor", "Categoria", "Sincronização", "Vínculos"]) expect(screen.queryByText(rotulo), rotulo).toBeNull();
  });

  it("salvar manda só o que mudou, com a chave (o início original) — e nunca mexe na série", async () => {
    abrir(serie(), ORIGINAL);
    fireEvent.change(await titulo(), { target: { value: "Novo título" } });
    salvar("Salvar ocorrência");
    await waitFor(() => expect(eventos.atualizarOcorrencia).toHaveBeenCalledWith("s1", { original: ORIGINAL, titulo: "Novo título" }));
    expect(eventos.atualizar).not.toHaveBeenCalled();
    expect(onSalvo).toHaveBeenCalled();
  });

  it("mudar a duração manda início e fim", async () => {
    abrir(serie(), ORIGINAL);
    await titulo();
    fireEvent.click(screen.getByRole("button", { name: "1h30" }));
    salvar("Salvar ocorrência");
    await waitFor(() => expect(eventos.atualizarOcorrencia).toHaveBeenCalledWith("s1", { original: ORIGINAL, inicio: "2026-09-22T13:00:00.000Z", fim: "2026-09-22T14:30:00.000Z" }));
  });

  it("sem mudança, salvar só fecha (nada é enviado)", async () => {
    abrir(serie(), ORIGINAL);
    await titulo();
    salvar("Salvar ocorrência");
    await waitFor(() => expect(onSalvo).toHaveBeenCalled());
    expect(eventos.atualizarOcorrencia).not.toHaveBeenCalled();
  });

  it("cancelar a ocorrência pede confirmação e chama o servidor só para ela (a série continua)", async () => {
    abrir(serie(), ORIGINAL);
    await titulo();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar ocorrência" }));
    expect(eventos.cancelarOcorrencia).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar só esta ocorrência" }));
    await waitFor(() => expect(eventos.cancelarOcorrencia).toHaveBeenCalledWith("s1", ORIGINAL));
    expect(eventos.excluir).not.toHaveBeenCalled();
  });
});

describe("editor de evento — a série em si", () => {
  it("série do Google: título e local travados, sem excluir, com a regra em texto; categoria e cor continuam livres", async () => {
    abrir(serie());
    expect((await titulo()).disabled).toBe(true);
    expect((screen.getByLabelText("Local") as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText(/Esta série é gerenciada no Google Calendar/)).toBeTruthy();
    expect(screen.getByText("Toda semana às terças")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Excluir" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Trabalho" }));
    salvar("Salvar evento");
    await waitFor(() => expect(eventos.atualizar).toHaveBeenCalledWith("s1", { categoria_id: "c1" })); // só o que é do Ecos
  });

  it("série só do Ecos (sem vínculo com o Google) continua editável", async () => {
    abrir(serie({ origem_google: false, visibilidade: "privado" }));
    expect((await titulo()).disabled).toBe(false);
    expect(screen.getByRole("button", { name: "Excluir" })).toBeTruthy();
    expect(screen.getByText("Toda semana às terças")).toBeTruthy();
  });
});
