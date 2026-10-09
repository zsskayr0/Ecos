import { AlertTriangle } from "lucide-react";

/** Único aviso de erro de carregamento das telas, com "Tentar de novo" quando há como repetir. */
export function EstadoErro({ mensagem, onTentarDeNovo }: { mensagem: string; onTentarDeNovo?: () => void }) {
  return (
    <div role="alert" className="mb-4 flex items-start gap-2 rounded-2xl border border-error/40 bg-error/10 p-3 text-sm text-error">
      <AlertTriangle size={16} aria-hidden className="mt-0.5 shrink-0" />
      <span className="min-w-0 flex-1">{mensagem}</span>
      {onTentarDeNovo && <button type="button" onClick={onTentarDeNovo} className="shrink-0 font-medium underline underline-offset-2">Tentar de novo</button>}
    </div>
  );
}
