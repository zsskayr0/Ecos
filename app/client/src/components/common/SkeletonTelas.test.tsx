import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const viewport = vi.hoisted(() => ({ desktop: true }));
vi.mock("@/lib/use-viewport", () => ({ useIsDesktop: () => viewport.desktop, useIsMobile: () => !viewport.desktop }));
vi.mock("@/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api")>();
  return { ...original, pastas: { ...original.pastas, listar: vi.fn().mockResolvedValue({ subpastas: [] }) } };
});
vi.mock("@/lib/use-catalogo-tags", () => ({ useCatalogoTags: () => ({ tags: [] }) }));
vi.mock("@/components/editor/EquipeSelector", () => ({ EquipeSelector: () => <div /> }));
vi.mock("@/components/editor/AttachmentsField", () => ({ AttachmentsField: () => <div data-testid="anexos" /> }));
vi.mock("@/components/editor/CorpoEditor", () => ({ CorpoEditor: () => <div data-testid="corpo" /> }));

import { EMPTY_TASK } from "@/lib/task-fields";
import { TaskComposer } from "@/components/editor/TaskComposer";
import {
  SkeletonAgendaLista, SkeletonBackups, SkeletonBusca, SkeletonEditarPerfil, SkeletonEquipePerfil, SkeletonEquipes,
  SkeletonEventoDialog, SkeletonEventos, SkeletonFeed, SkeletonHoje, SkeletonItens, SkeletonLicencas, SkeletonLixeira,
  SkeletonMetricasPerfil, SkeletonMidia, SkeletonNotaDetalhe, SkeletonNotificacoes, SkeletonOrganizacao, SkeletonPastas,
  SkeletonPerfilTela, SkeletonRotina, SkeletonSincronizacao, SkeletonTarefaDetalhe,
} from "./SkeletonTelas";

beforeEach(() => { viewport.desktop = true; });
afterEach(() => cleanup());

/** Nomes dos blocos principais, na ordem do DOM (skeleton desenhado na hora: atrasoMs=0). */
function blocos(ui: React.ReactElement): string[] {
  const { container } = render(ui);
  return [...container.querySelectorAll("[data-bloco]")].map((e) => e.getAttribute("data-bloco")!);
}
const contar = (lista: string[], nome: string) => lista.filter((n) => n === nome).length;
const unicos = (lista: string[]) => lista.filter((n, i) => lista[i - 1] !== n);

describe("forma: detalhe da tarefa", () => {
  it("desktop tem os mesmos blocos, na mesma ordem, do TaskComposer real", () => {
    const sk = blocos(<SkeletonTarefaDetalhe desktop atrasoMs={0} />);
    expect(unicos(sk)).toEqual(["titulo", "prioridade", "anexos", "descricao", "editor", "subtarefas", "planejamento", "tempo", "organizacao", "rodape"]);

    const { container } = render(<TaskComposer value={EMPTY_TASK} onChange={() => undefined} onSave={() => undefined} editing timePanel={<p>tempo</p>} showPriority={false} />);
    // Real: 1 título, 1 anexos, 1 descrição, Subtarefas na coluna principal, 3 seções no painel lateral (Planejamento, Tempo, Organização), 1 rodapé.
    expect(container.querySelectorAll("[data-task-composer] input[aria-label='Título da tarefa'], [data-task-composer] textarea[aria-label='Título da tarefa']").length).toBe(contar(sk, "titulo"));
    expect(container.querySelectorAll("[data-testid='anexos']").length).toBe(contar(sk, "anexos"));
    expect(container.querySelectorAll("section[aria-label='Descrição']").length).toBe(contar(sk, "descricao"));
    expect(container.querySelectorAll("aside section").length).toBe(["planejamento", "tempo", "organizacao"].reduce((n, b) => n + contar(sk, b), 0));
    expect(container.querySelectorAll("section[aria-label='Subtarefas']").length).toBe(contar(sk, "subtarefas"));
    expect(container.querySelectorAll("footer").length).toBe(contar(sk, "rodape"));
  });

  it("celular: status, título, prioridade, anexos, descrição, Mais detalhes e rodapé (sem painel lateral aberto)", () => {
    const sk = blocos(<SkeletonTarefaDetalhe desktop={false} atrasoMs={0} />);
    expect(unicos(sk)).toEqual(["cabecalho-status", "titulo", "prioridade", "anexos", "descricao", "editor", "mais-detalhes", "rodape"]);
    viewport.desktop = false;
    const { container } = render(<TaskComposer value={EMPTY_TASK} onChange={() => undefined} onSave={() => undefined} editing showPriority />);
    expect(container.querySelectorAll("aside.hidden").length).toBe(1); // painel recolhido: o skeleton mostra só o botão "Mais detalhes"
    expect(container.querySelectorAll("button[aria-controls]").length).toBe(contar(sk, "mais-detalhes"));
  });
});

describe("forma: nota", () => {
  it("detalhe da nota: título, organização, equipe, anexos, editor e rodapé", () => {
    expect(unicos(blocos(<SkeletonNotaDetalhe atrasoMs={0} />))).toEqual(["titulo", "organizacao", "equipe", "anexos", "editor", "rodape"]);
  });
});

describe("forma: listas de notas e tarefas", () => {
  it("tarefas no desktop viram tabela com cabeçalho e linhas (não cartões)", () => {
    const sk = blocos(<SkeletonItens modo="cards" tipo="tarefa" semFeedNoDesktop atrasoMs={0} itens={3} />);
    expect(sk[0]).toBe("barra-filtros");
    expect(sk[1]).toBe("tabela-cabecalho");
    expect(contar(sk, "tabela-linha")).toBe(5);
    expect(contar(sk, "cartao-tarefa")).toBe(0);
  });

  it("colunas da tabela de tarefas = colunas reais (Nome, Status, Prioridade, Prazo, Duração, Pasta, Tags, Editada)", () => {
    const { container } = render(<SkeletonItens modo="tabela" tipo="tarefa" atrasoMs={0} />);
    expect(container.querySelector("[data-bloco='tabela-cabecalho']")!.children.length).toBe(8);
  });

  it("no celular as tarefas são cartões; a lista compacta usa linhas", () => {
    viewport.desktop = false;
    expect(contar(blocos(<SkeletonItens modo="cards" tipo="tarefa" semFeedNoDesktop atrasoMs={0} itens={3} />), "cartao-tarefa")).toBe(3);
    cleanup();
    expect(contar(blocos(<SkeletonItens modo="lista" tipo="nota" atrasoMs={0} itens={2} />), "linha-nota")).toBe(4);
  });

  it("notas no desktop em cartões; Feed mistura nota e tarefa e não tem barra de filtros", () => {
    const notas = blocos(<SkeletonItens modo="cards" tipo="nota" atrasoMs={0} itens={3} />);
    expect(notas[0]).toBe("barra-filtros");
    expect(contar(notas, "cartao-nota")).toBe(3);
    cleanup();
    const feed = blocos(<SkeletonFeed atrasoMs={0} itens={4} />);
    expect(feed).not.toContain("barra-filtros");
    expect(feed).toEqual(["grupo-data", "cartao-tarefa", "cartao-nota", "cartao-tarefa", "cartao-nota"]);
  });
});

describe("forma: demais telas", () => {
  const casos: [string, React.ReactElement, string[]][] = [
    ["Hoje", <SkeletonHoje atrasoMs={0} />, ["grupo", "item-dia", "item-dia", "grupo", "item-dia", "item-dia", "item-dia"]],
    ["Agenda (lista do dia)", <SkeletonAgendaLista atrasoMs={0} itens={2} />, ["cartao-agenda", "cartao-agenda"]],
    ["Eventos", <SkeletonEventos atrasoMs={0} />, ["grupo", "evento", "evento", "grupo", "evento"]],
    ["Notificações", <SkeletonNotificacoes atrasoMs={0} />, ["grupo", "aviso", "aviso", "grupo", "aviso", "aviso"]],
    ["Busca", <SkeletonBusca atrasoMs={0} />, ["grupo", "resultado", "resultado", "resultado", "grupo", "resultado", "resultado"]],
    ["Lixeira", <SkeletonLixeira atrasoMs={0} itens={2} />, ["item-lixeira", "item-lixeira"]],
    ["Mídia", <SkeletonMidia atrasoMs={0} itens={2} />, ["item-midia", "item-midia"]],
    ["Equipes", <SkeletonEquipes atrasoMs={0} itens={2} />, ["linha-equipe", "linha-equipe"]],
    ["Perfil da equipe", <SkeletonEquipePerfil atrasoMs={0} membros={2} />, ["cabecalho", "tipo", "estatisticas", "acoes", "grupo", "membro", "membro"]],
    ["Perfil (tela)", <SkeletonPerfilTela atrasoMs={0} />, ["voltar", "cabecalho", "editar-perfil", "titulo-espaco", "metrica", "metrica", "metrica", "metrica", "metrica-largura"]],
    ["Perfil (métricas)", <SkeletonMetricasPerfil atrasoMs={0} />, ["metrica", "metrica", "metrica", "metrica", "metrica-largura"]],
    ["Editar perfil", <SkeletonEditarPerfil atrasoMs={0} />, ["titulo", "cartao-usuario", "cartao-senha"]],
    ["Rotina", <SkeletonRotina atrasoMs={0} />, ["voltar", "titulo", "resumo", ...Array(6).fill("cartao-rotina"), "salvar"]],
    ["Diálogo de evento", <SkeletonEventoDialog atrasoMs={0} />, ["cabecalho", ...Array(6).fill("secao"), "rodape"]],
    ["Sincronização", <SkeletonSincronizacao atrasoMs={0} />, ["estado", "modos"]],
    ["Cópias de segurança", <SkeletonBackups atrasoMs={0} itens={2} />, ["frequencia", "copia", "copia"]],
    ["Organização", <SkeletonOrganizacao atrasoMs={0} itens={2} />, ["trilha", "pasta", "pasta"]],
    ["Pastas", <SkeletonPastas atrasoMs={0} />, ["secao", "secao", "secao"]],
    ["Licenças", <SkeletonLicencas atrasoMs={0} itens={2} />, ["grupo-licenca", "grupo-licenca"]],
  ];
  it.each(casos)("%s: mesma sequência de blocos da tela real", (_nome, ui, esperado) => {
    expect(blocos(ui)).toEqual(esperado);
  });

  it("todo skeleton continua sendo região de carregamento (role=status, aria-busy)", () => {
    for (const [, ui] of casos) {
      const { container, unmount } = render(ui);
      const regiao = container.querySelector("[role='status'][aria-busy='true']");
      expect(regiao).not.toBeNull();
      expect(regiao!.querySelector(".sr-only")).not.toBeNull();
      unmount();
    }
  });
});
