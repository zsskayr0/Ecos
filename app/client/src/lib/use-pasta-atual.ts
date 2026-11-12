import { useEffect, useState } from "react";
import { pastas } from "@/lib/api";
import { useRefreshBus } from "@/lib/refresh-bus";
import { comPastasOtimistas, reconciliarPastasOtimistas, usePastasOtimistas } from "@/lib/pasta-otimista";
import type { PastaResumo } from "@/components/views/PastasGrade";

/** A própria pasta aberta (cor, ícone, tags e ajustes), lida na lista da pasta de cima. `null` até chegar ou se não existir mais. */
export function usePastaAtual(caminho: string, tipo: "nota" | "tarefa", espaco?: string): PastaResumo | null {
  const { versao } = useRefreshBus();
  const [servidor, setPasta] = useState<PastaResumo | null>(null);
  const sobrepostas = usePastasOtimistas();
  useEffect(() => {
    let vivo = true;
    const pai = caminho.split("/").slice(0, -1).join("/");
    pastas.listar({ tipo, pasta_pai: pai, espaco })
      .then((r) => { if (!vivo) return; reconciliarPastasOtimistas(r.subpastas as PastaResumo[]); setPasta((r.subpastas.find((p) => p.caminho === caminho) as PastaResumo | undefined) ?? null); })
      .catch(() => { if (vivo) setPasta(null); });
    return () => { vivo = false; };
  }, [caminho, tipo, espaco, versao]);
  return servidor ? comPastasOtimistas([servidor], sobrepostas)[0]! : null;
}
