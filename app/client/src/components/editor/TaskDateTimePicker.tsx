import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { CalendarDays, Clock, X } from "lucide-react";
import { useEscFecha } from "@/components/common/Dialog";
import { GradeMes, dataParaISO } from "@/components/common/GradeMes";
import "@/components/common/menu-suspenso.css";

const LARGURA = 288;
const LARGURA_MOVEL = 320;
/** Abaixo de `md` ou com toque como ponteiro principal. */
const ehMovel = () => window.innerWidth < 768 || !!window.matchMedia?.("(pointer: coarse)").matches;
const SAIDA_MS = 110;
const SUGESTOES = ["09:00", "14:00", "19:00"];
const dois = (n: number) => String(n).padStart(2, "0");

/** Aceita "14", "14h", "1430", "14:30", "14h30", "9.15"; devolve `HH:MM` ou `null` se não for um horário. */
export function interpretarHorario(texto: string): string | null {
  const limpo = texto.trim().toLowerCase();
  const m = /^(\d{1,2})\s*(?:[:h.]\s*(\d{1,2})?|(\d{2}))?\s*(?:m|min)?$/.exec(limpo);
  if (!m) return null;
  const hora = Number(m[1]);
  const minuto = Number(m[2] ?? m[3] ?? 0);
  return hora > 23 || minuto > 59 ? null : `${dois(hora)}:${dois(minuto)}`;
}

/** Hoje, amanhã, o próximo sábado e a próxima segunda (nunca o próprio dia de hoje nos dois últimos). */
function atalhos(agora = new Date()) {
  const em = (dias: number) => dataParaISO(new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() + dias));
  const ate = (diaDaSemana: number) => ((diaDaSemana - agora.getDay() + 7) % 7) || 7;
  return [
    { rotulo: "Hoje", iso: em(0) },
    { rotulo: "Amanhã", iso: em(1) },
    { rotulo: "Sábado", iso: em(ate(6)) },
    { rotulo: "Segunda", iso: em(ate(1)) },
  ];
}

/**
 * Onde desenhar o popover, em `position: fixed`, para não ser recortado pelo painel com rolagem em que o campo vive.
 * Um ancestral com `transform` (as janelas do Ecos) vira o referencial do `fixed`: as coordenadas são convertidas para ele.
 */
function posicionar(gatilho: HTMLElement, alturaPopover: number, movel: boolean): { estilo: CSSProperties; sobe: boolean } {
  const r = gatilho.getBoundingClientRect();
  let ref: HTMLElement | null = gatilho.parentElement;
  while (ref && getComputedStyle(ref).transform === "none") ref = ref.parentElement;
  const o = ref?.getBoundingClientRect() ?? { left: 0, top: 0 };
  const alturaJanela = Math.min(window.innerHeight, window.visualViewport?.height ?? Infinity);
  const larguraJanela = document.documentElement.clientWidth || window.innerWidth;
  // No celular o popover tem a largura do campo (entre 320 e 420px): alvos maiores e nada espremido.
  const largura = Math.min(movel ? Math.min(Math.max(r.width, LARGURA_MOVEL), 420) : LARGURA, larguraJanela - 16);
  const abaixo = alturaJanela - r.bottom - 12;
  const acima = r.top - 12;
  const subir = abaixo < alturaPopover && acima > abaixo;
  const topo = subir ? Math.max(8, r.top - 6 - alturaPopover) : r.bottom + 6;
  const esquerda = Math.max(8, Math.min(r.left, larguraJanela - largura - 8));
  return { sobe: subir, estilo: { position: "fixed", left: esquerda - o.left, top: topo - o.top, width: largura, maxHeight: Math.max(200, subir ? acima : abaixo) } };
}

const CHIP = "flex items-center rounded-lg border px-2.5 font-medium transition-colors";
const CHIP_NEUTRO = "border-border bg-surface-2 text-text-secondary hover:border-steel-400 hover:text-text-primary";
const CHIP_ATIVO = "border-steel-400 bg-steel-700/40 text-text-primary";

export function TaskDateTimePicker({ data, horario, onChange, disabled = false }: { data: string; horario: string; onChange: (data: string, horario: string) => void; disabled?: boolean }) {
  const id = useId();
  /** `aberto` é a intenção; `montado` fica ligado um instante a mais para a animação de saída. */
  const [aberto, setAberto] = useState(false);
  const [montado, setMontado] = useState(false);
  const [posicao, setPosicao] = useState<CSSProperties>();
  const [sobe, setSobe] = useState(false);
  const [movel, setMovel] = useState(false);
  const desmontar = useRef<number>();
  const [textoHora, setTextoHora] = useState(horario);
  const [horaInvalida, setHoraInvalida] = useState(false);
  const raiz = useRef<HTMLDivElement>(null);
  const gatilho = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);

  const fechar = useCallback((devolverFoco = true) => {
    setAberto(false);
    window.clearTimeout(desmontar.current);
    desmontar.current = window.setTimeout(() => setMontado(false), SAIDA_MS);
    if (devolverFoco) gatilho.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => () => window.clearTimeout(desmontar.current), []);
  useEscFecha(aberto, fechar);

  function abrir() {
    setTextoHora(horario);
    setHoraInvalida(false);
    setPosicao(undefined);
    setMovel(ehMovel());
    window.clearTimeout(desmontar.current);
    setMontado(true);
    setAberto(true);
  }

  // Mede o popover já desenhado (invisível) e só então o posiciona: abre para cima quando não cabe embaixo.
  useLayoutEffect(() => {
    if (!aberto || !montado || !gatilho.current || !popover.current) return;
    const { estilo, sobe: paraCima } = posicionar(gatilho.current, popover.current.offsetHeight, movel);
    setPosicao(estilo);
    setSobe(paraCima);
  }, [aberto, montado, movel]);

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: PointerEvent) => { if (!raiz.current?.contains(e.target as Node)) fechar(false); };
    // Rolar ou redimensionar tira o popover do lugar do campo: fecha (rolagem dentro do próprio popover não conta).
    const aoRolar = (e: Event) => { if (!(e.target instanceof Node) || !popover.current?.contains(e.target)) fechar(false); };
    const aoRedimensionar = () => fechar(false);
    document.addEventListener("pointerdown", fora);
    document.addEventListener("scroll", aoRolar, true);
    window.addEventListener("resize", aoRedimensionar);
    return () => {
      document.removeEventListener("pointerdown", fora);
      document.removeEventListener("scroll", aoRolar, true);
      window.removeEventListener("resize", aoRedimensionar);
    };
  }, [aberto, fechar]);

  // Ao abrir, o foco entra no dia escolhido (ou em hoje), para o teclado.
  useEffect(() => {
    if (aberto && posicao) popover.current?.querySelector<HTMLElement>('[data-dia][tabindex="0"]')?.focus({ preventScroll: true });
  }, [aberto, posicao]);

  const hoje = dataParaISO(new Date());
  function escolherDia(iso: string) { onChange(iso, horario); fechar(); }
  /** Horário sem dia escolhido vale para hoje. */
  function escolherHorario(novo: string) { onChange(data || hoje, novo); fechar(); }
  function confirmarTexto() {
    if (!textoHora.trim()) { if (horario) onChange(data, ""); setHoraInvalida(false); return true; }
    const lido = interpretarHorario(textoHora);
    if (!lido) { setHoraInvalida(true); return false; }
    setHoraInvalida(false);
    setTextoHora(lido);
    if (lido !== horario || !data) onChange(data || hoje, lido);
    return true;
  }

  // Vazio: só "Definir" (o rótulo do campo já diz o quê). Preenchido: "qui., 22 de out. · 14:30".
  const rotulo = data
    ? `${new Date(`${data}T12:00:00`).toLocaleDateString("pt-BR", { weekday: "short", day: "numeric", month: "short" })}${horario ? ` · ${horario}` : ""}`
    : "Definir";

  return <div ref={raiz} className="relative">
    <button ref={gatilho} type="button" disabled={disabled} aria-haspopup="dialog" aria-expanded={aberto} onClick={() => (aberto ? fechar() : abrir())} className="ecos-input flex min-h-11 items-center gap-3 !py-2.5 text-left hover:border-steel-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-steel-400 disabled:opacity-40">
      <CalendarDays size={17} className="shrink-0 text-steel-300" />
      <span className={`min-w-0 flex-1 truncate ${data ? "text-text-primary" : "text-text-secondary"}`}>{rotulo}</span>
    </button>
    {montado && <div ref={popover} role="dialog" aria-label="Escolher data e horário" data-saindo={!aberto} data-sobe={sobe} style={posicao ?? { position: "fixed", left: 0, top: 0, width: movel ? LARGURA_MOVEL : LARGURA, visibility: "hidden" }}
      className={`ecos-popover z-50 overflow-y-auto rounded-xl border border-border bg-surface-1 shadow-nav ${movel ? "p-4" : "p-3"}`}>
      <div className="mb-3 grid grid-cols-4 gap-1.5" role="group" aria-label="Atalhos de data">
        {atalhos().map((a) => <button key={a.rotulo} type="button" onClick={() => escolherDia(a.iso)} className={`${CHIP} ${movel ? "min-h-11 text-sm" : "min-h-8 text-xs"} justify-center !px-1 ${data === a.iso ? CHIP_ATIVO : CHIP_NEUTRO}`}>{a.rotulo}</button>)}
      </div>

      <GradeMes valor={data} onSelecionar={escolherDia} grande={movel} />

      <div className="mt-3 border-t border-border pt-3">
        <label htmlFor={`${id}-hora`} className={`mb-2 flex items-center gap-2 ${movel ? "text-sm" : "text-xs"} font-semibold text-text-secondary`}><Clock size={14} aria-hidden />Horário<span className="font-normal text-text-muted">opcional</span></label>
        <div className="grid grid-cols-4 gap-1.5">
          <input id={`${id}-hora`} value={textoHora} inputMode="numeric" autoComplete="off" placeholder="hh:mm" aria-invalid={horaInvalida} aria-describedby={horaInvalida ? `${id}-hora-ajuda` : undefined}
            onChange={(e) => { setTextoHora(e.target.value); setHoraInvalida(false); }}
            onBlur={() => { confirmarTexto(); }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (confirmarTexto()) fechar(); } }}
            className={`${movel ? "h-11 text-sm" : "h-8 text-xs"} min-w-0 rounded-lg border-2 bg-transparent px-1 text-center font-mono text-text-primary placeholder:text-text-muted ${horaInvalida ? "border-error" : "border-border-control"}`} />
          {SUGESTOES.map((s) => <button key={s} type="button" onClick={() => escolherHorario(s)} className={`${CHIP} ${movel ? "min-h-11 text-sm" : "min-h-8 text-xs"} justify-center !px-1 font-mono ${horario === s ? CHIP_ATIVO : CHIP_NEUTRO}`}>{s}</button>)}
        </div>
        {horaInvalida && <p id={`${id}-hora-ajuda`} role="alert" className="mt-2 text-[11px] text-error">Não entendi esse horário. Use o formato 14:30.</p>}
      </div>

      {(data || horario) && <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-2">
        {horario ? <button type="button" onClick={() => { onChange(data, ""); fechar(); }} className={`flex ${movel ? "min-h-11 text-sm" : "min-h-8 text-xs"} items-center rounded-lg px-2 text-text-secondary hover:bg-surface-2 hover:text-text-primary`}>Sem horário</button> : <span />}
        <button type="button" onClick={() => { onChange("", ""); fechar(); }} className={`flex ${movel ? "min-h-11 text-sm" : "min-h-8 text-xs"} items-center gap-1.5 rounded-lg px-2 text-text-secondary hover:bg-surface-2 hover:text-error`}><X size={14} aria-hidden />Limpar</button>
      </div>}
    </div>}
  </div>;
}
