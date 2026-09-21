import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { QrConvite } from "./QrConvite";

describe("QR code de convite de equipe", () => {
  it("desenha um QR code que aponta para /entrar/<código> no servidor", async () => {
    const { container } = render(<QrConvite codigo="ABCD1234" base="http://100.64.0.5:7023/" />);
    const img = await screen.findByRole("img", { name: /http:\/\/100\.64\.0\.5:7023\/entrar\/ABCD1234/ });
    await waitFor(() => expect(container.querySelector("svg")).toBeTruthy());
    expect(img.getAttribute("aria-label")).toContain("/entrar/ABCD1234");
    expect(screen.queryByText(/só funciona neste aparelho/)).toBeNull();
  });

  it("avisa quando o Ecos foi aberto por um endereço que só existe no próprio aparelho", async () => {
    render(<QrConvite codigo="ABCD1234" base="http://localhost:7023" />);
    expect(await screen.findByText(/só funciona neste aparelho/)).toBeTruthy();
  });
});
