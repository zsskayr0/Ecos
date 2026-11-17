import { describe, expect, it } from "vitest";
import { criarZip } from "./zip-simples";

describe("criarZip", () => {
  it("gera um zip válido com as entradas, o CRC e o fim do diretório", async () => {
    const blob = criarZip([{ nome: "a.md", dados: new TextEncoder().encode("hello") }, { nome: "b.md", dados: new TextEncoder().encode("") }]);
    const bytes = await new Promise<ArrayBuffer>((ok) => { const r = new FileReader(); r.onload = () => ok(r.result as ArrayBuffer); r.readAsArrayBuffer(blob); });
    const v = new DataView(bytes);
    expect(v.getUint32(0, true)).toBe(0x04034b50);
    expect(v.getUint32(14, true)).toBe(0x3610a686); // CRC-32 de "hello"
    const fim = v.byteLength - 22;
    expect(v.getUint32(fim, true)).toBe(0x06054b50);
    expect(v.getUint16(fim + 10, true)).toBe(2);
  });
});
