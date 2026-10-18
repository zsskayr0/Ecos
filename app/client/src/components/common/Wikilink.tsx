import { useEffect, useState } from "react";
import { analisarWikilink, resolverWikilink, useAbrirDestino, type Destino, type OrigemLink } from "@/lib/wikilinks";

interface Props {
  /** Texto de dentro do `[[ ]]`, sem o apelido. */
  interno: string;
  apelido?: string;
  origem?: OrigemLink;
}

/** `[[Título]]` na leitura: resolve o destino e abre ao clicar; sem destino, aparece apagado. */
export function Wikilink({ interno, apelido, origem }: Props) {
  const { referencia, titulo } = analisarWikilink(interno);
  const [destino, setDestino] = useState<Destino | null | undefined>(undefined);
  const abrir = useAbrirDestino();
  const origemTipo = origem?.tipo;
  const origemId = origem?.id;

  useEffect(() => {
    let ativo = true;
    setDestino(undefined);
    void resolverWikilink(referencia, origemTipo && origemId ? { tipo: origemTipo, id: origemId } : undefined).then((d) => { if (ativo) setDestino(d); });
    return () => { ativo = false; };
  }, [referencia, origemTipo, origemId]);

  const semDestino = destino === null;
  const dica = destino ? `Abrir ${destino.tipo === "tarefa" ? "tarefa" : "nota"}: ${destino.titulo}` : semDestino ? "Nenhuma nota ou tarefa com este título" : undefined;
  return (
    <button
      type="button"
      title={dica}
      disabled={semDestino}
      onClick={(e) => { e.stopPropagation(); if (destino) abrir(destino, e); }}
      className={`inline cursor-pointer rounded px-0.5 font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-steel-400 disabled:cursor-default ${semDestino ? "text-text-muted underline decoration-dashed decoration-1 underline-offset-4" : "text-steel-300 hover:bg-surface-3 hover:underline hover:underline-offset-4"}`}
    >
      {apelido || titulo}
    </button>
  );
}
