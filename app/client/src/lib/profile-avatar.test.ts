import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { obter, enviar } = vi.hoisted(() => ({ obter: vi.fn(), enviar: vi.fn() }));
vi.mock("./api", () => ({ avatarPerfil: { obter, enviar, remover: vi.fn() } }));

import { definirUsuarioDasFotos, prepararFotoPerfil, useFotoPerfil } from "./profile-avatar";

const PNG_BASE64 = "iVBORw0KGgo="; // assinatura PNG; o servidor valida pelos bytes
const legado = `data:image/png;base64,${PNG_BASE64}`;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  let n = 0;
  Object.assign(URL, { createObjectURL: vi.fn(() => `blob:ecos/${++n}`), revokeObjectURL: vi.fn() });
});

describe("foto de perfil no servidor", () => {
  it("mostra a foto do servidor sem tocar na cópia local", async () => {
    definirUsuarioDasFotos("U1");
    obter.mockResolvedValue(new Blob(["x"], { type: "image/png" }));
    const { result } = renderHook(() => useFotoPerfil("U1", 1));
    await waitFor(() => expect(result.current.url).toMatch(/^blob:/));
    expect(enviar).not.toHaveBeenCalled();
  });

  it("sobe uma vez a foto que só existia no navegador e a remove do localStorage", async () => {
    definirUsuarioDasFotos("U2");
    localStorage.setItem("ecos:avatar:U2", legado);
    obter.mockResolvedValue(null);
    enviar.mockResolvedValue({ ok: true, avatar_atualizado_em: 5 });
    const { result } = renderHook(() => useFotoPerfil("U2", null));
    await waitFor(() => expect(enviar).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(localStorage.getItem("ecos:avatar:U2")).toBeNull());
    expect(result.current.url).toMatch(/^blob:/);
  });

  it("não sobe a foto local de outra conta nem quando o envio falha", async () => {
    definirUsuarioDasFotos("OUTRA");
    localStorage.setItem("ecos:avatar:U3", legado);
    obter.mockResolvedValue(null);
    renderHook(() => useFotoPerfil("U3", null));
    await new Promise((r) => setTimeout(r, 30));
    expect(enviar).not.toHaveBeenCalled();

    definirUsuarioDasFotos("U4");
    localStorage.setItem("ecos:avatar:U4", legado);
    enviar.mockRejectedValue(new Error("sem rede"));
    const { result } = renderHook(() => useFotoPerfil("U4", null));
    await waitFor(() => expect(enviar).toHaveBeenCalled());
    expect(localStorage.getItem("ecos:avatar:U4")).toBe(legado);
    await waitFor(() => expect(result.current.url).toBe(legado));
  });

  it("sem foto em lugar nenhum fica sem url (o avatar cai nas iniciais)", async () => {
    definirUsuarioDasFotos("U5");
    obter.mockResolvedValue(null);
    const { result } = renderHook(() => useFotoPerfil("U5", null));
    await waitFor(() => expect(obter).toHaveBeenCalled());
    expect(result.current.url).toBeUndefined();
  });
});

describe("prepararFotoPerfil", () => {
  it("recusa arquivo que não é imagem e aceita PNG pequeno como está", async () => {
    await expect(prepararFotoPerfil(new File(["x"], "a.txt", { type: "text/plain" }))).rejects.toThrow(/imagem/i);
    const png = new File([new Uint8Array([1, 2, 3])], "a.png", { type: "image/png" });
    expect(await prepararFotoPerfil(png)).toBe(png);
  });
});
