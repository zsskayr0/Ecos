/**
 * Rolagem com o dedo feita à mão (Modo de escrita e bloco de escrita, onde o navegador não pode rolar
 * sozinho): segue o dedo e, ao soltar, continua deslizando e freia aos poucos, como a rolagem nativa.
 */
export interface Arrasto { mover: (x: number, y: number) => void; soltar: () => void }

const ATRITO = 0.95; // por quadro de ~16ms
const VELOCIDADE_MIN = 0.02; // px/ms

let pararAtual: (() => void) | null = null;

/** Para a inércia em andamento (um novo toque segura a página). */
export function pararInercia() { pararAtual?.(); pararAtual = null; }

export function iniciarArrasto(x0: number, y0: number, alvo: Element, lateral?: Element | null): Arrasto {
  pararInercia();
  let x = x0, y = y0;
  let amostras: { t: number; x: number; y: number }[] = [{ t: performance.now(), x, y }];
  return {
    mover(nx, ny) {
      if (lateral) lateral.scrollLeft += x - nx;
      alvo.scrollTop += y - ny;
      x = nx; y = ny;
      const t = performance.now();
      amostras.push({ t, x, y });
      amostras = amostras.filter((a) => t - a.t < 100);
    },
    soltar() {
      const t = performance.now();
      const a = amostras.find((s) => t - s.t < 100) ?? amostras[0];
      const dt = Math.max(1, t - a.t);
      let vx = lateral ? (a.x - x) / dt : 0, vy = (a.y - y) / dt;
      if (t - amostras[amostras.length - 1].t > 60 || Math.hypot(vx, vy) < VELOCIDADE_MIN * 5) return;
      let ultimo = t, quadro = 0, vivo = true;
      pararAtual = () => { vivo = false; cancelAnimationFrame(quadro); };
      const passo = (agora: number) => {
        if (!vivo) return;
        const d = Math.min(48, agora - ultimo); ultimo = agora;
        const antesY = alvo.scrollTop;
        alvo.scrollTop += vy * d;
        if (lateral) lateral.scrollLeft += vx * d;
        const f = Math.pow(ATRITO, d / 16);
        vx *= f; vy *= f;
        // Parou no fim da página ou ficou devagar: acabou.
        if (Math.hypot(vx, vy) < VELOCIDADE_MIN || (alvo.scrollTop === antesY && Math.abs(vy) > Math.abs(vx))) { pararAtual = null; return; }
        quadro = requestAnimationFrame(passo);
      };
      quadro = requestAnimationFrame(passo);
    },
  };
}
