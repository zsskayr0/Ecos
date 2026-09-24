import { useEffect, useState } from "react";
import { CheckCircle2 } from "lucide-react";

/** Aviso curto e passageiro ("Salvo em Notas"). Sem estado de React na origem: qualquer tela chama `avisar()`. */
type Toast = { mensagem: string; tom: "neutro" | "sucesso" };
type Ouvinte = (toast: Toast | null) => void;
const ouvintes = new Set<Ouvinte>();
let fechar: number | undefined;

const DURACAO_MS = 2500;

export function avisar(mensagem: string, tom: Toast["tom"] = "neutro"): void {
  window.clearTimeout(fechar);
  ouvintes.forEach((o) => o({ mensagem, tom }));
  fechar = window.setTimeout(() => ouvintes.forEach((o) => o(null)), DURACAO_MS);
}

export function ToastHost() {
  const [toast, setToast] = useState<Toast | null>(null);
  useEffect(() => {
    ouvintes.add(setToast);
    return () => { ouvintes.delete(setToast); };
  }, []);
  if (!toast) return null;
  return (
    <div
      aria-live="polite"
      role="status"
      className={`pointer-events-none fixed inset-x-4 bottom-[calc(env(safe-area-inset-bottom)+5.5rem)] z-[100] mx-auto flex w-fit items-center gap-2 rounded-xl border px-4 py-3 text-sm font-medium shadow-nav ${toast.tom === "sucesso" ? "border-success/50 bg-success text-white" : "border-steel-500/30 bg-surface-raised text-text-primary"}`}
    >
      {toast.tom === "sucesso" && <CheckCircle2 size={18} aria-hidden />}
      {toast.mensagem}
    </div>
  );
}
