import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({ notificacoes: { registrarAparelho: vi.fn().mockResolvedValue({ id: "ap-x", push_tipo: "unifiedpush" }) } }));

import { notificacoes } from "@/lib/api";
import { sincronizarEndereco, temPushNoCelular } from "./push-celular";

function ponte(endpoint: string | null) {
  (window as unknown as { EcosPush: unknown }).EcosPush = {
    estado: () => JSON.stringify({ distribuidor: "io.heckel.ntfy", endpoint, instalacao: "inst-12345678", permissao: true }),
    distribuidores: () => "[]", registrar: vi.fn(), desligar: vi.fn(), avisoPendente: () => "",
  };
}

describe("push no celular", () => {
  beforeEach(() => { localStorage.clear(); vi.mocked(notificacoes.registrarAparelho).mockClear(); });
  afterEach(() => { delete (window as unknown as { EcosPush?: unknown }).EcosPush; });

  it("fora do app Android não faz nada", async () => {
    expect(temPushNoCelular()).toBe(false);
    await sincronizarEndereco();
    expect(notificacoes.registrarAparelho).not.toHaveBeenCalled();
  });

  it("envia o endereço novo uma vez e de novo só quando ele muda", async () => {
    ponte("https://ntfy.exemplo.com/up1");
    await sincronizarEndereco();
    await sincronizarEndereco();
    expect(notificacoes.registrarAparelho).toHaveBeenCalledTimes(1);
    expect(vi.mocked(notificacoes.registrarAparelho).mock.calls[0][0]).toMatchObject({ instalacao: "inst-12345678", push_endpoint: "https://ntfy.exemplo.com/up1" });
    ponte(null); // desligou no aparelho: o servidor fica sabendo
    await sincronizarEndereco();
    expect(vi.mocked(notificacoes.registrarAparelho).mock.calls[1][0]).toMatchObject({ push_endpoint: null });
  });

  it("aparelho que nunca ligou não cadastra nada no servidor", async () => {
    ponte(null);
    await sincronizarEndereco();
    expect(notificacoes.registrarAparelho).not.toHaveBeenCalled();
  });
});
