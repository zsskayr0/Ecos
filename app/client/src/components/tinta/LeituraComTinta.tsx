/**
 * Leitura de Nota (celular). Usa o mesmo CodeMirror da edição, somente leitura, para que abrir a edição não mude
 * nada na tela: Fluido (texto que reflui, 16px) ou Página (coluna A4 ajustada à largura, onde a tinta cai no lugar).
 * Nota com tinta é sempre Página.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { extrairEstrutura } from "@/lib/sumario";
import type { EditorView } from "@codemirror/view";
import { OutlineTitulos } from "@/components/editor/OutlineTitulos";
import { IrParaTrecho } from "@/components/editor/IrParaTrecho";
import { EditorVivo, type AreaLike } from "@/components/editor/EditorVivo";
import { resolverSrcImagem } from "@/lib/markdown-mini";
import { corDoFundo, useFolha } from "@/lib/tinta/folha";
import { useTinta } from "@/lib/tinta/use-tinta";
import { ativos, LARGURA_COLUNA_PADRAO } from "@/lib/tinta/tipos";
import type { ModoVisualNota } from "@/lib/modo-visual-nota";
import { analisarWikilink, resolverWikilink, useAbrirDestino } from "@/lib/wikilinks";
import { avisar } from "@/lib/toast";
import { estiloColunaNota, estiloFolhaPagina, estiloTextoNota, linhaDaNota, usePreferenciasNota } from "@/lib/tipografia-nota";
import { CLASSE_TEXTO_COLUNA, ColunaTinta } from "./ColunaTinta";

const NADA = () => {};
const PINCEL = { ferramenta: "caneta" as const, cor: "auto", espessura: 2.5 };

export function LeituraComTinta({ notaId, corpo, modo, aoCarregar }: { notaId: string; corpo: string; modo: ModoVisualNota; aoCarregar?: (temTinta: boolean) => void }) {
  const tinta = useTinta(notaId);
  const prefsNota = usePreferenciasNota();
  const temTrilho = useMemo(() => extrairEstrutura(corpo).length >= 2, [corpo]);
  const area = useRef<AreaLike | null>(null);
  const raiz = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<EditorView | null>(null);
  const [folha] = useFolha(notaId);
  const abrirDestino = useAbrirDestino();
  const temTinta = tinta.carregado && ativos(tinta.tracos).length > 0;
  useEffect(() => { if (tinta.carregado) aoCarregar?.(temTinta); }, [tinta.carregado, temTinta, aoCarregar]);

  // A leitura usa a mesma folha da edição: página sem margens e com o mesmo fundo.
  useLayoutEffect(() => {
    const pagina = raiz.current?.closest<HTMLElement>(".ecos-detail-page") ?? null;
    if (!pagina) return;
    const cor = document.documentElement.getAttribute("data-theme") === "light" ? null : corDoFundo(folha.fundo);
    const alvos = [pagina, pagina.parentElement, pagina.parentElement?.parentElement].filter((x): x is HTMLElement => !!x);
    pagina.setAttribute("data-folha-plana", "");
    if (cor) alvos.forEach((x) => { x.style.setProperty("--ecos-folha", cor); x.style.backgroundColor = cor; });
    return () => { pagina.removeAttribute("data-folha-plana"); alvos.forEach((x) => { x.style.removeProperty("--ecos-folha"); x.style.removeProperty("background-color"); }); };
  }, [folha.fundo]);

  function abrirWikilink(interno: string, clique: MouseEvent) {
    const { referencia } = analisarWikilink(interno);
    void resolverWikilink(referencia, { tipo: "nota", id: notaId }).then((d) => {
      if (d) abrirDestino(d, clique);
      else avisar("Nenhuma nota ou tarefa com este título.");
    });
  }

  // Tudo mede em linhas (o número central das preferências), com ou sem escrita à mão.
  const linhaPx = linhaDaNota(prefsNota, 16);
  const editor = (
    <EditorVivo aoCriarView={setView} corpo={corpo} onCorpoChange={NADA} areaRef={area} ariaLabel="Conteúdo da nota" placeholder="Nota vazia." alturaMinima="6rem" className={CLASSE_TEXTO_COLUNA} somenteLeitura
      resolverImagem={(src) => resolverSrcImagem(src, notaId, "nota")} aoAbrirWikilink={abrirWikilink} />
  );
  return (
    <div ref={raiz} className="min-w-0 ecos-grade" data-trilho={temTrilho ? "" : undefined} style={{ background: "var(--ecos-folha, rgb(var(--ecos-surface-1-rgb)))", ...(temTinta || modo === "pagina" ? { "--ecos-linha-nota": `${linhaPx}px` } as CSSProperties : estiloTextoNota(prefsNota, 16)) }}>
      <OutlineTitulos corpo={corpo} view={view} raiz={raiz} />
      <IrParaTrecho itemId={notaId} corpo={corpo} view={view} raiz={raiz} />
      {!tinta.carregado
        ? <div aria-hidden className="min-h-24" />
        : temTinta || modo === "pagina"
        ? <ColunaTinta largura={tinta.largura ?? LARGURA_COLUNA_PADRAO} tracos={tinta.tracos} escrevendo={false} folhaPlana pincel={PINCEL} dedoDesenha={false} onOperacao={NADA} estiloFolha={folha.estilo} linhaPx={linhaPx}>{editor}</ColunaTinta>
        : <div style={{ ...estiloColunaNota(prefsNota), ...estiloFolhaPagina(prefsNota) }}>{editor}</div>}
    </div>
  );
}

