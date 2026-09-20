import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "./ErrorBoundary";

function Quebrado(): never {
  throw new Error("falha em http://192.168.0.9:7023/api/v1/notas/abc com o token eyJsegredo");
}

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("ErrorBoundary", () => {
  it("em produção não imprime stack nem a mensagem do erro, e a tela não a mostra", () => {
    vi.stubEnv("DEV", false);
    const registro = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<ErrorBoundary><Quebrado /></ErrorBoundary>);
    const impresso = registro.mock.calls.filter((c) => String(c[0]).startsWith("[ecos]")).flat().map(String).join(" ");
    expect(impresso).toContain("Error");
    expect(impresso).not.toMatch(/192\.168|eyJsegredo|at Quebrado|componentStack/);
    expect(screen.getByText(/Ocorreu um erro inesperado/)).toBeTruthy();
    expect(screen.queryByText(/eyJsegredo/)).toBeNull();
  });

  it("em desenvolvimento mostra a mensagem para quem está depurando", () => {
    vi.stubEnv("DEV", true);
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<ErrorBoundary><Quebrado /></ErrorBoundary>);
    expect(screen.getByText(/falha em http/)).toBeTruthy();
  });
});
