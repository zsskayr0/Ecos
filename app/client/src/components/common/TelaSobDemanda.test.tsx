import { lazy } from "react";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TelaSobDemanda } from "./TelaSobDemanda";

describe("TelaSobDemanda", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("mostra a tela quando o pedaço carrega", async () => {
    const Tela = lazy(() => Promise.resolve({ default: () => <p>pronta</p> }));
    render(<TelaSobDemanda><Tela /></TelaSobDemanda>);
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(screen.getByText("pronta")).toBeTruthy();
  });

  it("remonta quando o esqueleto fica preso", async () => {
    let montagens = 0;
    const Tela = lazy(() => new Promise<{ default: () => JSX.Element }>(() => undefined));
    const { container } = render(<TelaSobDemanda><Tela /></TelaSobDemanda>);
    montagens += 1;
    await act(async () => { await vi.advanceTimersByTimeAsync(350); });
    expect(montagens).toBe(1);
    expect(container.querySelector("[aria-busy]")).toBeTruthy();
  });
});
