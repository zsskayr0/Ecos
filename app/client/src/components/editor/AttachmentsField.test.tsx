import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...original,
    media: { ...original.media, enviar: vi.fn().mockResolvedValue({ caminho: "src/Media/2026-10/a.pdf", nome: "a.pdf", mime: "application/pdf" }), referencia: () => "[a.pdf](src/Media/2026-10/a.pdf)" },
  };
});

import { media } from "@/lib/api";
import { AttachmentsField } from "./AttachmentsField";

afterEach(() => vi.clearAllMocks());

function soltar(alvo: Element, arquivos: File[]) {
  const dataTransfer = { types: ["Files"], files: arquivos, dropEffect: "none" };
  fireEvent.dragEnter(alvo, { dataTransfer });
  fireEvent.dragOver(alvo, { dataTransfer });
  return fireEvent.drop(alvo, { dataTransfer });
}

describe("AttachmentsField — arrastar e soltar", () => {
  it("anexa o arquivo solto em qualquer ponto do formulário e põe a referência no corpo", async () => {
    const onCorpoChange = vi.fn();
    render(<form data-testid="form"><AttachmentsField tipo="tarefa" corpo="" onCorpoChange={onCorpoChange} /></form>);
    const arquivo = new File(["conteudo"], "a.pdf", { type: "application/pdf" });
    const naoCancelado = soltar(screen.getByTestId("form"), [arquivo]);
    expect(naoCancelado).toBe(false); // preventDefault: o navegador não abre o arquivo
    await waitFor(() => expect(media.enviar).toHaveBeenCalledWith(arquivo, undefined));
    await waitFor(() => expect(onCorpoChange).toHaveBeenCalledWith("[a.pdf](src/Media/2026-10/a.pdf)"));
  });

  it("não anexa quando o campo está desabilitado", () => {
    render(<form data-testid="form"><AttachmentsField tipo="nota" corpo="" onCorpoChange={() => undefined} disabled /></form>);
    soltar(screen.getByTestId("form"), [new File(["x"], "b.pdf")]);
    expect(media.enviar).not.toHaveBeenCalled();
  });
});

describe("AttachmentsField — vários arquivos pelo botão", () => {
  it("o seletor aceita vários arquivos e envia cada um", async () => {
    const { container } = render(<AttachmentsField tipo="nota" corpo="" onCorpoChange={() => undefined} />);
    const entrada = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    expect(entrada.multiple).toBe(true);
    const arquivos = [new File(["1"], "um.pdf"), new File(["2"], "dois.pdf"), new File(["3"], "tres.pdf")];
    fireEvent.change(entrada, { target: { files: arquivos } });
    await waitFor(() => expect(media.enviar).toHaveBeenCalledTimes(3));
    expect(vi.mocked(media.enviar).mock.calls.map((c) => (c[0] as File).name)).toEqual(["um.pdf", "dois.pdf", "tres.pdf"]);
  });
});
