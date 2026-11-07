/**
 * Leitura de Nota (celular). Sem tinta: o `MarkdownPreview` de sempre. Com tinta: o mesmo CodeMirror
 * da edição, somente leitura, dentro da coluna fixa ajustada à largura, para a tinta cair no lugar.
 */
import { useRef } from "react";
import { EditorVivo, type AreaLike } from "@/components/editor/EditorVivo";
import { MarkdownPreview, resolverSrcImagem } from "@/lib/markdown-mini";
import { useTinta } from "@/lib/tinta/use-tinta";
import { ativos, LARGURA_COLUNA_PADRAO } from "@/lib/tinta/tipos";
import { CLASSE_TEXTO_COLUNA, ColunaTinta } from "./ColunaTinta";

const NADA = () => {};
const PINCEL = { ferramenta: "caneta" as const, cor: "auto", espessura: 2.5 };

export function LeituraComTinta({ notaId, corpo }: { notaId: string; corpo: string }) {
  const tinta = useTinta(notaId);
  const area = useRef<AreaLike | null>(null);
  if (!tinta.carregado) return <div aria-hidden className="min-h-24" />;
  if (!ativos(tinta.tracos).length) {
    return corpo.trim() ? <MarkdownPreview corpo={corpo} itemId={notaId} tipo="nota" /> : <p className="text-text-muted">Nota vazia.</p>;
  }
  return (
    <ColunaTinta largura={tinta.largura ?? LARGURA_COLUNA_PADRAO} tracos={tinta.tracos} escrevendo={false} pincel={PINCEL} dedoDesenha={false} onOperacao={NADA}>
      <EditorVivo corpo={corpo} onCorpoChange={NADA} areaRef={area} ariaLabel="Conteúdo da nota" alturaMinima="6rem" className={CLASSE_TEXTO_COLUNA} somenteLeitura resolverImagem={(src) => resolverSrcImagem(src, notaId, "nota")} />
    </ColunaTinta>
  );
}
