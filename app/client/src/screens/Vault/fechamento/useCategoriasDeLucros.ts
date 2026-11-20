import { useEffect, useState } from "react";
import { vault } from "@/lib/api";

/**
 * Ids das categorias que valem como distribuição de lucros (a escolhida no Fechamento e as subcategorias dela). Vazio
 * enquanto carrega, quando nenhuma foi escolhida ou se o Cofre ainda não oferece o Fechamento.
 */
export function useCategoriasDeLucros(): string[] {
  const [ids, setIds] = useState<string[]>([]);
  useEffect(() => {
    let vivo = true;
    // A chamada vem de dentro de uma promessa para que uma falha (ou um Cofre antigo) vire só "nenhuma categoria".
    Promise.resolve()
      .then(() => vault.fechamento.configuracao())
      .then((c) => { if (vivo) setIds(c?.categorias_lucros ?? []); })
      .catch(() => { /* sem Fechamento configurado: o editor não oferece o recibo */ });
    return () => { vivo = false; };
  }, []);
  return ids;
}
