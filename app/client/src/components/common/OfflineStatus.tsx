import { useCallback, useEffect, useRef, useState, type PointerEvent as PointerReact } from "react";
import { AlertTriangle, CloudUpload, Loader2, WifiOff } from "lucide-react";
import { obterEstadoOffline, marcarServidorDisponivel, type EstadoOffline } from "@/lib/offline-store";
import { sincronizarPendenciasOffline } from "@/lib/api";
import { useRefreshBus } from "@/lib/refresh-bus";
import { avisar } from "@/lib/toast";

export function OfflineStatus() {
  const [estado, setEstado] = useState<EstadoOffline>(() => obterEstadoOffline());
  const estadoRef = useRef(estado);
  const { notificar } = useRefreshBus();
  // Arrastar o aviso para fora o dispensa; ele volta sozinho quando a situação muda (ex.: voltou a falhar ou a sincronizar).
  const [dispensado, setDispensado] = useState<string | null>(null);
  const [arraste, setArraste] = useState<{ x: number; y: number; solto: boolean } | null>(null);
  const toque = useRef<{ id: number; x0: number; y0: number; moveu: boolean } | null>(null);
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

  const situacao = estado.erro ? "erro" : estado.sincronizando ? "sync" : estado.servidorDisponivel ? "pendente" : "offline";
  useEffect(() => { setDispensado((atual) => (atual !== null && atual !== situacao ? null : atual)); }, [situacao]);
  if (dispensado === situacao) return null;
  if (estado.servidorDisponivel && !estado.sincronizando && estado.pendentes === 0 && !estado.erro) return null;

  const Icone = estado.erro ? AlertTriangle : estado.sincronizando ? Loader2 : estado.servidorDisponivel ? CloudUpload : WifiOff;
  const texto = estado.erro
    ? `Sincronização pendente · ${estado.pendentes}`
    : estado.sincronizando
      ? `Sincronizando ${estado.pendentes} alteração${estado.pendentes === 1 ? "" : "ões"}…`
      : estado.servidorDisponivel
        ? `${estado.pendentes} alteração${estado.pendentes === 1 ? "" : "ões"} aguardando envio`
        : estado.pendentes > 0
          ? `Sem conexão. ${estado.pendentes} alteração${estado.pendentes === 1 ? " será enviada" : "ões serão enviadas"} quando voltar.`
          : "Sem conexão. Suas alterações serão enviadas quando voltar.";

  const aoPressionar = (e: PointerReact<HTMLButtonElement>) => {
    toque.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, moveu: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const aoMover = (e: PointerReact<HTMLButtonElement>) => {
    const t = toque.current;
    if (!t || t.id !== e.pointerId) return;
    const dx = e.clientX - t.x0;
    const dy = Math.min(0, e.clientY - t.y0); // para baixo não arrasta: o aviso fica no topo
    if (!t.moveu && Math.hypot(dx, dy) < 6) return;
    t.moveu = true;
    setArraste({ x: dx, y: dy, solto: false });
  };
  const aoSoltar = (e: PointerReact<HTMLButtonElement>) => {
    const t = toque.current;
    toque.current = null;
    if (!t || !t.moveu) return;
    const dx = e.clientX - t.x0;
    const dy = Math.min(0, e.clientY - t.y0);
    if (Math.abs(dx) > 70 || dy < -28) {
      setArraste({ x: Math.abs(dx) > Math.abs(dy) ? Math.sign(dx) * 400 : dx, y: Math.abs(dx) > Math.abs(dy) ? 0 : -120, solto: true });
      window.setTimeout(() => { setDispensado(situacao); setArraste(null); }, 180);
    } else setArraste({ x: 0, y: 0, solto: true }); // não foi longe: volta ao lugar
    window.addEventListener("click", (ev) => { ev.stopPropagation(); ev.preventDefault(); }, { capture: true, once: true });
    window.setTimeout(() => setArraste((a) => (a && a.x === 0 && a.y === 0 ? null : a)), 200);
  };

  return (
    <button
      type="button"
      onPointerDown={aoPressionar} onPointerMove={aoMover} onPointerUp={aoSoltar} onPointerCancel={aoSoltar}
      style={{ touchAction: "none", transform: `translateX(calc(-50% + ${arraste?.x ?? 0}px)) translateY(${arraste?.y ?? 0}px)`, opacity: arraste ? Math.max(0.2, 1 - Math.hypot(arraste.x, arraste.y) / 220) : 1, transition: arraste?.solto ? "transform 180ms ease-out, opacity 180ms ease-out" : undefined }}
      onClick={() => void sincronizar()}
      disabled={estado.sincronizando || !navigator.onLine}
      role="status"
      title={estado.erro ?? (estado.pendentes > 0 ? "Tentar sincronizar agora" : undefined)}
      className={`fixed left-1/2 top-[calc(env(safe-area-inset-top)+10px)] z-[140] flex min-h-9 select-none items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold shadow-nav backdrop-blur-md ${estado.erro ? "border-warning/50 bg-warning/15 text-warning" : "border-steel-500/40 bg-surface-1/95 text-text-primary"}`}
    >
      <Icone size={15} aria-hidden className={estado.sincronizando ? "animate-spin motion-reduce:animate-none" : ""} />
      {texto}
    </button>
  );
}
