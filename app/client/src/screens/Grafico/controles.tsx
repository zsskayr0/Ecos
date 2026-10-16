import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check } from "lucide-react";

import "./grafico.css";
import { CORES_PREDEFINIDAS, type TipoGrafico } from "@/lib/preferencias-grafico";

/** Peças compartilhadas entre o painel flutuante do Gráfico e a tela de Configurações dele. */

/** Mesma forma do canvas: evento é losango, o resto é círculo. */
export function MarcaTipo({ tipo, cor, tamanho = 10 }: { tipo: TipoGrafico; cor: string; tamanho?: number }) {
  return (
    <span
      aria-hidden
      className="inline-block shrink-0 transition-colors duration-200"
      style={{
        width: tamanho,
        height: tamanho,
        background: cor,
        borderRadius: tipo === "evento" ? 2 : 999,
        transform: tipo === "evento" ? "rotate(45deg) scale(0.85)" : undefined,
      }}
    />
  );
}

const HEX = /^#[0-9a-fA-F]{6}$/;

interface SeletorCorProps {
  valor: string;
  onChange: (cor: string) => void;
  rotulo: string;
  tipo?: TipoGrafico;
  tamanho?: number;
}

/** Bolinha de cor que abre uma pequena paleta (predefinidas, escolha livre e código hexadecimal). */
export function SeletorCor({ valor, onChange, rotulo, tipo = "nota", tamanho = 16 }: SeletorCorProps) {
  const [aberto, setAberto] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [texto, setTexto] = useState(valor);
  const gatilho = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => setTexto(valor), [valor]);
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: PointerEvent) => {
      const alvo = e.target as Node;
      if (popover.current?.contains(alvo) || gatilho.current?.contains(alvo)) return;
      setAberto(false);
    };
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape") { setAberto(false); gatilho.current?.focus(); } };
    document.addEventListener("pointerdown", fora);
    document.addEventListener("keydown", tecla);
    return () => { document.removeEventListener("pointerdown", fora); document.removeEventListener("keydown", tecla); };
  }, [aberto]);

  function abrir() {
    const r = gatilho.current?.getBoundingClientRect();
    if (r) setPos({ x: Math.min(window.innerWidth - 232, Math.max(8, r.right - 224)), y: Math.min(window.innerHeight - 190, r.bottom + 8) });
    setAberto((a) => !a);
  }

  return (
    <>
      <button
        ref={gatilho}
        type="button"
        aria-label={`Cor: ${rotulo}`}
        aria-expanded={aberto}
        aria-controls={aberto ? id : undefined}
        onClick={abrir}
        className="flex shrink-0 items-center justify-center rounded-md p-1 transition-transform duration-150 hover:scale-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-steel-400"
      >
        <MarcaTipo tipo={tipo} cor={valor} tamanho={tamanho} />
      </button>
      {aberto && createPortal(
        <div
          ref={popover}
          id={id}
          role="dialog"
          aria-label={`Escolher cor: ${rotulo}`}
          style={{ left: pos.x, top: pos.y }}
          className="fixed z-[80] w-56 animate-[grafico-pop_140ms_ease-out] rounded-xl border border-border bg-surface-raised p-3 shadow-xl"
        >
          <div className="grid grid-cols-5 gap-2">
            {CORES_PREDEFINIDAS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={c}
                onClick={() => onChange(c)}
                className="relative flex h-7 w-full items-center justify-center rounded-lg transition-transform duration-150 hover:scale-105"
                style={{ background: c }}
              >
                {c.toLowerCase() === valor.toLowerCase() && <Check size={14} className="text-white drop-shadow" aria-hidden />}
              </button>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <input
              type="color"
              aria-label="Escolher outra cor"
              value={HEX.test(valor) ? valor : "#7a9cf0"}
              onChange={(e) => onChange(e.target.value)}
              className="h-8 w-9 shrink-0 cursor-pointer rounded-md border border-border bg-transparent p-0.5"
            />
            <input
              type="text"
              aria-label="Código da cor"
              value={texto}
              maxLength={7}
              spellCheck={false}
              onChange={(e) => { setTexto(e.target.value); if (HEX.test(e.target.value)) onChange(e.target.value); }}
              onBlur={() => setTexto(valor)}
              className="ecos-input min-h-8 !rounded-lg border border-border font-mono-value text-xs"
            />
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

interface DeslizanteProps {
  valor: number;
  min: number;
  max: number;
  passo: number;
  onChange: (v: number) => void;
  rotulo: string;
  formatar?: (v: number) => string;
  largura?: string;
}

/** Controle deslizante no estilo dos demais campos: trilho fino, valor em fonte monoespaçada. */
export function Deslizante({ valor, min, max, passo, onChange, rotulo, formatar = (v) => String(Math.round(v * 100) / 100), largura = "w-40" }: DeslizanteProps) {
  const pct = ((valor - min) / (max - min)) * 100;
  return (
    <div className="flex shrink-0 items-center gap-2.5">
      <input
        type="range"
        aria-label={rotulo}
        min={min}
        max={max}
        step={passo}
        value={valor}
        onChange={(e) => onChange(Number(e.target.value))}
        className={`ecos-grafico-slider ${largura}`}
        style={{ ["--preenchido" as string]: `${pct}%` }}
      />
      <span className="w-10 text-right font-mono-value text-[11px] tabular-nums text-text-muted">{formatar(valor)}</span>
    </div>
  );
}
