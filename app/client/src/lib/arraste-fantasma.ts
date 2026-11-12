/**
 * "Arquivinho" que fica pendurado no mouse (ou no dedo) durante o arrastar de itens (sidebar e tela de Arquivos).
 * Um cartão solto no <body> segue o ponteiro e balança como um pêndulo conforme ele se mexe. Quem decide quando
 * ele existe e onde está o ponteiro é `arraste-itens.ts`; aqui só o desenho e a física.
 */

export type TipoFantasma = "pasta" | "nota" | "tarefa" | "arquivo";

interface Opcoes {
  rotulo: string;
  quantidade: number;
  tipo: TipoFantasma;
}

export interface Fantasma {
  mover: (x: number, y: number) => void;
  encerrar: (soltou: boolean) => void;
}

const SVG: Record<TipoFantasma, string> = {
  pasta: '<path d="M4 8a3 3 0 0 1 3-3h7l3 3h13a3 3 0 0 1 3 3v17a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3Z" fill="currentColor" fill-opacity=".22" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  nota: '<path d="M8 3h13l7 7v19a1.5 1.5 0 0 1-1.5 1.5h-18A1.5 1.5 0 0 1 7 29V4.5A1.5 1.5 0 0 1 8 3Z" fill="currentColor" fill-opacity=".16" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M21 3v7h7M11 16h12M11 21h12M11 26h7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  tarefa: '<path d="M8 3h13l7 7v19a1.5 1.5 0 0 1-1.5 1.5h-18A1.5 1.5 0 0 1 7 29V4.5A1.5 1.5 0 0 1 8 3Z" fill="currentColor" fill-opacity=".16" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M21 3v7h7M11 17l3 3 6-7M11 26h12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  arquivo: '<path d="M8 3h13l7 7v19a1.5 1.5 0 0 1-1.5 1.5h-18A1.5 1.5 0 0 1 7 29V4.5A1.5 1.5 0 0 1 8 3Z" fill="currentColor" fill-opacity=".16" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M21 3v7h7" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
};

function escapar(t: string) {
  return t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

export function criarFantasma({ rotulo, quantidade, tipo }: Opcoes, x0: number, y0: number): Fantasma {
  const reduzido = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  const raiz = document.createElement("div");
  raiz.setAttribute("aria-hidden", "true");
  raiz.style.cssText = "position:fixed;left:0;top:0;z-index:2000;pointer-events:none;will-change:transform;";
  const cor = "rgb(var(--ecos-cyan-rgb))";
  const folhasExtras = quantidade > 1
    ? `<span style="position:absolute;left:4px;top:4px;width:44px;height:54px;border-radius:7px;background:rgb(var(--ecos-surface-2-rgb));border:1px solid rgb(var(--ecos-cyan-rgb)/.35);transform:rotate(9deg);"></span>
       <span style="position:absolute;left:2px;top:2px;width:44px;height:54px;border-radius:7px;background:rgb(var(--ecos-surface-2-rgb));border:1px solid rgb(var(--ecos-cyan-rgb)/.45);transform:rotate(-7deg);"></span>`
    : "";
  const selo = quantidade > 1
    ? `<span style="position:absolute;right:-9px;top:-9px;min-width:22px;height:22px;padding:0 6px;box-sizing:border-box;border-radius:11px;background:${cor};color:#06121a;font:700 12px/22px Inter,sans-serif;text-align:center;box-shadow:0 2px 8px rgb(0 0 0/.4);">${quantidade}</span>`
    : "";
  raiz.innerHTML = `
    <div class="f-pendulo" style="position:absolute;left:0;top:0;transform-origin:0 0;">
      <span style="position:absolute;left:-3px;top:-3px;width:6px;height:6px;border-radius:50%;background:${cor};box-shadow:0 0 0 3px rgb(var(--ecos-cyan-rgb)/.25);"></span>
      <span style="position:absolute;left:0;top:0;width:1.5px;height:12px;background:rgb(var(--ecos-cyan-rgb)/.7);transform:translateX(-.75px);"></span>
      <div style="position:absolute;left:-26px;top:11px;width:52px;">
        <div style="position:relative;width:48px;height:58px;margin:0 auto;">
          ${folhasExtras}
          <span style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;border-radius:7px;background:rgb(var(--ecos-surface-1-rgb));border:1px solid ${cor};color:${cor};box-shadow:0 8px 20px rgb(0 0 0/.45);">
            <svg width="30" height="30" viewBox="0 0 32 32" fill="none">${SVG[tipo]}</svg>
          </span>
          ${selo}
        </div>
        <div style="margin:6px -34px 0;max-width:120px;padding:2px 8px;border-radius:999px;background:rgb(var(--ecos-surface-2-rgb));border:1px solid rgb(var(--ecos-cyan-rgb)/.35);color:var(--ecos-text-primary);font:500 11px/16px Inter,sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:center;box-shadow:0 4px 12px rgb(0 0 0/.35);">${escapar(rotulo)}</div>
      </div>
    </div>`;
  document.body.appendChild(raiz);
  const pendulo = raiz.querySelector<HTMLElement>(".f-pendulo")!;

  // Física: a posição acompanha o ponteiro com um pouco de atraso; o ângulo é uma mola puxada pela velocidade horizontal.
  let alvoX = x0, alvoY = y0, x = x0, y = y0;
  let angulo = 0, velAng = 0, escala = 0.4, ultimoX = x0;
  let ativo = true;
  let quadro = 0;
  const passo = () => {
    if (!ativo) return;
    x += (alvoX - x) * 0.4;
    y += (alvoY - y) * 0.4;
    const vx = x - ultimoX;
    ultimoX = x;
    const alvoAng = reduzido ? 0 : Math.max(-38, Math.min(38, -vx * 1.8));
    velAng += (alvoAng - angulo) * 0.16;
    velAng *= 0.84;
    angulo += velAng;
    escala += (1 - escala) * 0.25;
    raiz.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    pendulo.style.transform = `rotate(${angulo}deg) scale(${escala})`;
    quadro = requestAnimationFrame(passo);
  };
  quadro = requestAnimationFrame(passo);

  return {
    mover(nx, ny) { alvoX = nx; alvoY = ny; },
    encerrar(soltou) {
      if (!ativo) return;
      ativo = false;
      cancelAnimationFrame(quadro);
      if (soltou && !reduzido && raiz.animate) {
        raiz.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, easing: "ease-out" }).finished.then(() => raiz.remove(), () => raiz.remove());
        pendulo.animate([{ transform: pendulo.style.transform }, { transform: `rotate(${angulo}deg) scale(0.5)` }], { duration: 160, easing: "ease-out", fill: "forwards" });
      } else {
        raiz.remove();
      }
    },
  };
}
