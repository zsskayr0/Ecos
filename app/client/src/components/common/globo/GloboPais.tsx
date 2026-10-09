import { useEffect, useRef, useState } from "react";
import { Bandeira } from "./Bandeira";
import { movimentoReduzido } from "@/lib/movimento";
import { PAISES_NO_GLOBO, VISTA_INICIAL } from "./paises";
import { ehTerra } from "./terra-mascara";
import "./globo.css";

const RAD = Math.PI / 180;
/** Luz vinda de cima à esquerda, de frente. */
const LUZ = (() => { const v = [-0.45, 0.5, 0.74]; const n = Math.hypot(...v); return v.map((x) => x / n) as [number, number, number]; })();
const NIVEIS_ALFA = 8;

type Rgb = [number, number, number];

function lerCor(variavel: string, padrao: Rgb): Rgb {
  const bruto = getComputedStyle(document.documentElement).getPropertyValue(variavel).trim().split(/\s+/).map(Number);
  return bruto.length === 3 && bruto.every((n) => Number.isFinite(n)) ? (bruto as Rgb) : padrao;
}

const normalizarLon = (lon: number) => ((((lon + 180) % 360) + 360) % 360) - 180;

interface Vista { lat: number; lon: number }

/**
 * Globo de pontos: a Terra inteira feita de pontos (máscara de terra em 1°), com sombra, um brilho discreto na borda e estrelas.
 * Ao mudar o país o globo gira com suavidade até ele; terra dentro do raio do país acende em ciano e, ao chegar,
 * um mastro cresce no ponto com a bandeira ondulando. Com "reduzir movimento" o globo pula direto para o país.
 */
export function GloboPais({ pais, ativo = true }: { pais: string; ativo?: boolean }) {
  const alvo = PAISES_NO_GLOBO[pais];
  const caixa = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [chegou, setChegou] = useState(false);
  // Estado da animação fica em ref: o quadro desenha sem passar pelo React.
  const estado = useRef({ atual: { ...VISTA_INICIAL } as Vista, alvo: alvo ?? VISTA_INICIAL, raio: alvo?.raio ?? 6, foco: 0, chegou: false });

  const desenharAgora = useRef<null | (() => void)>(null);
  const ativoRef = useRef(ativo);
  useEffect(() => { ativoRef.current = ativo; if (ativo) desenharAgora.current?.(); }, [ativo]);

  useEffect(() => {
    estado.current.alvo = alvo ?? VISTA_INICIAL;
    estado.current.raio = alvo?.raio ?? 6;
    estado.current.chegou = false;
    setChegou(false);
    desenharAgora.current?.();
  }, [alvo]);


  useEffect(() => {
    const cv = canvas.current;
    const cx = cv?.getContext("2d");
    if (!cv || !cx || !caixa.current) return;
    const reduzir = { get matches() { return movimentoReduzido(); } };
    let largura = 0;
    let dpr = 1;
    let cores = { terra: [143, 180, 220] as Rgb, mar: [62, 111, 168] as Rgb, brilho: [125, 211, 252] as Rgb, texto: [232, 239, 248] as Rgb };
    let raf = 0;
    let ultimo = performance.now();
    let quadros = 0;
    let visivel = true;

    const estrelas = Array.from({ length: 46 }, (_, i) => {
      const a = Math.sin(i * 12.9898) * 43758.5453, b = Math.sin(i * 78.233) * 12543.123;
      return { x: a - Math.floor(a), y: b - Math.floor(b), fase: (i * 1.7) % 6.28 };
    });

    function pegarCores() {
      cores = { terra: lerCor("--ecos-steel-300-rgb", cores.terra), mar: lerCor("--ecos-steel-500-rgb", cores.mar), brilho: lerCor("--ecos-cyan-rgb", cores.brilho), texto: lerCor("--ecos-text-primary-rgb", cores.texto) };
    }
    const rgba = (c: Rgb, a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

    function medir() {
      largura = caixa.current!.clientWidth;
      dpr = Math.min(2, window.devicePixelRatio || 1);
      cv!.width = Math.round(largura * dpr);
      cv!.height = Math.round(largura * dpr);
      cv!.style.width = `${largura}px`;
      cv!.style.height = `${largura}px`;
    }

    function quadro(agora: number) {
      const dt = Math.min(0.05, (agora - ultimo) / 1000);
      ultimo = agora;
      const e = estado.current;
      // Giro: aproxima exponencialmente (rápido no começo, assenta devagar), pelo caminho curto em longitude.
      const dLon = normalizarLon(e.alvo.lon - e.atual.lon);
      const dLat = e.alvo.lat - e.atual.lat;
      const k = reduzir.matches ? 1 : 1 - Math.exp(-dt * 3.4);
      e.atual.lon = normalizarLon(e.atual.lon + dLon * k);
      e.atual.lat += dLat * k;
      const falta = Math.hypot(dLon * Math.cos(e.atual.lat * RAD), dLat);
      const pousou = falta < 0.35;
      if (pousou) { e.atual.lon = e.alvo.lon; e.atual.lat = e.alvo.lat; }
      // O brilho sobe quando o globo se aproxima e cai ao começar a girar de novo.
      const metaFoco = pousou ? 1 : Math.max(0, 1 - falta / 40) * 0.6;
      e.foco += (metaFoco - e.foco) * (1 - Math.exp(-dt * 5));
      if (pousou !== e.chegou) { e.chegou = pousou; setChegou(pousou); }
      if (quadros++ % 45 === 0) pegarCores();
      desenhar(agora / 1000);
      const animando = !pousou || e.foco < 0.995;
      if (visivel && ativoRef.current && !document.hidden && (!reduzir.matches || animando)) raf = requestAnimationFrame(quadro);
      else raf = 0;
    }

    function desenhar(t: number) {
      const e = estado.current;
      const px = cv!.width;
      cx!.setTransform(1, 0, 0, 1, 0, 0);
      cx!.clearRect(0, 0, px, px);
      cx!.scale(dpr, dpr);
      const W = largura;
      const centro = W / 2;
      const R = W * 0.44;
      // Rede quadrada de pontos; as linhas ímpares ficam meia célula deslocadas, o que lê melhor como relevo.
      const colunas = Math.max(40, Math.min(84, Math.round((R * 2) / 4.6)));
      const linhas = colunas;
      const cel = (R * 2) / colunas;
      const lat0 = e.atual.lat * RAD, lon0 = e.atual.lon * RAD;
      const sl0 = Math.sin(lat0), cl0 = Math.cos(lat0);
      const alvoLat = e.alvo.lat * RAD, alvoLon = e.alvo.lon * RAD;
      const salvo = Math.sin(alvoLat), calvo = Math.cos(alvoLat);
      const raioEfetivo = Math.max(e.raio, 3.4) * RAD;
      const cosRaio = Math.cos(raioEfetivo);
      const pulso = 0.8 + 0.2 * Math.sin(t * 3.2);

      // Estrelas ao fundo, só fora do globo.
      for (const s of estrelas) {
        const sx = s.x * W, sy = s.y * W;
        if (Math.hypot(sx - centro, sy - centro) < R * 1.12) continue;
        cx!.fillStyle = rgba(cores.texto, 0.1 + 0.25 * (0.5 + 0.5 * Math.sin(t * 1.3 + s.fase)));
        cx!.fillRect(sx, sy, 1.2, 1.2);
      }

      // Atmosfera: anel de brilho ciano ao redor e um leve preenchimento do disco.
      const brilho = e.foco;
      const fora = Math.min(R * 1.3, W / 2);
      const halo = cx!.createRadialGradient(centro, centro, R * 0.86, centro, centro, fora);
      halo.addColorStop(0, rgba(cores.brilho, 0.07 + 0.05 * brilho));
      halo.addColorStop(0.4, rgba(cores.brilho, 0.02));
      halo.addColorStop(1, rgba(cores.brilho, 0));
      cx!.fillStyle = halo;
      cx!.beginPath(); cx!.arc(centro, centro, fora, 0, 7); cx!.fill();
      const disco = cx!.createRadialGradient(centro - R * 0.3, centro - R * 0.35, R * 0.1, centro, centro, R);
      disco.addColorStop(0, rgba(cores.mar, 0.1));
      disco.addColorStop(1, rgba(cores.mar, 0.02));
      cx!.fillStyle = disco;
      cx!.beginPath(); cx!.arc(centro, centro, R, 0, 7); cx!.fill();

      // Pontos agrupados por cor+opacidade: um fillStyle e um traçado por grupo, em vez de um por ponto.
      const grupos = new Map<number, { x: number; y: number; r: number }[]>();
      const poe = (cor: number, nivel: number, x: number, y: number, r: number) => {
        const chave = cor * 100 + nivel;
        const g = grupos.get(chave);
        if (g) g.push({ x, y, r }); else grupos.set(chave, [{ x, y, r }]);
      };
      for (let l = 0; l < linhas; l++) {
        const Y = -(((l + 0.5) / linhas) * 2 - 1); // cima = +
        const meia = (l % 2) * 0.5;
        for (let c = 0; c < colunas; c++) {
          const X = ((c + 0.5 + meia) / colunas) * 2 - 1;
          const r2 = X * X + Y * Y;
          if (r2 > 0.99) continue;
          const z = Math.sqrt(1 - r2);
          const sinLat = z * sl0 + Y * cl0;
          const lat = Math.asin(sinLat);
          const lon = lon0 + Math.atan2(X, z * cl0 - Y * sl0);
          const latG = lat / RAD, lonG = normalizarLon(lon / RAD);
          const sombra = Math.max(0, X * LUZ[0] + Y * LUZ[1] + z * LUZ[2]);
          const borda = Math.pow(z, 0.55); // some perto do limbo
          const terra = ehTerra(latG, lonG);
          // Distância angular até o país: dentro do raio, a terra acende.
          const cosD = sinLat * salvo + Math.cos(lat) * calvo * Math.cos(lon - alvoLon);
          const dentro = cosD > cosRaio;
          const x = centro - R + (c + 0.5 + meia) * cel, y = centro - R + (l + 0.5) * cel;

          if (dentro && e.foco > 0.02) {
            const d = Math.acos(Math.min(1, cosD));
            const miolo = 1 - d / raioEfetivo; // 1 no centro, 0 na borda
            const forca = Math.min(1, (terra ? 0.6 + 0.4 * miolo : 0.18 + 0.3 * miolo) * pulso * e.foco);
            const raio = cel * (terra ? 0.3 + 0.2 * miolo : 0.1 + 0.08 * miolo);
            poe(terra && miolo > 0.72 ? 3 : 2, Math.max(1, Math.round(forca * (NIVEIS_ALFA - 1) * borda)), x, y, raio);
            continue;
          }
          if (terra) {
            poe(0, Math.max(1, Math.round((0.3 + 0.7 * sombra) * (1 - 0.4 * e.foco) * borda * (NIVEIS_ALFA - 1))), x, y, cel * (0.2 + 0.2 * sombra) * (0.7 + 0.3 * borda));
          } else {
            const grade = Math.abs(((latG + 90) % 15) - 7.5) > 6.8 || Math.abs(((lonG + 180) % 15) - 7.5) > 6.8;
            if (grade) poe(1, Math.max(1, Math.round((0.35 + 0.4 * sombra) * borda * 4)), x, y, cel * 0.09);
          }
        }
      }
      const paleta = [cores.terra, cores.mar, cores.brilho, cores.texto];
      for (const [chave, itens] of grupos) {
        const cor = Math.floor(chave / 100), nivel = chave % 100;
        cx!.fillStyle = rgba(paleta[cor], Math.min(1, nivel / (NIVEIS_ALFA - 1)) * (cor >= 2 ? 1 : 0.95));
        cx!.beginPath();
        for (const it of itens) { cx!.moveTo(it.x + it.r, it.y); cx!.arc(it.x, it.y, it.r, 0, 6.2832); }
        cx!.fill();
      }
      // Contorno fino do limbo.
      cx!.strokeStyle = rgba(cores.brilho, 0.1 + 0.1 * brilho);
      cx!.lineWidth = 1;
      cx!.beginPath(); cx!.arc(centro, centro, R + 1, 0, 7); cx!.stroke();
    }

    function acordar() { if (!raf) { ultimo = performance.now(); raf = requestAnimationFrame(quadro); } }
    desenharAgora.current = () => { acordar(); };

    medir();
    pegarCores();
    desenhar(0);
    acordar();
    const obs = new ResizeObserver(() => { medir(); desenhar(performance.now() / 1000); });
    obs.observe(caixa.current);
    const interseccao = new IntersectionObserver(([en]) => { visivel = en.isIntersecting; if (visivel) acordar(); });
    interseccao.observe(caixa.current);
    const aoVisibilidade = () => { if (!document.hidden) acordar(); };
    document.addEventListener("visibilitychange", aoVisibilidade);
    // Troca de tema: relê as cores no próximo quadro.
    const tema = new MutationObserver(() => { pegarCores(); acordar(); });
    tema.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => { cancelAnimationFrame(raf); obs.disconnect(); interseccao.disconnect(); tema.disconnect(); document.removeEventListener("visibilitychange", aoVisibilidade); desenharAgora.current = null; };
  }, []);

  return (
    <div ref={caixa} className="relative mx-auto aspect-square w-full max-w-[340px]">
      <canvas ref={canvas} aria-hidden className="block" />
      <div className="ecos-globo-marca" data-visivel={chegou && !!alvo}>
        <span className="ecos-globo-anel" />
        <span className="ecos-globo-mastro" />
        <span className="ecos-globo-bandeira"><Bandeira pais={pais} /></span>
      </div>
    </div>
  );
}
