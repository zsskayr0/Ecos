/** Zip mínimo para .docx: grava sem compressão e lê entradas guardadas ou com deflate (via `DecompressionStream`). */

const TABELA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(dados: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < dados.length; i++) c = TABELA_CRC[(c ^ dados[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface EntradaZip { nome: string; dados: Uint8Array | string }

/** Monta um .zip com as entradas guardadas (método 0). */
export function gerarZip(entradas: EntradaZip[]): Uint8Array {
  const enc = new TextEncoder();
  const locais: Uint8Array[] = [];
  const centrais: Uint8Array[] = [];
  let deslocamento = 0;
  for (const e of entradas) {
    const nome = enc.encode(e.nome);
    const dados = typeof e.dados === "string" ? enc.encode(e.dados) : e.dados;
    const crc = crc32(dados);
    const local = new Uint8Array(30 + nome.length);
    const v = new DataView(local.buffer);
    v.setUint32(0, 0x04034b50, true); v.setUint16(4, 20, true); v.setUint16(6, 0x0800, true); v.setUint16(8, 0, true);
    v.setUint16(10, 0, true); v.setUint16(12, 0x21, true); v.setUint32(14, crc, true);
    v.setUint32(18, dados.length, true); v.setUint32(22, dados.length, true); v.setUint16(26, nome.length, true); v.setUint16(28, 0, true);
    local.set(nome, 30);
    const central = new Uint8Array(46 + nome.length);
    const c = new DataView(central.buffer);
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
    c.setUint16(12, 0, true); c.setUint16(14, 0x21, true); c.setUint32(16, crc, true); c.setUint32(20, dados.length, true); c.setUint32(24, dados.length, true);
    c.setUint16(28, nome.length, true); c.setUint32(42, deslocamento, true);
    central.set(nome, 46);
    locais.push(local, dados);
    centrais.push(central);
    deslocamento += local.length + dados.length;
  }
  const tamCentral = centrais.reduce((s, x) => s + x.length, 0);
  const fim = new Uint8Array(22);
  const f = new DataView(fim.buffer);
  f.setUint32(0, 0x06054b50, true); f.setUint16(8, entradas.length, true); f.setUint16(10, entradas.length, true);
  f.setUint32(12, tamCentral, true); f.setUint32(16, deslocamento, true);
  const partes = [...locais, ...centrais, fim];
  const saida = new Uint8Array(partes.reduce((s, x) => s + x.length, 0));
  let p = 0;
  for (const x of partes) { saida.set(x, p); p += x.length; }
  return saida;
}

async function inflar(dados: Uint8Array): Promise<Uint8Array> {
  const fluxo = new Blob([dados as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(fluxo).arrayBuffer());
}

/** Lê todas as entradas de um .zip (pelo diretório central). */
export async function lerZip(buf: ArrayBuffer): Promise<Map<string, Uint8Array>> {
  const bytes = new Uint8Array(buf);
  const v = new DataView(buf);
  let fim = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (v.getUint32(i, true) === 0x06054b50) { fim = i; break; }
  if (fim < 0) throw new Error("Arquivo .docx inválido.");
  const total = v.getUint16(fim + 10, true);
  let p = v.getUint32(fim + 16, true);
  const dec = new TextDecoder();
  const saida = new Map<string, Uint8Array>();
  for (let i = 0; i < total; i++) {
    if (v.getUint32(p, true) !== 0x02014b50) break;
    const metodo = v.getUint16(p + 10, true);
    const comprimido = v.getUint32(p + 20, true);
    const nLen = v.getUint16(p + 28, true), xLen = v.getUint16(p + 30, true), cLen = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const nome = dec.decode(bytes.subarray(p + 46, p + 46 + nLen));
    const inicio = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    const bruto = bytes.subarray(inicio, inicio + comprimido);
    if (metodo === 0) saida.set(nome, bruto.slice());
    else if (metodo === 8) saida.set(nome, await inflar(bruto));
    p += 46 + nLen + xLen + cLen;
  }
  return saida;
}
