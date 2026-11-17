import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Folder } from "lucide-react";
import { beforeEach, describe, expect, it } from "vitest";
import { lerPreferenciasAplicativo } from "@/lib/preferencias-aplicativo";
import { NotificacoesPreferenciasScreen } from "./NotificacoesPreferenciasScreen";
import { EditorConfigScreen } from "./EditorConfigScreen";
import { buscarConfiguracoes } from "./indice-busca";

beforeEach(() => {
  localStorage.clear();
  // O jsdom não traz matchMedia; `useIsDesktop` precisa dele. Aqui a tela é vista como desktop.
  window.matchMedia = ((consulta: string) => ({ matches: true, media: consulta, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, onchange: null, dispatchEvent: () => false })) as typeof window.matchMedia;
});

describe("telas de configuração", () => {
  it("Editor e escrita: trocar o que o Enter cria grava a preferência", () => {
    render(<MemoryRouter><EditorConfigScreen /></MemoryRouter>);
    expect(screen.getByRole("heading", { name: "Editor e escrita" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Tarefa" }));
    expect(lerPreferenciasAplicativo().capturaEnter).toBe("tarefa");
  });

  it("Notificações: ligar o resumo e o silêncio habilita e grava os horários", () => {
    render(<MemoryRouter><NotificacoesPreferenciasScreen /></MemoryRouter>);
    const hora = screen.getByLabelText("Horário do resumo") as HTMLButtonElement;
    expect(hora.disabled).toBe(true);
    fireEvent.click(screen.getByRole("switch", { name: "Resumo do dia" }));
    expect(hora.disabled).toBe(false);
    // O horário usa o seletor do Ecos (duas colunas): abre e escolhe hora e minuto.
    fireEvent.click(hora);
    fireEvent.click(screen.getByLabelText("Hora 07"));
    fireEvent.click(screen.getByLabelText("Minuto 30"));
    fireEvent.click(screen.getByRole("switch", { name: "Horário silencioso" }));
    const p = lerPreferenciasAplicativo();
    expect(p).toMatchObject({ resumoDiario: true, resumoHora: "07:30", silencioAtivo: true });
  });
});

describe("busca das configurações", () => {
  const grupos = [
    { titulo: "Aplicativo", abas: [{ para: "/configuracoes/aparencia", rotulo: "Aparência", Icone: Folder }, { para: "/configuracoes/idioma-regiao", rotulo: "Idioma e região", Icone: Folder }] },
    { titulo: "Tarefas e notas", abas: [{ para: "/configuracoes/editor", rotulo: "Editor e escrita", Icone: Folder }] },
  ];

  it("acha a opção sem acento e leva até a âncora dela", () => {
    const [primeiro] = buscarConfiguracoes("verificacao ortografica", grupos);
    expect(primeiro).toMatchObject({ titulo: "Verificação ortográfica", destino: "/configuracoes/editor#verificacao-ortografica", onde: "Tarefas e notas › Editor e escrita" });
  });

  it("acha por palavra de apoio e pelo nome da aba", () => {
    expect(buscarConfiguracoes("gpu", grupos)[0]?.titulo).toBe("Aceleração de hardware");
    expect(buscarConfiguracoes("aparencia", grupos)[0]).toMatchObject({ titulo: "Aparência", destino: "/configuracoes/aparencia" });
  });

  it("não mostra opções de abas que a pessoa não enxerga, nem nada para busca vazia", () => {
    expect(buscarConfiguracoes("resetar cofre", grupos)).toEqual([]);
    expect(buscarConfiguracoes("   ", grupos)).toEqual([]);
  });
});
