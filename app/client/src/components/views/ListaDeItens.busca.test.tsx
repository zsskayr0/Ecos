import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api")>();
  return { ...original, pastas: { ...original.pastas, listar: vi.fn() }, equipes: { ...original.equipes, listarMinhas: vi.fn() } };
});

import { equipes, pastas } from "@/lib/api";
import { RefreshProvider } from "@/lib/refresh-bus";
import { AppUIProvider } from "@/lib/ui-context";
import type { Tarefa } from "@/lib/types";
import { ListaDeItens } from "./ListaDeItens";

const tarefa = (id: string, titulo: string, extra: Partial<Tarefa> = {}): Tarefa => ({
  tipo: "tarefa", id, titulo, status: "pendente", scheduledAt: null, durationMin: 5, dueDate: null, espaco: "pessoal", dono: { id: "u1", nome: "Diogo" },
  encaixadaNaAgenda: false, prioridade: "baixa", atualizadoEm: "2026-09-20T10:00:00Z", criadoEm: "2026-09-01T10:00:00Z", pasta: null, tags: [], ...extra,
});
const ITENS = [tarefa("1", "Relatório mensal"), tarefa("2", "Comprar pão"), tarefa("3", "Revisar relatório do projeto"), tarefa("4", "Ligar para a Ana")];

function montar(props: { chaveFiltros?: string; pesquisavel?: boolean } = {}) {
  return render(
    <MemoryRouter>
      <AppUIProvider>
        <RefreshProvider>
          <ListaDeItens chave="tarefas" tipoPastas="tarefa" modo="lista" itens={ITENS} placeholderBusca="Pesquisar em Trabalho…" {...props} />
        </RefreshProvider>
      </AppUIProvider>
    </MemoryRouter>,
  );
}
const titulosNaTela = () => ITENS.map((t) => t.titulo).filter((t) => screen.queryByText(t));
const abrirBusca = async () => {
  fireEvent.click(screen.getByRole("button", { name: "Pesquisar" }));
  const campo = (await screen.findByRole("searchbox")) as HTMLInputElement;
  await waitFor(() => expect(document.activeElement).toBe(campo));
  return campo;
};

beforeEach(() => {
  localStorage.clear();
  vi.mocked(pastas.listar).mockResolvedValue({ subpastas: [] } as never);
  vi.mocked(equipes.listarMinhas).mockResolvedValue([]);
});

describe("lupa de pesquisa na lista de tarefas", () => {
  it("só aparece onde a lista pede (nas tarefas); nas outras telas a barra fica como sempre foi", () => {
    montar({ pesquisavel: false });
    expect(screen.queryByRole("search")).toBeNull();
  });

  it("fica ao lado de 'Ordenar' e filtra a lista enquanto se digita, dizendo quantos sobraram", async () => {
    montar({ pesquisavel: true });
    const ordenar = screen.getByRole("button", { name: /Ordenar/ });
    const lupa = screen.getByRole("search");
    expect(ordenar.compareDocumentPosition(lupa) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy(); // logo depois de "Ordenar"

    const campo = await abrirBusca();
    expect(campo.placeholder).toBe("Pesquisar em Trabalho…");
    fireEvent.change(campo, { target: { value: "relatorio" } }); // sem acento acha "Relatório"
    await waitFor(() => expect(titulosNaTela()).toEqual(["Relatório mensal", "Revisar relatório do projeto"]));
    expect(screen.getByText("2 de 4")).toBeTruthy();
  });

  it("sem resultado avisa o que foi procurado; apagar o texto devolve tudo", async () => {
    montar({ pesquisavel: true });
    const campo = await abrirBusca();
    fireEvent.change(campo, { target: { value: "zzz" } });
    expect(await screen.findByText("Nada encontrado para “zzz”.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Limpar pesquisa" }));
    await waitFor(() => expect(titulosNaTela()).toHaveLength(4));
    expect(screen.queryByText(/Nada encontrado/)).toBeNull();
  });

  it("o 'Limpar' da barra de filtros também apaga a pesquisa", async () => {
    montar({ pesquisavel: true });
    fireEvent.change(await abrirBusca(), { target: { value: "pao" } });
    await waitFor(() => expect(titulosNaTela()).toEqual(["Comprar pão"]));
    fireEvent.click(screen.getByRole("button", { name: /^Limpar$/ }));
    await waitFor(() => expect(titulosNaTela()).toHaveLength(4));
    expect(screen.getByRole("search").getAttribute("data-aberta")).toBe("false");
  });

  it("vale só para esta configuração: cada pasta guarda a sua pesquisa, e outra pasta não a herda", async () => {
    const a = montar({ pesquisavel: true, chaveFiltros: "tarefas:Trabalho" });
    fireEvent.change(await abrirBusca(), { target: { value: "pao" } });
    await waitFor(() => expect(titulosNaTela()).toEqual(["Comprar pão"]));
    a.unmount();

    // Outra pasta: sem pesquisa, lista inteira, barra recolhida.
    const b = montar({ pesquisavel: true, chaveFiltros: "tarefas:Casa" });
    await waitFor(() => expect(titulosNaTela()).toHaveLength(4));
    expect(screen.getByRole("search").getAttribute("data-aberta")).toBe("false");
    b.unmount();

    // De volta à primeira: a pesquisa dela continua lá, com a barra já aberta.
    montar({ pesquisavel: true, chaveFiltros: "tarefas:Trabalho" });
    await waitFor(() => expect(titulosNaTela()).toEqual(["Comprar pão"]));
    expect(screen.getByRole("search").getAttribute("data-aberta")).toBe("true");
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("pao");
  });
});
