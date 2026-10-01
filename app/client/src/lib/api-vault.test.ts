import { afterEach, expect, it, vi } from "vitest";
import { financeiro } from "./api";
afterEach(()=>vi.unstubAllGlobals());
it("descarta exportação recebida depois do bloqueio e pede no-store",async()=>{
  let responder!:(response:Response)=>void;
  const fetch=vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(()=>new Promise<Response>(resolve=>{responder=resolve;}));vi.stubGlobal("fetch",fetch);
  const pedido=financeiro.exportar({data_de:"2026-09-01",data_ate:"2026-09-30"});
  const rejeicao=expect(pedido).rejects.toMatchObject({code:"VAULT_LOCKED"});
  window.dispatchEvent(new Event("ecos:cofre-bloqueado"));
  responder(new Response(JSON.stringify({csv:"dados privados"}),{headers:{"content-type":"application/json"}}));
  await rejeicao;expect(fetch.mock.calls[0][1]).toMatchObject({cache:"no-store"});
});
it("VAULT_LOCKED oculta o cofre sem renovar sessão de login",async()=>{
  const bloqueado=vi.fn();window.addEventListener("ecos:cofre-bloqueado",bloqueado);
  const fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify({error:"VAULT_LOCKED"}),{status:401,headers:{"content-type":"application/json"}}));vi.stubGlobal("fetch",fetch);
  await expect(financeiro.painel({data_de:"2026-09-01",data_ate:"2026-09-30"})).rejects.toMatchObject({code:"VAULT_LOCKED"});
  expect(fetch).toHaveBeenCalledOnce();expect(bloqueado).toHaveBeenCalledOnce();window.removeEventListener("ecos:cofre-bloqueado",bloqueado);
});
