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
