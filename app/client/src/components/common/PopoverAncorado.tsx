import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

/** Uma ação do popover: a primeira marcada como `primaria` ganha o destaque. */
export interface AcaoPopover {
  rotulo: string;
  primaria?: boolean;
  icone?: ReactNode;
  onClick: () => void;
}

/** O que o popover mostra de um item da Agenda/Timeline, já traduzido em texto. */
export interface ResumoPopover {
  /** Tipo em uma palavra ("Tarefa", "Evento", "Conta a vencer"…). */
  tipo: string;
  titulo: string;
  /** Quando: "qua, 25 de nov · 14:00", "Dia todo"… */
  quando?: string;
  /** Linha extra (valor, prioridade, o que foi feito). */
  detalhe?: string;
  cor?: string;
  acoes: AcaoPopover[];
}

const fmtDia = new Intl.DateTimeFormat("pt-BR", { weekday: "short", day: "numeric", month: "short" });
/** "qua, 25 de nov · 14:00" (ou "· dia todo"). */
export function quandoDoItem(dia: string, minutos: number | null | undefined): string {
  const data = fmtDia.format(new Date(`${dia}T12:00:00`)).replace(/\./g, "");
  const hora = minutos === null || minutos === undefined ? "dia todo" : `${String(Math.floor(minutos / 60)).padStart(2, "0")}:${String(minutos % 60).padStart(2, "0")}`;
  return `${data} · ${hora}`;
}

const LARGURA = 320;
const MARGEM = 8;

/** Calcula onde o popover cabe: embaixo da âncora; se não couber, em cima; sempre dentro da janela. */
export function posicaoDoPopover(ancora: DOMRect, altura: number, janela = { largura: window.innerWidth, altura: window.innerHeight }) {
  const largura = Math.min(LARGURA, janela.largura - MARGEM * 2);
  const left = Math.min(Math.max(MARGEM, ancora.left), janela.largura - largura - MARGEM);
  const embaixo = ancora.bottom + 6;
  const top = embaixo + altura <= janela.altura - MARGEM ? embaixo : Math.max(MARGEM, ancora.top - altura - 6);
  return { left, top, width: largura };
}

/**
 * Popover leve ancorado num item: mostra o resumo e as ações rápidas sem sair da tela. Fecha com Esc, clique fora ou
 * depois de uma ação; ao fechar, o foco volta para quem o abriu.
 */
export function PopoverAncorado({ ancora, origem, resumo, onFechar }: { ancora: DOMRect; origem?: HTMLElement | null; resumo: ResumoPopover; onFechar: () => void }) {
  const caixa = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(() => posicaoDoPopover(ancora, 180));
  useLayoutEffect(() => {
    const altura = caixa.current?.offsetHeight || 180;
    setPos(posicaoDoPopover(ancora, altura));
  }, [ancora, resumo]);

  const fechar = useRef(onFechar);
  fechar.current = onFechar;
  useEffect(() => {
    caixa.current?.querySelector<HTMLElement>("[data-acao-primaria], button[data-acao]")?.focus();
    const aoTeclar = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); fechar.current(); } };
    const aoApertar = (e: PointerEvent) => {
      const alvo = e.target as Node;
      if (caixa.current?.contains(alvo) || origem?.contains(alvo)) return;
      fechar.current();
    };
    document.addEventListener("keydown", aoTeclar, true);
    document.addEventListener("pointerdown", aoApertar, true);
    return () => {
      document.removeEventListener("keydown", aoTeclar, true);
      document.removeEventListener("pointerdown", aoApertar, true);
      if (origem?.isConnected) origem.focus?.({ preventScroll: true });
    };
  }, [origem]);

  return createPortal(
    <div ref={caixa} role="dialog" aria-label={`${resumo.tipo}: ${resumo.titulo}`} data-popover-ancorado
      className="ecos-pop fixed z-[80] overflow-hidden rounded-xl border border-border bg-surface-1 shadow-nav"
      style={{ left: pos.left, top: pos.top, width: pos.width }}>
      <div className="flex items-start gap-2 px-4 pb-2 pt-3">
        {resumo.cor && <span aria-hidden className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: resumo.cor }} />}
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium uppercase tracking-wide text-text-muted">{resumo.tipo}</p>
          <h3 className="break-words text-[15px] font-semibold leading-snug text-text-primary">{resumo.titulo}</h3>
          {resumo.quando && <p className="mt-1 text-sm text-text-secondary">{resumo.quando}</p>}
          {resumo.detalhe && <p className="mt-0.5 font-mono-value text-sm text-text-secondary">{resumo.detalhe}</p>}
        </div>
        <button type="button" onClick={onFechar} aria-label="Fechar" className="-mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-text-muted hover:bg-surface-2 hover:text-text-primary"><X size={16} /></button>
      </div>
      {resumo.acoes.length > 0 && <div className="flex flex-wrap justify-end gap-2 border-t border-border px-3 py-2.5">
        {resumo.acoes.map((a) => <button key={a.rotulo} type="button" data-acao data-acao-primaria={a.primaria || undefined}
          onClick={() => { onFechar(); a.onClick(); }}
          className={`flex h-8 items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-colors ${a.primaria ? "bg-steel-700 text-on-steel hover:brightness-110" : "border border-border bg-surface-2 text-text-secondary hover:bg-surface-3 hover:text-text-primary"}`}>
          {a.icone}{a.rotulo}
        </button>)}
      </div>}
    </div>,
    document.body,
  );
}
