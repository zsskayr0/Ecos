import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { EditarPerfilScreen } from "./EditarPerfilScreen";

const recarregarPerfil = vi.hoisted(() => vi.fn());
const estado = vi.hoisted(() => ({ status: "carregando" as string }));

vi.mock("@/lib/auth-context", () => ({ useAuth: () => ({ perfil: null, status: estado.status, recarregarPerfil }) }));
vi.mock("@/lib/api", () => ({ auth: {}, ApiError: class extends Error {} }));

describe("EditarPerfilScreen sem perfil", () => {
  it("mostra carregamento enquanto o perfil chega", () => {
    estado.status = "carregando";
    render(<MemoryRouter><EditarPerfilScreen /></MemoryRouter>);
    expect(screen.getByRole("status")).toBeTruthy();
  });

  it("não fica em branco quando o perfil não carregou: erro com Tentar de novo", () => {
    estado.status = "indisponivel";
    render(<MemoryRouter><EditarPerfilScreen /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(recarregarPerfil).toHaveBeenCalledTimes(1);
  });
});
