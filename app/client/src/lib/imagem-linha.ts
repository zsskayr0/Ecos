/**
 * Imagem em linhas: dentro de `.ecos-grade` toda imagem ocupa um número INTEIRO de linhas da nota, e o texto seguinte
 * começa na linha logo abaixo. A imagem pode encolher para caber (altura = linhas inteiras para baixo, largura na mesma
 * proporção), mas nunca cresce. Imagem menor que uma linha fica do tamanho que é e reserva a linha inteira (padding).
 */

/** Medidas finais (px) para uma imagem de `nw`×`nh` num espaço de `larguraUtil`, com a linha `linha`. `maxLargura` limita a largura pedida. */
export function medirImagemEmLinhas(nw: number, nh: number, larguraUtil: number, linha: number, maxAltura: number, maxLargura = Infinity) {
  const proporcao = nw / nh;
  let w = Math.min(nw, larguraUtil, maxLargura);
  let h = w / proporcao;
  if (h > maxAltura) { h = maxAltura; w = h * proporcao; }
  const linhas = Math.floor(h / linha + 0.001);
  const altura = linhas >= 1 ? linhas * linha : h;
  return { altura, largura: altura * proporcao, folga: linhas >= 1 ? 0 : linha - h };
}

const CHAVE = "ecos:imagem-dimensoes:v1";
const MAX_LEMBRADAS = 600;
let lembradas: Map<string, [number, number]> | null = null;
function carregar() {
  if (lembradas) return lembradas;
  lembradas = new Map();
  try { for (const [k, v] of Object.entries(JSON.parse(localStorage.getItem(CHAVE) ?? "{}") as Record<string, [number, number]>)) lembradas.set(k, v); } catch { /* sem armazenamento */ }
  return lembradas;
}
/** Tamanho original de uma imagem já vista: a nota reserva o lugar dela antes de ela carregar, e a tela não pula ao rolar. */
export const dimensoesLembradas = (src: string): { w: number; h: number } | null => { const d = carregar().get(src); return d ? { w: d[0], h: d[1] } : null; };
export function lembrarDimensoes(src: string, w: number, h: number) {
  const m = carregar();
  const atual = m.get(src);
  if (atual && atual[0] === w && atual[1] === h) return;
  m.delete(src); m.set(src, [w, h]);
  while (m.size > MAX_LEMBRADAS) m.delete(m.keys().next().value as string);
  try { localStorage.setItem(CHAVE, JSON.stringify(Object.fromEntries(m))); } catch { /* sem armazenamento */ }
}

/**
 * Aplica as medidas a uma imagem. `espaco` limita a largura; `medidor` (já na página) dá a linha; `dims` é o tamanho original
 * quando a imagem ainda não carregou (lembrado de outra vez). Devolve true se algo mudou.
 */
export function encaixarImagemEmLinhas(img: HTMLImageElement, espaco: HTMLElement | null, dims?: { w: number; h: number } | null, medidor: HTMLElement = img): boolean {
  const nw = img.naturalWidth || dims?.w || 0;
  const nh = img.naturalHeight || dims?.h || 0;
  if (!espaco || !medidor.closest(".ecos-grade") || !nw || !nh) return false;
  if (img.naturalWidth) lembrarDimensoes(img.currentSrc || img.src, img.naturalWidth, img.naturalHeight);
  const linha = parseFloat(getComputedStyle(medidor).lineHeight);
  const cs = getComputedStyle(espaco);
  const larguraUtil = espaco.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
  if (!(linha > 0) || !(larguraUtil > 0)) return false;
  // Largura pedida no Markdown (`![alt|300]`): vale como teto. Guardada na primeira vez, porque depois a largura é nossa.
  if (img.dataset.larguraPedida === undefined) img.dataset.larguraPedida = img.style.width;
  const pedida = img.dataset.larguraPedida;
  const teto = pedida.endsWith("px") ? parseFloat(pedida) : pedida.endsWith("%") ? (parseFloat(pedida) / 100) * larguraUtil : Infinity;
  const m = medirImagemEmLinhas(nw, nh, larguraUtil, linha, window.innerHeight * 0.7, teto);
  const alvo = [`${m.altura}px`, `${m.largura}px`, `${m.folga}px`];
  if (img.style.height === alvo[0] && img.style.width === alvo[1] && img.style.paddingBottom === alvo[2]) return false;
  img.style.height = alvo[0]; img.style.width = alvo[1]; img.style.paddingBottom = alvo[2]; img.style.maxHeight = "none";
  return true;
}
