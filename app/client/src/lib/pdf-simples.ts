/**
 * Escritor de PDF mínimo (texto, linhas, retângulos e imagens JPEG) com as fontes padrão do formato (Helvetica e Courier),
 * sem dependências. Serve para gerar o arquivo na hora e entregá-lo como download, em vez de passar pela janela de impressão.
 * Coordenadas em pontos, com a origem no canto superior esquerdo da página.
 */
export type Fonte = "normal" | "negrito" | "italico" | "negritoItalico" | "codigo";
export type Cor = [number, number, number];

export const A4 = { largura: 595.28, altura: 841.89 };

const NOME_DA_FONTE: Record<Fonte, string> = { normal: "F1", negrito: "F2", codigo: "F3", italico: "F4", negritoItalico: "F5" };
const BASE_DA_FONTE: [string, string][] = [["F1", "Helvetica"], ["F2", "Helvetica-Bold"], ["F3", "Courier"], ["F4", "Helvetica-Oblique"], ["F5", "Helvetica-BoldOblique"]];

// Larguras da Helvetica (milésimos de em) para os códigos 32 a 126.
const LARGURAS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];
export const TOTAL_LARGURAS = LARGURAS.length;

// Caracteres fora do Latin-1 que o WinAnsi (codificação das fontes padrão) também tem.
const WINANSI: Record<string, number> = { "€": 0x80, "…": 0x85, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97, "™": 0x99 };

/** Troca o que a fonte padrão não desenha (símbolos, caracteres invisíveis) por algo seguro. */
export function limparTexto(texto: string): string {
  let saida = "";
  for (const ch of texto.replace(/ /g, " ").replace(/[​-‏⁠﻿️]/g, "")) {
    const c = ch.codePointAt(0)!;
    if (c === 10 || (c >= 32 && c < 127) || (c >= 160 && c <= 255)) saida += ch;
    else if (ch in WINANSI) saida += ch;
    else if (c === 9) saida += " ";
    else if (c >= 0x2000 && c <= 0x206f) saida += " ";
    else if (c > 255) saida += "?";
  }
  return saida;
}

const ehNegrito = (f: Fonte) => f === "negrito" || f === "negritoItalico";

function larguraDoCaractere(ch: string, fonte: Fonte): number {
  if (fonte === "codigo") return 600;
  let c = ch.charCodeAt(0);
  if (c > 126 || c < 32) {
    if (ch === "•") return 350;
    if (ch === "…" || ch === "—") return 1000;
    const base = ch.normalize("NFD")[0].charCodeAt(0);
    c = base >= 32 && base <= 126 ? base : 0;
  }
  const w = c >= 32 && c <= 126 ? LARGURAS[c - 32] : 556;
  return ehNegrito(fonte) ? w * 1.06 : w;
}

export function medir(texto: string, fonte: Fonte, tamanho: number): number {
  let soma = 0;
  for (const ch of texto) soma += larguraDoCaractere(ch, fonte);
  return (soma / 1000) * tamanho;
}

/** Quebra o texto em linhas que cabem em `largura`, respeitando as quebras de linha que já existem. */
export function quebrar(texto: string, largura: number, fonte: Fonte, tamanho: number): string[] {
  const linhas: string[] = [];
  for (const paragrafo of texto.split("\n")) {
    if (!paragrafo.trim()) { linhas.push(""); continue; }
    let atual = "";
    for (const palavra of paragrafo.split(" ")) {
      const tentativa = atual ? `${atual} ${palavra}` : palavra;
      if (medir(tentativa, fonte, tamanho) <= largura) { atual = tentativa; continue; }
      if (atual) linhas.push(atual);
      atual = palavra;
      // Palavra maior que a linha (um endereço, por exemplo): corta por caracteres.
      while (medir(atual, fonte, tamanho) > largura && atual.length > 1) {
        let corte = atual.length - 1;
        while (corte > 1 && medir(atual.slice(0, corte), fonte, tamanho) > largura) corte--;
        linhas.push(atual.slice(0, corte));
        atual = atual.slice(corte);
      }
    }
    linhas.push(atual);
  }
  return linhas;
}

function codificar(texto: string): string {
  let saida = "";
  for (const ch of texto) {
    const c = ch.charCodeAt(0);
    const byte = ch in WINANSI ? WINANSI[ch] : c < 256 ? c : 63;
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) saida += `\\${String.fromCharCode(byte)}`;
    else if (byte < 32 || byte > 126) saida += `\\${byte.toString(8).padStart(3, "0")}`;
    else saida += String.fromCharCode(byte);
  }
  return saida;
}

const n = (v: number) => (Math.round(v * 100) / 100).toString();
const cor = (c: Cor) => `${n(c[0])} ${n(c[1])} ${n(c[2])}`;

function emBinario(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return s;
}

interface ImagemJpeg { jpeg: Uint8Array; largura: number; altura: number }

export class DocumentoPdf {
  private paginas: string[][] = [[]];
  private imagens: ImagemJpeg[] = [];

  get totalDePaginas() { return this.paginas.length; }

  novaPagina() { this.paginas.push([]); }

  private atual() { return this.paginas[this.paginas.length - 1]; }

  /** `y` é a linha de base do texto, medida do topo da página. */
  texto(texto: string, x: number, y: number, fonte: Fonte, tamanho: number, c: Cor = [0.06, 0.09, 0.16]) {
    if (!texto) return;
    this.atual().push(`BT /${NOME_DA_FONTE[fonte]} ${n(tamanho)} Tf ${cor(c)} rg ${n(x)} ${n(A4.altura - y)} Td (${codificar(texto)}) Tj ET`);
  }

  linha(x1: number, y1: number, x2: number, y2: number, c: Cor, espessura = 0.75) {
    this.atual().push(`${cor(c)} RG ${n(espessura)} w ${n(x1)} ${n(A4.altura - y1)} m ${n(x2)} ${n(A4.altura - y2)} l S`);
  }

  retangulo(x: number, y: number, largura: number, altura: number, c: Cor) {
    this.atual().push(`${cor(c)} rg ${n(x)} ${n(A4.altura - y - altura)} ${n(largura)} ${n(altura)} re f`);
  }

  /** Guarda um JPEG para ser desenhado depois (quantas vezes quiser) com `imagem`. Devolve o índice. */
  adicionarImagem(jpeg: Uint8Array, largura: number, altura: number): number {
    this.imagens.push({ jpeg, largura, altura });
    return this.imagens.length - 1;
  }

  /** `y` é o topo da imagem, medido do topo da página. */
  imagem(indice: number, x: number, y: number, largura: number, altura: number) {
    this.atual().push(`q ${n(largura)} 0 0 ${n(altura)} ${n(x)} ${n(A4.altura - y - altura)} cm /Im${indice} Do Q`);
  }

  gerar(): Blob {
    const partes: string[] = [];
    const posicoes: number[] = [];
    let tamanho = 0;
    const gravar = (s: string) => { partes.push(s); tamanho += s.length; };
    const objeto = (id: number, corpo: string) => { posicoes[id] = tamanho; gravar(`${id} 0 obj\n${corpo}\nendobj\n`); };

    gravar("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n");
    const primeiraPagina = 3 + BASE_DA_FONTE.length;
    const ids = this.paginas.map((_, i) => primeiraPagina + i * 2);
    const primeiraImagem = primeiraPagina + this.paginas.length * 2;
    objeto(1, "<< /Type /Catalog /Pages 2 0 R >>");
    objeto(2, `<< /Type /Pages /Kids [${ids.map((id) => `${id} 0 R`).join(" ")}] /Count ${ids.length} >>`);
    BASE_DA_FONTE.forEach(([, base], i) => objeto(3 + i, `<< /Type /Font /Subtype /Type1 /BaseFont /${base} /Encoding /WinAnsiEncoding >>`));
    const fontes = BASE_DA_FONTE.map(([nome], i) => `/${nome} ${3 + i} 0 R`).join(" ");
    const xobjetos = this.imagens.length ? ` /XObject << ${this.imagens.map((_, i) => `/Im${i} ${primeiraImagem + i} 0 R`).join(" ")} >>` : "";
    this.paginas.forEach((comandos, i) => {
      const id = ids[i];
      const fluxo = comandos.join("\n");
      objeto(id, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4.largura} ${A4.altura}] /Resources << /Font << ${fontes} >>${xobjetos} >> /Contents ${id + 1} 0 R >>`);
      objeto(id + 1, `<< /Length ${fluxo.length} >>\nstream\n${fluxo}\nendstream`);
    });
    this.imagens.forEach((im, i) => {
      const dados = emBinario(im.jpeg);
      objeto(primeiraImagem + i, `<< /Type /XObject /Subtype /Image /Width ${im.largura} /Height ${im.altura} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${dados.length} >>\nstream\n${dados}\nendstream`);
    });

    const totalDeObjetos = primeiraImagem + this.imagens.length;
    const inicioDaTabela = tamanho;
    let tabela = `xref\n0 ${totalDeObjetos}\n0000000000 65535 f \n`;
    for (let id = 1; id < totalDeObjetos; id++) tabela += `${String(posicoes[id]).padStart(10, "0")} 00000 n \n`;
    gravar(tabela);
    gravar(`trailer\n<< /Size ${totalDeObjetos} /Root 1 0 R >>\nstartxref\n${inicioDaTabela}\n%%EOF\n`);

    const texto = partes.join("");
    const bytes = new Uint8Array(texto.length);
    for (let i = 0; i < texto.length; i++) bytes[i] = texto.charCodeAt(i) & 0xff;
    return new Blob([bytes], { type: "application/pdf" });
  }
}
