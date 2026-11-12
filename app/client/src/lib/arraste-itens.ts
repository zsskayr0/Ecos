import { useSyncExternalStore, type PointerEvent as PointerEventReact } from "react";
import { criarFantasma, type Fantasma, type TipoFantasma } from "./arraste-fantasma";

/**
 * Arrastar itens (pastas, notas, tarefas, arquivos) por eventos de ponteiro: funciona com mouse, caneta e toque, e
 * não troca o cursor do sistema (o arrastar nativo do HTML faz as duas coisas mal). No mouse, o arraste começa depois
 * de alguns pixels; no toque, segurando o dedo (um toque que anda rola a tela, como sempre).
 *
 * Onde dá para soltar: qualquer elemento com `data-soltar="<pasta>"` (vazio = raiz); vale o mais de dentro. Soltar
 * na borda de um painel (`data-pane-conteudo`) abre o item ao lado, quando quem arrasta oferece isso.
 */

export interface ConfigArraste {
  /** Chamada quando o arraste de fato começa: decide o que está sendo levado (e ajusta a seleção). */
  preparar: () => { itens: string[]; rotulo: string; tipo: TipoFantasma };
  /** Soltou numa pasta (`destino`, "" = raiz). */
  aoSoltar: (destino: string, itens: string[]) => void;
  /** O alvo mudou (`null` = nenhum): para realçar a pasta e abrir pastas que o arraste espera. */
  aoPairar?: (destino: string | null) => void;
  /** Soltou na borda de um painel: só vale se `aoAbrirAoLado` existir e levar um único item. */
  aoAbrirAoLado?: (paneId: string, lado: "left" | "right") => void;
  /** Terminou (soltou, cancelou ou Esc): limpar realces. */
  aoTerminar?: () => void;
}

export type ZonaLado = { paneId: string; lado: "left" | "right" } | null;

let zona: ZonaLado = null;
const ouvintes = new Set<() => void>();
function definirZona(z: ZonaLado) {
  if (z?.paneId === zona?.paneId && z?.lado === zona?.lado) return;
  zona = z;
  ouvintes.forEach((f) => f());
}
/** Borda de painel sob o ponteiro durante um arraste (para desenhar o destaque "abrir ao lado"). */
export function useZonaArraste(): ZonaLado {
  return useSyncExternalStore((cb) => { ouvintes.add(cb); return () => { ouvintes.delete(cb); }; }, () => zona, () => null);
}

const LIMIAR_MOUSE_PX = 5;
const ESPERA_TOQUE_MS = 350;
const TOLERANCIA_TOQUE_PX = 10;
const BORDA_PX = 72;
const ZONA_ROLAGEM_PX = 44;

let cancelarAtual: (() => void) | null = null;

function rolavel(el: Element | null): HTMLElement | null {
  while (el && el !== document.body) {
    const s = getComputedStyle(el);
    if (/(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 1) return el as HTMLElement;
    el = el.parentElement;
  }
  return null;
}

/** Ligue no `onPointerDown` do item arrastável. Elementos com `data-sem-arraste` dentro dele (⋯, setinha) não arrastam. */
export function aoPressionarItem(e: PointerEventReact, cfg: ConfigArraste) {
  if (e.button !== 0 || (e.target as HTMLElement).closest("[data-sem-arraste]")) return;
  cancelarAtual?.();
  const pointerId = e.pointerId;
  const toque = e.pointerType === "touch";
  const [x0, y0] = [e.clientX, e.clientY];
  let [x, y] = [x0, y0];
  let comecou = false;
  let dados: ReturnType<ConfigArraste["preparar"]> | null = null;
  let fantasma: Fantasma | null = null;
  let alvoEl: HTMLElement | null = null;
  let alvoDestino: string | null = null;
  let quadro = 0;
  let timer = 0;

  const marcar = (el: HTMLElement | null) => {
    if (el === alvoEl) return;
    alvoEl = el;
    alvoDestino = el ? el.dataset.soltar ?? "" : null;
    cfg.aoPairar?.(alvoDestino);
  };

  const descobrir = () => {
    const topo = document.elementsFromPoint(x, y)[0] ?? null;
    if (cfg.aoAbrirAoLado && dados && dados.itens.length === 1) {
      const painel = topo?.closest<HTMLElement>("[data-pane-conteudo]");
      if (painel) {
        const r = painel.getBoundingClientRect();
        const lado = x - r.left < BORDA_PX ? "left" : r.right - x < BORDA_PX ? "right" : null;
        if (lado) {
          definirZona({ paneId: painel.dataset.paneConteudo ?? "", lado });
          marcar(null);
          return;
        }
      }
    }
    definirZona(null);
    marcar(topo?.closest<HTMLElement>("[data-soltar]") ?? null);
  };

  const rolar = () => {
    if (comecou) {
      const topo = document.elementsFromPoint(x, y)[0] ?? null;
      const el = rolavel(topo);
      if (el) {
        const r = el.getBoundingClientRect();
        const dy = y < r.top + ZONA_ROLAGEM_PX ? -(r.top + ZONA_ROLAGEM_PX - y) : y > r.bottom - ZONA_ROLAGEM_PX ? y - (r.bottom - ZONA_ROLAGEM_PX) : 0;
        if (dy) { el.scrollTop += Math.max(-22, Math.min(22, dy / 2)); descobrir(); }
      }
    }
    quadro = requestAnimationFrame(rolar);
  };

  const ativar = () => {
    if (comecou) return;
    comecou = true;
    window.clearTimeout(timer);
    dados = cfg.preparar();
    fantasma = criarFantasma({ rotulo: dados.rotulo, quantidade: dados.itens.length, tipo: dados.tipo }, x, y);
    document.body.style.cursor = "grabbing";
    document.body.style.userSelect = "none";
    (document.body.style as CSSStyleDeclaration & { webkitTouchCallout?: string }).webkitTouchCallout = "none";
    if (toque && navigator.vibrate) navigator.vibrate(12);
    quadro = requestAnimationFrame(rolar);
    descobrir();
  };

  const aoMover = (ev: PointerEvent) => {
    if (ev.pointerId !== pointerId) return;
    [x, y] = [ev.clientX, ev.clientY];
    if (!comecou) {
      const d = Math.hypot(x - x0, y - y0);
      if (toque) { if (d > TOLERANCIA_TOQUE_PX) finalizar(false); return; } // andou antes de segurar: é rolagem
      if (d < LIMIAR_MOUSE_PX) return;
      ativar();
    }
    fantasma?.mover(x, y);
    descobrir();
  };
  // Depois que o arraste começa no toque, a tela não pode rolar junto.
  const aoMoverToque = (ev: TouchEvent) => { if (comecou && ev.cancelable) ev.preventDefault(); };
  const semMenu = (ev: Event) => ev.preventDefault();
  const aoTecla = (ev: KeyboardEvent) => { if (ev.key === "Escape") finalizar(false); };
  const aoSoltar = (ev: PointerEvent) => { if (ev.pointerId === pointerId) finalizar(true); };
  const aoCancelar = (ev: PointerEvent) => { if (ev.pointerId === pointerId) finalizar(false); };

  function finalizar(soltar: boolean) {
    window.clearTimeout(timer);
    cancelAnimationFrame(quadro);
    window.removeEventListener("pointermove", aoMover);
    window.removeEventListener("pointerup", aoSoltar);
    window.removeEventListener("pointercancel", aoCancelar);
    window.removeEventListener("keydown", aoTecla);
    window.removeEventListener("touchmove", aoMoverToque);
    window.removeEventListener("contextmenu", semMenu, true);
    cancelarAtual = null;
    if (comecou) {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      (document.body.style as CSSStyleDeclaration & { webkitTouchCallout?: string }).webkitTouchCallout = "";
      const lado = zona;
      if (soltar && dados) {
        if (lado && cfg.aoAbrirAoLado) cfg.aoAbrirAoLado(lado.paneId, lado.lado);
        else if (alvoDestino !== null) cfg.aoSoltar(alvoDestino, dados.itens);
      }
      definirZona(null);
      fantasma?.encerrar(soltar && (!!lado || alvoDestino !== null));
      // O clique que o navegador dispara depois de soltar não pode abrir nem selecionar nada.
      const engolir = (ev: MouseEvent) => { ev.stopPropagation(); ev.preventDefault(); };
      window.addEventListener("click", engolir, { capture: true, once: true });
      window.setTimeout(() => window.removeEventListener("click", engolir, true), 0);
      cfg.aoTerminar?.();
    }
  }

  window.addEventListener("pointermove", aoMover);
  window.addEventListener("pointerup", aoSoltar);
  window.addEventListener("pointercancel", aoCancelar);
  window.addEventListener("keydown", aoTecla);
  if (toque) {
    window.addEventListener("touchmove", aoMoverToque, { passive: false });
    // Segurar o dedo abriria o menu do navegador: aqui vira arraste.
    window.addEventListener("contextmenu", semMenu, true);
    timer = window.setTimeout(ativar, ESPERA_TOQUE_MS);
  }
  cancelarAtual = () => finalizar(false);
}
