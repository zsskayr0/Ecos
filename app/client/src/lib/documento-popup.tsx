import { createContext, useCallback, useContext } from "react";
import { useNavigate } from "react-router-dom";

/** Fornecido pelo shell desktop: abre Tarefa/Nota numa janela flutuante (ou, com `emAba`, direto numa aba nova). */
export const DocumentoPopupContext = createContext<((path: string, emAba: boolean) => void) | null>(null);

/** Permite que um documento aberto atualize o título da sua própria janela. */
export const TituloJanelaContext = createContext<((titulo: string) => void) | null>(null);
/** Fecha o documento atual, seja uma aba do workspace ou uma janela flutuante. */
export const FecharDocumentoContext = createContext<(() => void) | null>(null);

interface ModificadoresDeClique {
  ctrlKey: boolean;
  metaKey: boolean;
}

/** No mobile (sem shell desktop) cai na navegação normal para a tela de detalhe. Passe o evento do clique: Ctrl/Cmd+clique abre em aba. */
export function useAbrirDocumento() {
  const abrir = useContext(DocumentoPopupContext);
  const navigate = useNavigate();
  return useCallback(
    (path: string, clique?: ModificadoresDeClique) =>
      abrir ? abrir(path, !!clique && (clique.ctrlKey || clique.metaKey)) : navigate(path),
    [abrir, navigate],
  );
}

export interface AjusteDeJanela {
  /** Tamanho natural do conteúdo (px da imagem; pontos da página do PDF). */
  larguraNatural: number;
  alturaNatural: number;
  /** Espaço fixo que o próprio conteúdo soma ao redor (paddings, barra de ferramentas). */
  extraLargura: number;
  extraAltura: number;
  /** Fator máximo de ampliação sobre o tamanho natural (padrão 1: nunca amplia). */
  ampliar?: number;
}

/** Só existe dentro da janela flutuante: quem sabe o tamanho do conteúdo (imagem, PDF) pede que ela nasça ajustada. `null` em abas e no mobile. */
export const AjusteJanelaContext = createContext<((ajuste: AjusteDeJanela) => void) | null>(null);

export function useAjustarJanela() {
  return useContext(AjusteJanelaContext);
}

/**
 * Painel lateral da janela flutuante do lançamento: o seletor de categorias pede `abrir(largura)` e a janela se alarga
 * (mantendo-se centralizada) para encaixar o painel dentro dela, sem emenda entre os dois. Devolve a largura concedida
 * (0 = sem espaço: quem pediu usa outro jeito). `montagem` é onde o painel é desenhado. `null` fora dessas janelas.
 */
export interface PainelDeJanela {
  abrir: (largura: number) => number;
  fechar: () => void;
  montagem: HTMLElement | null;
}
export const PainelJanelaContext = createContext<PainelDeJanela | null>(null);
