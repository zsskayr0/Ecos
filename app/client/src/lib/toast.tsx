import { useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";

/** Aviso curto e passageiro ("Salvo em Notas"). Sem estado de React na origem: qualquer tela chama `avisar()`. */
export type AcaoToast = { rotulo: string; aoClicar: () => void };
type Toast = { mensagem: string; tom: "neutro" | "sucesso" | "erro"; acao?: AcaoToast; chave: number };
type Ouvinte = (toast: Toast | null) => void;
const ouvintes = new Set<Ouvinte>();
let fechar: number | undefined;
let sequencia = 0;

const DURACAO_MS = 2500;
/** Com ação (Desfazer) ou erro, dá tempo de ler e agir; pausa em hover/foco (ver `ToastHost`). */
export const DURACAO_COM_ACAO_MS = 8000;

export function avisar(mensagem: string, tom: Toast["tom"] = "neutro", acao?: AcaoToast): void {
  window.clearTimeout(fechar);
  const toast: Toast = { mensagem, tom, acao, chave: ++sequencia };
  ouvintes.forEach((o) => o(toast));
  fechar = window.setTimeout(() => ouvintes.forEach((o) => o(null)), acao || tom === "erro" ? DURACAO_COM_ACAO_MS : DURACAO_MS);
}

export function ToastHost() {
  const [toast, setToast] = useState<Toast | null>(null);
  const pausado = useRef(false);
  useEffect(() => {
    ouvintes.add(setToast);
    return () => { ouvintes.delete(setToast); };
  }, []);
  // Hover/foco pausa o fechamento; ao soltar, dá mais um tempo.
  const pausar = () => { pausado.current = true; window.clearTimeout(fechar); };
  const retomar = () => {
    pausado.current = false;
    window.clearTimeout(fechar);
    fechar = window.setTimeout(() => ouvintes.forEach((o) => o(null)), DURACAO_MS);
  };
  if (!toast) return null;
  const erro = toast.tom === "erro";
  return (
    <div
      aria-live={erro ? "assertive" : "polite"}
      role={erro ? "alert" : "status"}
      onMouseEnter={toast.acao ? pausar : undefined}
      onMouseLeave={toast.acao ? retomar : undefined}
      onFocus={toast.acao ? pausar : undefined}
      onBlur={toast.acao ? retomar : undefined}
      className={`${toast.acao ? "" : "pointer-events-none "}fixed inset-x-4 bottom-[calc(env(safe-area-inset-bottom)+5.5rem)] z-[100] mx-auto flex w-fit max-w-full items-center gap-2 rounded-xl border px-4 py-3 text-sm font-medium shadow-nav ${toast.tom === "sucesso" ? "border-success/50 bg-success text-white" : erro ? "border-error/50 bg-error text-white" : "border-steel-500/30 bg-surface-raised text-text-primary"}`}
    >
      {toast.tom === "sucesso" && <CheckCircle2 size={18} aria-hidden />}
      {erro && <AlertCircle size={18} aria-hidden />}
      <span>{toast.mensagem}</span>
      {toast.acao && (
        <button
          type="button"
          className="ml-1 min-h-[2.75rem] rounded-lg px-3 font-semibold underline underline-offset-2 hover:bg-white/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          onClick={() => { toast.acao?.aoClicar(); setToast(null); window.clearTimeout(fechar); }}
        >
          {toast.acao.rotulo}
        </button>
      )}
    </div>
  );
}
