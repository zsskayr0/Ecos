import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { lerCompartilhados } from "./compartilhar";

const b64 = (s: string) => btoa(s);
/** jsdom não tem `File.text()`. */
const texto = (f: File) => new Promise<string>((ok) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.readAsText(f); });

function instalarPonte(itens: { id: string; nome: string; mime: string; conteudo: string; destino?: string }[], quebrar: string[] = []) {
  const descartar = vi.fn();
  (window as unknown as { EcosCompartilhar: unknown }).EcosCompartilhar = {
    pendentes: () => JSON.stringify(itens.map((i) => ({ id: i.id, nome: i.nome, mime: i.mime, tamanho: i.conteudo.length, ...(i.destino ? { destino: i.destino } : {}) }))),
    parte: (id: string, inicio: number, tamanho: number) => {
      if (quebrar.includes(id)) return "";
      const item = itens.find((i) => i.id === id)!;
      return b64(item.conteudo.slice(inicio, inicio + tamanho));
    },
    descartar,
  };
  return descartar;
}

beforeEach(() => { delete (window as unknown as { EcosCompartilhar?: unknown }).EcosCompartilhar; });
afterEach(() => { delete (window as unknown as { EcosCompartilhar?: unknown }).EcosCompartilhar; });

it("sem a ponte do Android não há nada a ler", async () => {
  expect(await lerCompartilhados()).toEqual([]);
});

it("devolve cada arquivo com o destino escolhido no menu e apaga a cópia nativa", async () => {
  const descartar = instalarPonte([
    { id: "a", nome: "pix.pdf", mime: "application/pdf", conteudo: "%PDF-1.7 corpo", destino: "cofre" },
    { id: "b", nome: "foto.jpg", mime: "image/jpeg", conteudo: "jpegbytes", destino: "nota" },
  ]);
  const lidos = await lerCompartilhados();
  expect(lidos.map((l) => [l.arquivo.name, l.arquivo.type, l.destino])).toEqual([["pix.pdf", "application/pdf", "cofre"], ["foto.jpg", "image/jpeg", "nota"]]);
  expect(await texto(lidos[0].arquivo)).toBe("%PDF-1.7 corpo");
  expect(descartar).toHaveBeenCalledTimes(2);
});

it("ponte antiga, sem destino, é tratada como nota", async () => {
  instalarPonte([{ id: "a", nome: "x.png", mime: "image/png", conteudo: "png" }]);
  expect((await lerCompartilhados())[0].destino).toBe("nota");
});

it("destino desconhecido nunca cai no Cofre por engano", async () => {
  instalarPonte([{ id: "a", nome: "x.png", mime: "image/png", conteudo: "png", destino: "qualquer-coisa" }]);
  expect((await lerCompartilhados())[0].destino).toBe("nota");
});

it("um arquivo ilegível não derruba os outros, mas a cópia dele também é apagada", async () => {
  const descartar = instalarPonte([
    { id: "ruim", nome: "ruim.png", mime: "image/png", conteudo: "xx", destino: "cofre" },
    { id: "bom", nome: "bom.png", mime: "image/png", conteudo: "yy", destino: "cofre" },
  ], ["ruim"]);
  const lidos = await lerCompartilhados();
  expect(lidos.map((l) => l.arquivo.name)).toEqual(["bom.png"]);
  expect(descartar).toHaveBeenCalledWith("ruim");
  expect(descartar).toHaveBeenCalledWith("bom");
});

it("arquivo grande é lido em vários pedaços", async () => {
  const grande = "a".repeat(1_300_000);
  instalarPonte([{ id: "g", nome: "g.png", mime: "image/png", conteudo: grande, destino: "cofre" }]);
  const [lido] = await lerCompartilhados();
  expect(lido.arquivo.size).toBe(grande.length);
});
