import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";

/**
 * Arrastar uma Tarefa de qualquer lista para o calendário — pelo mesmo modelo de ponteiro das abas (sem a API nativa de
 * arrastar e soltar do HTML, que falha em alguns ambientes e não existe no toque).
 *
 * A origem (uma linha de tarefa) e o destino (a Agenda) não se conhecem: quem arrasta avisa por eventos de `window`
 * (`mover`, `soltar`, `cancelar`, sempre com o ponteiro em coordenadas de tela) e quem é destino decide se aquele ponto
 * é seu, mostra a prévia e, ao `soltar`, cria o que precisar. Arrastar NUNCA altera a Tarefa em si.
 */
export interface TarefaArrastavel {
  id: string;
  titulo: string;
  /** Estimativa da Tarefa (`duration_min`): é quanto tempo será alocado no calendário. */
  duracaoMin: number | null;
  prioridade?: string;
}

export interface EventoArrasteTarefa {
  fase: "mover" | "soltar" | "cancelar";
  tarefa: TarefaArrastavel;
  x: number;
  y: number;
}

export const EVENTO_ARRASTE_TAREFA = "ecos:arraste-tarefa";
/** Quanto o ponteiro anda (px) antes de o clique virar arrasto (mouse/caneta). */
const LIMIAR_PX = 6;
/** No toque, o dedo precisa ficar parado isto para "pegar" a linha; antes, arrastar rola a lista. */
export const LONGO_TOQUE_TAREFA_MS = 350;
const TOLERANCIA_TOQUE_PX = 8;

interface Estado {
  aoPressionarTarefa: (e: ReactPointerEvent<HTMLElement>, tarefa: TarefaArrastavel) => void;
}

const SEM_ARRASTE: Estado = { aoPressionarTarefa: () => {} };
const Contexto = createContext<Estado>(SEM_ARRASTE);

function avisar(detail: EventoArrasteTarefa) {
  window.dispatchEvent(new CustomEvent<EventoArrasteTarefa>(EVENTO_ARRASTE_TAREFA, { detail }));
}

/** Para quem é destino do arrasto: recebe cada fase do gesto. */
export function useOuvirArrasteTarefa(aoEvento: (e: EventoArrasteTarefa) => void) {
  const atual = useRef(aoEvento);
  atual.current = aoEvento;
  useEffect(() => {
    const ouvinte = (ev: Event) => atual.current((ev as CustomEvent<EventoArrasteTarefa>).detail);
    window.addEventListener(EVENTO_ARRASTE_TAREFA, ouvinte);
    return () => window.removeEventListener(EVENTO_ARRASTE_TAREFA, ouvinte);
  }, []);
}

/** Para quem é origem: `aoPressionarTarefa` vai no `onPointerDown` da linha. Fora do provider vira um no-op. */
export function useArrasteTarefa(): Estado {
  return useContext(Contexto);
}

export function ArrasteTarefaProvider({ children }: { children: ReactNode }) {
  const [arrastando, setArrastando] = useState<TarefaArrastavel | null>(null);
  const [ponteiro, setPonteiro] = useState<{ x: number; y: number } | null>(null);
  const encerrarGesto = useRef<(() => void) | null>(null);
  const descartarCliqueFantasma = useRef<(() => void) | null>(null);

  useEffect(() => () => {
    encerrarGesto.current?.();
    descartarCliqueFantasma.current?.();
  }, []);

  const aoPressionarTarefa = useCallback((e: ReactPointerEvent<HTMLElement>, tarefa: TarefaArrastavel) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    encerrarGesto.current?.();
    descartarCliqueFantasma.current?.();

    const toque = e.pointerType === "touch";
    const pointerId = e.pointerId;
    const inicio = { x: e.clientX, y: e.clientY };
    let ativo = false;
    let ultimo = { x: inicio.x, y: inicio.y };
    let timerLongo: ReturnType<typeof setTimeout> | null = null;

    const bloquearRolagem = (ev: TouchEvent) => { if (ativo && ev.cancelable) ev.preventDefault(); };

    function comecar() {
      if (ativo) return;
      ativo = true;
      document.body.style.userSelect = "none";
      document.body.style.cursor = "grabbing";
      (navigator as Navigator & { vibrate?: (ms: number) => boolean }).vibrate?.(12);
      setArrastando(tarefa);
      setPonteiro(ultimo);
    }

    function limpar(soltar: boolean, x = ultimo.x, y = ultimo.y) {
      if (timerLongo) clearTimeout(timerLongo);
      window.removeEventListener("pointermove", aoMover);
      window.removeEventListener("pointerup", aoSoltar);
      window.removeEventListener("pointercancel", aoCancelar);
      window.removeEventListener("keydown", aoTecla, true);
      window.removeEventListener("touchmove", bloquearRolagem);
      encerrarGesto.current = null;
      if (ativo) {
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
        avisar({ fase: soltar ? "soltar" : "cancelar", tarefa, x, y });
        // O clique que o navegador dispara ao soltar não pode abrir a Tarefa que acabou de ser arrastada.
        const engolir = (ev: Event) => { ev.stopPropagation(); ev.preventDefault(); };
        const remover = () => {
          window.removeEventListener("click", engolir, true);
          clearTimeout(timerFantasma);
          if (descartarCliqueFantasma.current === remover) descartarCliqueFantasma.current = null;
        };
        const timerFantasma = setTimeout(remover, 0);
        window.addEventListener("click", engolir, { capture: true, once: true });
        descartarCliqueFantasma.current = remover;
      }
      setArrastando(null);
      setPonteiro(null);
    }

    function aoMover(ev: PointerEvent) {
      if (ev.pointerId !== pointerId) return;
      ultimo = { x: ev.clientX, y: ev.clientY };
      const distancia = Math.hypot(ev.clientX - inicio.x, ev.clientY - inicio.y);
      if (!ativo) {
        // No toque, mexer antes da pressão longa é rolagem da lista: desiste.
        if (toque) { if (distancia > TOLERANCIA_TOQUE_PX) limpar(false); return; }
        if (distancia < LIMIAR_PX) return;
        comecar();
      }
      setPonteiro(ultimo);
      avisar({ fase: "mover", tarefa, x: ev.clientX, y: ev.clientY });
    }
    function aoSoltar(ev: PointerEvent) {
      if (ev.pointerId !== pointerId) return;
      limpar(true, ev.clientX, ev.clientY);
    }
    function aoCancelar(ev: PointerEvent) {
      if (ev.pointerId === pointerId) limpar(false);
    }
    function aoTecla(ev: KeyboardEvent) {
      if (ev.key === "Escape") { ev.stopPropagation(); limpar(false); }
    }

    window.addEventListener("pointermove", aoMover);
    window.addEventListener("pointerup", aoSoltar);
    window.addEventListener("pointercancel", aoCancelar);
    window.addEventListener("keydown", aoTecla, true);
    encerrarGesto.current = () => limpar(false);
    if (toque) {
      window.addEventListener("touchmove", bloquearRolagem, { passive: false });
      timerLongo = setTimeout(comecar, LONGO_TOQUE_TAREFA_MS);
    }
  }, []);

  const valor = useMemo<Estado>(() => ({ aoPressionarTarefa }), [aoPressionarTarefa]);
  return (
    <Contexto.Provider value={valor}>
      {children}
      {arrastando && ponteiro && (
        <div
          aria-hidden
          className="pointer-events-none fixed z-[1000] max-w-[240px] truncate rounded-md border border-cyan/50 bg-surface-2 px-3 py-1.5 text-xs text-text-primary shadow-nav"
          style={{ left: ponteiro.x + 12, top: ponteiro.y + 12 }}
        >
          {arrastando.titulo}
          <span className="ml-2 font-mono-value text-text-muted">{arrastando.duracaoMin ? `${arrastando.duracaoMin} min` : ""}</span>
        </div>
      )}
    </Contexto.Provider>
  );
}
