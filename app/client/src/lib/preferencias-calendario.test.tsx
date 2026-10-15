import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { obter, atualizar } = vi.hoisted(() => ({ obter: vi.fn(), atualizar: vi.fn() }));
vi.mock("./api", () => ({ preferenciasCalendarioApi: { obter, atualizar } }));

import {
  CHAVE_PREFERENCIAS_CALENDARIO, PREFERENCIAS_PADRAO, lerPreferenciasCalendario, minutosDoInicio, salvarPreferenciasCalendario, usePreferenciasCalendario,
  salvarPreferenciasCalendarioNoServidor, sincronizarPreferenciasCalendario,
} from "./preferencias-calendario";

beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); });

describe("minutosDoInicio", () => {
  it.each([["06:00", 360], ["00:00", 0], ["23:55", 1435], ["9:30", 570], ["12:05", 725]])("%s = %i min", (texto, minutos) => {
    expect(minutosDoInicio(texto)).toBe(minutos);
  });
  it.each([[""], ["abc"], ["24:00"], ["12:60"], ["7"], [null], [undefined]])("valor inválido (%s) cai no padrão 06:00, nunca em NaN", (v) => {
    expect(minutosDoInicio(v as string)).toBe(360);
  });
});

describe("leitura e gravação", () => {
  it("sem nada salvo, vale o padrão (início 06:00, prazos ligados)", () => {
    expect(lerPreferenciasCalendario()).toEqual(PREFERENCIAS_PADRAO);
    expect(PREFERENCIAS_PADRAO).toMatchObject({ inicio: "06:00", deadlines: true });
  });
  it("lê o formato que a tela de Configurações grava", () => {
    localStorage.setItem(CHAVE_PREFERENCIAS_CALENDARIO, JSON.stringify({ pais: "Portugal", fuso: "Europe/Lisbon", inicio: "08:30", deadlines: false }));
    expect(lerPreferenciasCalendario()).toEqual({ pais: "Portugal", fuso: "Europe/Lisbon", inicio: "08:30", deadlines: false });
  });
  it("texto quebrado ou tipos errados não derrubam: voltam ao padrão campo a campo", () => {
    localStorage.setItem(CHAVE_PREFERENCIAS_CALENDARIO, "{isso não é json");
    expect(lerPreferenciasCalendario()).toEqual(PREFERENCIAS_PADRAO);
    localStorage.setItem(CHAVE_PREFERENCIAS_CALENDARIO, JSON.stringify({ inicio: 7, deadlines: "sim", pais: 3 }));
    expect(lerPreferenciasCalendario()).toEqual(PREFERENCIAS_PADRAO);
  });
  it("salvar mescla com o que já existia", () => {
    salvarPreferenciasCalendario({ inicio: "07:15" });
    salvarPreferenciasCalendario({ deadlines: false });
    expect(lerPreferenciasCalendario()).toMatchObject({ inicio: "07:15", deadlines: false, pais: "Brasil" });
  });
});

describe("gancho reativo (a Agenda muda sem recarregar)", () => {
  it("devolve o início em minutos e o estado dos prazos", () => {
    salvarPreferenciasCalendario({ inicio: "08:00", deadlines: false });
    const { result } = renderHook(() => usePreferenciasCalendario());
    expect(result.current.inicioMin).toBe(480);
    expect(result.current.mostrarPrazos).toBe(false);
  });

  it("reage na hora quando a tela de Configurações salva", () => {
    const { result } = renderHook(() => usePreferenciasCalendario());
    expect(result.current).toMatchObject({ inicioMin: 360, mostrarPrazos: true });
    act(() => salvarPreferenciasCalendario({ inicio: "09:45", deadlines: false }));
    expect(result.current).toMatchObject({ inicioMin: 585, mostrarPrazos: false });
    act(() => salvarPreferenciasCalendario({ deadlines: true }));
    expect(result.current).toMatchObject({ inicioMin: 585, mostrarPrazos: true });
  });

  it("reage também a uma mudança vinda de outra janela (evento storage)", () => {
    const { result } = renderHook(() => usePreferenciasCalendario());
    act(() => {
      localStorage.setItem(CHAVE_PREFERENCIAS_CALENDARIO, JSON.stringify({ inicio: "10:00", deadlines: false }));
      window.dispatchEvent(new StorageEvent("storage", { key: CHAVE_PREFERENCIAS_CALENDARIO }));
    });
    expect(result.current).toMatchObject({ inicioMin: 600, mostrarPrazos: false });
  });

  it("ignora mudança em outra chave do storage", () => {
    const { result } = renderHook(() => usePreferenciasCalendario());
    const antes = result.current.preferencias;
    act(() => { window.dispatchEvent(new StorageEvent("storage", { key: "outra-coisa" })); });
    expect(result.current.preferencias).toBe(antes);
  });

  it("o valor é estável entre renderizações enquanto nada muda (não causa re-render em laço)", () => {
    const { result, rerender } = renderHook(() => usePreferenciasCalendario());
    const primeiro = result.current.preferencias;
    rerender();
    expect(result.current.preferencias).toBe(primeiro);
  });

  it("vários ouvintes recebem a mesma mudança", () => {
    const a = renderHook(() => usePreferenciasCalendario());
    const b = renderHook(() => usePreferenciasCalendario());
    act(() => salvarPreferenciasCalendario({ inicio: "05:30" }));
    expect(a.result.current.inicioMin).toBe(330);
    expect(b.result.current.inicioMin).toBe(330);
  });

  it("depois de desmontar, deixa de ouvir (sem vazamento)", () => {
    const { result, unmount } = renderHook(() => usePreferenciasCalendario());
    unmount();
    expect(() => act(() => salvarPreferenciasCalendario({ inicio: "11:00" }))).not.toThrow();
    expect(result.current.inicioMin).toBe(360);
  });
});

describe("sincronização com o servidor", () => {
  const remoto = (p: object) => ({ pais: "Portugal", fuso: "Europe/Lisbon", inicio: "08:30", deadlines: false, definido: true, ...p });

  it("o que o servidor tem vale em outro aparelho e vira a cópia local", async () => {
    obter.mockResolvedValue(remoto({}));
    const prefs = await sincronizarPreferenciasCalendario("U1");
    expect(prefs).toEqual({ pais: "Portugal", fuso: "Europe/Lisbon", inicio: "08:30", deadlines: false });
    expect(lerPreferenciasCalendario()).toEqual(prefs);
    expect(atualizar).not.toHaveBeenCalled();
  });

  it("migra uma vez os valores locais quando o servidor nunca recebeu nada", async () => {
    localStorage.setItem(CHAVE_PREFERENCIAS_CALENDARIO, JSON.stringify({ pais: "Japão", fuso: "Asia/Tokyo", inicio: "07:00", deadlines: true }));
    obter.mockResolvedValue({ pais: "Brasil", fuso: "America/Sao_Paulo", inicio: "06:00", deadlines: true, definido: false });
    atualizar.mockResolvedValue(remoto({ pais: "Japão", fuso: "Asia/Tokyo", inicio: "07:00", deadlines: true }));
    await sincronizarPreferenciasCalendario("U1");
    expect(atualizar).toHaveBeenCalledWith({ pais: "Japão", fuso: "Asia/Tokyo", inicio: "07:00", deadlines: true });
  });

  it("não sobe a cópia local de outra conta", async () => {
    localStorage.setItem(CHAVE_PREFERENCIAS_CALENDARIO, JSON.stringify({ pais: "Japão", fuso: "Asia/Tokyo", inicio: "07:00", deadlines: true }));
    localStorage.setItem("ecos.config.calendario.usuario", "OUTRA");
    obter.mockResolvedValue({ pais: "Brasil", fuso: "America/Sao_Paulo", inicio: "06:00", deadlines: true, definido: false });
    const prefs = await sincronizarPreferenciasCalendario("U2");
    expect(atualizar).not.toHaveBeenCalled();
    expect(prefs).toEqual(PREFERENCIAS_PADRAO);
  });

  it("sem rede, a cópia local continua valendo", async () => {
    salvarPreferenciasCalendario({ inicio: "09:00" });
    obter.mockRejectedValue(new Error("offline"));
    expect((await sincronizarPreferenciasCalendario("U1")).inicio).toBe("09:00");
  });

  it("salvar manda tudo ao servidor, atualiza a cópia e propaga o erro de campo", async () => {
    atualizar.mockResolvedValue(remoto({ fuso: "UTC" }));
    const prefs = await salvarPreferenciasCalendarioNoServidor("U1", { fuso: "UTC" });
    expect(atualizar).toHaveBeenCalledWith(expect.objectContaining({ fuso: "UTC" }));
    expect(lerPreferenciasCalendario().fuso).toBe("UTC");
    expect(prefs.fuso).toBe("UTC");

    atualizar.mockRejectedValue(new Error("fuso inválido"));
    await expect(salvarPreferenciasCalendarioNoServidor("U1", { fuso: "Marte" })).rejects.toThrow("fuso inválido");
    expect(lerPreferenciasCalendario().fuso).toBe("UTC");
  });
});
