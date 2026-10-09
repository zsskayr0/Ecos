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
  todayPeriod,
  type Period,
} from "./period";
import { CalendarDays as IconCalendar, ChevronDown as IconChevronDown } from "lucide-react";

type Mode = "month" | "range" | "year";

export function PeriodPicker({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
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
    setMode(value.kind);
  }, [open, value]);

  useEffect(() => { if(!open)return; dialog.current?.querySelector<HTMLButtonElement>("button")?.focus(); const close=(e:KeyboardEvent)=>{if(e.key==="Escape")setOpen(false);};window.addEventListener("keydown",close);return()=>{window.removeEventListener("keydown",close);trigger.current?.focus();}; },[open]);
  function applyMonth(year: number, month: number) {
    onChange({ kind: "month", year, month });
    setOpen(false);
  }

  function applyYear(year: number) {
    onChange({ kind: "year", year });
    setOpen(false);
  }

  function applyRange() {
    if (!rangeStart || !rangeEnd) return;
    const [from, to] = rangeStart <= rangeEnd ? [rangeStart, rangeEnd] : [rangeEnd, rangeStart];
    onChange({ kind: "range", from, to });
    setOpen(false);
  }

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

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div ref={dialog} role="dialog" aria-modal="true" onKeyDown={e=>{if(e.key!=="Tab")return;const controls=Array.from(e.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled),input:not(:disabled)"));const first=controls[0],last=controls[controls.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}} aria-label="Selecionar período" className="cofre-card cofre-period-popover">
            <button
              onClick={() => {
                onChange(todayPeriod());
                setOpen(false);
              }}
              className={
                "mb-2 w-full rounded-[9px] border border-[var(--border)] py-1.5 text-[0.74rem] font-bold " +
                (isTodayPeriod(value) ? "bg-[var(--panel-elevated)] text-[var(--text)]" : "text-[var(--text-muted)] hover:bg-[var(--panel-elevated)] hover:text-[var(--text)]")
              }
            >
              Hoje
            </button>
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
                <div className="relative" onMouseLeave={() => setHoverIso(null)}>
                  {/* overlay: uma barra arredondada por semana, do dia inicial ao final — não célula a célula */}
                  {rowSegments.map((seg) => (
                    <div
                      key={seg.row}
                      className="pointer-events-none absolute rounded-[4px] bg-[var(--panel-elevated)] transition-[left,width] duration-100 ease-out"
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
                      return (
                        <button
                          key={cell.iso}
                          onClick={() => pickRangeDay(cell.iso)}
                          onMouseEnter={() => setHoverIso(cell.iso)}
                          className={
                            "mx-auto flex h-6 w-6 items-center justify-center rounded-[6px] text-[0.7rem] transition-transform duration-100 hover:scale-110 " +
                            (!cell.inMonth ? "text-[var(--text-faint)] opacity-40" : isEdge ? "font-bold text-[var(--text)]" : "text-[var(--text-muted)]")
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
