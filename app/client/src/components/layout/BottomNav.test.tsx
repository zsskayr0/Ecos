import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { BottomNav } from "./BottomNav";

describe("BottomNav", () => {
  it("é a navegação Principal, com rótulo visível e aria-current no item ativo", () => {
    render(<MemoryRouter initialEntries={["/notas"]}><BottomNav /></MemoryRouter>);
    expect(screen.getByRole("navigation", { name: "Principal" })).toBeTruthy();
    const ativo = screen.getByRole("link", { name: "Notas" });
    expect(ativo.getAttribute("aria-current")).toBe("page");
    expect(ativo.className).toContain("min-h-11");
    expect(ativo.className).toContain("min-w-11");
    expect(screen.getByRole("link", { name: "Feed" }).getAttribute("aria-current")).toBeNull();
  });
});
