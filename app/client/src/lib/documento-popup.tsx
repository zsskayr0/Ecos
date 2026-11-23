import { createContext, useCallback, useContext } from "react";
import { useNavigate } from "react-router-dom";
import { tarefasPrivadas } from "@/lib/api";
import { avisar } from "@/lib/toast";

/** Fornecido pelo shell desktop: abre Tarefa/Nota numa janela flutuante (ou, com `emAba`, direto numa aba nova). */
/** Como abrir: `false` janela flutuante; `true` guia nova em foco; `"segundo-plano"` guia nova sem sair do que está aberto. */
export type ModoAbrirDocumento = boolean | "segundo-plano";
export const DocumentoPopupContext = createContext<((path: string, emAba: ModoAbrirDocumento) => void) | null>(null);

/** Permite que um documento aberto atualize o título da sua própria janela. */
export const TituloJanelaContext = createContext<((titulo: string) => void) | null>(null);
/** Fecha o documento atual, seja uma aba do workspace ou uma janela flutuante. */
export const FecharDocumentoContext = createContext<(() => void) | null>(null);
/** Indica que uma janela de documento está ocupando a camada Focus. */
export const ModoFocusDocumentoContext = createContext(false);
/** Área independente, ao lado da tarefa Focus, onde o planejamento é montado. */
export const PainelFocusTarefaContext = createContext<HTMLElement | null>(null);
/** Painel esquerdo do Focus (espelho do painel direito), onde a nota monta o sumário. */
export const PainelFocusEsquerdoContext = createContext<HTMLElement | null>(null);
/** Espaço no cabeçalho da camada Focus (ao lado do X) onde a tarefa coloca suas ações: concluir, apagar, recolher painel. */
export const AcoesFocusContext = createContext<HTMLElement | null>(null);
/** Espaço no cabeçalho da janela flutuante (ao lado de "Fixar como aba") onde a tela coloca ações próprias. */
export const AcoesJanelaContext = createContext<HTMLElement | null>(null);
/** Recolhe/expande o painel lateral do modo Focus (a tarefa ocupa a largura toda quando recolhido). */
export const PainelFocusControleContext = createContext<{ aberto: boolean; alternar: () => void; /** `false` no Modo Slide, que não tem painel lateral. */ disponivel?: boolean }>({ aberto: true, alternar: () => {} });

interface ModificadoresDeClique {
  ctrlKey: boolean;
  metaKey: boolean;
  /** 1 = botão do meio: abre em guia, como o Ctrl+clique. */
  button?: number;
}

/** No mobile (sem shell desktop) cai na navegação normal para a tela de detalhe. Passe o evento do clique: Ctrl/Cmd+clique abre em aba. */
export function useAbrirDocumento() {
  const abrir = useContext(DocumentoPopupContext);
  const navigate = useNavigate();
  return useCallback(
    (path: string, clique?: ModificadoresDeClique) => {
      // Tarefa mascarada: o conteúdo está numa pasta trancada; não há o que abrir sem a senha.
      const id = /^\/tarefa\/([^/?#]+)/.exec(path)?.[1];
      if (id && tarefasPrivadas.has(id)) { avisar("Tarefa privada. Destranque a pasta dela para abrir.", "neutro"); return; }
      return abrir ? abrir(path, clique?.button === 1 ? "segundo-plano" : !!clique && (clique.ctrlKey || clique.metaKey)) : navigate(path);
    },
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
