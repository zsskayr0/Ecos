import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import { escritaEmImagens, urlComImagemEmbutida } from "@/lib/escrita-bloco";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { numerarTitulosLigado, remarkSumario } from "@/lib/sumario";
import remarkMath from "remark-math";
import { normalizarDelimitadores, remarkMatematicaBloco } from "@/lib/matematica";
import { imagemDaFormula } from "@/lib/formula-imagem";
import rehypeRaw from "rehype-raw";
import { lerAltImagem } from "@/lib/markdown-blocos";
import { comBibliografia } from "./notas-rodape";
import { notas, tarefas, type ArquivoExplorador } from "@/lib/api";
import { medirNota, type LayoutNota } from "@/lib/layout-nota-tinta";
import { caixa, intersecta } from "@/lib/tinta/geometria";
import { LARGURA_COLUNA_PADRAO, type TintaNota, type Traco } from "@/lib/tinta/tipos";
import { baixarArquivo } from "@/lib/baixar-arquivo";
import { resolverSrcImagem } from "@/lib/markdown-mini";
import { A4, DocumentoPdf, limparTexto, medir, type Cor, type Fonte } from "@/lib/pdf-simples";
import { obterAccessToken } from "@/lib/server-config";
import { lerPreferenciasAplicativo } from "@/lib/preferencias-aplicativo";
import { MARGENS, PAPEIS, QUEBRA_PAGINA } from "@/lib/tipografia-nota";

const semWikilink = (texto: string) => texto.replace(/\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g, (_, alvo: string, apelido?: string) => apelido || alvo);
const dataBr = (iso: string) => new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString("pt-BR");
const STATUS = { pendente: "Pendente", concluida: "Concluída", arquivada: "Arquivada" } as const;
const PRIORIDADE = { baixa: "Baixa", media: "Média", alta: "Alta" } as const;

type ItemExportavel = Pick<ArquivoExplorador, "tipo" | "id">;
interface Documento { id: string; titulo: string; tipo: "nota" | "tarefa"; corpo: string; tags: string[]; meta: string[] }

async function carregar(a: ItemExportavel): Promise<Documento | null> {
  if (!a.id) return null;
  if (a.tipo === "nota") {
    const n = await notas.obter(a.id);
    return { id: a.id, titulo: n.titulo, tipo: "nota", corpo: comBibliografia(n.corpo), tags: n.tags, meta: [`Atualizada em ${dataBr(n.atualizado_em)}`] };
  }
  if (a.tipo === "tarefa") {
    const t = await tarefas.obter(a.id);
    const meta = [STATUS[t.status], `Prioridade ${PRIORIDADE[t.prioridade].toLowerCase()}`];
    if (t.due_date) meta.push(`Prazo ${dataBr(t.due_date)}`);
    const subs = t.subtarefas.map((s) => `- [${s.concluida ? "x" : " "}] ${s.titulo}`).join("\n");
    return { id: a.id, titulo: t.titulo, tipo: "tarefa", corpo: [t.corpo, subs].filter(Boolean).join("\n\n"), tags: t.tags, meta };
  }
  return null;
}

// ---------------------------------------------------------------- imagens (fotos do texto e emojis viram JPEG)

interface ImagemPronta { indice: number; largura: number; altura: number }
type Imagens = Map<string, ImagemPronta | null>;

async function emJpeg(origem: CanvasImageSource & { width: number; height: number }, maxLado: number): Promise<{ bytes: Uint8Array; largura: number; altura: number } | null> {
  const escala = Math.min(1, maxLado / Math.max(origem.width, origem.height));
  const largura = Math.max(1, Math.round(origem.width * escala));
  const altura = Math.max(1, Math.round(origem.height * escala));
  const canvas = document.createElement("canvas");
  canvas.width = largura; canvas.height = altura;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, largura, altura); // JPEG não tem transparência
  ctx.drawImage(origem, 0, 0, largura, altura);
  const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/jpeg", 0.88));
  if (!blob) return null;
  return { bytes: new Uint8Array(await blob.arrayBuffer()), largura, altura };
}

async function imagemDaRede(url: string): Promise<{ bytes: Uint8Array; largura: number; altura: number } | null> {
  try {
    // O token só vai para o servidor do Ecos; em site de terceiros ele vazaria e ainda barraria a requisição (CORS).
    const doEcos = new URL(url, window.location.href).origin === window.location.origin || url.startsWith("/");
    const token = doEcos ? obterAccessToken() : null;
    const resp = doEcos
      ? await fetch(url, { credentials: "include", headers: token ? { Authorization: `Bearer ${token}` } : {} })
      : await fetch(url, { credentials: "omit", mode: "cors" });
    if (!resp.ok) return null;
    return await emJpeg(await createImageBitmap(await resp.blob()), 1400);
  } catch { return null; }
}

async function imagemDoEmoji(emoji: string): Promise<{ bytes: Uint8Array; largura: number; altura: number } | null> {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 96; canvas.height = 96;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, 96, 96);
    ctx.font = '76px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillStyle = "#000";
    ctx.fillText(emoji, 48, 52);
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/jpeg", 0.92));
    return blob ? { bytes: new Uint8Array(await blob.arrayBuffer()), largura: 96, altura: 96 } : null;
  } catch { return null; }
}

const EMOJI = /(\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic}|[\u{1F3FB}-\u{1F3FF}])*|[\u{1F1E6}-\u{1F1FF}]{2})/gu;
const ehEmoji = (s: string) => { const cp = s.codePointAt(0)!; return cp >= 0x2300 || s.includes("️"); };

// ---------------------------------------------------------------- escrita à mão (Modo de escrita)

interface FatiaTinta { bytes: Uint8Array; largura: number; altura: number; ptAltura: number }

/**
 * A tinta é posicionada por coordenadas sobre a coluna da tela, e o texto do PDF quebra linhas diferente,
 * então ela não pode ser sobreposta ao texto: vai numa seção própria, desenhada em fatias do tamanho da página.
 */
async function fatiasDaTinta(tinta: TintaNota): Promise<FatiaTinta[]> {
  const tracos = tinta.tracos.filter((t) => !t.apagado_em && t.pontos.length);
  if (!tracos.length) return [];
  const larguraCol = tinta.largura_coluna ?? LARGURA_COLUNA_PADRAO;
  const escala = LARGURA / larguraCol; // px da coluna → pt do PDF
  const altFatia = (BASE - TOPO) / escala; // altura de uma fatia, em px da coluna
  const caixas = tracos.map((t) => ({ t, c: caixa(t) }));
  const fim = Math.max(...caixas.map((x) => x.c.y1)) + 8;
  const resolucao = 2;
  const fatias: FatiaTinta[] = [];
  for (let y0 = 0; y0 < fim; y0 += altFatia) {
    const janela = { x0: -1e6, y0, x1: 1e6, y1: y0 + altFatia };
    const dentro = caixas.filter((x) => intersecta(x.c, janela));
    if (!dentro.length) continue;
    const altura = Math.min(altFatia, fim - y0);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(larguraCol * resolucao); canvas.height = Math.max(1, Math.round(altura * resolucao));
    const ctx = canvas.getContext("2d");
    if (!ctx) continue;
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(resolucao, resolucao); ctx.translate(0, -y0);
    for (const { t } of dentro) {
      const p = new Path2D(t.d);
      const cor = t.cor === "auto" ? "#0f1729" : t.cor;
      if (t.ferramenta === "caneta") { ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1; ctx.fillStyle = cor; ctx.fill(p); }
      else { ctx.globalCompositeOperation = "multiply"; ctx.globalAlpha = 0.45; ctx.strokeStyle = cor; ctx.lineWidth = t.espessura; ctx.lineCap = t.reta ? "butt" : "round"; ctx.lineJoin = "round"; ctx.stroke(p); }
    }
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/jpeg", 0.9));
    if (blob) fatias.push({ bytes: new Uint8Array(await blob.arrayBuffer()), largura: canvas.width, altura: canvas.height, ptAltura: altura * escala });
  }
  return fatias;
}

/** Nota com tinta: o texto e a tinta ficam onde a tela os mostra (o texto continua selecionável). */
interface NotaFiel { layout: LayoutNota; tracos: Traco[]; largura: number; imagens: Map<string, ImagemPronta> }

function corHex(cor: string): Cor {
  const m = /^#([0-9a-f]{6})$/i.exec(cor);
  if (!m) return [0.06, 0.09, 0.16];
  const v = parseInt(m[1], 16);
  return [(v >> 16 & 255) / 255, (v >> 8 & 255) / 255, (v & 255) / 255];
}

/** Cor do texto na tela → cor no papel branco: cinzas viram texto escuro ou cinza, cores vivas ficam (no tema escuro viram o azul de link). */
function corNoPapel(rgb: [number, number, number], escuro: boolean): Cor {
  const [r, g, b] = rgb.map((x) => x / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max - min > 0.25) return escuro ? AZUL : [r, g, b];
  const claridade = (r + g + b) / 3;
  const forca = escuro ? claridade : 1 - claridade; // 1 = texto principal
  return forca > 0.7 ? TEXTO : CINZA;
}

function escreverFiel(e: Escritor, nota: NotaFiel) {
  const { layout, tracos, largura } = nota;
  const escala = LARGURA / largura;
  const topo0 = e.y;
  const alt1 = BASE - topo0, altN = BASE - TOPO; // espaço útil da 1ª página e das seguintes, em pt
  const inicioPt = (p: number) => (p === 0 ? 0 : alt1 + (p - 1) * altN);
  const topoNaPagina = (p: number) => (p === 0 ? topo0 : TOPO);
  const paginaDe = (ypx: number) => { const pt = ypx * escala; return pt < alt1 ? 0 : 1 + Math.floor((pt - alt1) / altN); };
  // o editor reserva um vão grande abaixo do texto: vale só até a última palavra/imagem ou traço
  const fimPx = Math.max(24, ...layout.palavras.map((w) => w.y + w.h), ...layout.imagens.map((i) => i.y + i.h), ...tracos.map((t) => caixa(t).y1)) + 8;
  const ultima = paginaDe(Math.max(0, fimPx - 1));
  for (let p = 0; p <= ultima; p++) {
    if (p > 0) e.pdf.novaPagina();
    const dy = topoNaPagina(p) - inicioPt(p); // pt a somar ao y em pt da nota
    for (const im of layout.imagens) {
      const pronta = nota.imagens.get(im.src);
      if (pronta && paginaDe(im.y) === p) e.pdf.imagem(pronta.indice, MARGEM_LATERAL + im.x * escala, im.y * escala + dy, im.w * escala, im.h * escala);
    }
    for (const w of layout.palavras) {
      if (paginaDe(w.y) !== p) continue;
      const fonte: Fonte = w.codigo ? "codigo" : w.negrito ? (w.italico ? "negritoItalico" : "negrito") : w.italico ? "italico" : "normal";
      const texto = limparTexto(w.t);
      if (!texto) continue;
      let tam = w.px * escala;
      const largAlvo = w.w * escala, largReal = medir(texto, fonte, tam);
      if (largReal > largAlvo * 1.02) tam *= Math.max(0.6, largAlvo / largReal); // a fonte do PDF é mais larga que a da tela: encolhe para não invadir a próxima palavra
      e.pdf.texto(texto, MARGEM_LATERAL + w.x * escala, w.y * escala + dy + w.h * escala * 0.78, fonte, tam, corNoPapel(w.rgb, layout.escuro));
    }
    const faixa = { x0: -1e6, y0: inicioPt(p) / escala, x1: 1e6, y1: (inicioPt(p) + (p === 0 ? alt1 : altN)) / escala };
    for (const t of tracos) {
      if (!intersecta(caixa(t), faixa)) continue;
      const cor = t.cor === "auto" ? TEXTO : corHex(t.cor);
      if (t.ferramenta === "caneta") e.pdf.caminho(t.d, escala, MARGEM_LATERAL, dy, { cor, preencher: true });
      else e.pdf.caminho(t.d, escala, MARGEM_LATERAL, dy, { cor, preencher: false, marca: true, largura: t.espessura, ponta: t.reta ? "reta" : "redonda" });
    }
  }
  e.y = topoNaPagina(ultima) + Math.max(0, fimPx * escala - inicioPt(ultima)) + 6;
}

// ---------------------------------------------------------------- texto em linhas, com negrito/itálico/emoji

interface Trecho { t: string; f: Fonte; cor?: Cor; mat?: string }
type Parte = Trecho | { img: HTMLImageElement; doc: Documento };
type Ficha =
  | { k: "palavra"; t: string; f: Fonte; cor?: Cor; w: number }
  | { k: "espaco"; f: Fonte; w: number }
  | { k: "emoji"; e: string; w: number }
  | { k: "formula"; chave: string; w: number; h: number }
  | { k: "quebra" };

// Página e margens: A4 com margens fixas, ou o papel e as margens do modo página (Configurações > Editor e escrita).
let MARGEM_LATERAL = 54;
let TOPO = 58;
let BASE = A4.altura - 58;
let LARGURA = A4.largura - MARGEM_LATERAL * 2;
function definirPagina(papel: { largura: number; altura: number }, margem: number | null) {
  MARGEM_LATERAL = margem ?? 54;
  TOPO = margem ?? 58;
  BASE = papel.altura - (margem ?? 58);
  LARGURA = papel.largura - MARGEM_LATERAL * 2;
}
/** Marca da linha `---pagebreak`, trocada antes do Markdown virar HTML. */
const MARCA_QUEBRA = "ECOSQUEBRADEPAGINA";
const marcarQuebras = (corpo: string) => corpo.split("\n").map((l) => (QUEBRA_PAGINA.test(l) ? `\n${MARCA_QUEBRA}\n` : l)).join("\n");
/** `imagemDaFormula` desenha a 20px com resolução 3x. */
const ESCALA_FORMULA = 3;
const chaveFormula = (tex: string, bloco: boolean) => `${bloco ? "B" : "I"}:${tex.trim()}`;
const CINZA: Cor = [0.39, 0.45, 0.55];
const TEXTO: Cor = [0.06, 0.09, 0.16];
const AZUL: Cor = [0.15, 0.39, 0.92];
const LINHA: Cor = [0.89, 0.91, 0.94];

function fichasDe(trechos: Trecho[], tamanho: number, emojis: Imagens, formulas: Imagens): Ficha[] {
  const fichas: Ficha[] = [];
  for (const tr of trechos) {
    if (tr.mat) {
      const im = formulas.get(tr.mat);
      const fonte = limparTexto(tr.mat.slice(2));
      if (im) { const esc = tamanho / (20 * ESCALA_FORMULA); fichas.push({ k: "formula", chave: tr.mat, w: im.largura * esc, h: im.altura * esc }); }
      else fichas.push({ k: "palavra", t: fonte, f: "codigo", cor: tr.cor, w: medir(fonte, "codigo", tamanho) });
      continue;
    }
    const partes = tr.t.split(EMOJI);
    for (const parte of partes) {
      if (!parte) continue;
      if (parte.match(EMOJI)?.[0] === parte && ehEmoji(parte)) {
        if (emojis.get(parte)) fichas.push({ k: "emoji", e: parte, w: tamanho * 1.2 });
        continue;
      }
      for (const pedaco of limparTexto(parte).split(/( |\n)/)) {
        if (!pedaco) continue;
        if (pedaco === "\n") fichas.push({ k: "quebra" });
        else if (pedaco === " ") fichas.push({ k: "espaco", f: tr.f, w: medir(" ", tr.f, tamanho) });
        else fichas.push({ k: "palavra", t: pedaco, f: tr.f, cor: tr.cor, w: medir(pedaco, tr.f, tamanho) });
      }
    }
  }
  return fichas;
}

function empacotar(fichas: Ficha[], largura: number, tamanho: number): Ficha[][] {
  const linhas: Ficha[][] = [];
  let atual: Ficha[] = [];
  let usado = 0;
  const fechar = () => {
    while (atual.length && atual[atual.length - 1].k === "espaco") atual.pop();
    linhas.push(atual); atual = []; usado = 0;
  };
  for (const f of fichas) {
    if (f.k === "quebra") { fechar(); continue; }
    if (f.k === "espaco" && atual.length === 0 && linhas.length > 0) continue; // sem espaço no começo de linha quebrada
    if (usado + f.w > largura && atual.some((x) => x.k !== "espaco")) {
      fechar();
      if (f.k === "espaco") continue;
    }
    // palavra maior que a linha inteira: corta por caracteres
    if (f.k === "palavra" && f.w > largura) {
      let resto = f.t;
      while (resto) {
        let corte = resto.length;
        while (corte > 1 && medir(resto.slice(0, corte), f.f, tamanho) > largura - usado) corte--;
        const pedaco = resto.slice(0, corte);
        atual.push({ ...f, t: pedaco, w: medir(pedaco, f.f, tamanho) });
        usado += medir(pedaco, f.f, tamanho);
        resto = resto.slice(corte);
        if (resto) fechar();
      }
      continue;
    }
    atual.push(f); usado += f.w;
  }
  fechar();
  return linhas;
}

interface OpcoesParagrafo { cor?: Cor; tamanho?: number; recuo?: number; antes?: number; depois?: number; barra?: boolean; prefixo?: string; alinhar?: "centro" | "direita" }

/** Cursor de escrita: posiciona o texto de cima para baixo e vira a página quando acaba o espaço. */
class Escritor {
  y = TOPO;
  formulas: Imagens = new Map();
  constructor(readonly pdf: DocumentoPdf, readonly imagens: Imagens, readonly emojis: Imagens) {}

  garantir(altura: number) { if (this.y + altura > BASE) { this.pdf.novaPagina(); this.y = TOPO; } }
  espaco(pt: number) { this.y += pt; }

  texto(trechos: Trecho[], { cor = TEXTO, tamanho = 10.5, recuo = 0, antes = 0, depois = 5, barra = false, prefixo = "", alinhar }: OpcoesParagrafo = {}) {
    const fichas = fichasDe(trechos, tamanho, this.emojis, this.formulas);
    if (!fichas.some((f) => f.k !== "espaco" && f.k !== "quebra") && !prefixo) return;
    const x = MARGEM_LATERAL + recuo;
    const larguraPrefixo = prefixo ? 16 : 0;
    const linhas = empacotar(fichas, LARGURA - recuo - larguraPrefixo, tamanho);
    this.y += antes;
    linhas.forEach((linha, i) => {
      const comEmoji = linha.some((f) => f.k === "emoji");
      const altura = Math.max(tamanho * 1.45, comEmoji ? tamanho * 1.7 : 0, ...linha.map((f) => (f.k === "formula" ? f.h + tamanho * 0.35 : 0)));
      this.garantir(altura);
      if (barra) this.pdf.linha(x - 8, this.y - 1, x - 8, this.y + altura - 3, [0.8, 0.84, 0.89], 2);
      if (i === 0 && prefixo) this.pdf.texto(limparTexto(prefixo), x, this.y + tamanho, "normal", tamanho, cor);
      let cursor = x + larguraPrefixo;
      if (alinhar) {
        const usada = linha.reduce((soma, f) => soma + (f.k === "quebra" ? 0 : f.w), 0);
        const sobra = Math.max(0, LARGURA - recuo - larguraPrefixo - usada);
        cursor += alinhar === "centro" ? sobra / 2 : sobra;
      }
      for (const f of linha) {
        if (f.k === "palavra") this.pdf.texto(f.t, cursor, this.y + tamanho, f.f, tamanho, f.cor ?? cor);
        else if (f.k === "emoji") {
          const im = this.emojis.get(f.e)!;
          this.pdf.imagem(im.indice, cursor, this.y + tamanho - f.w * 0.82, f.w, f.w);
        } else if (f.k === "formula") this.pdf.imagem(this.formulas.get(f.chave)!.indice, cursor, this.y + (altura - f.h) / 2 - tamanho * 0.1, f.w, f.h);
        if (f.k !== "quebra") cursor += f.w;
      }
      this.y += altura;
    });
    this.y += depois;
  }

  /**
   * Tabela de verdade: colunas com largura proporcional ao conteúdo (cabendo na coluna do texto),
   * texto quebrando dentro da célula, cabeçalho em negrito com fundo, bordas finas e alinhamento
   * por coluna (`:---:`). Se a tabela vira a página, o cabeçalho se repete no topo.
   */
  tabela(el: Element, doc: Documento) {
    const TAM = 9;
    const PAD = 5;
    const ALT_LINHA = TAM * 1.4;
    const BORDA: Cor = [0.82, 0.85, 0.89];
    const FUNDO_CAB: Cor = [0.95, 0.96, 0.98];
    const linhasHtml = Array.from(el.querySelectorAll("tr"));
    if (!linhasHtml.length) return;
    const linhas = linhasHtml.map((tr) => Array.from(tr.children).map((c) => {
      const cab = c.tagName === "TH";
      const partes = inline(c, cab ? "negrito" : "normal", doc).filter((x): x is Trecho => !("img" in x));
      if (partes.length) { partes[0] = { ...partes[0], t: partes[0].t.replace(/^\s+/, "") }; partes[partes.length - 1] = { ...partes[partes.length - 1], t: partes[partes.length - 1].t.replace(/\s+$/, "") }; }
      const alin = (c.getAttribute("align") ?? (c as HTMLElement).style?.textAlign ?? "") as string;
      return { cab, fichas: fichasDe(partes, TAM, this.emojis, this.formulas), alinhar: alin === "center" ? "centro" : alin === "right" ? "direita" : "" };
    }));
    const ncol = Math.max(...linhas.map((l) => l.length));
    const larguraTexto = (fs: Ficha[]) => fs.reduce((soma, f) => soma + (f.k === "quebra" ? 0 : f.w), 0);
    const maiorPalavra = (fs: Ficha[]) => Math.max(0, ...fs.map((f) => (f.k === "palavra" ? f.w : 0)));
    // Largura natural (texto numa linha) e mínima (maior palavra) de cada coluna.
    const natural = Array.from({ length: ncol }, (_, c) => Math.max(24, ...linhas.map((l) => (l[c] ? larguraTexto(l[c].fichas) : 0))) + PAD * 2);
    const minima = Array.from({ length: ncol }, (_, c) => Math.min(LARGURA / ncol, Math.max(24, ...linhas.map((l) => (l[c] ? maiorPalavra(l[c].fichas) : 0))) + PAD * 2));
    const somaNat = natural.reduce((a, b) => a + b, 0);
    let larguras: number[];
    if (somaNat <= LARGURA) larguras = natural.map((w) => (w * LARGURA) / somaNat);
    else {
      // Não cabe: cada coluna fica com a mínima e o resto é repartido pela sobra de conteúdo.
      const somaMin = minima.reduce((a, b) => a + b, 0);
      const resto = Math.max(0, LARGURA - somaMin);
      const excesso = natural.map((w, i) => Math.max(0, w - minima[i]));
      const somaEx = excesso.reduce((a, b) => a + b, 0) || 1;
      larguras = minima.map((m, i) => (somaMin > LARGURA ? (m * LARGURA) / somaMin : m + (resto * excesso[i]) / somaEx));
    }
    const xs = larguras.reduce<number[]>((acc, w, i) => [...acc, acc[i] + w], [MARGEM_LATERAL]);
    const quebrar = (l: (typeof linhas)[number]) => Array.from({ length: ncol }, (_, c) => (l[c] ? empacotar(l[c].fichas, larguras[c] - PAD * 2, TAM) : []));
    const alturaDe = (q: Ficha[][][]) => Math.max(1, ...q.map((ls) => ls.length)) * ALT_LINHA + PAD * 2;

    const desenhar = (l: (typeof linhas)[number], q: Ficha[][][], h: number) => {
      const cab = l.some((c) => c.cab);
      if (cab) this.pdf.retangulo(MARGEM_LATERAL, this.y, LARGURA, h, FUNDO_CAB);
      q.forEach((ls, c) => {
        ls.forEach((linhaF, k) => {
          const usada = linhaF.reduce((soma, f) => soma + (f.k === "quebra" ? 0 : f.w), 0);
          const sobra = Math.max(0, larguras[c] - PAD * 2 - usada);
          let cursor = xs[c] + PAD + (l[c]?.alinhar === "centro" ? sobra / 2 : l[c]?.alinhar === "direita" ? sobra : 0);
          const base = this.y + PAD + k * ALT_LINHA + TAM;
          for (const f of linhaF) {
            if (f.k === "palavra") this.pdf.texto(f.t, cursor, base, f.f, TAM, f.cor ?? TEXTO);
            else if (f.k === "emoji") this.pdf.imagem(this.emojis.get(f.e)!.indice, cursor, base - f.w * 0.82, f.w, f.w);
            else if (f.k === "formula") this.pdf.imagem(this.formulas.get(f.chave)!.indice, cursor, base - f.h + TAM * 0.2, f.w, f.h);
            if (f.k !== "quebra") cursor += f.w;
          }
        });
      });
      // Bordas: topo da linha e verticais; a base fica com o topo da próxima (ou o fecho da tabela).
      this.pdf.linha(MARGEM_LATERAL, this.y, MARGEM_LATERAL + LARGURA, this.y, BORDA, 0.6);
      for (const x of xs) this.pdf.linha(x, this.y, x, this.y + h, BORDA, 0.6);
      this.y += h;
      this.pdf.linha(MARGEM_LATERAL, this.y, MARGEM_LATERAL + LARGURA, this.y, BORDA, 0.6);
    };

    const cabecalho = linhas[0].some((c) => c.cab) ? linhas[0] : null;
    const qCab = cabecalho ? quebrar(cabecalho) : null;
    const hCab = qCab ? alturaDe(qCab) : 0;
    this.y += 2;
    linhas.forEach((l, i) => {
      const q = quebrar(l);
      const h = alturaDe(q);
      if (this.y + h > BASE) {
        this.pdf.novaPagina();
        this.y = TOPO;
        if (cabecalho && qCab && i > 0) desenhar(cabecalho, qCab, hCab);
      }
      desenhar(l, q, h);
    });
    this.y += 8;
  }

  figura(img: HTMLImageElement, doc: Documento) {
    const src = resolverSrcImagem(img.getAttribute("src") ?? undefined, doc.id, doc.tipo);
    const pronta = src ? this.imagens.get(src) : null;
    const { alt, largura, alinhar } = lerAltImagem(img.getAttribute("alt") ?? "");
    const legenda = img.getAttribute("title");
    if (!pronta) { this.texto([{ t: `[imagem${alt ? `: ${alt}` : ""}]`, f: "italico" }], { cor: CINZA }); return; }
    // Largura pedida no alt (px de tela ≈ 0,75 pt; % da coluna).
    const pedida = largura ? (largura.endsWith("%") ? (LARGURA * parseFloat(largura)) / 100 : parseFloat(largura) * 0.75) : pronta.largura * 0.75;
    let w = Math.min(LARGURA, pedida);
    let h = (w * pronta.altura) / pronta.largura;
    const maximo = BASE - TOPO;
    if (h > maximo) { h = maximo; w = (h * pronta.largura) / pronta.altura; }
    this.garantir(h);
    const x = MARGEM_LATERAL + (alinhar === "centro" ? (LARGURA - w) / 2 : alinhar === "direita" ? LARGURA - w : 0);
    this.pdf.imagem(pronta.indice, x, this.y, w, h);
    this.y += h + (legenda ? 3 : 8);
    if (legenda) this.texto([{ t: legenda, f: "italico" }], { tamanho: 9, cor: CINZA, alinhar: "centro", depois: 6 });
  }

  /** Fórmula em bloco (`$$...$$`): centralizada; sem imagem, sai o código. */
  formula(chave: string) {
    const im = this.formulas.get(chave);
    if (!im) { this.texto([{ t: chave.slice(2), f: "codigo" }], { tamanho: 9, recuo: 8, depois: 6 }); return; }
    const esc = 11 / (20 * ESCALA_FORMULA);
    let w = im.largura * esc, h = im.altura * esc;
    if (w > LARGURA) { h *= LARGURA / w; w = LARGURA; }
    this.garantir(h + 8);
    this.pdf.imagem(im.indice, MARGEM_LATERAL + (LARGURA - w) / 2, this.y + 2, w, h);
    this.y += h + 8;
  }

  regua() {
    this.garantir(8);
    this.pdf.linha(MARGEM_LATERAL, this.y + 3, this.pdf.papel.largura - MARGEM_LATERAL, this.y + 3, LINHA, 0.75);
    this.y += 9;
  }
}

// ---------------------------------------------------------------- do HTML do markdown para o PDF

const negrito = (f: Fonte): Fonte => (f === "codigo" ? f : f === "italico" || f === "negritoItalico" ? "negritoItalico" : "negrito");
const italico = (f: Fonte): Fonte => (f === "codigo" ? f : f === "negrito" || f === "negritoItalico" ? "negritoItalico" : "italico");

/** Texto inline do elemento (sem listas aninhadas), com negrito/itálico/código/link e as imagens nos seus lugares. */
function inline(no: Node, f: Fonte, doc: Documento, cor?: Cor, saida: Parte[] = []): Parte[] {
  no.childNodes.forEach((filho, i, todos) => {
    if (filho.nodeType === 3) { saida.push({ t: (filho.textContent ?? "").replace(/\s+/g, " "), f, cor }); return; }
    if (filho.nodeType !== 1) return;
    const el = filho as Element;
    const tag = el.tagName;
    if (tag === "UL" || tag === "OL" || tag === "INPUT") return;
    if (tag === "BR") saida.push({ t: "\n", f, cor });
    else if (tag === "IMG") saida.push({ img: el as HTMLImageElement, doc });
    else if (tag === "STRONG" || tag === "B") inline(el, negrito(f), doc, cor, saida);
    else if (tag === "EM" || tag === "I") inline(el, italico(f), doc, cor, saida);
    else if (tag === "CODE" && el.classList.contains("math-inline")) saida.push({ t: "", f, cor, mat: chaveFormula(el.textContent ?? "", false) });
    else if (tag === "CODE") inline(el, "codigo", doc, cor, saida);
    else if (tag === "A") inline(el, f, doc, AZUL, saida);
    else { inline(el, f, doc, cor, saida); if (tag === "P" && i < todos.length - 1) saida.push({ t: "\n", f, cor }); }
  });
  return saida;
}

/** Escreve as partes na ordem: trechos de texto juntos num parágrafo e cada imagem como figura. */
function escreverPartes(e: Escritor, partes: Parte[], opcoes: OpcoesParagrafo = {}) {
  let grupo: Trecho[] = [];
  const despejar = () => {
    // apara os espaços das pontas do parágrafo
    if (grupo.length) { grupo[0] = { ...grupo[0], t: grupo[0].t.replace(/^\s+/, "") }; grupo[grupo.length - 1] = { ...grupo[grupo.length - 1], t: grupo[grupo.length - 1].t.replace(/\s+$/, "") }; }
    e.texto(grupo, opcoes); grupo = [];
  };
  for (const p of partes) {
    if ("img" in p) { despejar(); e.figura(p.img, p.doc); } else grupo.push(p);
  }
  despejar();
}

function textoSimples(el: Element): string {
  const copia = el.cloneNode(true) as Element;
  copia.querySelectorAll("ul,ol,input").forEach((x) => x.remove());
  copia.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
  return (copia.textContent ?? "").replace(/[ \t\r\f\v]+/g, " ").replace(/ ?\n ?/g, "\n").trim();
}

function escreverLista(e: Escritor, lista: Element, nivel: number, doc: Documento) {
  const ordenada = lista.tagName === "OL";
  let numero = 1;
  for (const item of Array.from(lista.children)) {
    if (item.tagName !== "LI") continue;
    const caixa = item.querySelector("input[type=checkbox]");
    const marcador = caixa ? (caixa.hasAttribute("checked") ? "[x]" : "[ ]") : ordenada ? `${numero}.` : "•";
    numero++;
    escreverPartes(e, inline(item, "normal", doc), { recuo: nivel * 16, prefixo: marcador, depois: 2 });
    for (const filho of Array.from(item.children)) if (filho.tagName === "UL" || filho.tagName === "OL") escreverLista(e, filho, nivel + 1, doc);
  }
  e.espaco(4);
}

function escreverBlocos(e: Escritor, raiz: Element, doc: Documento) {
  for (const no of Array.from(raiz.children)) {
    const tag = no.tagName;
    if (/^H[1-6]$/.test(tag)) {
      const tamanho = ({ H1: 16, H2: 14, H3: 12.5 } as Record<string, number>)[tag] ?? 11.5;
      escreverPartes(e, inline(no, "negrito", doc), { tamanho, antes: 8, depois: 4 });
    } else if (tag === "UL" || tag === "OL") escreverLista(e, no, 0, doc);
    else if (tag === "DETAILS") {
      for (const filho of Array.from(no.children)) {
        if (filho.tagName === "SUMMARY") escreverPartes(e, inline(filho, "negrito", doc), { depois: 3 });
        else escreverBlocos(e, wrapper(filho), doc);
      }
      // Texto solto direto dentro do <details> (sem parágrafo).
      const solto = Array.from(no.childNodes).filter((n) => n.nodeType === 3 && n.textContent?.trim()).map((n) => n.textContent!.trim()).join(" ");
      if (solto) e.texto([{ t: solto, f: "normal" }]);
    } else if ((tag === "P" || tag === "DIV") && (no.getAttribute("align") === "center" || no.getAttribute("align") === "right")) {
      const alinhar = no.getAttribute("align") === "center" ? "centro" : "direita";
      if (tag === "DIV" && no.children.length) for (const filho of Array.from(no.children)) escreverPartes(e, inline(filho, "normal", doc), { alinhar });
      else escreverPartes(e, inline(no, "normal", doc), { alinhar });
    }
    else if (tag === "BLOCKQUOTE") escreverPartes(e, inline(no, "italico", doc, CINZA), { cor: CINZA, recuo: 14, barra: true, depois: 6 });
    else if (tag === "PRE" && no.querySelector("code.math-display")) e.formula(chaveFormula(no.textContent ?? "", true));
    else if (tag === "PRE") e.texto([{ t: textoSimples(no), f: "codigo" }], { tamanho: 9, recuo: 8, depois: 6 });
    else if (tag === "HR") e.regua();
    else if (tag === "TABLE") e.tabela(no, doc); else if (tag === "IMG") e.figura(no as HTMLImageElement, doc);
    else if (tag === "P" && no.textContent?.trim() === MARCA_QUEBRA) { e.pdf.novaPagina(); e.y = TOPO; }
    else if (tag === "DIV" || tag === "SECTION") escreverBlocos(e, no, doc);
    else escreverPartes(e, inline(no, "normal", doc));
  }
}

/** Embrulha um elemento para reusar `escreverBlocos`, que percorre os filhos. */
function wrapper(el: Element): Element {
  const caixa = el.ownerDocument.createElement("div");
  caixa.appendChild(el.cloneNode(true));
  return caixa;
}

function escreverDocumento(e: Escritor, d: Documento, raiz: Element | null) {
  e.texto([{ t: d.tipo === "nota" ? "NOTA" : "TAREFA", f: "negrito" }], { tamanho: 8, cor: CINZA, depois: 2 });
  e.texto([{ t: d.titulo, f: "negrito" }], { tamanho: 20, depois: 4 });
  e.texto([{ t: d.meta.join("  ·  "), f: "normal" }], { tamanho: 10, cor: CINZA, depois: 2 });
  if (d.tags.length) e.texto([{ t: d.tags.map((t) => `#${t}`).join("  "), f: "normal" }], { tamanho: 10, cor: AZUL, depois: 2 });
  e.regua();
  if (raiz) escreverBlocos(e, raiz, d);
}

/** Gera um PDF com as notas e tarefas escolhidas (uma por página) e o entrega como download, igual ao .zip. */
export async function exportarDocumentosEmPdf(itens: ItemExportavel[]): Promise<void> {
  const docs = (await Promise.all(itens.map(carregar))).filter((d): d is Documento => !!d);
  if (!docs.length) throw new Error("Não há notas ou tarefas na seleção para exportar.");

  const raizes = docs.map((d) => {
    const html = renderToStaticMarkup(createElement(ReactMarkdown, { remarkPlugins: [remarkGfm, remarkMath, remarkMatematicaBloco, remarkBreaks, remarkSumario({ numerar: numerarTitulosLigado(), sumario: lerPreferenciasAplicativo().sumarioNoPdf })], rehypePlugins: [rehypeRaw], urlTransform: urlComImagemEmbutida }, marcarQuebras(semWikilink(escritaEmImagens(normalizarDelimitadores(d.corpo))))));
    const corpo = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html").body;
    // Só texto e formatação seguem para o PDF: nada de script/estilo vindo do HTML da nota.
    corpo.querySelectorAll("script,style,iframe,object,embed").forEach((x) => x.remove());
    return corpo;
  });


  // Imagens do texto e emojis: baixa/desenha tudo antes de montar as páginas.
  const prefs = lerPreferenciasAplicativo();
  const papel = prefs.notaPapel === "desligado" ? A4 : PAPEIS[prefs.notaPapel];
  definirPagina(papel, prefs.notaPapel === "desligado" ? null : MARGENS[prefs.notaMargem]);
  const pdf = new DocumentoPdf(papel);
  const imagens: Imagens = new Map();
  const emojis: Imagens = new Map();
  const formulas: Imagens = new Map();
  const pedidos: Promise<void>[] = [];
  const registrar = (mapa: Imagens, chave: string, quando: Promise<{ bytes: Uint8Array; largura: number; altura: number } | null>) => {
    mapa.set(chave, null);
    pedidos.push(quando.then((r) => { if (r) mapa.set(chave, { indice: pdf.adicionarImagem(r.bytes, r.largura, r.altura), largura: r.largura, altura: r.altura }); }));
  };
  raizes.forEach((raiz, i) => {
    raiz.querySelectorAll("img").forEach((img) => {
      const src = resolverSrcImagem(img.getAttribute("src") ?? undefined, docs[i].id, docs[i].tipo);
      if (src && !imagens.has(src)) registrar(imagens, src, imagemDaRede(src));
    });
    raiz.querySelectorAll("code.math-inline, code.math-display").forEach((c) => {
      const bloco = c.classList.contains("math-display");
      const chave = chaveFormula(c.textContent ?? "", bloco);
      if (!formulas.has(chave)) registrar(formulas, chave, imagemDaFormula(chave.slice(2), bloco));
    });
    for (const m of (raiz.textContent ?? "").matchAll(EMOJI)) if (ehEmoji(m[0]) && !emojis.has(m[0])) registrar(emojis, m[0], imagemDoEmoji(m[0]));
  });
  for (const d of docs) for (const m of `${d.titulo} ${d.tags.join(" ")}`.matchAll(EMOJI)) if (ehEmoji(m[0]) && !emojis.has(m[0])) registrar(emojis, m[0], imagemDoEmoji(m[0]));
  await Promise.all(pedidos);

  // Tinta das notas. Se medir o texto falhar, a escrita sai numa seção à parte; se a tinta não carregar, sai só o texto.
  const tintas: { fiel?: NotaFiel; fatias: FatiaTinta[] }[] = await Promise.all(docs.map(async (d) => {
    if (d.tipo !== "nota") return { fatias: [] };
    try {
      const tinta = await notas.tinta.obter(d.id);
      const tracos = tinta.tracos.filter((t) => !t.apagado_em && t.pontos.length);
      if (!tracos.length) return { fatias: [] };
      const largura = tinta.largura_coluna ?? LARGURA_COLUNA_PADRAO;
      try {
        const layout = await medirNota(d.corpo, d.id, largura);
        const imgs = new Map<string, ImagemPronta>();
        await Promise.all(layout.imagens.map(async (im) => {
          if (imgs.has(im.src)) return;
          const r = await imagemDaRede(im.src);
          if (r) imgs.set(im.src, { indice: pdf.adicionarImagem(r.bytes, r.largura, r.altura), largura: r.largura, altura: r.altura });
        }));
        return { fiel: { layout, tracos, largura, imagens: imgs }, fatias: [] };
      } catch { return { fatias: await fatiasDaTinta(tinta) }; }
    } catch { return { fatias: [] }; }
  }));

  const e = new Escritor(pdf, imagens, emojis);
  e.formulas = formulas;
  docs.forEach((d, i) => {
    if (i > 0) { pdf.novaPagina(); e.y = TOPO; }
    escreverDocumento(e, d, tintas[i].fiel ? null : raizes[i]);
    if (tintas[i].fiel) escreverFiel(e, tintas[i].fiel!);
    if (tintas[i].fatias.length) {
      pdf.novaPagina(); e.y = TOPO;
      e.texto([{ t: `Escrita à mão · ${d.titulo}`, f: "negrito" }], { tamanho: 8, cor: CINZA, depois: 4 });
      for (const f of tintas[i].fatias) {
        const h = f.ptAltura;
        if (e.y + h > BASE) { pdf.novaPagina(); e.y = TOPO; }
        pdf.imagem(pdf.adicionarImagem(f.bytes, f.largura, f.altura), MARGEM_LATERAL, e.y, LARGURA, h);
        e.y += h + 4;
      }
    }
  });
  e.espaco(10);
  e.texto([{ t: `Ecos · gerado em ${new Date().toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}`, f: "normal" }], { tamanho: 8, cor: [0.58, 0.64, 0.72] });
  const nome = docs.length === 1 ? docs[0].titulo.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim() || "Ecos" : `Ecos - ${docs.length} documentos`;
  baixarArquivo(pdf.gerar(), `${nome}.pdf`);
}
