/**
 * Leitura de Nota (celular). Usa o mesmo CodeMirror da edição, somente leitura, para que abrir a edição não mude
 * nada na tela: Fluido (texto que reflui, 16px) ou Página (coluna A4 ajustada à largura, onde a tinta cai no lugar).
 * Nota com tinta é sempre Página.
 */
import { useEffect, useLayoutEffect, useRef, type CSSProperties } from "react";
import { EditorVivo, type AreaLike } from "@/components/editor/EditorVivo";
import { resolverSrcImagem } from "@/lib/markdown-mini";
import { corDoFundo, useFolha } from "@/lib/tinta/folha";
import { useTinta } from "@/lib/tinta/use-tinta";
import { ativos, LARGURA_COLUNA_PADRAO } from "@/lib/tinta/tipos";
import type { ModoVisualNota } from "@/lib/modo-visual-nota";
import { analisarWikilink, resolverWikilink, useAbrirDestino } from "@/lib/wikilinks";
import { avisar } from "@/lib/toast";
import { CLASSE_TEXTO_COLUNA, ColunaTinta } from "./ColunaTinta";

const NADA = () => {};
const PINCEL = { ferramenta: "caneta" as const, cor: "auto", espessura: 2.5 };
const FONTE_FLUIDA = { "--ecos-fonte-nota": "16px", "--ecos-linha-nota": "24px" } as CSSProperties;

export function LeituraComTinta({ notaId, corpo, modo, aoCarregar }: { notaId: string; corpo: string; modo: ModoVisualNota; aoCarregar?: (temTinta: boolean) => void }) {
  const tinta = useTinta(notaId);
  const area = useRef<AreaLike | null>(null);
  const raiz = useRef<HTMLDivElement>(null);
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
    if (cor) alvos.forEach((x) => x.style.setProperty("--ecos-folha", cor));
    return () => { pagina.removeAttribute("data-folha-plana"); alvos.forEach((x) => x.style.removeProperty("--ecos-folha")); };
  }, [folha.fundo]);

  function abrirWikilink(interno: string, clique: MouseEvent) {
    const { referencia } = analisarWikilink(interno);
    void resolverWikilink(referencia, { tipo: "nota", id: notaId }).then((d) => {
      if (d) abrirDestino(d, clique);
      else avisar("Nenhuma nota ou tarefa com este título.");
    });
  }

  const editor = (
    <EditorVivo corpo={corpo} onCorpoChange={NADA} areaRef={area} ariaLabel="Conteúdo da nota" placeholder="Nota vazia." alturaMinima="6rem" className={CLASSE_TEXTO_COLUNA} somenteLeitura
      resolverImagem={(src) => resolverSrcImagem(src, notaId, "nota")} aoAbrirWikilink={abrirWikilink} />
  );
  return (
    <div ref={raiz} className="min-w-0" style={{ background: "var(--ecos-folha, rgb(var(--ecos-surface-1-rgb)))", ...(temTinta || modo === "pagina" ? {} : FONTE_FLUIDA) }}>
      {!tinta.carregado
        ? <div aria-hidden className="min-h-24" />
        : temTinta || modo === "pagina"
        ? <ColunaTinta largura={tinta.largura ?? LARGURA_COLUNA_PADRAO} tracos={tinta.tracos} escrevendo={false} folhaPlana pincel={PINCEL} dedoDesenha={false} onOperacao={NADA} estiloFolha={folha.estilo}>{editor}</ColunaTinta>
        : editor}
    </div>
  );
}

