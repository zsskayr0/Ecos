import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { FormaPagamentoApi } from "./api";

const estado = vi.hoisted(() => ({ chave: "srv|u1|pessoal", geracao: 0, ouvinte: null as null | (() => void), listar: vi.fn() }));
vi.mock("./api", () => ({
  ApiError: class ApiError extends Error { constructor(public code: string, message: string, public status: number) { super(message); } },
  vault: { formasPagamento: { listar: estado.listar } },
  chaveContextoCofre: () => estado.chave,
  geracaoDoCofre: () => estado.geracao,
  assinarContextoCofre: (cb: () => void) => { estado.ouvinte = cb; return () => { estado.ouvinte = null; }; },
}));

import { carregar, formasAtuais, reiniciarFormasPagamento, useFormasPagamento } from "./formas-pagamento-store";

const f = (codigo: string, nome: string, extra: Partial<FormaPagamentoApi> = {}): FormaPagamentoApi => ({ codigo, nome, icone: null, cor: null, padrao: true, ativa: true, ordem: 1, criado_por: null, usos: 0, ...extra });
const adiado = <T,>() => { let resolver!: (v: T) => void; let rejeitar!: (e: unknown) => void; const promessa = new Promise<T>((res, rej) => { resolver = res; rejeitar = rej; }); return { promessa, resolver, rejeitar }; };

beforeEach(() => {
  estado.chave = "srv|u1|pessoal"; estado.geracao = 0; estado.ouvinte = null;
  estado.listar.mockReset();
  reiniciarFormasPagamento();
});

describe("store de formas de pagamento", () => {
  it("troca de usuário com o mesmo espaço 'pessoal' não vaza a lista anterior", async () => {
    estado.listar.mockResolvedValueOnce([f("pix", "Pix do usuário 1")]);
    const { result } = renderHook(() => useFormasPagamento());
    await waitFor(() => expect(result.current.lista).toHaveLength(1));
    const segunda = adiado<FormaPagamentoApi[]>();
    estado.listar.mockReturnValueOnce(segunda.promessa);
    act(() => { estado.chave = "srv|u2|pessoal"; estado.ouvinte?.(); });
    expect(result.current.lista).toEqual([]);
    expect(result.current.indisponivel).toBe(true);
    await act(async () => { segunda.resolver([f("ted", "TED do usuário 2")]); await segunda.promessa; });
    await waitFor(() => expect(result.current.lista.map((x) => x.nome)).toEqual(["TED do usuário 2"]));
  });

  it("resposta que chega depois de trocar o contexto é descartada", async () => {
    const lenta = adiado<FormaPagamentoApi[]>();
    estado.listar.mockReturnValueOnce(lenta.promessa);
    const { result } = renderHook(() => useFormasPagamento());
    estado.listar.mockResolvedValue([f("boleto", "Boleto da equipe")]);
    act(() => { estado.chave = "srv|u1|equipe:7"; estado.ouvinte?.(); });
    await act(async () => { lenta.resolver([f("pix", "Pix antigo")]); await lenta.promessa; });
    await waitFor(() => expect(result.current.lista.map((x) => x.nome)).toEqual(["Boleto da equipe"]));
  });

  it("bloquear o Cofre limpa a lista e descarta a resposta em voo, sem recarregar sozinho", async () => {
    estado.listar.mockResolvedValueOnce([f("pix", "Pix")]);
    const { result } = renderHook(() => useFormasPagamento());
    await waitFor(() => expect(result.current.lista).toHaveLength(1));
    const emVoo = adiado<FormaPagamentoApi[]>();
    estado.listar.mockReturnValueOnce(emVoo.promessa);
    let forcado!: Promise<void>;
    act(() => { forcado = carregar(true); });
    act(() => { estado.geracao++; estado.ouvinte?.(); });
    expect(result.current.lista).toEqual([]);
    await act(async () => { emVoo.resolver([f("pix", "Pix (resposta antiga)")]); await forcado; });
    expect(formasAtuais()).toBeNull();
    expect(estado.listar).toHaveBeenCalledTimes(2);
  });

  it("carregar(true) ignora o TTL e refaz mesmo que a carga anterior tenha falhado", async () => {
    const primeira = adiado<FormaPagamentoApi[]>();
    estado.listar.mockReturnValueOnce(primeira.promessa).mockResolvedValueOnce([f("pix", "Pix")]);
    const { result } = renderHook(() => useFormasPagamento());
    let forcado!: Promise<void>;
    act(() => { forcado = carregar(true); });
    await act(async () => { primeira.rejeitar(new Error("rede")); await forcado; });
    expect(estado.listar).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(result.current.lista).toHaveLength(1));
  });

  it("dentro do TTL uma carga normal reaproveita o cache; a forçada não", async () => {
    estado.listar.mockResolvedValue([f("pix", "Pix")]);
    const { result } = renderHook(() => useFormasPagamento());
    await waitFor(() => expect(result.current.lista).toHaveLength(1));
    await act(async () => { await carregar(false); });
    expect(estado.listar).toHaveBeenCalledTimes(1);
    await act(async () => { await carregar(true); });
    expect(estado.listar).toHaveBeenCalledTimes(2);
  });

  it("consumidores simultâneos compartilham uma única requisição", async () => {
    estado.listar.mockResolvedValue([f("pix", "Pix")]);
    const a = renderHook(() => useFormasPagamento());
    const b = renderHook(() => useFormasPagamento());
    await waitFor(() => expect(a.result.current.lista).toHaveLength(1));
    expect(b.result.current.lista).toHaveLength(1);
    expect(estado.listar).toHaveBeenCalledTimes(1);
  });

  it("expõe ativas, porCodigo e o rótulo com fallback para o código", async () => {
    estado.listar.mockResolvedValue([f("pix", "Pix"), f("ted", "TED", { ativa: false })]);
    const { result } = renderHook(() => useFormasPagamento());
    await waitFor(() => expect(result.current.lista).toHaveLength(2));
    expect(result.current.ativas.map((x) => x.codigo)).toEqual(["pix"]);
    expect(result.current.porCodigo.get("ted")?.nome).toBe("TED");
    expect(result.current.rotulo("ted")).toBe("TED");
    expect(result.current.rotulo("desconhecida")).toBe("desconhecida");
    expect(result.current.rotulo(null)).toBe("");
  });

  it("erro de rede sem cache aparece em `erro` e permite tentar de novo", async () => {
    estado.listar.mockRejectedValueOnce(new Error("sem rede")).mockResolvedValueOnce([f("pix", "Pix")]);
    const { result } = renderHook(() => useFormasPagamento());
    await waitFor(() => expect(result.current.erro).toBeTruthy());
    expect(result.current.indisponivel).toBe(true);
    await act(async () => { await result.current.recarregar(); });
    await waitFor(() => expect(result.current.lista).toHaveLength(1));
    expect(result.current.erro).toBeNull();
  });
});
