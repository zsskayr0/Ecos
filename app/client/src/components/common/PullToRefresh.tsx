import { useRef, useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";

const LIMIAR_PX = 64;

/**
 * Pull to refresh — dragging down from the top of the page (scroll at 0)
 * redoes the screen's data fetch, with no connection to Search (sections
 * 3.1/3.3 are separate things). Pointer Events (the same mechanism the
 * rest of the product already uses for stroke capture, see architecture
 * section 1.3), so it works the same on touch and mouse.
 */
export function PullToRefresh({ onRefresh, children }: { onRefresh: () => Promise<void> | void; children: ReactNode }) {
  const [puxado, setPuxado] = useState(0);
  const [atualizando, setAtualizando] = useState(false);
  const inicioY = useRef<number | null>(null);
  const arrastando = useRef(false);

  function onPointerDown(e: React.PointerEvent) {
    if (window.scrollY > 0 || atualizando) return;
    inicioY.current = e.clientY;
    arrastando.current = true;
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!arrastando.current || inicioY.current === null) return;
    const delta = e.clientY - inicioY.current;
    if (delta <= 0) {
      setPuxado(0);
      return;
    }
    // Resistance — pulling twice as far only advances half as much, feels more predictable.
    setPuxado(Math.min(delta * 0.5, LIMIAR_PX * 1.4));
  }

  async function soltar() {
    if (!arrastando.current) return;
    arrastando.current = false;
    inicioY.current = null;
    if (puxado >= LIMIAR_PX) {
      setAtualizando(true);
      setPuxado(LIMIAR_PX);
      try {
        await onRefresh();
      } finally {
        setAtualizando(false);
        setPuxado(0);
      }
    } else {
      setPuxado(0);
    }
  }

  const altura = atualizando ? LIMIAR_PX : puxado;

  return (
    <div onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={soltar} onPointerCancel={soltar}>
      <div
        className="flex items-center justify-center overflow-hidden"
        style={{ height: altura, transition: arrastando.current ? "none" : "height 150ms ease-out" }}
      >
        <Loader2
          size={20}
          strokeWidth={1.75}
          className={`text-steel-300 ${atualizando ? "animate-spin" : ""}`}
          style={{
            opacity: Math.min(altura / LIMIAR_PX, 1),
            transform: atualizando ? undefined : `rotate(${Math.min((altura / LIMIAR_PX) * 360, 360)}deg)`,
          }}
        />
      </div>
      {children}
    </div>
  );
}
