import { act, cleanup, render } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rolarAteElemento = vi.fn();
vi.mock("./sumario-editor", () => ({ rolarAteElemento: (...a: unknown[]) => rolarAteElemento(...a), rolarAteLinha: vi.fn() }));

import { pedirIr } from "@/lib/ir-para";
import { IrParaTrecho } from "./IrParaTrecho";

describe("ver onde está (leitura)", () => {
  beforeEach(() => { vi.useFakeTimers(); rolarAteElemento.mockReset(); });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  function leitura(corpo: string, itemId = "n1") {
    const raiz = createRef<HTMLDivElement>();
    const { container } = render(
      <div ref={raiz}>
        <ul><li id="a"><a href="https://exemplo.com/a">Docs</a></li><li id="b"><button data-wikilink="Reunião">Reunião</button></li></ul>
        <IrParaTrecho itemId={itemId} corpo={corpo} view={null} raiz={raiz} />
      </div>,
    );
    return container;
  }

  it("rola até o link externo pedido antes de a janela abrir e destaca o item da lista", () => {
    pedirIr("n1", { url: "https://exemplo.com/a" });
    const c = leitura("- [Docs](https://exemplo.com/a)\n- [[Reunião]]");
    act(() => { vi.advanceTimersByTime(260); });
    expect(rolarAteElemento).toHaveBeenCalledTimes(1);
    expect((rolarAteElemento.mock.calls[0]![0] as HTMLElement).getAttribute("href")).toBe("https://exemplo.com/a");
    act(() => { vi.advanceTimersByTime(600); });
    expect(c.querySelector("#a")!.classList.contains("ecos-ir-destaque")).toBe(true);
    expect(c.querySelector("#b")!.classList.contains("ecos-ir-destaque")).toBe(false);
  });

  it("janela já aberta: o pedido chega por evento e acha o wikilink (sem acento/caixa)", () => {
    const c = leitura("- [Docs](https://exemplo.com/a)\n- [[Reunião]]");
    act(() => pedirIr("n1", { wikilink: "reuniao" }));
    act(() => { vi.advanceTimersByTime(260); });
    expect((rolarAteElemento.mock.calls[0]![0] as HTMLElement).dataset.wikilink).toBe("Reunião");
    act(() => { vi.advanceTimersByTime(600); });
    expect(c.querySelector("#b")!.classList.contains("ecos-ir-destaque")).toBe(true);
  });

  it("pedido de outro item ou de trecho que não está no texto não rola nada", () => {
    pedirIr("outro", { url: "https://exemplo.com/a" });
    pedirIr("n1", { url: "https://nao-existe.com" });
    leitura("- [Docs](https://exemplo.com/a)");
    act(() => { vi.advanceTimersByTime(5000); });
    expect(rolarAteElemento).not.toHaveBeenCalled();
  });
});
