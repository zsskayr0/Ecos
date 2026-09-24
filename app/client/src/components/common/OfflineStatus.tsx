import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CloudUpload, Loader2, WifiOff } from "lucide-react";
import { obterEstadoOffline, marcarServidorDisponivel, type EstadoOffline } from "@/lib/offline-store";
import { sincronizarPendenciasOffline } from "@/lib/api";
import { useRefreshBus } from "@/lib/refresh-bus";
import { avisar } from "@/lib/toast";

export function OfflineStatus() {
  const [estado, setEstado] = useState<EstadoOffline>(() => obterEstadoOffline());
  const estadoRef = useRef(estado);
  const { notificar } = useRefreshBus();
  estadoRef.current = estado;

  const sincronizar = useCallback(async () => {
    if (!navigator.onLine || estadoRef.current.sincronizando || estadoRef.current.pendentes === 0) return;
    const enviadas = await sincronizarPendenciasOffline();
    if (enviadas > 0) {
      notificar();
      avisar(`${enviadas} alteração${enviadas === 1 ? "" : "ões"} sincronizada${enviadas === 1 ? "" : "s"}.`, "sucesso");
    }
  }, [notificar]);

  useEffect(() => {
    const atualizar = (evento: Event) => setEstado({ ...((evento as CustomEvent<EstadoOffline>).detail ?? obterEstadoOffline()) });
    const ficouOnline = () => { void sincronizar(); };
    const ficouOffline = () => marcarServidorDisponivel(false);
    window.addEventListener("ecos:offline-change", atualizar);
    window.addEventListener("online", ficouOnline);
    window.addEventListener("offline", ficouOffline);
    const timer = window.setInterval(() => {
      const atual = estadoRef.current;
      if (navigator.onLine && (atual.pendentes > 0 || !atual.servidorDisponivel)) void sincronizar();
    }, 15_000);
    void sincronizar();
    return () => {
      window.removeEventListener("ecos:offline-change", atualizar);
      window.removeEventListener("online", ficouOnline);
      window.removeEventListener("offline", ficouOffline);
      window.clearInterval(timer);
    };
  }, [sincronizar]);

  if (estado.servidorDisponivel && !estado.sincronizando && estado.pendentes === 0 && !estado.erro) return null;

  const Icone = estado.erro ? AlertTriangle : estado.sincronizando ? Loader2 : estado.servidorDisponivel ? CloudUpload : WifiOff;
  const texto = estado.erro
    ? `Sincronização pendente · ${estado.pendentes}`
    : estado.sincronizando
      ? `Sincronizando ${estado.pendentes} alteração${estado.pendentes === 1 ? "" : "ões"}…`
      : estado.servidorDisponivel
        ? `${estado.pendentes} alteração${estado.pendentes === 1 ? "" : "ões"} aguardando envio`
        : estado.pendentes > 0
          ? `Offline · ${estado.pendentes} alteração${estado.pendentes === 1 ? " salva" : "ões salvas"} neste dispositivo`
          : "Offline · usando os dados salvos neste dispositivo";

  return (
    <button
      type="button"
      onClick={() => void sincronizar()}
      disabled={estado.sincronizando || !navigator.onLine}
      role="status"
      title={estado.erro ?? (estado.pendentes > 0 ? "Tentar sincronizar agora" : undefined)}
      className={`fixed left-1/2 top-[calc(env(safe-area-inset-top)+10px)] z-[140] flex min-h-9 -translate-x-1/2 items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold shadow-nav backdrop-blur-md ${estado.erro ? "border-warning/50 bg-warning/15 text-warning" : "border-steel-500/40 bg-surface-1/95 text-text-primary"}`}
    >
      <Icone size={15} aria-hidden className={estado.sincronizando ? "animate-spin motion-reduce:animate-none" : ""} />
      {texto}
    </button>
  );
}
