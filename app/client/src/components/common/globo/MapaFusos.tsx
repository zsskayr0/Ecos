import { useEffect, useRef } from "react";
import { movimentoReduzido } from "@/lib/movimento";
import { PAISES_NO_GLOBO } from "./paises";
import { ehTerra } from "./terra-mascara";

type Rgb = [number, number, number];

function lerCor(variavel: string, padrao: Rgb): Rgb {
  const bruto = getComputedStyle(document.documentElement).getPropertyValue(variavel).trim().split(/\s+/).map(Number);
  return bruto.length === 3 && bruto.every((n) => Number.isFinite(n)) ? (bruto as Rgb) : padrao;
}

/** Deslocamento do fuso em relação a UTC, em horas (pode ser fracionado, como a Índia: 5,5). */
export function offsetDoFuso(fuso: string, data = new Date()): number {
  try {
    const nome = new Intl.DateTimeFormat("en-US", { timeZone: fuso, timeZoneName: "longOffset" }).formatToParts(data).find((p) => p.type === "timeZoneName")?.value ?? "GMT";
    const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(nome);
    return m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) + Number(m[3] ?? 0) / 60) : 0;
  } catch { return 0; }
}

export function rotuloOffset(horas: number): string {
  const sinal = horas < 0 ? "-" : "+";
  const abs = Math.abs(horas);
  const h = Math.floor(abs), min = Math.round((abs - h) * 60);
  return `GMT${sinal}${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

const LAT_TOPO = 82, LAT_BASE = -58;

/**
 * Mapa-múndi de pontos dividido nos 24 fusos de 15°. O fuso escolhido é uma faixa que desliza até o lugar certo;
 * a terra dentro dela acende e o país selecionado ganha um marcador. Substitui o globo enquanto se escolhe o fuso.
 */
export function MapaFusos({ fuso, pais, ativo }: { fuso: string; pais: string; ativo: boolean }) {
  const caixa = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const estado = useRef({ faixa: 0, alvo: 0, entrada: 0, inicializado: false });
  const ativoRef = useRef(ativo);
  const acordarRef = useRef<null | (() => void)>(null);

  useEffect(() => {
    estado.current.alvo = offsetDoFuso(fuso);
    if (!estado.current.inicializado) { estado.current.faixa = estado.current.alvo; estado.current.inicializado = true; }
    acordarRef.current?.();
  }, [fuso]);

  useEffect(() => {
    ativoRef.current = ativo;
    if (ativo) { estado.current.entrada = 0; acordarRef.current?.(); }
  }, [ativo]);

  useEffect(() => {
    const cv = canvas.current, cx = cv?.getContext("2d");
    if (!cv || !cx || !caixa.current) return;
    const reduzir = { get matches() { return movimentoReduzido(); } };
    let W = 0, dpr = 1, raf = 0, ultimo = performance.now(), visivel = true, quadros = 0;
    let cores = { terra: [143, 180, 220] as Rgb, mar: [62, 111, 168] as Rgb, brilho: [125, 211, 252] as Rgb, texto: [232, 239, 248] as Rgb, mudo: [107, 108, 114] as Rgb };
    const pegarCores = () => { cores = { terra: lerCor("--ecos-steel-300-rgb", cores.terra), mar: lerCor("--ecos-steel-500-rgb", cores.mar), brilho: lerCor("--ecos-cyan-rgb", cores.brilho), texto: lerCor("--ecos-text-primary-rgb", cores.texto), mudo: lerCor("--ecos-text-muted-rgb", cores.mudo) }; };
    const rgba = (c: Rgb, a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

    function medir() {
      W = caixa.current!.clientWidth;
      dpr = Math.min(2, window.devicePixelRatio || 1);
      cv!.width = Math.round(W * dpr); cv!.height = Math.round(W * dpr);
      cv!.style.width = `${W}px`; cv!.style.height = `${W}px`;
    }

    function desenhar(t: number) {
      const e = estado.current;
      cx!.setTransform(1, 0, 0, 1, 0, 0);
      cx!.clearRect(0, 0, cv!.width, cv!.height);
      cx!.scale(dpr, dpr);
      const pad = 10;
      const Mw = W - pad * 2;
      // Esticado na vertical (≈ 0,6 da largura): ocupa o painel quadrado sem espaços mortos e mantém os pontos redondos.
      const Mh = Mw * 0.6;
      const x0 = pad, y0 = (W - Mh) / 2 - 12;
      const xDe = (lon: number) => x0 + ((lon + 180) / 360) * Mw;
      const yDe = (lat: number) => y0 + ((LAT_TOPO - lat) / (LAT_TOPO - LAT_BASE)) * Mh;
      const aparece = Math.min(1, e.entrada);
      const larg = (Mw / 360) * 15; // largura de um fuso

      // Faixas dos 24 fusos, alternadas, aparecendo da esquerda para a direita.
      for (let h = -12; h <= 12; h++) {
        const ini = Math.max(-180, h * 15 - 7.5), fim = Math.min(180, h * 15 + 7.5);
        const atraso = Math.min(1, Math.max(0, aparece * 1.6 - (h + 12) / 40));
        if (h % 2 !== 0) { cx!.fillStyle = rgba(cores.mar, 0.14 * atraso); cx!.fillRect(xDe(ini), y0 - 6, xDe(fim) - xDe(ini), Mh + 12); }
        cx!.fillStyle = rgba(cores.mar, 0.45 * atraso);
        cx!.fillRect(xDe(ini), y0 - 6, 0.6, Mh + 12);
      }

      // Faixa do fuso escolhido.
      const centroFaixa = e.faixa * 15;
      const fx = xDe(Math.max(-180, centroFaixa - 7.5)), fw = xDe(Math.min(180, centroFaixa + 7.5)) - fx;
      const pulso = 0.85 + 0.15 * Math.sin(t * 2.6);
      cx!.fillStyle = rgba(cores.brilho, 0.2 * aparece * pulso);
      cx!.fillRect(fx, y0 - 6, fw, Mh + 12);
      cx!.fillStyle = rgba(cores.brilho, 0.85 * aparece);
      cx!.fillRect(fx, y0 - 6, fw, 1.4);
      cx!.fillRect(fx, y0 + Mh + 4.6, fw, 1.4);

      // Terra em pontos; a que cai dentro da faixa acende.
      const colunas = Math.round(Mw / 3.6), linhas = Math.round(Mh / 3.6);
      const cw = Mw / colunas, ch = Mh / linhas;
      const normal: [number, number][] = [], aceso: [number, number][] = [];
      for (let l = 0; l < linhas; l++) {
        const lat = LAT_TOPO - ((l + 0.5) / linhas) * (LAT_TOPO - LAT_BASE);
        for (let c = 0; c < colunas; c++) {
          const lon = -180 + ((c + 0.5) / colunas) * 360;
          if (!ehTerra(lat, lon)) continue;
          const px = x0 + (c + 0.5) * cw, py = y0 + (l + 0.5) * ch;
          (Math.abs(lon / 15 - e.faixa) <= 0.5 ? aceso : normal).push([px, py]);
        }
      }
      cx!.fillStyle = rgba(cores.terra, 0.9 * aparece);
      cx!.beginPath(); for (const [px, py] of normal) { cx!.moveTo(px + cw * 0.42, py); cx!.arc(px, py, cw * 0.42, 0, 6.2832); } cx!.fill();
      cx!.fillStyle = rgba(cores.brilho, aparece);
      cx!.beginPath(); for (const [px, py] of aceso) { cx!.moveTo(px + cw * 0.56, py); cx!.arc(px, py, cw * 0.56, 0, 6.2832); } cx!.fill();

      // Marcador do país.
      const p = PAISES_NO_GLOBO[pais];
      if (p) {
        const mx = xDe(p.lon), my = yDe(p.lat);
        const anel = ((t * 0.7) % 1);
        cx!.strokeStyle = rgba(cores.texto, (1 - anel) * 0.7 * aparece);
        cx!.lineWidth = 1;
        cx!.beginPath(); cx!.arc(mx, my, 2.5 + anel * 9, 0, 6.2832); cx!.stroke();
        cx!.fillStyle = rgba(cores.texto, aparece);
        cx!.beginPath(); cx!.arc(mx, my, 2.2, 0, 6.2832); cx!.fill();
      }

      // Régua de horas abaixo do mapa.
      cx!.font = '9px "JetBrains Mono", monospace';
      cx!.textAlign = "center"; cx!.textBaseline = "top";
      const yRegua = y0 + Mh + 11;
      for (let h = -12; h <= 12; h += 3) {
        const perto = Math.abs(h - e.faixa) < 1.6;
        cx!.fillStyle = rgba(cores.mudo, (perto ? 0.1 : 0.9) * aparece);
        cx!.fillText(h === 0 ? "0" : (h > 0 ? `+${h}` : `${h}`), xDe(h * 15), yRegua);
      }
      const rotulo = rotuloOffset(e.alvo).replace("GMT", "");
      const larguraRotulo = cx!.measureText(rotulo).width + 12;
      const lx = Math.min(x0 + Mw - larguraRotulo / 2, Math.max(x0 + larguraRotulo / 2, xDe(centroFaixa)));
      cx!.fillStyle = rgba(cores.brilho, 0.16 * aparece);
      cx!.beginPath(); cx!.roundRect(lx - larguraRotulo / 2, yRegua - 3, larguraRotulo, 15, 7); cx!.fill();
      cx!.fillStyle = rgba(cores.brilho, aparece);
      cx!.fillText(rotulo, lx, yRegua);
    }

    function quadro(agora: number) {
      const dt = Math.min(0.05, (agora - ultimo) / 1000);
      ultimo = agora;
      const e = estado.current;
      const k = reduzir.matches ? 1 : 1 - Math.exp(-dt * 5);
      e.faixa += (e.alvo - e.faixa) * k;
      if (Math.abs(e.alvo - e.faixa) < 0.002) e.faixa = e.alvo;
      e.entrada = Math.min(1, e.entrada + (reduzir.matches ? 1 : dt / 0.9));
      if (quadros++ % 45 === 0) pegarCores();
      desenhar(agora / 1000);
      raf = visivel && ativoRef.current && !document.hidden && (!reduzir.matches || e.entrada < 1) ? requestAnimationFrame(quadro) : 0;
    }
    const acordar = () => { if (!raf) { ultimo = performance.now(); raf = requestAnimationFrame(quadro); } };
    acordarRef.current = acordar;

    medir(); pegarCores(); estado.current.entrada = ativoRef.current ? 0 : 1; desenhar(0); acordar();
    const obs = new ResizeObserver(() => { medir(); desenhar(performance.now() / 1000); });
    obs.observe(caixa.current);
    const inter = new IntersectionObserver(([en]) => { visivel = en.isIntersecting; if (visivel) acordar(); });
    inter.observe(caixa.current);
    const aoVisibilidade = () => { if (!document.hidden) acordar(); };
    document.addEventListener("visibilitychange", aoVisibilidade);
    const tema = new MutationObserver(() => { pegarCores(); acordar(); });
    tema.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => { cancelAnimationFrame(raf); obs.disconnect(); inter.disconnect(); tema.disconnect(); document.removeEventListener("visibilitychange", aoVisibilidade); acordarRef.current = null; };
  }, [pais]);

  return (
    <div ref={caixa} className="relative mx-auto aspect-square w-full max-w-[340px]">
      <canvas ref={canvas} aria-hidden className="block" />
    </div>
  );
}
