import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@/lib/api", async (importOriginal) => {
  const o = await importOriginal<typeof import("@/lib/api")>();
  return { ...o, auth: { ...o.auth, perfil: vi.fn(), logout: vi.fn() } };
});
const pendentes = vi.hoisted(() => vi.fn());
vi.mock("./offline-store", async (importOriginal) => {
  const o = await importOriginal<typeof import("./offline-store")>();
  return { ...o, prepararConteudoOffline: vi.fn().mockResolvedValue(undefined), limparDadosOffline: vi.fn().mockResolvedValue(undefined), listarMutacoesPendentes: pendentes };
});
import { auth } from "@/lib/api";
import { AuthProvider, useAuth } from "./auth-context";

function Sair({ semAviso }: { semAviso?: boolean }) {
  const { logout, status } = useAuth();
  return <><span>estado:{status}</span><button onClick={() => void logout(semAviso ? { semAviso: true } : undefined)}>sair</button></>;
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  pendentes.mockResolvedValue([]);
  vi.mocked(auth.perfil).mockResolvedValue({ id: "u1", nome: "Ana", nome_usuario: "ana", cofre_ativado: false, equipes: [] } as never);
  vi.mocked(auth.logout).mockResolvedValue(undefined as never);
});

it("com rascunho não salvo, sair mostra o diálogo e 'Continuar na conta' mantém a sessão e o rascunho", async () => {
  localStorage.setItem("ecos.note-draft.v1:n1", "{}");
  render(<AuthProvider><Sair /></AuthProvider>);
  await screen.findByText("estado:autenticado");
  fireEvent.click(screen.getByText("sair"));
  const dialogo = await screen.findByRole("dialog", { name: "Você tem alterações não enviadas" });
  expect(dialogo.textContent).toMatch(/1 rascunho/);
  fireEvent.click(screen.getByRole("button", { name: "Continuar na conta" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(auth.logout).not.toHaveBeenCalled();
  expect(localStorage.getItem("ecos.note-draft.v1:n1")).toBe("{}");
});

it("Esc cancela a saída", async () => {
  localStorage.setItem("ecos.note-draft.v1:n1", "{}");
  render(<AuthProvider><Sair /></AuthProvider>);
  await screen.findByText("estado:autenticado");
  fireEvent.click(screen.getByText("sair"));
  await screen.findByRole("dialog");
  fireEvent.keyDown(document, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(auth.logout).not.toHaveBeenCalled();
});

it("confirmando, sai e apaga o rascunho; sem rascunho nem pendência não pergunta", async () => {
  localStorage.setItem("ecos.task-draft.v1:t1", "{}");
  render(<AuthProvider><Sair /></AuthProvider>);
  await screen.findByText("estado:autenticado");
  fireEvent.click(screen.getByText("sair"));
  fireEvent.click(await screen.findByRole("button", { name: "Sair mesmo assim" }));
  await screen.findByText("estado:deslogado");
  expect(auth.logout).toHaveBeenCalledTimes(1);
  expect(localStorage.getItem("ecos.task-draft.v1:t1")).toBeNull();
});

it("alterações pendentes de envio também pedem confirmação", async () => {
  pendentes.mockResolvedValue([{ id: "m1" }, { id: "m2" }]);
  render(<AuthProvider><Sair /></AuthProvider>);
  await screen.findByText("estado:autenticado");
  fireEvent.click(screen.getByText("sair"));
  const dialogo = await screen.findByRole("dialog");
  expect(dialogo.textContent).toMatch(/2 alterações ainda não enviadas/);
});

it("sem pendências o logout é direto", async () => {
  render(<AuthProvider><Sair /></AuthProvider>);
  await screen.findByText("estado:autenticado");
  fireEvent.click(screen.getByText("sair"));
  await screen.findByText("estado:deslogado");
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("semAviso (conta apagada) não pergunta", async () => {
  localStorage.setItem("ecos.task-draft.v1:t1", "{}");
  render(<AuthProvider><Sair semAviso /></AuthProvider>);
  await screen.findByText("estado:autenticado");
  fireEvent.click(screen.getByText("sair"));
  await screen.findByText("estado:deslogado");
  expect(screen.queryByRole("dialog")).toBeNull();
});
