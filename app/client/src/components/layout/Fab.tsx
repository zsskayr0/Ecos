import { useEffect, useRef, useState } from "react";
import { Plus, Search } from "lucide-react";
import { useLocation } from "react-router-dom";
import { useAppUI } from "@/lib/ui-context";

/** Distância de arrasto (px) que gira o globo um quarto de volta, trazendo a lupa para a frente; ao soltar com o giro completo, abre a Busca. */
const ARRASTO_COMPLETO_PX = 44; // = 28px de raio × π/2: o dedo anda o mesmo que a superfície, num quarto de volta (90°)
const CHAVE_DICA = "ecos:dica-busca-fab";

/**
 * Floating FAB, encaixado no recorte do meio da pílula de navegação (ver .ecos-fab[data-pilula] no global.css).
 * Cyan→violet gradient; flips to violet→cyan inside the Vault. Contextual
 * behavior by origin (section 2.4): Feed opens the choice popup, Agenda
 * opens the Tarefa form directly, Vault opens the Transacao form directly.
 * Fora do Cofre, arrastar o botão para baixo o faz girar como um globo (ele não sai do lugar): o dedo "navega" pela
 * superfície e a lupa sobe do polo de cima. Soltar com o giro completo abre a busca rápida; soltar antes devolve o globo.
 */
export function Fab() {
  const location = useLocation();
  const { abrirCaptura, diaCofre, abrirBusca } = useAppUI();
  const noCofre = location.pathname.startsWith("/cofre");
  const naAgenda = location.pathname.startsWith("/agenda");
  const [giro, setGiro] = useState(0); // 0..1
  const [arrastando, setArrastando] = useState(false);
  const [dica, setDica] = useState(false);
  const giroRef = useRef(0);
  const inicio = useRef<{ y: number; id: number } | null>(null);
  const moveu = useRef(false);

  // Primeira vez: o globo gira um pouco e volta, duas vezes, para mostrar que dá para arrastar. Só uma vez por aparelho.
  useEffect(() => {
    try {
      if (localStorage.getItem(CHAVE_DICA)) return;
      localStorage.setItem(CHAVE_DICA, "1");
    } catch { return; }
    setDica(true);
    const t = window.setTimeout(() => setDica(false), 3600);
    return () => window.clearTimeout(t);
  }, []);

  function onClick() {
    if (moveu.current) { moveu.current = false; return; }
    if (noCofre) abrirCaptura("transacao", diaCofre);
    else if (naAgenda) abrirCaptura("tarefa");
    else abrirCaptura("escolha");
  }

  function aoPressionar(e: React.PointerEvent<HTMLButtonElement>) {
    inicio.current = { y: e.clientY, id: e.pointerId };
    moveu.current = false;
    // Captura já no toque: com o mouse (e dedos rápidos) o ponteiro sai de cima do botão antes do primeiro movimento.
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* segue sem captura */ }
  }
  function aoMover(e: React.PointerEvent<HTMLButtonElement>) {
    const ini = inicio.current;
    if (!ini || e.pointerId !== ini.id) return;
    const d = e.clientY - ini.y;
    if (!moveu.current) {
      if (d < 6) return;
      moveu.current = true;
      setArrastando(true);
      setDica(false);
    }
    const g = Math.max(0, Math.min(1, d / ARRASTO_COMPLETO_PX));
    if (g >= 1 && giroRef.current < 1) navigator.vibrate?.(10);
    giroRef.current = g;
    setGiro(g);
  }
  function aoSoltar(e: React.PointerEvent<HTMLButtonElement>) {
    const ini = inicio.current;
    if (!ini || e.pointerId !== ini.id) return;
    inicio.current = null;
    const deveAbrirBusca = giroRef.current >= 1;
    giroRef.current = 0;
    setArrastando(false);
    setGiro(0);
    if (deveAbrirBusca) abrirBusca();
    if (moveu.current) window.setTimeout(() => { moveu.current = false; }, 0);
  }

  const gradiente = noCofre
    ? "linear-gradient(135deg, var(--ecos-violet), var(--ecos-cyan))"
    : "linear-gradient(135deg, var(--ecos-cyan), var(--ecos-violet))";

  return (
    <button
      onClick={onClick}
      onPointerDown={aoPressionar}
      onPointerMove={aoMover}
      onPointerUp={aoSoltar}
      onPointerCancel={aoSoltar}
      aria-label={noCofre ? "Nova transação" : "Criar"}
      className="ecos-fab z-40 h-14 w-14 rounded-full text-on-accent shadow-nav"
      data-pilula={noCofre ? "cofre" : "ecos"}
      style={{ touchAction: "none" }}
    >
      <span className="ecos-esfera">
        <span className="ecos-esfera-disco" style={{ background: gradiente }} />
        <span
          className={`ecos-esfera-giro ${dica ? "ecos-esfera-dica" : ""}`}
          style={{ transform: giro ? `rotateX(${-90 * giro}deg)` : undefined, transition: arrastando ? "none" : undefined }}
        >
          <span className="ecos-esfera-glifo" style={{ transform: "translateZ(28px)" }}><Plus size={26} strokeWidth={2} /></span>
          <span className="ecos-esfera-glifo" style={{ transform: "rotateX(90deg) translateZ(28px)" }}><Search size={24} strokeWidth={2} /></span>
        </span>
        <span className="ecos-esfera-brilho" />
      </span>
    </button>
  );
}
