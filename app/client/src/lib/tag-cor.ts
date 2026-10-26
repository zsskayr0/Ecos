import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { CSSProperties } from "react";
import { tagsApi, type TagCatalogo } from "./api";
import { useVersaoOpcional } from "./refresh-bus";

/**
 * Cor das tags. A escolha mora no servidor (catálogo do espaço, igual para todos os membros); aqui fica o
 * espelho em memória para `corDaTag` continuar síncrono nos componentes, no mesmo molde de `team-color.ts`.
 * Sem escolha, a cor é derivada do nome. Nunca violeta: é a cor do Cofre.
 */
const PALETA_AUTOMATICA = ["#3E6FA8", "#0891B2", "#0D9488", "#16A34A", "#65A30D", "#CA8A04", "#EA580C", "#DC2626", "#DB2777", "#64748B"];

const doEspaco = new Map<string, string>();
const dePrimeiroEspaco = new Map<string, string>();
const ouvintes = new Set<() => void>();
let versaoDoEspelho = 0;

const chave = (espaco: string, tag: string) => `${espaco}\u0000${tag}`;

/** Cor derivada do nome da tag (mesmo nome, mesma cor em qualquer aparelho). */
export function corAutomaticaDaTag(tag: string): string {
  let hash = 0;
  for (let i = 0; i < tag.length; i++) hash = (hash * 31 + tag.charCodeAt(i)) >>> 0;
  return PALETA_AUTOMATICA[hash % PALETA_AUTOMATICA.length];
}

/** Guarda as cores que o servidor informou. `espaco` = o catálogo veio filtrado: só as daquele espaço são trocadas. */
export function registrarCoresDasTags(catalogo: TagCatalogo[], espaco?: string): void {
  for (const k of [...doEspaco.keys()]) if (!espaco || k.startsWith(`${espaco}\u0000`)) doEspaco.delete(k);
  if (!espaco) dePrimeiroEspaco.clear();
  for (const t of catalogo) {
    for (const e of t.espacos) {
      if (!e.cor) continue;
      doEspaco.set(chave(e.espaco, t.tag), e.cor);
      if (!dePrimeiroEspaco.has(t.tag)) dePrimeiroEspaco.set(t.tag, e.cor);
    }
  }
  versaoDoEspelho++;
  ouvintes.forEach((f) => f());
}

/** Cor da tag no catálogo do `espaco` (a escolhida ou a derivada). Sem `espaco`, vale a de qualquer espaço que a tenha. */
export function corDaTag(tag: string, espaco?: string): string {
  const salva = espaco ? doEspaco.get(chave(espaco, tag)) : dePrimeiroEspaco.get(tag);
  return salva ?? corAutomaticaDaTag(tag);
}

/** `true` se alguém escolheu a cor (em vez da automática) — a tela de tags usa para oferecer "Voltar ao automático". */
export function corFoiEscolhida(tag: string, espaco: string): boolean {
  return doEspaco.has(chave(espaco, tag));
}

const assinar = (f: () => void) => { ouvintes.add(f); return () => { ouvintes.delete(f); }; };
const instantaneo = () => versaoDoEspelho;

// Vários chips montam ao mesmo tempo: uma única busca por versão do bus.
let versaoBuscada: number | null = null;
function buscarCores(versao: number) {
  if (versaoBuscada === versao) return;
  versaoBuscada = versao;
  tagsApi.listar().then((c) => registrarCoresDasTags(c)).catch(() => { versaoBuscada = null; });
}

/** Mantém o espelho de cores carregado e redesenha o componente quando ele muda. */
export function useCoresDasTags(): (tag: string, espaco?: string) => string {
  const versao = useVersaoOpcional();
  useEffect(() => { if (versao !== null) buscarCores(versao); }, [versao]);
  const v = useSyncExternalStore(assinar, instantaneo, instantaneo);
  return useMemo(() => (tag, espaco) => (void v, corDaTag(tag, espaco)), [v]);
}

const mistura = (cor: string, pct: number) => `color-mix(in srgb, ${cor} ${pct}%, transparent)`;

/** Fundo e borda suaves na cor da tag; o texto puxa para a cor do tema para manter contraste nos dois temas. */
export function estiloDaTag(cor: string): CSSProperties {
  return { backgroundColor: mistura(cor, 16), boxShadow: `inset 0 0 0 1px ${mistura(cor, 38)}`, color: `color-mix(in srgb, ${cor} 62%, currentColor)` };
}
