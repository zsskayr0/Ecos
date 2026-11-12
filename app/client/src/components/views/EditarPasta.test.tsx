import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pastas } from "@/lib/api";
import { RefreshProvider } from "@/lib/refresh-bus";
import { ToastHost } from "@/lib/toast";
import { EditarPasta } from "./EditarPasta";

const viewport = vi.hoisted(() => ({ desktop: true }));
vi.mock("@/lib/use-viewport", () => ({ useIsDesktop: () => viewport.desktop, useIsMobile: () => !viewport.desktop }));
vi.mock("@/lib/api", () => ({ ApiError: class extends Error {}, pastas: { renomear: vi.fn() } }));
vi.mock("@/components/common/AparenciaPasta", () => ({ default: () => <div>seletores de cor e ícone</div> }));

const pasta = { caminho: "Jogos/Minecraft", nome: "Minecraft", contagem_itens: 0, tags: ["mods"], prioridade_padrao: "alta" as const };

function montar(aoSalvar = vi.fn(), tipo: "nota" | "tarefa" = "tarefa") {
  render(<RefreshProvider><EditarPasta pasta={pasta} tipo={tipo} espaco="pessoal" aoFechar={vi.fn()} aoSalvar={aoSalvar} /><ToastHost /></RefreshProvider>);
  return aoSalvar;
}

describe("EditarPasta", () => {
  beforeEach(() => { vi.mocked(pastas.renomear).mockReset().mockResolvedValue({ ok: true }); viewport.desktop = true; });

  it("cor e ícone começam recolhidos e abrem sob demanda", async () => {
    montar();
    expect(screen.queryByText("seletores de cor e ícone")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Cor e ícone/ }));
    expect(await screen.findByText("seletores de cor e ícone")).toBeTruthy();
  });

  it("salva com o caminho novo ao renomear e manda os ajustes da pasta", async () => {
    const aoSalvar = montar();
    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Minecraft Java" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(aoSalvar).toHaveBeenCalledWith("Jogos/Minecraft Java"));
    expect(pastas.renomear).toHaveBeenCalledWith(expect.objectContaining({
      tipo: "tarefa", espaco: "pessoal", caminho_atual: "Jogos/Minecraft", novo_caminho: "Jogos/Minecraft Java", tags: ["mods"], prioridade_padrao: "alta", fixada: false,
    }));
  });

  it("recusa nome com barra e não chama o servidor", () => {
    montar();
    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "a/b" } });
    expect((screen.getByRole("button", { name: "Salvar" }) as HTMLButtonElement).disabled).toBe(true);
    expect(pastas.renomear).not.toHaveBeenCalled();
  });

  it("nota não mostra padrões de tarefa; no celular vira folha com véu", () => {
    viewport.desktop = false;
    montar(vi.fn(), "nota");
    expect(screen.queryByRole("button", { name: /Padrões das tarefas/ })).toBeNull();
    expect(screen.getByRole("dialog").getAttribute("aria-modal")).toBe("true");
  });

  it("em tela larga, cor e ícone abrem numa aba lateral (não dentro do painel) e o Esc fecha só ela", async () => {
    vi.stubGlobal("matchMedia", (consulta: string) => ({ matches: true, media: consulta, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    const aoFechar = vi.fn();
    render(<RefreshProvider><EditarPasta pasta={pasta} tipo="tarefa" espaco="pessoal" aoFechar={aoFechar} aoSalvar={vi.fn()} /></RefreshProvider>);
    fireEvent.click(screen.getByRole("button", { name: /Cor e ícone/ }));
    const aba = await screen.findByRole("complementary", { name: "Cor e ícone da pasta" });
    expect(await screen.findByText("seletores de cor e ícone")).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "Editar pasta" }).contains(aba)).toBe(false);
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("complementary")).toBeNull());
    expect(aoFechar).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("confia no servidor: fecha na hora com o pedido ainda pendente", async () => {
    vi.mocked(pastas.renomear).mockReturnValue(new Promise(() => undefined) as never);
    const aoFechar = vi.fn();
    const aoSalvar = vi.fn();
    render(<RefreshProvider><EditarPasta pasta={pasta} tipo="tarefa" espaco="pessoal" aoFechar={aoFechar} aoSalvar={aoSalvar} /></RefreshProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(aoFechar).toHaveBeenCalled());
    expect(pastas.renomear).toHaveBeenCalledTimes(1);
    expect(aoSalvar).not.toHaveBeenCalled(); // só segue para o nome novo quando o servidor confirmar
  });

  it("se o servidor recusar, avisa e oferece tentar de novo", async () => {
    vi.mocked(pastas.renomear).mockRejectedValueOnce(new Error("sem conexão")).mockResolvedValue({ ok: true });
    const aoSalvar = vi.fn();
    render(<RefreshProvider><EditarPasta pasta={pasta} tipo="tarefa" espaco="pessoal" aoFechar={vi.fn()} aoSalvar={aoSalvar} /><ToastHost /></RefreshProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Tentar de novo" }));
    await waitFor(() => expect(aoSalvar).toHaveBeenCalledWith("Jogos/Minecraft"));
    expect(pastas.renomear).toHaveBeenCalledTimes(2);
  });
});
