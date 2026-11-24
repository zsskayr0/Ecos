/**
 * Bloco de escrita: um trecho de escrita à mão que vive numa linha da nota, como um bloco de código.
 * No arquivo fica assim (um traço por linha; pontos `x,y,pressão` em px de uma folha de 700 de largura):
 *
 *     ```escrita 240
 *     c auto 2 12.5,40,50 13,41.2,52 …
 *     ```
 *
 * Por estar no texto, sobe e desce com ele, vai junto ao copiar e é desfeito com Ctrl+Z.
 * Fora do editor (leitura, PDF, exportação) vira imagem.
 */
import { defaultUrlTransform } from "react-markdown";
import { gerarD } from "@/lib/tinta/geometria";
import { linhaNotaAtual } from "@/lib/linha-nota";
import type { Ferramenta, PontoTinta } from "@/lib/tinta/tipos";

/** Largura lógica da folha do bloco: as coordenadas valem igual em qualquer tela (a folha é escalada). */
export const LARGURA_ESCRITA = 700;
export const ALTURA_ESCRITA_PADRAO = 240;
export const ALTURA_ESCRITA_MIN = 80;
export const ALTURA_ESCRITA_MAX = 2400;
/** Lado do quadriculado, em px da folha: uma linha da nota (o número central). */
export const passoGrade = () => linhaNotaAtual();

export interface TracoEscrita { ferramenta: Ferramenta; cor: string; espessura: number; pontos: PontoTinta[]; d: string }
export interface BlocoEscrita { altura: number; tracos: TracoEscrita[] }

export const ehLinguagemEscrita = (info: string) => /^escrita\b/.test(info.trim());

export function novoBlocoEscrita(altura = ALTURA_ESCRITA_PADRAO) {
  return "```escrita " + altura + "\n```";
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const limitarAltura = (h: number) => Math.min(ALTURA_ESCRITA_MAX, Math.max(ALTURA_ESCRITA_MIN, Math.round(h)));

export function criarTracoEscrita(ferramenta: Ferramenta, cor: string, espessura: number, pontos: readonly PontoTinta[]): TracoEscrita {
  const p = pontos.map((q) => ({ x: r1(q.x), y: r1(q.y), pressao: Math.round(Math.min(1, Math.max(0, q.pressao)) * 100) / 100 }));
  return { ferramenta, cor, espessura, pontos: p, d: gerarD(ferramenta, p, espessura) };
}

/** Lê o bloco inteiro (com as cercas) ou só o miolo + a linha de abertura. Linha ruim é ignorada. */
export function lerBlocoEscrita(fonte: string): BlocoEscrita {
  const linhas = fonte.split("\n");
  const abertura = linhas[0] ?? "";
  const m = abertura.match(/escrita\s+(\d+)/);
  const altura = limitarAltura(m ? Number(m[1]) : ALTURA_ESCRITA_PADRAO);
  const tracos: TracoEscrita[] = [];
  for (const l of linhas.slice(1)) {
    const partes = l.trim().split(/\s+/);
    if (partes.length < 4 || (partes[0] !== "c" && partes[0] !== "m")) continue;
    const ferramenta: Ferramenta = partes[0] === "m" ? "marca-texto" : "caneta";
    const cor = partes[1] === "auto" || /^#[0-9a-f]{6}$/i.test(partes[1]) ? partes[1] : "auto";
    const espessura = Number(partes[2]);
    if (!(espessura > 0 && espessura < 100)) continue;
    const pontos: PontoTinta[] = [];
    for (const p of partes.slice(3)) {
      const [x, y, z] = p.split(",").map(Number);
      if (Number.isFinite(x) && Number.isFinite(y)) pontos.push({ x, y, pressao: Number.isFinite(z) ? z / 100 : 0.5 });
    }
    if (pontos.length) tracos.push({ ferramenta, cor, espessura, pontos, d: gerarD(ferramenta, pontos, espessura) });
  }
  return { altura, tracos };
}

export function escreverBlocoEscrita(b: BlocoEscrita): string {
  const linhas = b.tracos.map((t) => [t.ferramenta === "marca-texto" ? "m" : "c", t.cor, t.espessura, ...t.pontos.map((p) => `${r1(p.x)},${r1(p.y)},${Math.round(p.pressao * 100)}`)].join(" "));
  return ["```escrita " + limitarAltura(b.altura), ...linhas, "```"].join("\n");
}

/** SVG da escrita. `corTinta` substitui "auto" (cor do texto); `grade` desenha o quadriculado. */
export function svgEscrita(b: BlocoEscrita, opcoes: { corTinta: string; grade?: string | null; fundo?: string | null }): string {
  const { corTinta, grade, fundo } = opcoes;
  const esc = (s: string) => s.replace(/[<>&"]/g, "");
  const defs = grade ? `<defs><pattern id="g" width="${passoGrade()}" height="${passoGrade()}" patternUnits="userSpaceOnUse"><path d="M ${passoGrade()} 0 L 0 0 0 ${passoGrade()}" fill="none" stroke="${esc(grade)}" stroke-opacity="0.1" stroke-width="1"/></pattern></defs>` : "";
  const fundos = (fundo ? `<rect width="100%" height="100%" fill="${esc(fundo)}"/>` : "") + (grade ? `<rect width="100%" height="100%" fill="url(#g)"/>` : "");
  const tracos = b.tracos.map((t) => {
    const cor = esc(t.cor === "auto" ? corTinta : t.cor);
    return t.ferramenta === "caneta"
      ? `<path d="${t.d}" fill="${cor}"/>`
      : `<path d="${t.d}" fill="none" stroke="${cor}" stroke-opacity="0.4" stroke-width="${t.espessura}" stroke-linecap="round" stroke-linejoin="round"/>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${LARGURA_ESCRITA} ${b.altura}" width="${LARGURA_ESCRITA}" height="${b.altura}">${defs}${fundos}${tracos}</svg>`;
}

/** Desenha os traços num canvas já escalado para px da folha. */
export function desenharEscrita(ctx: CanvasRenderingContext2D, tracos: readonly Pick<TracoEscrita, "ferramenta" | "cor" | "espessura" | "d">[], corTinta: string, escuro: boolean) {
  for (const t of tracos) {
    const cor = t.cor === "auto" ? corTinta : t.cor;
    const p = new Path2D(t.d);
    if (t.ferramenta === "caneta") {
      ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1; ctx.fillStyle = cor; ctx.fill(p);
    } else {
      ctx.globalCompositeOperation = escuro ? "screen" : "multiply"; ctx.globalAlpha = 0.4;
      ctx.strokeStyle = cor; ctx.lineWidth = t.espessura; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.stroke(p);
    }
  }
  ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1;
}

/** Leitura: a altura vai no nome da linguagem (`escrita-240`), porque o "meta" da cerca não chega ao HTML. */
export const alturaNaLinguagem = (md: string) => (md.includes("```escrita") ? md.replace(/^```escrita[ \t]+(\d+)[ \t]*$/gm, "```escrita-$1") : md);

const CERCA_ESCRITA = /^```escrita[^\n]*\n[\s\S]*?^```[ \t]*$/gm;

/**
 * PDF e exportação: troca cada bloco de escrita por uma imagem PNG (tinta preta, folha branca quadriculada).
 * Sem canvas (testes), troca por um aviso em texto.
 */
export function escritaEmImagens(md: string): string {
  if (!md.includes("```escrita")) return md;
  return md.replace(CERCA_ESCRITA, (fonte) => {
    const b = lerBlocoEscrita(fonte);
    const url = pngEscrita(b);
    return url ? `![Escrita à mão|100%](${url})` : "_[escrita à mão]_";
  });
}

/** O react-markdown barra `data:`; aqui só passam as imagens PNG que o próprio Ecos gerou. */
export const urlComImagemEmbutida = (url: string) => (url.startsWith("data:image/png;base64,") ? url : defaultUrlTransform(url));

function pngEscrita(b: BlocoEscrita): string | null {
  try {
    const escala = 2;
    const c = document.createElement("canvas");
    c.width = LARGURA_ESCRITA * escala; c.height = b.altura * escala;
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    ctx.scale(escala, escala);
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, LARGURA_ESCRITA, b.altura);
    ctx.strokeStyle = "#e3e6ea"; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = passoGrade(); x < LARGURA_ESCRITA; x += passoGrade()) { ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, b.altura); }
    for (let y = passoGrade(); y < b.altura; y += passoGrade()) { ctx.moveTo(0, y + 0.5); ctx.lineTo(LARGURA_ESCRITA, y + 0.5); }
    ctx.stroke();
    desenharEscrita(ctx, b.tracos, "#111111", false);
    const url = c.toDataURL("image/png");
    return url.startsWith("data:image/png") ? url : null;
  } catch { return null; }
}
