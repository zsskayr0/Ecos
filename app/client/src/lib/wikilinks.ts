import { useCallback, useContext } from "react";
import { UNSAFE_NavigationContext } from "react-router-dom";
import { links } from "@/lib/api";
import { DocumentoPopupContext } from "@/lib/documento-popup";
import { carregarNotas } from "@/components/editor/wikilink-sugestoes";

export type TipoItem = "nota" | "tarefa";
export interface Destino { tipo: TipoItem; id: string; titulo: string }
export interface OrigemLink { tipo: TipoItem; id: string }

/** Rota de cada tipo de documento. */
export const caminhoDe = (tipo: TipoItem, id: string) => (tipo === "tarefa" ? `/tarefa/${id}` : `/notas/nota/${id}`);

/**
 * `[[nota:Título]]` / `[[tarefa:Título]]` desambiguam; sem prefixo vale o título inteiro.
 * `referencia` é o que o servidor recebe (com prefixo); `titulo` é o que se mostra quando não há apelido.
 */
export function analisarWikilink(interno: string): { referencia: string; titulo: string; tipo?: TipoItem } {
  const referencia = interno.trim();
  const m = /^(nota|tarefa):\s*(.+)$/i.exec(referencia);
  return m ? { referencia, titulo: m[2].trim(), tipo: m[1].toLowerCase() as TipoItem } : { referencia, titulo: referencia };
}

const VALIDADE_MS = 30_000;
const ESPERA_LOTE_MS = 15;
const entradas = new Map<string, { em: number; promessa: Promise<Destino | null> }>();
const filas = new Map<string, { origem?: OrigemLink; pendentes: Map<string, ((d: Destino | null) => void)[]> }>();

const chaveOrigem = (o?: OrigemLink) => (o ? `${o.tipo}:${o.id}` : "-");
const norm = (t: string) => t.trim().toLowerCase();

/** Sem a rota do servidor (404), as notas locais resolvem o que dá: só título de nota. */
async function resolverLocal(referencia: string): Promise<Destino | null> {
  const { titulo, tipo } = analisarWikilink(referencia);
  if (tipo === "tarefa") return null;
  try {
    const achada = (await carregarNotas()).find((n) => norm(n.titulo) === norm(titulo));
    return achada ? { tipo: "nota", id: achada.id, titulo: achada.titulo } : null;
  } catch { return null; }
}

async function descarregar(chave: string) {
  const fila = filas.get(chave);
  filas.delete(chave);
  if (!fila) return;
  const titulos = [...fila.pendentes.keys()];
  try {
    for (let i = 0; i < titulos.length; i += 200) {
      const lote = titulos.slice(i, i + 200);
      const { resolvidos } = await links.resolver(lote, fila.origem);
      for (const t of lote) for (const r of fila.pendentes.get(t) ?? []) r(resolvidos[t] ?? null);
    }
  } catch {
    for (const t of titulos) { const d = await resolverLocal(t); for (const r of fila.pendentes.get(t) ?? []) r(d); }
  }
}

/** Resolve um wikilink em lote (vários `[[...]]` da mesma tela viram uma chamada só) e guarda o resultado por alguns segundos. */
export function resolverWikilink(referencia: string, origem?: OrigemLink): Promise<Destino | null> {
  const chave = `${chaveOrigem(origem)}|${norm(referencia)}`;
  const guardada = entradas.get(chave);
  if (guardada && Date.now() - guardada.em < VALIDADE_MS) return guardada.promessa;
  const promessa = new Promise<Destino | null>((resolve) => {
    const k = chaveOrigem(origem);
    let fila = filas.get(k);
    if (!fila) {
      fila = { origem, pendentes: new Map() };
      filas.set(k, fila);
      setTimeout(() => { void descarregar(k); }, ESPERA_LOTE_MS);
    }
    fila.pendentes.set(referencia, [...(fila.pendentes.get(referencia) ?? []), resolve]);
  });
  entradas.set(chave, { em: Date.now(), promessa });
  return promessa;
}

export function esquecerWikilinksResolvidos() { entradas.clear(); }

/**
 * Abre um destino como o resto do app: janela flutuante no desktop (Ctrl/Cmd+clique = aba), navegação no mobile.
 * Não exige Router (testes e telas soltas): sem ele, simplesmente não navega.
 */
export function useAbrirDestino() {
  const abrirNaJanela = useContext(DocumentoPopupContext);
  const navigator = useContext(UNSAFE_NavigationContext)?.navigator;
  return useCallback((destino: { tipo: TipoItem; id: string }, clique?: { ctrlKey: boolean; metaKey: boolean }) => {
    const caminho = caminhoDe(destino.tipo, destino.id);
    if (abrirNaJanela) abrirNaJanela(caminho, !!clique && (clique.ctrlKey || clique.metaKey));
    else navigator?.push(caminho);
  }, [abrirNaJanela, navigator]);
}
