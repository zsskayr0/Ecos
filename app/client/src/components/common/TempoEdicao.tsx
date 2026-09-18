import { useSyncExternalStore } from "react";
import { formatDataHoraCompleta, formatUltimaEdicao } from "@/lib/format";

const PASSO_MS = 30_000;
const assinantes = new Set<() => void>();
let timer: number | undefined;

// Um relógio só para todos os horários da tela: "há 1 minuto" vira "há 2 minutos" sem recarregar.
function assinar(aviso: () => void) {
  assinantes.add(aviso);
  timer ??= window.setInterval(() => assinantes.forEach((f) => f()), PASSO_MS);
  return () => {
    assinantes.delete(aviso);
    if (!assinantes.size && timer !== undefined) {
      window.clearInterval(timer);
      timer = undefined;
    }
  };
}
const janelaAtual = () => Math.floor(Date.now() / PASSO_MS);

/** Data da última edição em formato de feed; o tooltip mostra a data e a hora completas. */
export function TempoEdicao({ iso, className }: { iso: string | null | undefined; className?: string }) {
  // O valor só serve para re-renderizar a cada tick; o texto usa a hora real.
  useSyncExternalStore(assinar, janelaAtual);
  if (!iso) return null;
  const texto = formatUltimaEdicao(iso);
  if (!texto) return null;
  return (
    <time dateTime={iso} title={`Editada em ${formatDataHoraCompleta(iso)}`} className={className}>
      {texto}
    </time>
  );
}
