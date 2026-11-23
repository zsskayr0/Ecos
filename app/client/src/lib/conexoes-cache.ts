import type { ConexoesItem } from "@/lib/api";

/** Quanto o que foi visto fica guardado; depois disso a entrada é apagada. */
export const VALIDADE_CONEXOES_MS = 5 * 60 * 1000;

interface Entrada<T> { valor: T; timer: ReturnType<typeof setTimeout> }

/** Mapa em memória com validade: cada gravação reinicia os 5 minutos e, vencidos, a entrada some sozinha. */
function criarCache<T>() {
  const mapa = new Map<string, Entrada<T>>();
  return {
    ler: (chave: string): T | undefined => mapa.get(chave)?.valor,
    gravar(chave: string, valor: T) {
      const antiga = mapa.get(chave);
      if (antiga) clearTimeout(antiga.timer);
      mapa.set(chave, { valor, timer: setTimeout(() => mapa.delete(chave), VALIDADE_CONEXOES_MS) });
    },
    limpar() { for (const e of mapa.values()) clearTimeout(e.timer); mapa.clear(); },
  };
}

export interface ConexoesGuardadas { dados: ConexoesItem; titulo: string }

const telas = criarCache<ConexoesGuardadas>();
const titulosDasPaginas = criarCache<string | null>();

/** Para comparar com e sem cache sem mexer no código: `localStorage.setItem("ecos:sem-cache-conexoes", "1")` (e `removeItem` para voltar). */
function desligado() {
  try { return localStorage.getItem("ecos:sem-cache-conexoes") === "1"; } catch { return false; }
}

/** Princípio otimista: a tela do mapa abre já com o que foi visto da última vez e depois confere o servidor. */
export const lerConexoes = (tipo: string, id: string) => (desligado() ? undefined : telas.ler(`${tipo}:${id}`));
export const guardarConexoes = (tipo: string, id: string, v: ConexoesGuardadas) => telas.gravar(`${tipo}:${id}`, v);

export const lerTituloPagina = (url: string) => (desligado() ? undefined : titulosDasPaginas.ler(url));
export const guardarTituloPagina = (url: string, titulo: string | null) => titulosDasPaginas.gravar(url, titulo);

export function limparCacheConexoes() { telas.limpar(); titulosDasPaginas.limpar(); }
