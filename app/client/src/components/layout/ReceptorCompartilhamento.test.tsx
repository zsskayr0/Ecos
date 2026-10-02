import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

type Callback = (itens: { arquivo: File; destino: "nota" | "cofre" }[]) => void | Promise<void>;
const estado = vi.hoisted(() => ({ callback: null as null | Callback, perfil: { cofre_ativado: true } as { cofre_ativado: boolean } | null }));
const ui = vi.hoisted(() => ({ trocarTipoCaptura: vi.fn(), empilharAnexosDeCaptura: vi.fn() }));

vi.mock("@/lib/compartilhar", () => ({ useCompartilhados: (cb: Callback) => { estado.callback = cb; } }));
vi.mock("@/lib/auth-context", () => ({ useAuth: () => ({ perfil: estado.perfil }) }));
vi.mock("@/lib/ui-context", () => ({ useAppUI: () => ({ capturaAberta: null, espacoAtivo: "pessoal", ...ui }) }));
vi.mock("@/lib/api", async (importOriginal) => {
  const o = await importOriginal<typeof import("@/lib/api")>();
  return { ...o, media: { enviar: vi.fn(), referencia: vi.fn(() => "![x](src/Media/x.png)") } };
});
import { media } from "@/lib/api";
import { limparFilaDeComprovantes, quantosEsperando, tomarComprovantes } from "@/lib/fila-comprovantes";
import { ReceptorCompartilhamento } from "./ReceptorCompartilhamento";

const arq = (nome: string, tipo = "application/pdf") => new File(["x"], nome, { type: tipo });

beforeEach(() => {
  vi.clearAllMocks();
  limparFilaDeComprovantes();
  estado.perfil = { cofre_ativado: true };
});

it("\"Ecos Cofre\" enfileira o arquivo em memória e abre a aba Comprovantes do Cofre", async () => {
  const abrir = vi.fn();
  window.addEventListener("ecos:abrir-cofre", abrir as EventListener);
  render(<ReceptorCompartilhamento />);
  await act(async () => { await estado.callback!([{ arquivo: arq("pix.pdf"), destino: "cofre" }]); });
  expect(quantosEsperando()).toBe(1);
  expect(abrir).toHaveBeenCalledTimes(1);
  expect((abrir.mock.calls[0][0] as CustomEvent<string>).detail).toBe("/cofre/comprovantes");
  expect(media.enviar).not.toHaveBeenCalled();
  expect(ui.trocarTipoCaptura).not.toHaveBeenCalled();
  window.removeEventListener("ecos:abrir-cofre", abrir as EventListener);
});

it("\"Ecos\" continua anexando a imagem a uma nota e não encosta no Cofre", async () => {
  vi.mocked(media.enviar).mockResolvedValue({} as never);
  render(<ReceptorCompartilhamento />);
  await act(async () => { await estado.callback!([{ arquivo: arq("foto.png", "image/png"), destino: "nota" }]); });
  expect(media.enviar).toHaveBeenCalledOnce();
  expect(ui.trocarTipoCaptura).toHaveBeenCalledWith("nota");
  expect(ui.empilharAnexosDeCaptura).toHaveBeenCalledWith(["![x](src/Media/x.png)"]);
  expect(quantosEsperando()).toBe(0);
});

it("Cofre desativado na conta: avisa com clareza e não guarda o arquivo na fila", async () => {
  estado.perfil = { cofre_ativado: false };
  render(<ReceptorCompartilhamento />);
  await act(async () => { await estado.callback!([{ arquivo: arq("pix.pdf"), destino: "cofre" }]); });
  expect((await screen.findByRole("alert")).textContent).toContain("O Cofre não está ativado");
  expect(quantosEsperando()).toBe(0);
});

it("compartilhar para nota e Cofre ao mesmo tempo separa cada um no seu destino", async () => {
  vi.mocked(media.enviar).mockResolvedValue({} as never);
  render(<ReceptorCompartilhamento />);
  await act(async () => {
    await estado.callback!([{ arquivo: arq("a.pdf"), destino: "cofre" }, { arquivo: arq("b.png", "image/png"), destino: "nota" }]);
  });
  await waitFor(() => expect(media.enviar).toHaveBeenCalledTimes(1));
  expect(tomarComprovantes().map((f) => f.name)).toEqual(["a.pdf"]);
});
