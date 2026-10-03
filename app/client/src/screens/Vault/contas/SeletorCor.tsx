import { useMemo, useRef, useState, type PointerEvent } from "react";
import { corDoTexto } from "../VaultCategories";

/**
 * Paleta padrão: 13 colunas, uma por matiz (vermelho, laranja, amarelo… rosa) mais uma de cinzas, e 7 linhas de tons do
 * mais claro ao mais escuro. Cada coluna tem, portanto, todos os tons da mesma cor, um embaixo do outro.
 */
const MATIZES = [0, 22, 42, 68, 140, 165, 190, 215, 245, 275, 305, 335];
const TONS: [number, number][] = [[90, 88], [85, 78], [80, 66], [75, 55], [70, 44], [65, 33], [60, 22]];
const CINZAS = ["#ffffff", "#e5e7eb", "#c7ccd4", "#9ca3af", "#6b7280", "#374151", "#111827"];
export const COLUNAS_PALETA = MATIZES.length + 1;

function hslParaHex(h: number, s: number, l: number): string {
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * c).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

export const PALETA: string[] = TONS.flatMap(([s, l], linha) => [...MATIZES.map((h) => hslParaHex(h, s, l)), CINZAS[linha]!]);

type Hsv = { h: number; s: number; v: number };

function hexParaRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const rgbParaHex = (r: number, g: number, b: number) => `#${[r, g, b].map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, "0")).join("")}`;

function rgbParaHsv(r: number, g: number, b: number): Hsv {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B), min = Math.min(R, G, B), d = max - min;
  let h = 0;
  if (d) h = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return { h: (h * 60 + 360) % 360, s: max ? d / max : 0, v: max };
}
function hsvParaRgb({ h, s, v }: Hsv): [number, number, number] {
  const f = (n: number) => { const k = (n + h / 60) % 6; return (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255; };
  return [f(5), f(3), f(1)];
}

/**
 * Cor da conta: uma paleta de cubos pequenos ou, na outra aba, o seletor avançado (área de saturação/brilho, matiz,
 * valores RGB e hexadecimal). A cor escolhida vale nas duas abas.
 */
export function SeletorCor({ valor, onChange }: { valor: string; onChange: (hex: string) => void }) {
  const [aba, setAba] = useState<"paleta" | "avancado">("paleta");
  return (
    <div className="cofre-cor">
      <div className="cofre-cor-abas" role="group" aria-label="Modo de escolher a cor">
        <button type="button" aria-pressed={aba === "paleta"} onClick={() => setAba("paleta")}>Paleta</button>
        <button type="button" aria-pressed={aba === "avancado"} onClick={() => setAba("avancado")}>Avançado</button>
        <span className="cofre-cor-atual"><i style={{ background: valor, color: corDoTexto(valor) }} />{valor.toUpperCase()}</span>
      </div>
      {aba === "paleta" ? (
        <div className="cofre-cor-paleta" role="group" aria-label="Paleta de cores">
          {PALETA.map((c) => <button key={c} type="button" aria-label={`Cor ${c}`} aria-pressed={valor.toLowerCase() === c} style={{ background: c }} onClick={() => onChange(c)} />)}
        </div>
      ) : <Avancado valor={valor} onChange={onChange} />}
    </div>
  );
}

function Avancado({ valor, onChange }: { valor: string; onChange: (hex: string) => void }) {
  const rgb = hexParaRgb(valor) ?? [148, 163, 184];
  // O matiz é guardado à parte: em cinza/preto o hex perde a informação dele e a barra pularia para o vermelho.
  const [matiz, setMatiz] = useState(() => rgbParaHsv(...rgb).h);
  const [hexTexto, setHexTexto] = useState<string | null>(null);
  const hsv = useMemo<Hsv>(() => { const x = rgbParaHsv(...rgb); return { h: x.s > 0 && x.v > 0 ? x.h : matiz, s: x.s, v: x.v }; }, [rgb[0], rgb[1], rgb[2], matiz]); // eslint-disable-line react-hooks/exhaustive-deps
  const area = useRef<HTMLDivElement>(null);

  function mudar(novo: Hsv) { onChange(rgbParaHex(...hsvParaRgb(novo))); }
  function noArrasto(e: PointerEvent<HTMLDivElement>) {
    if (!area.current || (e.type === "pointermove" && e.buttons !== 1)) return;
    const r = area.current.getBoundingClientRect();
    const s = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    const v = 1 - Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
    mudar({ h: hsv.h, s, v });
  }
  function canal(i: 0 | 1 | 2, texto: string) {
    const n = Math.max(0, Math.min(255, Number(texto.replace(/\D/g, "")) || 0));
    const novo: [number, number, number] = [...rgb] as [number, number, number];
    novo[i] = n;
    onChange(rgbParaHex(...novo));
  }

  return (
    <div className="cofre-cor-avancado">
      <div ref={area} className="cofre-cor-area" role="slider" aria-label="Saturação e brilho" aria-valuetext={`${Math.round(hsv.s * 100)}% de saturação, ${Math.round(hsv.v * 100)}% de brilho`} tabIndex={0}
        style={{ background: `linear-gradient(to top,#000,transparent),linear-gradient(to right,#fff,hsl(${hsv.h},100%,50%))` }}
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); noArrasto(e); }} onPointerMove={noArrasto}
        onKeyDown={(e) => {
          const passo = e.shiftKey ? 0.1 : 0.02;
          const d = { ArrowLeft: [-passo, 0], ArrowRight: [passo, 0], ArrowUp: [0, passo], ArrowDown: [0, -passo] }[e.key];
          if (!d) return;
          e.preventDefault();
          mudar({ h: hsv.h, s: Math.max(0, Math.min(1, hsv.s + d[0]!)), v: Math.max(0, Math.min(1, hsv.v + d[1]!)) });
        }}>
        <i style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: valor }} />
      </div>
      <input className="cofre-cor-matiz" type="range" min={0} max={360} value={Math.round(hsv.h)} aria-label="Matiz"
        onChange={(e) => { const h = Number(e.target.value); setMatiz(h); mudar({ h, s: hsv.s || 0.5, v: hsv.v || 0.8 }); }} />
      <div className="cofre-cor-campos">
        {(["R", "G", "B"] as const).map((rotulo, i) => (
          <label key={rotulo}><span>{rotulo}</span><input inputMode="numeric" value={rgb[i]} aria-label={`Valor ${rotulo}`} onChange={(e) => canal(i as 0 | 1 | 2, e.target.value)} /></label>
        ))}
        <label className="cofre-cor-hex"><span>HEX</span>
          <input value={hexTexto ?? valor.toUpperCase()} aria-label="Cor em hexadecimal" maxLength={7} spellCheck={false}
            onChange={(e) => { const t = e.target.value; setHexTexto(t); const c = t.startsWith("#") ? t : `#${t}`; if (hexParaRgb(c)) onChange(c.toLowerCase()); }}
            onBlur={() => setHexTexto(null)} />
        </label>
      </div>
    </div>
  );
}
