import { useEffect, useRef } from "react";

/**
 * Bloqueio automático do Cofre por inatividade. Preferência deste aparelho (não vai ao servidor):
 * minutos sem uso até bloquear; 0 desliga. O tempo em segundo plano conta como inatividade.
 */
const CHAVE = "ecos:cofre:auto-bloqueio-min";
export const AUTO_BLOQUEIO_PADRAO_MIN = 5;
export const OPCOES_AUTO_BLOQUEIO: { valor: string; rotulo: string }[] = [
  { valor: "1", rotulo: "1 minuto" },
  { valor: "5", rotulo: "5 minutos" },
  { valor: "15", rotulo: "15 minutos" },
  { valor: "30", rotulo: "30 minutos" },
  { valor: "0", rotulo: "Nunca" },
];

export function lerAutoBloqueioMin(): number {
  try {
    const bruto = localStorage.getItem(CHAVE);
    if (bruto === null) return AUTO_BLOQUEIO_PADRAO_MIN;
    const n = Number(bruto);
    return OPCOES_AUTO_BLOQUEIO.some((o) => Number(o.valor) === n) ? n : AUTO_BLOQUEIO_PADRAO_MIN;
  } catch {
    return AUTO_BLOQUEIO_PADRAO_MIN;
  }
}

export function salvarAutoBloqueioMin(min: number): void {
  try { localStorage.setItem(CHAVE, String(min)); } catch { /* armazenamento indisponível: vale o padrão */ }
  window.dispatchEvent(new Event("ecos:auto-bloqueio-config"));
}

const EVENTOS_ATIVIDADE = ["pointerdown", "keydown", "wheel", "touchstart", "scroll"] as const;

/**
 * Enquanto `ativo` (Cofre aberto), chama `bloquear` depois de N minutos sem interação ou de voltar de um
 * segundo plano que durou mais que isso. Compara horários (não só um timer): timers são freados em segundo plano.
 */
export function useAutoBloqueio(ativo: boolean, bloquear: () => void) {
  const bloquearRef = useRef(bloquear);
  bloquearRef.current = bloquear;
  useEffect(() => {
    if (!ativo) return;
    let ultima = Date.now();
    let timer: number | undefined;
    let disparado = false;
    const limiteMs = () => lerAutoBloqueioMin() * 60_000;
    const verificar = () => {
      const limite = limiteMs();
      if (limite <= 0 || disparado) return;
      if (Date.now() - ultima >= limite) { disparado = true; bloquearRef.current(); }
    };
    const agendar = () => {
      window.clearTimeout(timer);
      const limite = limiteMs();
      if (limite > 0) timer = window.setTimeout(verificar, Math.max(1000, limite - (Date.now() - ultima) + 50));
    };
    const atividade = () => { if (document.visibilityState === "hidden") return; ultima = Date.now(); agendar(); };
    const visibilidade = () => { if (document.visibilityState === "visible") { verificar(); if (!disparado) { ultima = Date.now(); agendar(); } } };
    const mudouConfig = () => { ultima = Date.now(); agendar(); };
    for (const e of EVENTOS_ATIVIDADE) window.addEventListener(e, atividade, { passive: true, capture: true });
    document.addEventListener("visibilitychange", visibilidade);
    window.addEventListener("ecos:auto-bloqueio-config", mudouConfig);
    agendar();
    return () => {
      window.clearTimeout(timer);
      for (const e of EVENTOS_ATIVIDADE) window.removeEventListener(e, atividade, { capture: true } as EventListenerOptions);
      document.removeEventListener("visibilitychange", visibilidade);
      window.removeEventListener("ecos:auto-bloqueio-config", mudouConfig);
    };
  }, [ativo]);
}
