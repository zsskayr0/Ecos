// Portado do Nexus: components/PeriodPicker.tsx. Mantém a composição e as interações originais.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  MONTH_ABBR,
  WEEKDAY_ABBR,
  buildMonthGrid,
  computeRangeRowSegments,
  formatBR,
  isTodayPeriod,
  parseBRDateLenient,
  periodLabel,
  periodRange,
  toISO,
  todayPeriod,
  type Period,
} from "./period";
import { CalendarDays as IconCalendar, ChevronDown as IconChevronDown } from "lucide-react";

type Mode = "month" | "range" | "year";

/** Últimas seleções de período, guardadas no aparelho (valem para qualquer tela e conta). */
const CHAVE_RECENTES = "ecos:cofre:periodos-recentes";
const MAX_RECENTES = 6;
function lerRecentes(): Period[] {
  try {
    const v = JSON.parse(localStorage.getItem(CHAVE_RECENTES) ?? "[]");
    return Array.isArray(v) ? (v as Period[]).filter((x) => x && (x.kind === "month" || x.kind === "year" || x.kind === "range")).slice(0, MAX_RECENTES) : [];
  } catch { return []; }
}
function guardarRecente(p: Period): Period[] {
  const chave = JSON.stringify(p);
  const lista = [p, ...lerRecentes().filter((x) => JSON.stringify(x) !== chave)].slice(0, MAX_RECENTES);
  try { localStorage.setItem(CHAVE_RECENTES, JSON.stringify(lista)); } catch { /* vale só nesta sessão */ }
  return lista;
}


export function PeriodPicker({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  // No celular o seletor é um popup sobre a tela desfocada, com entrada e saída animadas (no desktop segue o popover de sempre).
  const [movel, setMovel] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width:700px)").matches);
  const [visivel, setVisivel] = useState(false);
  const [recentes, setRecentes] = useState<Period[]>(() => lerRecentes());
  const [baixoDoPopup, setBaixoDoPopup] = useState(0);
  /** Aplica o período e o lembra entre as últimas seleções. */
  const aplicar = (p: Period) => { setRecentes(guardarRecente(p)); onChange(p); };
  const [saindo, setSaindo] = useState(false);
  useEffect(() => {
    const q = window.matchMedia("(max-width:700px)");
    const f = () => setMovel(q.matches);
    q.addEventListener("change", f);
    return () => q.removeEventListener("change", f);
  }, []);
  useEffect(() => {
    if (open) { setVisivel(true); setSaindo(false); return; }
    if (!movel) { setVisivel(false); return; }
    if (!visivel) return;
    setSaindo(true);
    const t = window.setTimeout(() => { setVisivel(false); setSaindo(false); }, 200);
    return () => window.clearTimeout(t);
  }, [open, movel]); // eslint-disable-line react-hooks/exhaustive-deps
  // Largura do rótulo medida: o botão cresce/encolhe com transição quando o texto muda e empurra vizinhos junto.
  const rotulo = useRef<HTMLSpanElement>(null);
  const [larguraRotulo, setLarguraRotulo] = useState<number | null>(null);
  const textoPeriodo = periodLabel(value);
  useLayoutEffect(() => {
    const el = rotulo.current;
    if (!el) return;
    const medir = () => setLarguraRotulo(Math.ceil(el.getBoundingClientRect().width) + 1);
    medir();
    // A fonte da página pode carregar depois da primeira medida; remedir evita o texto cortado.
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(medir);
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [textoPeriodo]);
  const [mode, setMode] = useState<Mode>(value.kind);

  // --- estado do modo "Mês" ---
  const [monthNavYear, setMonthNavYear] = useState(value.kind === "month" ? value.year : new Date().getFullYear());
  const [monthText, setMonthText] = useState("");

  // --- estado do modo "Intervalo" (calendário com dois pontos) ---
  const today = new Date();
  const [rangeNavYear, setRangeNavYear] = useState(value.kind === "range" ? Number(value.from.slice(0, 4)) : today.getFullYear());
  const [rangeNavMonth, setRangeNavMonth] = useState(value.kind === "range" ? Number(value.from.slice(5, 7)) : today.getMonth() + 1);
  const [rangeStart, setRangeStart] = useState<string | null>(value.kind === "range" ? value.from : null);
  const [rangeEnd, setRangeEnd] = useState<string | null>(value.kind === "range" ? value.to : null);
  const [hoverIso, setHoverIso] = useState<string | null>(null);
  const [fromText, setFromText] = useState(value.kind === "range" ? formatBR(value.from) : "");
  const [toText, setToText] = useState(value.kind === "range" ? formatBR(value.to) : "");

  // --- estado do modo "Ano" ---
  const [yearGridStart, setYearGridStart] = useState((value.kind === "year" ? value.year : today.getFullYear()) - 5);
  const [yearText, setYearText] = useState("");

  useEffect(() => {
    if (!open) return;
    // Sempre abre no intervalo, já preenchido com o período em uso (um mês vira do dia 1 ao último).
    const { from, to } = periodRange(value);
    setMode("range");
    setRangeStart(from); setRangeEnd(to);
    setFromText(formatBR(from)); setToText(formatBR(to));
    setRangeNavYear(Number(from.slice(0, 4))); setRangeNavMonth(Number(from.slice(5, 7)));
    setRecentes(lerRecentes());
  }, [open, value]);
  // O popup das últimas seleções fica logo abaixo do principal, que muda de altura conforme o modo.
  useLayoutEffect(() => {
    if (!visivel || !movel) return;
    const el = dialog.current;
    if (!el) return;
    const medir = () => setBaixoDoPopup(el.offsetTop + el.offsetHeight);
    medir();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(medir);
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [visivel, movel, mode]);

  useEffect(() => { if(!open)return; dialog.current?.querySelector<HTMLButtonElement>("button")?.focus(); const close=(e:KeyboardEvent)=>{if(e.key==="Escape")setOpen(false);};window.addEventListener("keydown",close);return()=>{window.removeEventListener("keydown",close);trigger.current?.focus();}; },[open]);
  function applyMonth(year: number, month: number) {
    aplicar({ kind: "month", year, month });
    setOpen(false);
  }

  function applyYear(year: number) {
    aplicar({ kind: "year", year });
    setOpen(false);
  }

  function applyRange() {
    if (!rangeStart || !rangeEnd) return;
    const [from, to] = rangeStart <= rangeEnd ? [rangeStart, rangeEnd] : [rangeEnd, rangeStart];
    aplicar({ kind: "range", from, to });
    setOpen(false);
  }

  // Arrastar: pegar um dia cria o intervalo a partir dele; pegar uma ponta de um intervalo pronto a ajusta.
  const arrasto = useRef<{ ancora: string; navEm: number } | null>(null);
  const [arrastando, setArrastando] = useState(false);
  function definirIntervalo(a: string, b: string) {
    const [from, to] = a <= b ? [a, b] : [b, a];
    setRangeStart(from); setRangeEnd(to);
    setFromText(formatBR(from)); setToText(formatBR(to));
  }
  function diaSob(e: React.PointerEvent): { iso: string; foraDoMes: boolean } | null {
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-iso]") as HTMLElement | null;
    return el ? { iso: el.dataset.iso as string, foraDoMes: el.dataset.fora === "1" } : null;
  }
  function comecarArrasto(e: React.PointerEvent) {
    const d = diaSob(e);
    if (!d) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    let ancora = d.iso;
    if (rangeStart && rangeEnd) {
      if (d.iso === rangeStart) ancora = rangeEnd;
      else if (d.iso === rangeEnd) ancora = rangeStart;
    }
    arrasto.current = { ancora, navEm: 0 };
    setArrastando(true);
    definirIntervalo(ancora, d.iso);
  }
  function moverArrasto(e: React.PointerEvent) {
    const a = arrasto.current;
    if (!a) return;
    const d = diaSob(e);
    if (!d) return;
    definirIntervalo(a.ancora, d.iso);
    // Chegou num dia do mês vizinho: vira o calendário para continuar arrastando.
    if (d.foraDoMes && Date.now() - a.navEm > 650) {
      a.navEm = Date.now();
      const ano = Number(d.iso.slice(0, 4)), mes = Number(d.iso.slice(5, 7));
      setRangeNavYear(ano); setRangeNavMonth(mes);
    }
  }
  function terminarArrasto() { arrasto.current = null; setArrastando(false); }

  function pickRangeDay(iso: string) {
    if (!rangeStart || (rangeStart && rangeEnd)) {
      setRangeStart(iso);
      setRangeEnd(null);
      setFromText(formatBR(iso));
      setToText("");
      return;
    }
    const [from, to] = iso >= rangeStart ? [rangeStart, iso] : [iso, rangeStart];
    setRangeStart(from);
    setRangeEnd(to);
    setFromText(formatBR(from));
    setToText(formatBR(to));
    setHoverIso(null);
  }

  // Enquanto o dia final não foi clicado, o mouse "arrasta" uma prévia do
  // intervalo — é essa prévia que renderiza a barra, não só a seleção final.
  const previewEnd = rangeStart && !rangeEnd ? hoverIso : null;
  const displayStart = rangeStart;
  const displayEnd = previewEnd ?? rangeEnd;

  function commitFromText(text: string) {
    setFromText(text);
    const iso = parseBRDateLenient(text);
    if (iso) setRangeStart(iso);
  }

  function commitToText(text: string) {
    setToText(text);
    const iso = parseBRDateLenient(text);
    if (iso) setRangeEnd(iso);
  }

  function commitMonthText(text: string) {
    const m = /^(\d{1,2})\/(\d{4})$/.exec(text.trim());
    if (!m) return;
    const month = Number(m[1]);
    const year = Number(m[2]);
    if (month >= 1 && month <= 12) applyMonth(year, month);
  }

  function commitYearText(text: string) {
    const year = Number(text.trim());
    if (Number.isInteger(year) && year > 1900 && year < 9999) applyYear(year);
  }

  const grid = buildMonthGrid(rangeNavYear, rangeNavMonth);
  const rowSegments = computeRangeRowSegments(grid, displayStart, displayEnd);

  return (
    <div className="relative shrink-0">
      <button
        ref={trigger}
        aria-haspopup="dialog"
        aria-label={`Selecionar período: ${periodLabel(value)}`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="cofre-card flex items-center gap-2 whitespace-nowrap rounded-[11px] px-3.5 py-2 text-[0.78rem] font-semibold text-[var(--text-muted)] transition-all duration-150 hover:text-[var(--text)] active:scale-[0.97]"
      >
        <IconCalendar width={13} height={13} />
        <span className="cofre-period-rotulo" style={larguraRotulo == null ? undefined : { width: larguraRotulo }}><span ref={rotulo}>{textoPeriodo}</span></span>
        <IconChevronDown width={12} height={12} className={`text-[var(--text-faint)] transition-transform duration-150 ${open ? "rotate-180" : ""}`} />
      </button>

      {visivel && (
        <>
          <div className={movel ? `ecos-busca-veu ${saindo ? "ecos-busca-saindo" : "ecos-busca-entrando"}` : "fixed inset-0 z-10"} onClick={() => setOpen(false)} />
          <div ref={dialog} role="dialog" aria-modal="true" onKeyDown={e=>{if(e.key!=="Tab")return;const controls=Array.from(e.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled),input:not(:disabled)"));const first=controls[0],last=controls[controls.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}} aria-label="Selecionar período" className="cofre-card cofre-period-popover" data-movel={movel || undefined} data-saindo={saindo || undefined}>
            <div className="mb-2 grid grid-cols-2 gap-2">
              <button
                onClick={() => { aplicar(todayPeriod()); setOpen(false); }}
                className={
                  "w-full rounded-[9px] border border-[var(--border)] py-1.5 text-[0.74rem] font-bold " +
                  (isTodayPeriod(value) ? "bg-[var(--panel-elevated)] text-[var(--text)]" : "text-[var(--text-muted)] hover:bg-[var(--panel-elevated)] hover:text-[var(--text)]")
                }
              >
                Hoje
              </button>
              <button
                onClick={() => { const d = new Date(); aplicar({ kind: "month", year: d.getFullYear(), month: d.getMonth() + 1 }); setOpen(false); }}
                className={
                  "w-full rounded-[9px] border border-[var(--border)] py-1.5 text-[0.74rem] font-bold " +
                  (value.kind === "month" && value.year === new Date().getFullYear() && value.month === new Date().getMonth() + 1 ? "bg-[var(--panel-elevated)] text-[var(--text)]" : "text-[var(--text-muted)] hover:bg-[var(--panel-elevated)] hover:text-[var(--text)]")
                }
              >
                Este mês
              </button>
            </div>
            <div className="mb-3 flex rounded-[10px] border border-[var(--border)] bg-[var(--bg)] p-[3px]">
              {(["month", "range", "year"] as Mode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={
                    "flex-1 rounded-lg py-1.5 text-[0.74rem] font-bold " +
                    (mode === m ? "bg-[var(--panel-elevated)] text-[var(--text)]" : "text-[var(--text-muted)]")
                  }
                >
                  {m === "month" ? "Mês" : m === "range" ? "Intervalo" : "Ano"}
                </button>
              ))}
            </div>

            {mode === "month" && (
              <div>
                <div className="mb-2.5 flex items-center justify-between">
                  <NavBtn onClick={() => setMonthNavYear((y) => y - 1)}>‹</NavBtn>
                  <span className="text-[0.82rem] font-bold">{monthNavYear}</span>
                  <NavBtn onClick={() => setMonthNavYear((y) => y + 1)}>›</NavBtn>
                </div>
                <div className="grid grid-cols-4 gap-1.5">
                  {MONTH_ABBR.map((label, i) => {
                    const month = i + 1;
                    const isSelected = value.kind === "month" && value.year === monthNavYear && value.month === month;
                    return (
                      <button
                        key={label}
                        onClick={() => applyMonth(monthNavYear, month)}
                        className={
                          "rounded-[8px] py-2 text-[0.74rem] font-semibold transition-colors " +
                          (isSelected ? "bg-[var(--panel-elevated)] text-[var(--text)]" : "text-[var(--text-muted)] hover:bg-[var(--panel-elevated)] hover:text-[var(--text)]")
                        }
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
                <TextJump
                  placeholder="Ir para (mm/aaaa)"
                  value={monthText}
                  onChange={setMonthText}
                  onSubmit={() => commitMonthText(monthText)}
                />
              </div>
            )}

            {mode === "range" && (
              <div>
                <div className="mb-2.5 flex items-center justify-between">
                  <NavBtn
                    onClick={() =>
                      setRangeNavMonth((m) => {
                        if (m === 1) {
                          setRangeNavYear((y) => y - 1);
                          return 12;
                        }
                        return m - 1;
                      })
                    }
                  >
                    ‹
                  </NavBtn>
                  <span className="text-[0.78rem] font-bold">
                    {MONTH_ABBR[rangeNavMonth - 1]} {rangeNavYear}
                  </span>
                  <NavBtn
                    onClick={() =>
                      setRangeNavMonth((m) => {
                        if (m === 12) {
                          setRangeNavYear((y) => y + 1);
                          return 1;
                        }
                        return m + 1;
                      })
                    }
                  >
                    ›
                  </NavBtn>
                </div>
                <div className="mb-1 grid grid-cols-7 text-center text-[0.62rem] font-bold text-[var(--text-faint)]">
                  {WEEKDAY_ABBR.map((d, i) => (
                    <span key={i}>{d}</span>
                  ))}
                </div>
                <div
                  className="relative select-none"
                  style={{ touchAction: "none" }}
                  data-arrastando={arrastando || undefined}
                  onPointerDown={comecarArrasto}
                  onPointerMove={moverArrasto}
                  onPointerUp={terminarArrasto}
                  onPointerCancel={terminarArrasto}
                >
                  {/* overlay: uma barra arredondada por semana, do dia inicial ao final — não célula a célula */}
                  {rowSegments.map((seg) => (
                    <div
                      key={seg.row}
                      className="cofre-faixa-intervalo pointer-events-none absolute transition-[left,width] duration-150 ease-out"
                      style={{
                        top: `${(seg.row * 100) / 6}%`,
                        height: `${100 / 6}%`,
                        left: `${(seg.colStart * 100) / 7}%`,
                        width: `${((seg.colEnd - seg.colStart + 1) * 100) / 7}%`,
                      }}
                    />
                  ))}

                  <div className="relative z-10 grid grid-cols-7 text-center">
                    {grid.map((cell) => {
                      const isEdge = cell.iso === displayStart || cell.iso === displayEnd;
                      const ehHoje = cell.iso === toISO(today.getFullYear(), today.getMonth() + 1, today.getDate());
                      return (
                        <button
                          key={cell.iso}
                          type="button"
                          tabIndex={-1}
                          data-iso={cell.iso}
                          data-fora={cell.inMonth ? "0" : "1"}
                          className={
                            "mx-auto flex h-6 w-6 items-center justify-center rounded-[6px] text-[0.7rem] " +
                            (!cell.inMonth ? "text-[var(--text-faint)] opacity-40" : isEdge ? "cofre-dia-extremo font-bold" : ehHoje ? "cofre-dia-hoje font-bold text-[var(--text)]" : "text-[var(--text-muted)]")
                          }
                        >
                          {cell.day}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <TextJump placeholder="De (dd/mm/aaaa)" value={fromText} onChange={commitFromText} onSubmit={() => {}} />
                  <TextJump placeholder="Até (dd/mm/aaaa)" value={toText} onChange={commitToText} onSubmit={() => {}} />
                </div>
                <button
                  onClick={applyRange}
                  disabled={!rangeStart || !rangeEnd}
                  className="cofre-solid mt-2.5 w-full rounded-[9px] py-2 text-[0.76rem] font-bold transition-transform active:scale-[0.97] disabled:opacity-40"
                >
                  Aplicar intervalo
                </button>
              </div>
            )}

            {mode === "year" && (
              <div>
                <div className="mb-2.5 flex items-center justify-between">
                  <NavBtn onClick={() => setYearGridStart((y) => y - 8)}>‹</NavBtn>
                  <span className="text-[0.78rem] font-bold">
                    {yearGridStart} – {yearGridStart + 7}
                  </span>
                  <NavBtn onClick={() => setYearGridStart((y) => y + 8)}>›</NavBtn>
                </div>
                <div className="grid grid-cols-4 gap-1.5">
                  {Array.from({ length: 8 }, (_, i) => yearGridStart + i).map((y) => (
                    <button
                      key={y}
                      onClick={() => applyYear(y)}
                      className={
                        "rounded-[8px] py-2 text-[0.74rem] font-semibold transition-colors " +
                        (value.kind === "year" && value.year === y
                          ? "bg-[var(--panel-elevated)] text-[var(--text)]"
                          : "text-[var(--text-muted)] hover:bg-[var(--panel-elevated)] hover:text-[var(--text)]")
                      }
                    >
                      {y}
                    </button>
                  ))}
                </div>
                <TextJump placeholder="Ir para (aaaa)" value={yearText} onChange={setYearText} onSubmit={() => commitYearText(yearText)} />
              </div>
            )}
          </div>
          {movel && recentes.length > 0 && (
            <div className="cofre-period-recentes" data-saindo={saindo || undefined} style={{ top: baixoDoPopup + 10 }} role="dialog" aria-label="Últimas seleções de período">
              <b>Recentes</b>
              <div>
                {recentes.map((r) => (
                  <button key={JSON.stringify(r)} onClick={() => { aplicar(r); setOpen(false); }}>
                    <IconCalendar width={14} height={14} />{periodLabel(r)}
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function NavBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className="flex h-6 w-6 items-center justify-center rounded-[7px] text-[var(--text-muted)] transition-colors hover:bg-[var(--panel-elevated)] hover:text-[var(--text)] active:scale-95">
      {children}
    </button>
  );
}

function TextJump({
  placeholder,
  value,
  onChange,
  onSubmit,
}: {
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => e.key === "Enter" && onSubmit()}
      placeholder={placeholder}
      className="cofre-mono mt-2.5 w-full rounded-[9px] border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5 text-[0.74rem] text-[var(--text)] placeholder:text-[var(--text-faint)]"
    />
  );
}
