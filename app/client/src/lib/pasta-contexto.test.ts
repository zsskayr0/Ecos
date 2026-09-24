import { describe, expect, it } from "vitest";
import { caminhoPastaNaRota, pastaDoCaminho } from "./pasta-contexto";

describe("caminhos de pastas com várias camadas", () => {
  it("preserva todas as barras e codifica cada nome separadamente", () => {
    expect(caminhoPastaNaRota("dev/apps/Ecos móvel")).toBe("dev/apps/Ecos%20m%C3%B3vel");
  });

  it("recupera o caminho relativo completo da navegação", () => {
    expect(pastaDoCaminho("/notas/pasta/dev/apps/Ecos%20m%C3%B3vel")).toEqual({
      tipo: "nota",
      pasta: "dev/apps/Ecos móvel",
    });
    expect(pastaDoCaminho("/tarefas/pasta/clientes/acme/2026?modo=lista")).toEqual({
      tipo: "tarefa",
      pasta: "clientes/acme/2026",
    });
  });
});
