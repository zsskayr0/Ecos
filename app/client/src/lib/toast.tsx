import { useEffect, useState } from "react";

/** Aviso curto e passageiro ("Salvo em Notas"). Sem estado de React na origem: qualquer tela chama `avisar()`. */
type Ouvinte = (mensagem: string | null) => void;
const ouvintes = new Set<Ouvinte>();
let fechar: number | undefined;

const DURACAO_MS = 2500;

export function avisar(mensagem: string): void {
  window.clearTimeout(fechar);
  ouvintes.forEach((o) => o(mensagem));
  fechar = window.setTimeout(() => ouvintes.forEach((o) => o(null)), DURACAO_MS);
}

export function ToastHost() {
  const [mensagem, setMensagem] = useState<string | null>(null);
  useEffect(() => {
    ouvintes.add(setMensagem);
    return () => { ouvintes.delete(setMensagem); };
  }, []);
  if (!mensagem) return null;
  return (
    <div
      aria-live="polite"
      role="status"
      className="pointer-events-none fixed inset-x-4 bottom-[calc(env(safe-area-inset-bottom)+5.5rem)] z-[100] mx-auto w-fit rounded-xl border border-steel-500/30 bg-surface-raised px-4 py-3 text-sm font-medium text-text-primary shadow-nav"
    >
      {mensagem}
    </div>
  );
}
