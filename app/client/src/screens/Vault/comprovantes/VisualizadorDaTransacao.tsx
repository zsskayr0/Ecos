import { useState } from "react";
import type { AnexoApi } from "@/lib/api";
import { ComprovanteViewer } from "./ComprovanteViewer";

/**
 * Mostra os anexos de um lançamento no visualizador, com setas para passar de um para o outro. Com `comLancamento`, o
 * visualizador também abre o lançamento ao lado (usado a partir da lista); dentro do próprio editor do lançamento isso
 * seria redundante, então fica desligado.
 */
export function VisualizadorDaTransacao({ transacaoId, anexos, inicial = 0, onFechar, aoMudar, comLancamento = false }: {
  transacaoId: string;
  anexos: AnexoApi[];
  inicial?: number;
  onFechar: () => void;
  aoMudar?: () => void;
  comLancamento?: boolean;
}) {
  const [indice, setIndice] = useState(Math.max(0, Math.min(inicial, anexos.length - 1)));
  const atual = anexos[indice];
  if (!atual) return null;
  return (
    <ComprovanteViewer
      arquivo={atual}
      lancamentoId={comLancamento ? transacaoId : undefined}
      onFechar={onFechar}
      aoMudar={aoMudar}
      navegacao={anexos.length > 1 ? {
        posicao: `${indice + 1} de ${anexos.length}`,
        temAnterior: indice > 0,
        temProximo: indice < anexos.length - 1,
        anterior: () => setIndice((i) => Math.max(0, i - 1)),
        proximo: () => setIndice((i) => Math.min(anexos.length - 1, i + 1)),
      } : undefined}
    />
  );
}
