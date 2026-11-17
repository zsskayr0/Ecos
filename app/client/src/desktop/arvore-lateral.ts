import { useSyncExternalStore } from "react";

/** Pequeno repositório de sinais do menu lateral que outras partes do desktop precisam ler (a barra do topo e a tela Arquivos). */
function sinal<T>(inicial: T) {
  let valor = inicial;
  const ouvintes = new Set<() => void>();
  return {
    definir(novo: T) { if (valor === novo) return; valor = novo; ouvintes.forEach((o) => o()); },
    usar(servidor: T): T { return useSyncExternalStore((aviso) => { ouvintes.add(aviso); return () => { ouvintes.delete(aviso); }; }, () => valor, () => servidor); },
  };
}

/** A árvore de pastas do menu lateral está à vista (modo explorador, menu expandido, seção Arquivos aberta). Quem mostra o caminho da pasta não precisa repeti-lo. */
const arvore = sinal(false);
export const definirArvoreLateralVisivel = arvore.definir;
export const useArvoreLateralVisivel = () => arvore.usar(false);

/** Largura atual do menu lateral em px (acompanha a animação). A barra do topo usa isso para alinhar o logo ao menu e as guias ao conteúdo. */
export const LARGURA_MENU_RECOLHIDO = 56;
const larguraMenu = sinal(LARGURA_MENU_RECOLHIDO);
export const definirLarguraMenu = larguraMenu.definir;
export const useLarguraMenu = () => larguraMenu.usar(LARGURA_MENU_RECOLHIDO);
