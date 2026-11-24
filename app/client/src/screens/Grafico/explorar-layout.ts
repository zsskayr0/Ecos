import type { ArestaGrafico, NoGrafico } from "@/lib/api";
import { montarGrafo } from "./grafo-puro";

export const LARGURA_CARTAO = 208;
export const ALTURA_CARTAO = 46;
/** Máximo de itens por anel a partir do 2º (os mais conectados ficam); o 1º anel mostra todos. */
export const MAX_ANEL_EXTERNO = 60;

export interface NoPosicionado { no: NoGrafico; anel: number; x: number; y: number; grau: number }
export interface LinhaExplorar { chave: string; de: string; para: string; d: string; anel: number }
export interface LayoutExplorar {
  nos: NoPosicionado[];
  linhas: LinhaExplorar[];
  /** Tamanho do mundo (quadrado) e posição do centro nele. */
  tamanho: number;
  centro: { x: number; y: number };
  /** Raio de cada anel (índice 1 em diante). */
  raios: number[];
  /** Quantos itens a profundidade pedida teria, mas foram deixados de fora pelo limite por anel. */
  ocultos: number;
}

/** Visada geral de `nos`: o que está até `profundidade` conexões do `raizId`, em anéis concêntricos, com as ligações entre eles. */
export function layoutAneis(nos: NoGrafico[], arestas: ArestaGrafico[], raizId: string, profundidade: number, incluirTags: boolean): LayoutExplorar | null {
  const g = montarGrafo(nos, arestas);
  const porId = new Map(g.nos.map((n) => [n.id, n]));
  const raiz = porId.get(raizId);
  if (!raiz) return null;

  // BFS por anéis, lembrando o pai (para manter os filhos perto dele no anel seguinte).
  const anelDe = new Map<string, number>([[raizId, 0]]);
  const pai = new Map<string, string>();
  const aneis: string[][] = [[raizId]];
  let ocultos = 0;
  for (let d = 1; d <= profundidade; d++) {
    const candidatos: string[] = [];
    for (const id of aneis[d - 1]) {
      for (const v of g.vizinhos.get(id) ?? []) {
        if (anelDe.has(v) || (!incluirTags && porId.get(v)!.tipo === "tag")) continue;
        anelDe.set(v, d);
        pai.set(v, id);
        candidatos.push(v);
      }
    }
    if (!candidatos.length) break;
    if (d > 1 && candidatos.length > MAX_ANEL_EXTERNO) {
      candidatos.sort((a, b) => (g.grau.get(b) ?? 0) - (g.grau.get(a) ?? 0));
      for (const id of candidatos.slice(MAX_ANEL_EXTERNO)) anelDe.delete(id);
      ocultos += candidatos.length - MAX_ANEL_EXTERNO;
      candidatos.length = MAX_ANEL_EXTERNO;
    }
    aneis.push(candidatos);
  }

  // Raios: cada anel precisa de arco suficiente para os cartões, e fica 300px além do anterior.
  const ARCO = 235;
  const raios: number[] = [0];
  for (let d = 1; d < aneis.length; d++) {
    const porArco = (aneis[d].length * ARCO) / (2 * Math.PI);
    raios.push(Math.max(porArco, raios[d - 1] + 300, 300));
  }
  const rMax = raios[raios.length - 1] || 0;
  const tamanho = Math.ceil(2 * (rMax + LARGURA_CARTAO) + 160);
  const centro = { x: tamanho / 2, y: tamanho / 2 };

  const posicoes = new Map<string, NoPosicionado>();
  posicoes.set(raizId, { no: raiz, anel: 0, x: centro.x, y: centro.y, grau: g.grau.get(raizId) ?? 0 });
  const angulo = new Map<string, number>([[raizId, -Math.PI / 2]]);
  for (let d = 1; d < aneis.length; d++) {
    // Ordena por ângulo do pai (filhos juntos), depois por tipo e título: o desenho é estável entre aberturas.
    const lista = [...aneis[d]].sort((a, b) =>
      (angulo.get(pai.get(a)!) ?? 0) - (angulo.get(pai.get(b)!) ?? 0)
      || porId.get(a)!.tipo.localeCompare(porId.get(b)!.tipo)
      || porId.get(a)!.titulo.localeCompare(porId.get(b)!.titulo, "pt-BR"));
    lista.forEach((id, i) => {
      const a = -Math.PI / 2 + (2 * Math.PI * i) / lista.length;
      angulo.set(id, a);
      posicoes.set(id, { no: porId.get(id)!, anel: d, x: centro.x + raios[d] * Math.cos(a), y: centro.y + raios[d] * Math.sin(a), grau: g.grau.get(id) ?? 0 });
    });
  }

  // Ligações entre quem está no desenho: curva suave, e o anel é o do extremo mais afastado (para a ordem da animação).
  const linhas: LinhaExplorar[] = [];
  for (const a of g.arestas) {
    const p = posicoes.get(a.origem), q = posicoes.get(a.destino);
    if (!p || !q) continue;
    // Sempre desenha do mais interno ao mais externo: a linha "nasce" no centro e cresce até o cartão.
    const [de, para] = p.anel <= q.anel ? [p, q] : [q, p];
    const mx = (de.x + para.x) / 2, my = (de.y + para.y) / 2;
    // Curva para o lado do centro do mundo, mais forte nas ligações entre itens do mesmo anel.
    const mesmoAnel = de.anel === para.anel;
    const k = mesmoAnel ? 0.35 : 0.12;
    const cx = mx + (centro.x - mx) * k, cy = my + (centro.y - my) * k;
    linhas.push({ chave: `${de.no.id}→${para.no.id}`, de: de.no.id, para: para.no.id, d: `M${de.x},${de.y} Q${cx},${cy} ${para.x},${para.y}`, anel: para.anel });
  }

  return { nos: [...posicoes.values()], linhas, tamanho, centro, raios, ocultos };
}

/** Escala que deixa o anel `anel` inteiro no visor (com piso para o texto continuar legível). */
export function escalaParaAnel(layout: LayoutExplorar, anel: number, vw: number, vh: number, piso = 0.45): number {
  const r = layout.raios[Math.min(anel, layout.raios.length - 1)] ?? 0;
  const metade = r + LARGURA_CARTAO / 2 + 40;
  const alvo = Math.min(vw / (2 * metade), vh / (2 * (r + ALTURA_CARTAO + 90)));
  return Math.max(piso, Math.min(1, alvo));
}
