/**
 * Geometria da tinta: funções puras (sem DOM), testadas em `geometria.test.ts`.
 * Suavização própria (sem dependência): média móvel leve + curvas quadráticas pelos pontos médios;
 * a caneta vira um contorno de largura variável pela pressão, com pontas arredondadas.
 */
import type { Ferramenta, PontoTinta, Traco } from "./tipos";

export interface Caixa { x0: number; y0: number; x1: number; y1: number }

const r1 = (n: number) => Math.round(n * 10) / 10;
/** Número curto e só com caracteres aceitos pelo servidor (nunca `e-5`, nunca `NaN`). */
const num = (n: number) => {
  const v = r1(Number.isFinite(n) ? n : 0);
  return (Object.is(v, -0) ? 0 : v).toString();
};

/** Descarta pontos quase coincidentes (o mouse manda vários no mesmo pixel). */
export function simplificar(pontos: readonly PontoTinta[], distanciaMin = 0.75): PontoTinta[] {
  if (pontos.length <= 2) return pontos.map((p) => ({ ...p }));
  const saida = [{ ...pontos[0] }];
  for (let i = 1; i < pontos.length - 1; i++) {
    const a = saida[saida.length - 1];
    const p = pontos[i];
    if (Math.hypot(p.x - a.x, p.y - a.y) >= distanciaMin) saida.push({ ...p });
  }
  saida.push({ ...pontos[pontos.length - 1] });
  return saida;
}

/** Média móvel de 3 pontos (mantém as pontas): tira o serrilhado da mão sem arredondar cantos demais. */
export function suavizar(pontos: readonly PontoTinta[]): PontoTinta[] {
  if (pontos.length < 3) return pontos.map((p) => ({ ...p }));
  return pontos.map((p, i) => {
    if (i === 0 || i === pontos.length - 1) return { ...p };
    const a = pontos[i - 1], b = pontos[i + 1];
    return { x: (a.x + 2 * p.x + b.x) / 4, y: (a.y + 2 * p.y + b.y) / 4, pressao: (a.pressao + 2 * p.pressao + b.pressao) / 4 };
  });
}

/** Linha suave pelos pontos (curvas quadráticas com controle no ponto e fim no ponto médio). */
export function caminhoCentral(pontos: readonly { x: number; y: number }[]): string {
  if (pontos.length === 0) return "";
  const [p0] = pontos;
  if (pontos.length === 1) return `M${num(p0.x)} ${num(p0.y)} L${num(p0.x + 0.1)} ${num(p0.y)}`;
  let d = `M${num(p0.x)} ${num(p0.y)}`;
  for (let i = 1; i < pontos.length - 1; i++) {
    const p = pontos[i], q = pontos[i + 1];
    d += ` Q${num(p.x)} ${num(p.y)} ${num((p.x + q.x) / 2)} ${num((p.y + q.y) / 2)}`;
  }
  const u = pontos[pontos.length - 1];
  return `${d} L${num(u.x)} ${num(u.y)}`;
}

function caminhoFechado(pontos: readonly { x: number; y: number }[]): string {
  if (pontos.length < 3) return "";
  const meio = (a: { x: number; y: number }, b: { x: number; y: number }) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const m0 = meio(pontos[pontos.length - 1], pontos[0]);
  let d = `M${num(m0.x)} ${num(m0.y)}`;
  for (let i = 0; i < pontos.length; i++) {
    const p = pontos[i], m = meio(p, pontos[(i + 1) % pontos.length]);
    d += ` Q${num(p.x)} ${num(p.y)} ${num(m.x)} ${num(m.y)}`;
  }
  return `${d} Z`;
}

/** Meia largura da caneta num ponto: pressão 0 → 35 %, 0,5 → 100 %, 1 → 165 % da espessura/2. */
export const meiaLargura = (espessura: number, pressao: number) => (espessura / 2) * (0.35 + 1.3 * Math.min(1, Math.max(0, pressao)));

/** Contorno fechado de largura variável (lado esquerdo, ponta, lado direito, ponta). */
export function contornoCaneta(pontosBrutos: readonly PontoTinta[], espessura: number): string {
  const pontos = suavizar(simplificar(pontosBrutos));
  const n = pontos.length;
  if (n === 0) return "";
  if (n === 1) {
    const p = pontos[0];
    const r = Math.max(0.6, meiaLargura(espessura, p.pressao));
    const circulo = Array.from({ length: 8 }, (_, i) => ({ x: p.x + r * Math.cos((i * Math.PI) / 4), y: p.y + r * Math.sin((i * Math.PI) / 4) }));
    return caminhoFechado(circulo);
  }
  const esq: { x: number; y: number }[] = [];
  const dir: { x: number; y: number }[] = [];
  const normal = (i: number) => {
    const a = pontos[Math.max(0, i - 1)], b = pontos[Math.min(n - 1, i + 1)];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    return { nx: -dy / len, ny: dx / len, tx: dx / len, ty: dy / len };
  };
  for (let i = 0; i < n; i++) {
    const p = pontos[i];
    const { nx, ny } = normal(i);
    const w = meiaLargura(espessura, p.pressao);
    esq.push({ x: p.x + nx * w, y: p.y + ny * w });
    dir.push({ x: p.x - nx * w, y: p.y - ny * w });
  }
  /** Meia-volta de `de` para `ate` em torno de `c`, para fora do traço (na direção `t`). */
  const ponta = (c: PontoTinta, t: { x: number; y: number }, de: { x: number; y: number }) => {
    const r = Math.hypot(de.x - c.x, de.y - c.y);
    const a0 = Math.atan2(de.y - c.y, de.x - c.x);
    // O meio do arco aponta para `t`; escolhe o sentido que passa por ele.
    const alvo = Math.atan2(t.y, t.x);
    const sentido = Math.sin(alvo - a0) >= 0 ? 1 : -1;
    return [1, 2, 3].map((k) => ({ x: c.x + r * Math.cos(a0 + sentido * (k * Math.PI) / 4), y: c.y + r * Math.sin(a0 + sentido * (k * Math.PI) / 4) }));
  };
  const fim = normal(n - 1), ini = normal(0);
  const contorno = [
    ...esq,
    ...ponta(pontos[n - 1], { x: fim.tx, y: fim.ty }, esq[n - 1]),
    ...dir.reverse(),
    ...ponta(pontos[0], { x: -ini.tx, y: -ini.ty }, dir[dir.length - 1]),
  ];
  return caminhoFechado(contorno);
}

export function gerarD(ferramenta: Ferramenta, pontos: readonly PontoTinta[], espessura: number): string {
  return ferramenta === "caneta" ? contornoCaneta(pontos, espessura) : caminhoCentral(suavizar(simplificar(pontos, 1.5)));
}

export function caixa(t: Pick<Traco, "pontos" | "espessura">): Caixa {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of t.pontos) {
    if (p.x < x0) x0 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x;
    if (p.y > y1) y1 = p.y;
  }
  const m = t.espessura;
  return { x0: x0 - m, y0: y0 - m, x1: x1 + m, y1: y1 + m };
}

export const intersecta = (a: Caixa, b: Caixa) => a.x0 <= b.x1 && a.x1 >= b.x0 && a.y0 <= b.y1 && a.y1 >= b.y0;

function distSegmento(px: number, py: number, a: PontoTinta, b: PontoTinta) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / l2)) : 0;
  return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
}

/** O ponto (borracha de raio `raio`) toca o traço? */
export function atinge(t: Pick<Traco, "pontos" | "espessura">, x: number, y: number, raio: number): boolean {
  const c = caixa(t);
  if (x < c.x0 - raio || x > c.x1 + raio || y < c.y0 - raio || y > c.y1 + raio) return false;
  const limite = raio + t.espessura / 2;
  if (t.pontos.length === 1) return Math.hypot(x - t.pontos[0].x, y - t.pontos[0].y) <= limite;
  for (let i = 1; i < t.pontos.length; i++) if (distSegmento(x, y, t.pontos[i - 1], t.pontos[i]) <= limite) return true;
  return false;
}

/** Id curto, único o bastante por Nota (tempo + aleatório), só `[0-9a-z]`. */
export function novoIdTraco(agora = Date.now()): string {
  const aleatorio = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => (b % 36).toString(36)).join("");
  return `${agora.toString(36)}${aleatorio}`;
}

export function novoTraco(ferramenta: Ferramenta, cor: string, espessura: number, pontosBrutos: readonly PontoTinta[]): Traco {
  const pontos = simplificar(pontosBrutos).map((p) => ({ x: r1(p.x), y: r1(p.y), pressao: Math.round(Math.min(1, Math.max(0, p.pressao)) * 100) / 100 }));
  return { id: novoIdTraco(), ferramenta, cor, espessura, pontos, d: gerarD(ferramenta, pontos, espessura), criado_em: new Date().toISOString() };
}

/** Interpola pontos para no máximo `passo` px entre vizinhos (pressão também). */
export function densificar(pontos: readonly PontoTinta[], passo = 2): PontoTinta[] {
  if (pontos.length < 2) return pontos.map((p) => ({ ...p }));
  const s: PontoTinta[] = [{ ...pontos[0] }];
  for (let i = 1; i < pontos.length; i++) {
    const a = pontos[i - 1], b = pontos[i];
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / passo));
    for (let k = 1; k <= n; k++) {
      const f = k / n;
      s.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, pressao: a.pressao + (b.pressao - a.pressao) * f });
    }
  }
  return s;
}

/**
 * Borracha por trecho: remove do traço os pontos a até `raio` (+ meia espessura) do caminho da borracha
 * e devolve os pedaços que sobraram (mínimo 2 pontos cada). Um único pedaço do mesmo tamanho = nada mudou.
 */
export function cortar(t: Pick<Traco, "pontos" | "espessura">, caminhoBorracha: readonly { x: number; y: number }[], raio: number): PontoTinta[][] {
  const pts = densificar(t.pontos, 2);
  const lim = raio + t.espessura / 2;
  const pedacos: PontoTinta[][] = [];
  let atual: PontoTinta[] = [];
  for (const p of pts) {
    if (caminhoBorracha.some((a) => Math.hypot(p.x - a.x, p.y - a.y) <= lim)) {
      if (atual.length >= 2) pedacos.push(atual);
      atual = [];
    } else atual.push(p);
  }
  if (atual.length >= 2) pedacos.push(atual);
  return pedacos;
}

export type FormaReconhecida = "linha" | "circulo" | "elipse" | "triangulo" | "retangulo" | "quadrilatero";

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

function distReta(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) {
  const l = dist(a, b);
  return l ? Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / l : dist(p, a);
}

function douglas(p: readonly { x: number; y: number }[], eps: number): { x: number; y: number }[] {
  if (p.length < 3) return [...p];
  let m = -1, k = 0;
  for (let i = 1; i < p.length - 1; i++) { const d = distReta(p[i], p[0], p[p.length - 1]); if (d > m) { m = d; k = i; } }
  if (m <= eps) return [p[0], p[p.length - 1]];
  return [...douglas(p.slice(0, k + 1), eps).slice(0, -1), ...douglas(p.slice(k), eps)];
}

const pt = (x: number, y: number): PontoTinta => ({ x, y, pressao: 0.5 });
const poligono = (v: readonly { x: number; y: number }[]) => densificar([...v, v[0]].map((q) => pt(q.x, q.y)), 2);

/**
 * Reconhece um traço feito à mão como figura geométrica (linha, círculo/elipse, triângulo, retângulo ou
 * quadrilátero) e devolve os pontos da figura limpa. `null` = é um rabisco/letra, fica como está.
 */
export function reconhecerForma(pontos: readonly PontoTinta[]): { forma: FormaReconhecida; pontos: PontoTinta[] } | null {
  const p = simplificar(pontos, 1.5);
  if (p.length < 4) return null;
  let comprimento = 0;
  for (let i = 1; i < p.length; i++) comprimento += dist(p[i - 1], p[i]);
  const xs = p.map((q) => q.x), ys = p.map((q) => q.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const diag = Math.hypot(x1 - x0, y1 - y0);
  if (comprimento < 24 || diag < 16) return null;
  const a = p[0], b = p[p.length - 1];
  const folga = dist(a, b);

  if (folga > comprimento * 0.2) {
    // Aberto: só linha reta.
    if (p.every((q) => distReta(q, a, b) <= Math.max(2.5, folga * 0.06))) {
      let fim = { x: b.x, y: b.y };
      const ang = Math.atan2(b.y - a.y, b.x - a.x), passo = Math.PI / 4;
      const alvo = Math.round(ang / passo) * passo;
      if (Math.abs(ang - alvo) < (4 * Math.PI) / 180) fim = { x: a.x + Math.cos(alvo) * folga, y: a.y + Math.sin(alvo) * folga };
      return { forma: "linha", pontos: densificar([pt(a.x, a.y), pt(fim.x, fim.y)], 2) };
    }
    return null;
  }

  // Fechado: vértices por Douglas-Peucker (a partir do ponto mais distante do início).
  let kf = 0, md = 0;
  p.forEach((q, i) => { const d = dist(q, a); if (d > md) { md = d; kf = i; } });
  const eps = diag * 0.07;
  const v = [...douglas(p.slice(0, kf + 1), eps).slice(0, -1), ...douglas(p.slice(kf), eps)];
  if (dist(v[v.length - 1], v[0]) < diag * 0.12) v.pop();
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, ra = (x1 - x0) / 2, rb = (y1 - y0) / 2;
  const erro = ra > 4 && rb > 4 ? p.reduce((s, q) => s + Math.abs(Math.hypot((q.x - cx) / ra, (q.y - cy) / rb) - 1), 0) / p.length : 1;
  if (v.length >= 5 && erro < 0.14) {
    const circulo = Math.abs(ra - rb) / Math.max(ra, rb) < 0.14;
    const r = (ra + rb) / 2;
    const el = Array.from({ length: 73 }, (_, i) => { const t = (i / 72) * Math.PI * 2; return pt(cx + (circulo ? r : ra) * Math.cos(t), cy + (circulo ? r : rb) * Math.sin(t)); });
    return { forma: circulo ? "circulo" : "elipse", pontos: el };
  }
  if (v.length === 3) return { forma: "triangulo", pontos: poligono(v) };
  if (v.length === 4) {
    const lados = v.map((q, i) => ({ x: v[(i + 1) % 4].x - q.x, y: v[(i + 1) % 4].y - q.y }));
    const retos = lados.every((l, i) => { const m = lados[(i + 1) % 4]; return Math.abs(l.x * m.x + l.y * m.y) / (Math.hypot(l.x, l.y) * Math.hypot(m.x, m.y) || 1) < 0.35; });
    const alinhado = lados.every((l) => { const g = Math.abs((Math.atan2(l.y, l.x) * 180) / Math.PI) % 90; return g < 10 || g > 80; });
    if (retos && alinhado) return { forma: "retangulo", pontos: poligono([{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }]) };
    return { forma: "quadrilatero", pontos: poligono(v) };
  }
  return null;
}

/** Ponto dentro do polígono (laço), pela regra par-ímpar. */
export function pontoNoPoligono(x: number, y: number, poly: readonly { x: number; y: number }[]): boolean {
  let dentro = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) dentro = !dentro;
  }
  return dentro;
}

/** Traços (ativos) que o laço envolve: pelo menos metade dos pontos do traço fica dentro dele. */
export function selecionadosPeloLaco(tracos: readonly Traco[], laco: readonly { x: number; y: number }[]): string[] {
  if (laco.length < 3) return [];
  return tracos.filter((t) => {
    if (t.apagado_em) return false;
    const pts = densificar(t.pontos, 4);
    return pts.filter((p) => pontoNoPoligono(p.x, p.y, laco)).length * 2 >= pts.length;
  }).map((t) => t.id);
}

/** Caixa que envolve todos os traços (com a margem da espessura), ou `null` se a lista é vazia. */
export function caixaDoConjunto(tracos: readonly Traco[]): Caixa | null {
  if (!tracos.length) return null;
  return tracos.map(caixa).reduce((a, b) => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) }));
}

/** Cópia do traço movida/ampliada: ponto → `ancora + (ponto − ancora) × fator + (dx, dy)`; a espessura acompanha o fator. */
export function transformarTraco(t: Traco, ancora: { x: number; y: number }, fator: number, dx: number, dy: number): Traco {
  const pontos = t.pontos.map((p) => ({ x: ancora.x + (p.x - ancora.x) * fator + dx, y: ancora.y + (p.y - ancora.y) * fator + dy, pressao: p.pressao }));
  return novoTraco(t.ferramenta, t.cor, Math.round(t.espessura * fator * 10) / 10 || t.espessura, pontos);
}
