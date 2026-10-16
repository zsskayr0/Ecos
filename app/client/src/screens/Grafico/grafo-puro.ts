import type { ArestaGrafico, NoGrafico } from "@/lib/api";
import type { TipoGrafico } from "@/lib/preferencias-grafico";

/** Funções puras do Gráfico (sem canvas nem física): testáveis e usadas pelo motor. */

export const normalizar = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Casa título (já normalizado) com a busca (já normalizada); busca vazia casa tudo. */
export const casaBusca = (chaveNormalizada: string, buscaNormalizada: string) => !buscaNormalizada || chaveNormalizada.includes(buscaNormalizada);

export const chaveAresta = (a: ArestaGrafico) => `${a.origem}→${a.destino}→${a.tipo}`;

export interface GrafoBase {
  nos: NoGrafico[];
  arestas: ArestaGrafico[];
  vizinhos: Map<string, Set<string>>;
  grau: Map<string, number>;
}

/**
 * Só existe o que o servidor devolveu: nó repetido (mesmo id) vale uma vez, e aresta cujo origem/destino não esteja
 * nos nós, autoaresta ou repetida (mesma origem, destino e tipo) é descartada. Nunca cria nó.
 */
export function montarGrafo(nos: NoGrafico[], arestas: ArestaGrafico[]): GrafoBase {
  const ids = new Set<string>();
  const nosUnicos: NoGrafico[] = [];
  for (const n of nos) {
    if (ids.has(n.id)) continue;
    ids.add(n.id);
    nosUnicos.push(n);
  }
  const vistas = new Set<string>();
  const arestasValidas: ArestaGrafico[] = [];
  const vizinhos = new Map<string, Set<string>>();
  for (const a of arestas) {
    if (a.origem === a.destino || !ids.has(a.origem) || !ids.has(a.destino)) continue;
    const chave = chaveAresta(a);
    if (vistas.has(chave)) continue;
    vistas.add(chave);
    arestasValidas.push(a);
    if (!vizinhos.has(a.origem)) vizinhos.set(a.origem, new Set());
    if (!vizinhos.has(a.destino)) vizinhos.set(a.destino, new Set());
    vizinhos.get(a.origem)!.add(a.destino);
    vizinhos.get(a.destino)!.add(a.origem);
  }
  const grau = new Map(nosUnicos.map((n) => [n.id, vizinhos.get(n.id)?.size ?? 0]));
  return { nos: nosUnicos, arestas: arestasValidas, vizinhos, grau };
}

/** Ids visíveis dado o filtro por tipo; sem "mostrar sem conexão", some quem não tem aresta entre tipos ligados. */
export function idsVisiveis(
  nos: NoGrafico[],
  arestas: ArestaGrafico[],
  tipos: Record<TipoGrafico, boolean>,
  mostrarSemConexao: boolean,
): Set<string> {
  const tipoDe = new Map(nos.map((n) => [n.id, n.tipo]));
  const grauVisivel = new Map<string, number>();
  for (const a of arestas) {
    const ts = tipoDe.get(a.origem);
    const tt = tipoDe.get(a.destino);
    if (ts && tt && tipos[ts] && tipos[tt]) {
      grauVisivel.set(a.origem, (grauVisivel.get(a.origem) ?? 0) + 1);
      grauVisivel.set(a.destino, (grauVisivel.get(a.destino) ?? 0) + 1);
    }
  }
  return new Set(nos.filter((n) => tipos[n.tipo] && (mostrarSemConexao || (grauVisivel.get(n.id) ?? 0) > 0)).map((n) => n.id));
}
