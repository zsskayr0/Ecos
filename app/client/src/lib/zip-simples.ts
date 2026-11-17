/** Zip sem compressão (método "store"): o bastante para entregar vários arquivos de uma vez sem depender de biblioteca. */
const TABELA = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();

function crc32(dados: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < dados.length; i++) c = TABELA[(c ^ dados[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface ArquivoParaZip { nome: string; dados: Uint8Array }

export function criarZip(arquivos: ArquivoParaZip[], agora = new Date()): Blob {
  const texto = new TextEncoder();
  const hora = (agora.getHours() << 11) | (agora.getMinutes() << 5) | Math.floor(agora.getSeconds() / 2);
  const data = ((Math.max(agora.getFullYear(), 1980) - 1980) << 9) | ((agora.getMonth() + 1) << 5) | agora.getDate();
  const partes: BlobPart[] = [];
  const central: BlobPart[] = [];
  let deslocamento = 0;
  let tamanhoCentral = 0;

  for (const a of arquivos) {
    const nome = texto.encode(a.nome);
    const crc = crc32(a.dados);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true); // bit 11: nomes em UTF-8
    local.setUint16(8, 0, true); local.setUint16(10, hora, true); local.setUint16(12, data, true);
    local.setUint32(14, crc, true); local.setUint32(18, a.dados.length, true); local.setUint32(22, a.dados.length, true);
    local.setUint16(26, nome.length, true); local.setUint16(28, 0, true);
    partes.push(local.buffer, nome, a.dados as BlobPart);

    const entrada = new DataView(new ArrayBuffer(46));
    entrada.setUint32(0, 0x02014b50, true); entrada.setUint16(4, 20, true); entrada.setUint16(6, 20, true); entrada.setUint16(8, 0x0800, true);
    entrada.setUint16(10, 0, true); entrada.setUint16(12, hora, true); entrada.setUint16(14, data, true);
    entrada.setUint32(16, crc, true); entrada.setUint32(20, a.dados.length, true); entrada.setUint32(24, a.dados.length, true);
    entrada.setUint16(28, nome.length, true); entrada.setUint32(42, deslocamento, true);
    central.push(entrada.buffer, nome);
    tamanhoCentral += 46 + nome.length;
    deslocamento += 30 + nome.length + a.dados.length;
  }

  const fim = new DataView(new ArrayBuffer(22));
  fim.setUint32(0, 0x06054b50, true); fim.setUint16(8, arquivos.length, true); fim.setUint16(10, arquivos.length, true);
  fim.setUint32(12, tamanhoCentral, true); fim.setUint32(16, deslocamento, true);
  return new Blob([...partes, ...central, fim.buffer], { type: "application/zip" });
}
