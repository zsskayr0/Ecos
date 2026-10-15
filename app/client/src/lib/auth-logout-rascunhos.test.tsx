import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@/lib/api", async (importOriginal) => {
  const o = await importOriginal<typeof import("@/lib/api")>();
  return { ...o, auth: { ...o.auth, perfil: vi.fn(), logout: vi.fn() } };
});
vi.mock("./offline-store", async (importOriginal) => {
  const o = await importOriginal<typeof import("./offline-store")>();
  return { ...o, prepararConteudoOffline: vi.fn().mockResolvedValue(undefined), limparDadosOffline: vi.fn().mockResolvedValue(undefined) };
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
  vi.mocked(auth.perfil).mockResolvedValue({ id: "u1", nome: "Ana", nome_usuario: "ana", cofre_ativado: false, equipes: [] } as never);
  vi.mocked(auth.logout).mockResolvedValue(undefined as never);
});

it("com rascunho não salvo, sair pergunta antes e cancelar mantém a sessão e o rascunho", async () => {
  localStorage.setItem("ecos.note-draft.v1:n1", "{}");
  const confirmar = vi.spyOn(window, "confirm").mockReturnValue(false);
  render(<AuthProvider><Sair /></AuthProvider>);
  await screen.findByText("estado:autenticado");
  fireEvent.click(screen.getByText("sair"));
  await waitFor(() => expect(confirmar).toHaveBeenCalledTimes(1));
  expect(confirmar.mock.calls[0][0]).toMatch(/1 rascunho/);
  expect(auth.logout).not.toHaveBeenCalled();
  expect(localStorage.getItem("ecos.note-draft.v1:n1")).toBe("{}");
});

it("confirmando, sai e apaga o rascunho; sem rascunho não pergunta", async () => {
  localStorage.setItem("ecos.task-draft.v1:t1", "{}");
  const confirmar = vi.spyOn(window, "confirm").mockReturnValue(true);
  render(<AuthProvider><Sair /></AuthProvider>);
  await screen.findByText("estado:autenticado");
  fireEvent.click(screen.getByText("sair"));
  await screen.findByText("estado:deslogado");
  expect(auth.logout).toHaveBeenCalledTimes(1);
  expect(localStorage.getItem("ecos.task-draft.v1:t1")).toBeNull();
  expect(confirmar).toHaveBeenCalledTimes(1);
});

it("semAviso (conta apagada) não pergunta", async () => {
  localStorage.setItem("ecos.task-draft.v1:t1", "{}");
  const confirmar = vi.spyOn(window, "confirm").mockReturnValue(false);
  render(<AuthProvider><Sair semAviso /></AuthProvider>);
  await screen.findByText("estado:autenticado");
  fireEvent.click(screen.getByText("sair"));
  await screen.findByText("estado:deslogado");
  expect(confirmar).not.toHaveBeenCalled();
});
