import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CreateFlow, MIN_CARACTERES_CRIACAO, temConteudoMinimo, type CapturaDraft, type SetDraft } from "./CreateFlow";

const criar = vi.hoisted(() => vi.fn(async () => ({ id: "n1" })));
const atualizar = vi.hoisted(() => vi.fn(async () => ({})));
const avisar = vi.hoisted(() => vi.fn());
const fecharCaptura = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api", () => ({
  notas: { criar, atualizar }, tarefas: { criar, atualizar }, vault: {},
  ApiError: class extends Error {},
}));
vi.mock("@/lib/formas-pagamento-store", () => ({
  useFormasPagamento: () => ({ lista: [], ativas: [], porCodigo: new Map(), carregando: false, indisponivel: false, erro: null, rotulo: (c?: string | null) => c ?? "", recarregar: vi.fn() }),
}));
vi.mock("@/lib/toast", () => ({ avisar }));
vi.mock("@/lib/refresh-bus", () => ({ useRefreshBus: () => ({ notificar: vi.fn() }) }));
vi.mock("@/lib/ui-context", () => ({
  useAppUI: () => ({ capturaAberta: "nota", fecharCaptura, trocarTipoCaptura: vi.fn(), espacoAtivo: "pessoal", anexosDeCaptura: [], limparAnexosDeCaptura: vi.fn() }),
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
    criar.mockClear(); atualizar.mockClear(); avisar.mockClear(); fecharCaptura.mockClear();
    render(<MemoryRouter><CreateFlow /></MemoryRouter>);
  });
  afterEach(() => { vi.useRealTimers(); });

  it("o mínimo de caracteres é aplicado ao título", () => {
    expect(temConteudoMinimo("R")).toBe(false);
    expect(temConteudoMinimo("  ab  ")).toBe(false);
    expect(temConteudoMinimo("a".repeat(MIN_CARACTERES_CRIACAO))).toBe(true);
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

  it("um título cria um único item e as pausas seguintes só atualizam", async () => {
    digitar("Reunião");
    await passar(700);
    expect(criar).toHaveBeenCalledTimes(1);
    digitar("Reunião de pauta");
    await passar(700);
    expect(criar).toHaveBeenCalledTimes(1);
    expect(atualizar).toHaveBeenCalledTimes(1);
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
