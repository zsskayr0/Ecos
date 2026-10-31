import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CreateFlow, MIN_CARACTERES_CRIACAO, temConteudoMinimo, type CapturaDraft, type SetDraft } from "./CreateFlow";

const criar = vi.hoisted(() => vi.fn(async () => ({ id: "n1" })));
const atualizar = vi.hoisted(() => vi.fn(async () => ({})));
const avisar = vi.hoisted(() => vi.fn());
const fecharCaptura = vi.hoisted(() => vi.fn());
const abrirCaptura = vi.hoisted(() => vi.fn());
const notificar = vi.hoisted(() => vi.fn());
const ui = vi.hoisted(() => ({ idCaptura: 1, tipo: "nota" }));

vi.mock("@/lib/api", () => ({
  notas: { criar, atualizar }, tarefas: { criar, atualizar }, vault: {},
  ApiError: class extends Error {},
}));
vi.mock("@/lib/formas-pagamento-store", () => ({
  useFormasPagamento: () => ({ lista: [], ativas: [], porCodigo: new Map(), carregando: false, indisponivel: false, erro: null, rotulo: (c?: string | null) => c ?? "", recarregar: vi.fn() }),
}));
vi.mock("@/lib/toast", () => ({ avisar }));
vi.mock("@/lib/refresh-bus", () => ({ useRefreshBus: () => ({ notificar }) }));
vi.mock("@/lib/ui-context", () => ({
  useAppUI: () => ({ capturaAberta: ui.tipo, idCaptura: ui.idCaptura, abrirCaptura, fecharCaptura, trocarTipoCaptura: vi.fn(), espacoAtivo: "pessoal", anexosDeCaptura: [], limparAnexosDeCaptura: vi.fn() }),
}));
vi.mock("@/screens/Eventos/EventoDialog", () => ({
  EventoDialog: ({ onSalvo }: { onSalvo: () => void }) => <button onClick={onSalvo}>Salvar evento de teste</button>,
}));
vi.mock("./NoteForm", () => ({
  NoteForm: ({ draft, setDraft }: { draft: CapturaDraft; setDraft: SetDraft }) => (
    <input aria-label="titulo" value={draft.texto} onChange={(e) => setDraft((d) => ({ ...d, texto: e.target.value }))} />
  ),
}));

function digitar(texto: string) { fireEvent.change(screen.getByLabelText("titulo"), { target: { value: texto } }); }
async function passar(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }

describe("autosave da captura", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    ui.idCaptura = 1;
    ui.tipo = "nota";
    criar.mockClear(); atualizar.mockClear(); avisar.mockClear(); abrirCaptura.mockClear(); fecharCaptura.mockClear(); notificar.mockClear();
    render(<MemoryRouter><CreateFlow /></MemoryRouter>);
  });
  afterEach(() => { vi.useRealTimers(); });

  it("o mínimo de caracteres é aplicado ao título", () => {
    expect(temConteudoMinimo("R")).toBe(false);
    expect(temConteudoMinimo("  ab  ")).toBe(false);
    expect(temConteudoMinimo("a".repeat(MIN_CARACTERES_CRIACAO))).toBe(true);
  });

  it("oferece Evento no botão Criar e abre o editor existente", () => {
    cleanup();
    ui.tipo = "escolha";
    const vista = render(<MemoryRouter><CreateFlow /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Evento" }));
    expect(abrirCaptura).toHaveBeenCalledWith("evento");
    ui.tipo = "evento";
    vista.rerender(<MemoryRouter><CreateFlow /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Salvar evento de teste" }));
    expect(notificar).toHaveBeenCalledTimes(1);
    expect(fecharCaptura).toHaveBeenCalledTimes(1);
  });

  it("um caractere não cria item, nem depois de fechar", async () => {
    digitar("R");
    await passar(2000);
    fireEvent.click(screen.getByLabelText("Fechar"));
    await passar(100);
    expect(criar).not.toHaveBeenCalled();
    expect(avisar).not.toHaveBeenCalled();
    expect(fecharCaptura).toHaveBeenCalled();
  });

  it("o rascunho da captura vive só em memória: nada do que se digita vai para o localStorage", async () => {
    digitar("Mercado do João 123,45");
    await passar(300);
    const guardado = Object.keys(localStorage).map((k) => `${k}=${localStorage.getItem(k)}`).join("\n");
    expect(guardado).not.toContain("Mercado");
    expect(guardado).not.toContain("123,45");
    expect(localStorage.getItem("ecos.capture-draft.v1")).toBeNull();
  });

  it("um título cria um único item e as pausas seguintes só atualizam", async () => {
    digitar("Reunião");
    await passar(700);
    expect(criar).toHaveBeenCalledTimes(1);
    digitar("Reunião de pauta");
    await passar(700);
    expect(criar).toHaveBeenCalledTimes(1);
    expect(atualizar).toHaveBeenCalledTimes(1);
  });

  it("servidor fora do ar: o texto fica guardado neste aparelho e não é perdido", async () => {
    criar.mockRejectedValueOnce(new Error("offline"));
    digitar("Reunião importante");
    await passar(700);
    const guardado = JSON.parse(localStorage.getItem("ecos.capture-draft-falha.v1") ?? "null");
    expect(guardado.tipo).toBe("nota");
    expect(guardado.draft.texto).toBe("Reunião importante");
    expect((screen.getByLabelText("titulo") as HTMLInputElement).value).toBe("Reunião importante");
  });

  it("uma nova sessão de captura (clique rápido, sem fechar) começa vazia e cria outro item", async () => {
    cleanup();
    const vista = render(<MemoryRouter><CreateFlow /></MemoryRouter>);
    digitar("Primeira");
    await passar(700);
    expect(criar).toHaveBeenCalledTimes(1);
    ui.idCaptura = 2;
    vista.rerender(<MemoryRouter><CreateFlow /></MemoryRouter>);
    await passar(10);
    expect((screen.getByLabelText("titulo") as HTMLInputElement).value).toBe("");
    digitar("Segunda");
    await passar(700);
    expect(criar).toHaveBeenCalledTimes(2);
    expect(atualizar).not.toHaveBeenCalled();
  });

  it("fechar com conteúdo grava o que faltava e avisa onde ficou", async () => {
    digitar("Reunião");
    fireEvent.click(screen.getByLabelText("Fechar")); // antes dos 600 ms
    await passar(100);
    expect(criar).toHaveBeenCalledTimes(1);
    expect(avisar).toHaveBeenCalledWith("Salvo em Notas");
    expect(fecharCaptura).toHaveBeenCalled();
  });
});
