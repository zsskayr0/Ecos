import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const abrirDocumento = vi.fn();
vi.mock("@/lib/api", async () => {
  const real = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...real, arquivos: { ...real.arquivos, listar: vi.fn(), mover: vi.fn(), renomear: vi.fn(), excluir: vi.fn(), enviar: vi.fn() }, pastas: { ...real.pastas, listar: vi.fn(), criar: vi.fn() } };
});
vi.mock("@/lib/refresh-bus", () => ({ useRefreshBus: () => ({ versao: 0, notificar: vi.fn() }) }));
vi.mock("@/lib/use-espaco-filtro", () => ({ useEspacoFiltro: () => "pessoal" }));
vi.mock("@/lib/use-viewport", () => ({ useIsDesktop: () => true }));
vi.mock("@/lib/documento-popup", () => ({ useAbrirDocumento: () => abrirDocumento }));

import { arquivos, pastas } from "@/lib/api";
import { ArquivosScreen } from "./ArquivosScreen";

const conteudo = {
  pasta: "",
  pastas: [{ nome: "Projetos", caminho: "Projetos" }],
  arquivos: [
    { nome: "note-Plano.md", caminho: "note-Plano.md", categoria: "markdown" as const, tamanho_bytes: 300, modificado_em: null, tipo: "nota" as const, id: "N1", titulo: "Plano" },
    { nome: "Antiga.md", caminho: "Antiga.md", categoria: "markdown" as const, tamanho_bytes: 10, modificado_em: null, tipo: "nota" as const, id: "N2", titulo: "Antiga", fora_do_padrao: true },
    { nome: "lista.txt", caminho: "lista.txt", categoria: "texto" as const, tamanho_bytes: 17, modificado_em: null },
  ],
};

const linha = (caminho: string) => document.querySelector(`[role=row][data-caminho="${caminho}"]`)!;

describe("ArquivosScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    abrirDocumento.mockReset();
    vi.mocked(arquivos.listar).mockResolvedValue(conteudo);
    vi.mocked(arquivos.mover).mockResolvedValue({ movidos: [{ de: "lista.txt", para: "Projetos/lista.txt" }], falhas: [] });
    vi.mocked(arquivos.renomear).mockResolvedValue({ caminho: "novo.txt" });
    vi.mocked(arquivos.excluir).mockResolvedValue({ excluidos: ["lista.txt"], falhas: [] });
    vi.mocked(arquivos.enviar).mockResolvedValue({ caminho: "x", nome: "x" });
    vi.mocked(pastas.criar).mockResolvedValue({ ok: true, caminho: "Contratos" });
    vi.mocked(pastas.listar).mockResolvedValue({ subpastas: [{ caminho: "Projetos", nome: "Projetos", contagem_itens: 0 }], itens: [] });
  });

  it("lista pastas e arquivos, com o fora do padrão em vermelho", async () => {
    render(<MemoryRouter><ArquivosScreen /></MemoryRouter>);
    expect(await screen.findByText("note-Plano.md")).toBeTruthy();
    expect(screen.getByText("lista.txt")).toBeTruthy();
    expect(screen.getByText("Antiga.md").className).toContain("text-error");
  });

  it("duplo clique abre a nota no Ecos e o resto no visualizador", async () => {
    render(<MemoryRouter><ArquivosScreen /></MemoryRouter>);
    await screen.findByText("note-Plano.md");
    fireEvent.doubleClick(linha("note-Plano.md"));
    expect(abrirDocumento).toHaveBeenLastCalledWith("/notas/nota/N1", expect.anything());
    fireEvent.doubleClick(linha("lista.txt"));
    expect(abrirDocumento).toHaveBeenLastCalledWith("/media/ver?a=lista.txt&e=pessoal", expect.anything());
  });

  it("arrastar a seleção para uma pasta move todos os selecionados", async () => {
    render(<MemoryRouter><ArquivosScreen /></MemoryRouter>);
    await screen.findByText("note-Plano.md");
    fireEvent.click(linha("lista.txt"));
    fireEvent.click(linha("note-Plano.md"), { ctrlKey: true });
    const dados = new Map<string, string>();
    const dataTransfer = { setData: (t: string, v: string) => dados.set(t, v), getData: (t: string) => dados.get(t) ?? "", get types() { return [...dados.keys()]; }, effectAllowed: "", dropEffect: "" };
    fireEvent.dragStart(linha("note-Plano.md"), { dataTransfer });
    fireEvent.dragOver(linha("Projetos"), { dataTransfer });
    fireEvent.drop(linha("Projetos"), { dataTransfer });
    await waitFor(() => expect(arquivos.mover).toHaveBeenCalledWith({ espaco: "pessoal", itens: ["lista.txt", "note-Plano.md"], destino: "Projetos" }));
  });

  it("F2 renomeia o arquivo pelo nome e a nota pelo título", async () => {
    render(<MemoryRouter><ArquivosScreen /></MemoryRouter>);
    await screen.findByText("note-Plano.md");
    fireEvent.click(linha("lista.txt"));
    fireEvent.keyDown(linha("lista.txt"), { key: "F2" });
    const campo = await screen.findByLabelText("Nome");
    expect((campo as HTMLInputElement).value).toBe("lista.txt");
    fireEvent.change(campo, { target: { value: "compras.txt" } });
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Renomear" }));
    await waitFor(() => expect(arquivos.renomear).toHaveBeenCalledWith({ espaco: "pessoal", caminho: "lista.txt", novo_nome: "compras.txt" }));

    fireEvent.click(linha("note-Plano.md"));
    fireEvent.keyDown(linha("note-Plano.md"), { key: "F2" });
    const titulo = await screen.findByLabelText("Título");
    expect((titulo as HTMLInputElement).value).toBe("Plano");
  });

  it("Delete pede confirmação e só então manda para a Lixeira", async () => {
    render(<MemoryRouter><ArquivosScreen /></MemoryRouter>);
    await screen.findByText("note-Plano.md");
    fireEvent.click(linha("lista.txt"));
    fireEvent.click(linha("Projetos"), { ctrlKey: true });
    fireEvent.keyDown(linha("lista.txt"), { key: "Delete" });
    expect(arquivos.excluir).not.toHaveBeenCalled();
    expect(screen.getByText("Excluir 2 itens?")).toBeTruthy();
    expect(screen.getByText(/com tudo o que tem dentro/)).toBeTruthy();
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Excluir" }));
    await waitFor(() => expect(arquivos.excluir).toHaveBeenCalledWith({ espaco: "pessoal", itens: ["lista.txt", "Projetos"] }));
  });

  it("Nova pasta cria na pasta aberta e recusa nome repetido", async () => {
    render(<MemoryRouter><ArquivosScreen /></MemoryRouter>);
    await screen.findByText("note-Plano.md");
    fireEvent.click(screen.getByRole("button", { name: /Nova pasta/ }));
    const dialogo = screen.getByRole("dialog");
    fireEvent.change(within(dialogo).getByLabelText("Nome"), { target: { value: "projetos" } });
    fireEvent.click(within(dialogo).getByRole("button", { name: "Criar" }));
    expect(await within(dialogo).findByRole("alert")).toBeTruthy();
    expect(pastas.criar).not.toHaveBeenCalled();
    fireEvent.change(within(dialogo).getByLabelText("Nome"), { target: { value: "Contratos" } });
    fireEvent.click(within(dialogo).getByRole("button", { name: "Criar" }));
    await waitFor(() => expect(pastas.criar).toHaveBeenCalledWith({ nome: "Contratos", pasta_pai: undefined, espaco: "pessoal" }));
  });

  it("Enviar manda cada arquivo escolhido para a pasta aberta", async () => {
    render(<MemoryRouter><ArquivosScreen /></MemoryRouter>);
    await screen.findByText("note-Plano.md");
    const a = new File(["a"], "a.pdf"), b = new File(["b"], "b.png");
    fireEvent.change(screen.getByLabelText("Escolher arquivos para enviar"), { target: { files: [a, b] } });
    await waitFor(() => expect(arquivos.enviar).toHaveBeenCalledTimes(2));
    expect(arquivos.enviar).toHaveBeenCalledWith("pessoal", "", a);
    expect(arquivos.enviar).toHaveBeenCalledWith("pessoal", "", b);
  });

  it("soltar arquivos do computador numa pasta envia para ela", async () => {
    render(<MemoryRouter><ArquivosScreen /></MemoryRouter>);
    await screen.findByText("note-Plano.md");
    const foto = new File(["x"], "foto.jpg");
    const dataTransfer = { types: ["Files"], files: [foto], getData: () => "", dropEffect: "" };
    fireEvent.dragOver(linha("Projetos"), { dataTransfer });
    fireEvent.drop(linha("Projetos"), { dataTransfer });
    await waitFor(() => expect(arquivos.enviar).toHaveBeenCalledWith("pessoal", "Projetos", foto));
    expect(arquivos.enviar).toHaveBeenCalledTimes(1);
  });

  it("Mover para… pelo menu escolhe a pasta numa lista, sem arrastar", async () => {
    render(<MemoryRouter><ArquivosScreen /></MemoryRouter>);
    await screen.findByText("note-Plano.md");
    fireEvent.click(screen.getByRole("button", { name: "Ações de lista.txt" }));
    fireEvent.click(await screen.findByRole("menuitemradio", { name: /Mover para/ }));
    const dialogo = screen.getByRole("dialog");
    expect((within(dialogo).getByRole("button", { name: "Mover aqui" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(dialogo).getByText("Projetos"));
    fireEvent.click(within(dialogo).getByRole("button", { name: "Mover aqui" }));
    await waitFor(() => expect(arquivos.mover).toHaveBeenCalledWith({ espaco: "pessoal", itens: ["lista.txt"], destino: "Projetos" }));
  });
});

