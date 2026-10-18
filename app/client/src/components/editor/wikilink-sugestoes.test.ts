import { describe, expect, it } from "vitest";
import { sugerir, tituloExiste, type NotaSugestao } from "./wikilink-sugestoes";

const nota = (id: string, titulo: string, atualizado_em = "2026-01-01", extra: Partial<NotaSugestao> = {}): NotaSugestao => ({ id, titulo, pasta: null, tags: [], atualizado_em, ...extra });
const NOTAS = [nota("1", "Projeto X", "2026-01-03"), nota("2", "Ideias Soltas", "2026-01-05"), nota("3", "Reunião de Projeto", "2026-01-04"), nota("4", "Açaí do João", "2026-01-01", { tags: ["receita"] })];

describe("sugerir", () => {
  it("sem consulta lista as mais recentes primeiro", () => {
    expect(sugerir("", NOTAS).map((n) => n.id)).toEqual(["2", "3", "1", "4"]);
  });
  it("prefixo vence palavra no meio", () => {
    expect(sugerir("proj", NOTAS).map((n) => n.id)).toEqual(["1", "3"]);
  });
  it("ignora acento e caixa", () => {
    expect(sugerir("ACAI", NOTAS).map((n) => n.id)).toEqual(["4"]);
    expect(sugerir("reuniao", NOTAS).map((n) => n.id)).toEqual(["3"]);
  });
  it("aceita letras espalhadas", () => {
    expect(sugerir("pjx", NOTAS).map((n) => n.id)).toEqual(["1"]);
  });
  it("acha pela tag e não sugere a própria nota", () => {
    expect(sugerir("receita", NOTAS).map((n) => n.id)).toEqual(["4"]);
    expect(sugerir("proj", NOTAS, "1").map((n) => n.id)).toEqual(["3"]);
  });
  it("detecta título já existente", () => {
    expect(tituloExiste("projeto x", NOTAS)).toBe(true);
    expect(tituloExiste("Projeto", NOTAS)).toBe(false);
  });
});
