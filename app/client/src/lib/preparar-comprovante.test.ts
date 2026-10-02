import { expect, it, vi } from "vitest";
import { ANEXO_TAMANHO_MAXIMO_BYTES } from "@/lib/api";
import { ComprovanteGrandeDemais, prepararComprovante, type Reducao } from "./preparar-comprovante";

const MB = 1024 * 1024;
function arquivo(nome: string, tipo: string, tamanho: number) {
  const f = new File(["x"], nome, { type: tipo });
  Object.defineProperty(f, "size", { value: tamanho });
  return f;
}
const blobDe = (tamanho: number) => { const b = new Blob(["x"]); Object.defineProperty(b, "size", { value: tamanho }); return b; };

it("dentro do limite, devolve o MESMO arquivo, sem recomprimir", async () => {
  const original = arquivo("pix.jpg", "image/jpeg", ANEXO_TAMANHO_MAXIMO_BYTES);
  const reducao: Reducao = { reencodar: vi.fn() };
  expect(await prepararComprovante(original, reducao)).toBe(original);
  expect(reducao.reencodar).not.toHaveBeenCalled();
});

it("foto acima do limite é reduzida para JPEG, com qualidade e lado menores a cada tentativa", async () => {
  const reencodar = vi.fn()
    .mockResolvedValueOnce(blobDe(9 * MB))
    .mockResolvedValueOnce(blobDe(7 * MB));
  const reduzida = await prepararComprovante(arquivo("IMG_0001.HEIC.png", "image/png", 14 * MB), { reencodar });
  expect(reduzida.type).toBe("image/jpeg");
  expect(reduzida.name).toBe("IMG_0001.HEIC.jpg");
  expect(reduzida.size).toBeLessThan(ANEXO_TAMANHO_MAXIMO_BYTES);
  expect(reencodar).toHaveBeenNthCalledWith(1, expect.anything(), 3000, 0.88);
  expect(reencodar).toHaveBeenNthCalledWith(2, expect.anything(), 2400, 0.8);
});

it("PDF grande demais não tem como reduzir: o erro diz o que fazer", async () => {
  const erro = await prepararComprovante(arquivo("extrato.pdf", "application/pdf", 12 * MB), { reencodar: vi.fn() }).catch((e) => e);
  expect(erro).toBeInstanceOf(ComprovanteGrandeDemais);
  expect(erro.message).toContain("extrato.pdf");
  expect(erro.message).toContain("8 MB");
});

it("HEIC grande demais sugere enviar um print", async () => {
  await expect(prepararComprovante(arquivo("foto.heic", "image/heic", 12 * MB), { reencodar: vi.fn() })).rejects.toThrow(/print/);
});

it("navegador que não abre a imagem produz erro claro", async () => {
  await expect(prepararComprovante(arquivo("x.jpg", "image/jpeg", 12 * MB), { reencodar: async () => null })).rejects.toThrow(/Não consegui reduzir/);
});

it("imagem que continua grande mesmo no mínimo é recusada em vez de enviada", async () => {
  const reencodar = vi.fn(async () => blobDe(12 * MB));
  await expect(prepararComprovante(arquivo("x.jpg", "image/jpeg", 30 * MB), { reencodar })).rejects.toThrow(/continua grande/);
  expect(reencodar).toHaveBeenCalledTimes(4);
});
