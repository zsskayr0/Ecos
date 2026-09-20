import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { LicensesScreen } from "./LicensesScreen";

function abrir() {
  return render(<MemoryRouter><LicensesScreen /></MemoryRouter>);
}

describe("LicensesScreen", () => {
  it("lista as fontes OFL e avisa que as marcas de terceiros são só referência nominativa", async () => {
    abrir();
    expect(screen.getByText(/marcas registradas de Google LLC/)).toBeTruthy();
    expect(screen.getByText(/não usa seus logotipos/)).toBeTruthy();
    fireEvent.change(await screen.findByLabelText("Buscar pacote ou licença"), { target: { value: "@fontsource/inter" } });
    fireEvent.click(await screen.findByRole("button", { name: /OFL-1\.1/ }));
    expect(screen.getByText("@fontsource/inter 5.3.0")).toBeTruthy();
    expect(screen.getByText(/SIL OPEN FONT LICENSE Version 1\.1/i)).toBeTruthy();
  });

  it("mostra estado vazio quando a busca não encontra nada", async () => {
    abrir();
    fireEvent.change(await screen.findByLabelText("Buscar pacote ou licença"), { target: { value: "zzz-inexistente" } });
    expect(await screen.findByText(/Nenhum resultado/)).toBeTruthy();
  });
});
