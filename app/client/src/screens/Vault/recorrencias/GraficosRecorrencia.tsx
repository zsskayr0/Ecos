import { useRef, useState, type ReactNode } from "react";
import { formatMoeda } from "@/lib/format";
import type { TotalDoBalde } from "./ocorrencias";

const dataBR = (iso: string) => iso.split("-").reverse().join("/");
const dataLonga = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" });
const mesLongo = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
const porDia = (totais: TotalDoBalde[]) => totais.length > 0 && totais.every((t) => t.de === t.ate);
const quando = (t: TotalDoBalde) => (t.de === t.ate ? dataLonga(t.de) : mesLongo(t.de));
const ocorrenciasTxt = (n: number) => (n === 0 ? "nenhuma ocorrência" : n === 1 ? "1 ocorrência" : `${n} ocorrências`);

/** "R$ 1,2 mil" / "R$ 350": rótulo curto para o eixo. */
function compacto(centavos: number): string {
  const r = centavos / 100;
  if (r >= 1_000_000) return `${(r / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`;
  if (r >= 1000) return `${(r / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
  return String(Math.round(r));
}

/** Teto "redondo" do eixo (em centavos) para 4 divisões. */
function tetoDoEixo(maior: number): number {
  if (maior <= 0) return 400_00;
  const bruto = maior / 100 / 4;
  const pot = Math.pow(10, Math.floor(Math.log10(bruto)));
  const passo = ([1, 2, 2.5, 5, 10].map((m) => m * pot).find((p) => p >= bruto) ?? 10 * pot);
  return Math.round(passo * 4 * 100);
}

/** Cartão que acompanha o mouse/foco dentro do gráfico, sem sair da área. */
function Dica({ x, y, largura, children }: { x: number; y: number; largura: number; children: ReactNode }) {
  const meio = 92;
  const esquerda = Math.min(Math.max(x, meio), Math.max(meio, largura - meio));
  return <div className="cofre-rec-dica-grafico" role="tooltip" style={{ left: esquerda, top: y }}>{children}</div>;
}

// ---------------------------------------------------------------------------------------------------------
// Mapa de intensidade
// ---------------------------------------------------------------------------------------------------------

/** Despesas previstas dia a dia num calendário (ou mês a mês): quanto mais forte a cor, maior o gasto. */
export function MapaDeIntensidade({ totais, hoje }: { totais: TotalDoBalde[]; hoje: string }) {
  const caixa = useRef<HTMLDivElement>(null);
  const [foco, setFoco] = useState<{ i: number; x: number; y: number; w: number } | null>(null);
  const dias = porDia(totais);
  const maior = Math.max(0, ...totais.map((t) => t.saidas));
  const total = totais.reduce((s, t) => s + t.saidas, 0);
  const topo = maior > 0 ? totais.find((t) => t.saidas === maior) : undefined;
  const comGasto = totais.filter((t) => t.saidas > 0).length;
  const resumo = topo ? `Maior despesa prevista: ${formatMoeda(topo.saidas)} em ${dataBR(topo.de)}.` : "Nenhuma despesa prevista no período.";
  const folga = dias && totais[0] ? new Date(`${totais[0].de}T12:00:00Z`).getUTCDay() : 0;
  const forca = (v: number) => (maior > 0 && v > 0 ? 0.2 + 0.8 * Math.pow(v / maior, 0.6) : 0);

  function mirar(i: number, el: HTMLElement) {
    const c = caixa.current;
    if (!c) return;
    const a = c.getBoundingClientRect(), b = el.getBoundingClientRect();
    setFoco({ i, x: b.left - a.left + b.width / 2, y: b.top - a.top, w: a.width });
  }
  const t = foco ? totais[foco.i] : undefined;

  return (
    <div className="cofre-rec-mapa" ref={caixa} onPointerLeave={() => setFoco(null)}>
      <div className="cofre-rec-mapa-resumo">
        <span><b className="cofre-mono">{formatMoeda(total)}</b> previstos</span>
        <span>{comGasto} {dias ? (comGasto === 1 ? "dia com despesa" : "dias com despesa") : (comGasto === 1 ? "mês com despesa" : "meses com despesa")}</span>
      </div>
      <div className="cofre-rec-heat" data-dias={dias || undefined} role="img" aria-label={`Intensidade de despesas recorrentes. ${resumo}`}>
        {dias && ["D", "S", "T", "Q", "Q", "S", "S"].map((d, i) => <span key={`h${i}`} className="cofre-rec-heat-semana" aria-hidden="true">{d}</span>)}
        {dias && Array.from({ length: folga }, (_, i) => <span key={`v${i}`} aria-hidden="true" />)}
        {totais.map((c, i) => {
          const f = forca(c.saidas);
          return (
            <span key={c.de} className="cofre-rec-heat-cell" tabIndex={0} data-vazio={f === 0 || undefined} data-hoje={(c.de <= hoje && hoje <= c.ate) || undefined} data-ativo={foco?.i === i || undefined}
              aria-label={`${quando(c)}: ${c.saidas > 0 ? `despesas ${formatMoeda(c.saidas)}` : "sem despesas"}`}
              style={{ ["--i" as string]: Math.min(i, 40), ...(f > 0 ? { background: `color-mix(in srgb, var(--cofre-expense) ${Math.round(f * 100)}%, var(--panel-elevated))` } : {}) }}
              onPointerEnter={(e) => mirar(i, e.currentTarget)} onFocus={(e) => mirar(i, e.currentTarget)} onBlur={() => setFoco(null)}>
              <small>{dias ? c.rotulo.replace(/^0/, "") : c.rotulo}</small>
            </span>
          );
        })}
      </div>
      <div className="cofre-rec-mapa-legenda" aria-hidden="true">
        <span>menos</span>
        <i style={{ background: "var(--panel-elevated)" }} />
        {[0.3, 0.55, 0.8, 1].map((f) => <i key={f} style={{ background: `color-mix(in srgb, var(--cofre-expense) ${Math.round((0.2 + 0.8 * f) * 100)}%, var(--panel-elevated))` }} />)}
        <span>mais{maior > 0 && <> · pico <b className="cofre-mono">{formatMoeda(maior)}</b></>}</span>
      </div>
      {t && foco && (
        <Dica x={foco.x} y={foco.y} largura={foco.w}>
          <b>{quando(t)}</b>
          <span><i data-tipo="saida" />Despesas <em className="cofre-mono">{formatMoeda(t.saidas)}</em></span>
          {t.entradas > 0 && <span><i data-tipo="entrada" />Receitas <em className="cofre-mono">{formatMoeda(t.entradas)}</em></span>}
          <small>{ocorrenciasTxt(t.quantidade)}</small>
        </Dica>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------
// Barras por período
// ---------------------------------------------------------------------------------------------------------

/** Receitas e despesas previstas em cada dia (ou mês), com eixo, legenda clicável, marcador de hoje e detalhes ao passar o mouse. */
export function BarrasPorPeriodo({ totais, hoje }: { totais: TotalDoBalde[]; hoje: string }) {
  const caixa = useRef<HTMLDivElement>(null);
  const [foco, setFoco] = useState<{ i: number; x: number; w: number } | null>(null);
  const [ocultas, setOcultas] = useState<{ entrada: boolean; saida: boolean }>({ entrada: false, saida: false });
  const entradas = totais.reduce((s, t) => s + t.entradas, 0);
  const saidas = totais.reduce((s, t) => s + t.saidas, 0);
  const visivel = (t: TotalDoBalde) => [ocultas.entrada ? 0 : t.entradas, ocultas.saida ? 0 : t.saidas];
  const teto = tetoDoEixo(Math.max(0, ...totais.flatMap(visivel)));
  const passo = totais.length > 16 ? 4 : 1;
  const altura = (v: number) => (v > 0 ? `${Math.max(2.5, (v / teto) * 100)}%` : "0%");
  const vazio = entradas === 0 && saidas === 0;

  function mirar(i: number, el: HTMLElement) {
    const c = caixa.current;
    if (!c) return;
    const a = c.getBoundingClientRect(), b = el.getBoundingClientRect();
    setFoco({ i, x: b.left - a.left + b.width / 2, w: a.width });
  }
  const alternar = (s: "entrada" | "saida") => setOcultas((o) => ({ ...o, [s]: !o[s] }));
  const t = foco ? totais[foco.i] : undefined;
  const saldo = entradas - saidas;

  return (
    <div className="cofre-rec-barras" onPointerLeave={() => setFoco(null)}>
      <div className="cofre-rec-barras-legenda" role="group" aria-label="Séries do gráfico">
        <button type="button" aria-pressed={!ocultas.entrada} data-tipo="entrada" onClick={() => alternar("entrada")}><i />Receitas <b className="cofre-mono">{formatMoeda(entradas)}</b></button>
        <button type="button" aria-pressed={!ocultas.saida} data-tipo="saida" onClick={() => alternar("saida")}><i />Despesas <b className="cofre-mono">{formatMoeda(saidas)}</b></button>
        <span data-tom={saldo >= 0 ? "ok" : "neg"}>Saldo <b className="cofre-mono">{saldo < 0 ? "−" : ""}{formatMoeda(Math.abs(saldo))}</b></span>
      </div>
      <div className="cofre-rec-grafico-area" ref={caixa}>
        <div className="cofre-rec-eixo" aria-hidden="true">
          {[1, 0.75, 0.5, 0.25, 0].map((f) => <span key={f} style={{ bottom: `${f * 100}%` }}>{f === 0 ? "0" : compacto(teto * f)}</span>)}
        </div>
        <div className="cofre-rec-plano">
          {[1, 0.75, 0.5, 0.25, 0].map((f) => <i key={f} className="cofre-rec-linha-guia" style={{ bottom: `${f * 100}%` }} aria-hidden="true" />)}
          <div className="cofre-rec-bars" role="img" aria-label={`Por período: receitas ${formatMoeda(entradas)} e despesas ${formatMoeda(saidas)}.`}>
            {totais.map((g, i) => (
              <div key={g.de} className="cofre-rec-bars-grupo" tabIndex={0} data-ativo={foco?.i === i || undefined} data-hoje={(g.de <= hoje && hoje <= g.ate) || undefined}
                aria-label={`${quando(g)}: receitas ${formatMoeda(g.entradas)}, despesas ${formatMoeda(g.saidas)}`}
                style={{ ["--i" as string]: Math.min(i, 40) }}
                onPointerEnter={(e) => mirar(i, e.currentTarget)} onFocus={(e) => mirar(i, e.currentTarget)} onBlur={() => setFoco(null)}>
                <div className="cofre-rec-bars-colunas">
                  <i data-tipo="entrada" style={{ height: altura(ocultas.entrada ? 0 : g.entradas) }} />
                  <i data-tipo="saida" style={{ height: altura(ocultas.saida ? 0 : g.saidas) }} />
                </div>
                <small aria-hidden="true">{i % passo === 0 || (g.de <= hoje && hoje <= g.ate) ? g.rotulo : ""}</small>
              </div>
            ))}
          </div>
          {vazio && <p className="cofre-rec-grafico-vazio">Nada previsto neste período.</p>}
          {t && foco && (
            <Dica x={foco.x - 40} y={4} largura={Math.max(0, (foco.w || 0) - 40)}>
              <b>{quando(t)}</b>
              <span><i data-tipo="entrada" />Receitas <em className="cofre-mono">{formatMoeda(t.entradas)}</em></span>
              <span><i data-tipo="saida" />Despesas <em className="cofre-mono">{formatMoeda(t.saidas)}</em></span>
              <small>{ocorrenciasTxt(t.quantidade)}{t.de <= hoje && hoje <= t.ate ? " · hoje" : ""}</small>
            </Dica>
          )}
        </div>
      </div>
    </div>
  );
}
