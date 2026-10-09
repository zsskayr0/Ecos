import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { ArrowDown, ArrowUp, Download } from "lucide-react";
import type { CategoriaApi, TransacaoApi, financeiro } from "@/lib/api";
import { formatMoeda } from "@/lib/format";
import { idDaMae, montarHierarquia } from "@/lib/categorias-hierarquia";
import { SegmentedSlide } from "@/components/common/SegmentedSlide";
import { DonutChart } from "../nexus/DonutChart";
import { RadarChart } from "../nexus/RadarChart";
import { periodNoun, type Period } from "../nexus/period";
import { COR_SEM_CATEGORIA, corDoTexto, resolverIcone } from "./icone";

type Recorrencia = Awaited<ReturnType<typeof financeiro.recorrencias>>[number];

interface Stat {
  id: string;
  nome: string;
  icone: string | null;
  cor: string;
  total: number;
  count: number;
  ticket: number;
  anterior: number;
  variacao: number | null;
  share: number;
  recorrencias: number;
}

const SEM_CATEGORIA = "__sem__";
const EIXOS = ["Total gasto", "Nº lançamentos", "Ticket médio", "Recorrências ativas"];
const estiloI = (i: number) => ({ "--i": i }) as CSSProperties;

function csv(campo: string | number): string {
  const s = String(campo);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function useContagem(alvo: number, ms = 850): number {
  const [valor, setValor] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setValor(alvo); return; }
    let raf = 0;
    const inicio = performance.now();
    const passo = (t: number) => {
      const p = Math.min(1, (t - inicio) / ms);
      setValor(alvo * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(passo);
    };
    raf = requestAnimationFrame(passo);
    return () => cancelAnimationFrame(raf);
  }, [alvo, ms]);
  return valor;
}

/**
 * Análise de despesas do período (os gráficos que ficam abaixo da navegação). Com `agrupar`, as subcategorias entram
 * na conta da categoria-mãe; sem ele, cada subcategoria é uma categoria à parte.
 */
export function AnaliseCategorias({ despesas, anteriores, recorrencias, categorias, period, intervalo, agrupar, aoAgrupar }: {
  despesas: TransacaoApi[];
  anteriores: TransacaoApi[];
  recorrencias: Recorrencia[];
  categorias: CategoriaApi[];
  period: Period;
  intervalo: { from: string; to: string };
  agrupar: boolean;
  aoAgrupar: (v: boolean) => void;
}) {
  const [foco, setFoco] = useState<string | null>(null);
  const { porId } = useMemo(() => montarHierarquia(categorias), [categorias]);

  const stats = useMemo<Stat[]>(() => {
    const chave = (id: string | null | undefined) => (id ? (agrupar ? idDaMae(id, porId) : id) : SEM_CATEGORIA);
    const totais = new Map<string, { total: number; count: number }>();
    for (const t of despesas) {
      const k = chave(t.categoria_id);
      const cur = totais.get(k) ?? { total: 0, count: 0 };
      cur.total += t.valor_centavos;
      cur.count += 1;
      totais.set(k, cur);
    }
    const prev = new Map<string, number>();
    for (const t of anteriores) { const k = chave(t.categoria_id); prev.set(k, (prev.get(k) ?? 0) + t.valor_centavos); }
    const recs = new Map<string, number>();
    for (const r of recorrencias) { if (r.ativa && r.tipo === "saida") { const k = chave(r.categoria_id); recs.set(k, (recs.get(k) ?? 0) + 1); } }
    const geral = [...totais.values()].reduce((s, v) => s + v.total, 0);
    return [...totais.entries()]
      .map(([id, { total, count }]): Stat => {
        const c = porId.get(id);
        const anterior = prev.get(id) ?? 0;
        return { id, nome: c?.nome ?? "Sem categoria", icone: c?.icone ?? null, cor: c?.cor ?? COR_SEM_CATEGORIA, total, count, ticket: Math.round(total / count), anterior, variacao: anterior > 0 ? ((total - anterior) / anterior) * 100 : null, share: geral > 0 ? (total / geral) * 100 : 0, recorrencias: recs.get(id) ?? 0 };
      })
      .sort((a, b) => b.total - a.total);
  }, [despesas, anteriores, recorrencias, porId, agrupar]);

  const temSubs = categorias.some((c) => c.pai_id);
  const top3 = stats.slice(0, 3);
  const totalGeral = stats.reduce((s, c) => s + c.total, 0);
  const totalLancamentos = stats.reduce((s, c) => s + c.count, 0);
  const maxRanking = Math.max(1, ...stats.map((s) => s.total));
  const segmentos = stats.map((s) => ({ label: s.nome, valueCents: s.total, color: s.cor }));
  const lider = top3[0];
  const insight = lider
    ? lider.variacao !== null && Math.abs(lider.variacao) >= 1
      ? `${lider.nome} consumiu ${lider.share.toFixed(0)}% do total gasto no período — ${Math.abs(lider.variacao).toFixed(0)}% ${lider.variacao > 0 ? "a mais" : "a menos"} que no período anterior.`
      : `${lider.nome} foi a categoria com maior gasto no período, consumindo ${lider.share.toFixed(0)}% do total.`
    : null;

  function exportar() {
    const linhas = [["Categoria", "Total (R$)", "Lançamentos", "Ticket médio (R$)", "Variação vs período anterior (%)", "Recorrências ativas"].join(","),
      ...stats.map((s) => [csv(s.nome), (s.total / 100).toFixed(2), s.count, (s.ticket / 100).toFixed(2), s.variacao === null ? "" : s.variacao.toFixed(1), s.recorrencias].map(csv).join(","))];
    const url = URL.createObjectURL(new Blob(["﻿" + linhas.join("\n")], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `categorias_${intervalo.from}_a_${intervalo.to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="cofre-cats-analise" aria-labelledby="cofre-cats-analise-titulo">
      <div className="cofre-cats-analise-topo">
        <div>
          <h2 id="cofre-cats-analise-titulo">Análise de gastos</h2>
          <p>Despesas {periodNoun(period)} por categoria.</p>
        </div>
        {temSubs && (
          <SegmentedSlide className="cofre-launch-slide" ariaLabel="Subcategorias nos gráficos" value={agrupar ? "agrupadas" : "separadas"} onChange={(x) => aoAgrupar(x === "agrupadas")}
            opcoes={[{ value: "separadas", label: "Subcategorias separadas", cor: "cofre-blue" }, { value: "agrupadas", label: "Em bloco na categoria-mãe", cor: "cofre-blue" }]} />
        )}
      </div>

      {stats.length === 0 || !lider ? (
        <div className="cofre-card cofre-cats-empty cofre-rise">
          <p>Nada para analisar {periodNoun(period)}</p>
          <small>Lance algumas despesas com categoria neste período para ver o comparativo.</small>
        </div>
      ) : (
        <>
          <div className="cofre-cats-grid">
            <div className="cofre-cats-left">
              <div className="cofre-cats-trio">
                {top3.map((s, i) => <TopCard key={s.id} s={s} pos={i} i={i + 2} />)}
              </div>
              <div className="cofre-cats-trio">
                {top3.map((s, i) => (
                  <div key={s.id} className="cofre-card cofre-cats-card cofre-rise" style={estiloI(i + 5)}>
                    <Spec rotulo="Total gasto" valor={formatMoeda(s.total)} />
                    <Spec rotulo="Lançamentos" valor={String(s.count)} />
                    <Spec rotulo="Ticket médio" valor={formatMoeda(s.ticket)} />
                    <Spec rotulo="Recorrências ativas" valor={String(s.recorrencias)} />
                  </div>
                ))}
              </div>
              <div className="cofre-cats-duo">
                <div className="cofre-card cofre-cats-card cofre-rise" style={estiloI(8)}>
                  <h4>Participação de todas as categorias</h4>
                  <DonutChart segments={segmentos} />
                </div>
                <div className="cofre-card cofre-cats-card cofre-rise" style={estiloI(9)}>
                  <h4>Ranking completo</h4>
                  <div className="cofre-cats-ranking" data-focando={foco ? "true" : undefined}>
                    {stats.map((s, i) => {
                      const Icone = resolverIcone(s.icone);
                      return (
                        <div key={s.id} data-foco={foco === s.id ? "true" : undefined} onMouseEnter={() => setFoco(s.id)} onMouseLeave={() => setFoco(null)}>
                          <span className="cofre-cats-icon sm" style={{ background: s.cor, color: corDoTexto(s.cor) }}><Icone size={12} /></span>
                          <span className="cofre-cats-rank-name" title={s.nome}>{s.nome}</span>
                          <i className="cofre-cats-bar"><u className="cofre-grow" style={{ ...estiloI(i), width: `${Math.max(3, (s.total / maxRanking) * 100)}%`, background: s.cor }} /></i>
                          <b className="cofre-mono">{formatMoeda(s.total)}</b>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
              <div className="cofre-card cofre-cats-card cofre-rise" style={estiloI(10)}>
                <h4>Comparativo por métrica</h4>
                <div className="cofre-cats-metrics">
                  <Metrica rotulo="Total gasto" stats={top3} valor={(s) => s.total} formato={formatMoeda} />
                  <Metrica rotulo="Nº lançamentos" stats={top3} valor={(s) => s.count} formato={String} />
                  <Metrica rotulo="Ticket médio" stats={top3} valor={(s) => s.ticket} formato={formatMoeda} />
                  <Metrica rotulo="Recorrências ativas" stats={top3} valor={(s) => s.recorrencias} formato={String} />
                  <div className="cofre-cats-metric" style={{ gridTemplateColumns: `110px repeat(${top3.length}, minmax(0,1fr))` }}>
                    <span>Variação</span>
                    {top3.map((s) => <Variacao key={s.id} v={s.variacao} />)}
                  </div>
                </div>
              </div>
            </div>

            <div className="cofre-cats-right">
              <Destaque s={lider} periodo={periodNoun(period)} total={totalGeral} />
              <div className="cofre-card cofre-cats-card cofre-cats-radar cofre-rise" style={estiloI(4)}>
                <h4>Comparativo visual</h4>
                <RadarChart axes={EIXOS} series={top3.map((s) => ({ label: s.nome, color: s.cor, values: [s.total / 100, s.count, s.ticket / 100, s.recorrencias] }))} />
              </div>
            </div>
          </div>

          {insight && (
            <div className="cofre-card cofre-cats-insight cofre-rise" style={estiloI(11)}>
              <span><ArrowUp size={14} /></span>
              <p>{insight}</p>
            </div>
          )}

          <div className="cofre-cats-footer cofre-rise" style={estiloI(12)}>
            <span>{stats.length} categoria{stats.length > 1 ? "s" : ""} com gasto · {totalLancamentos} lançamento{totalLancamentos > 1 ? "s" : ""} considerado{totalLancamentos > 1 ? "s" : ""}</span>
            <button type="button" className="cofre-secondary" onClick={exportar}><Download size={13} />Exportar CSV</button>
          </div>
        </>
      )}
    </section>
  );
}

function TopCard({ s, pos, i }: { s: Stat; pos: number; i: number }) {
  const pct = useContagem(s.share);
  return (
    <div className="cofre-card cofre-cats-card cofre-cats-top3 cofre-rise" style={estiloI(i)}>
      <div className="cofre-cats-top3-head"><b>{s.nome}</b><span>#{pos + 1}</span></div>
      <i className="cofre-cats-bar"><u className="cofre-grow" style={{ ...estiloI(i), width: `${Math.max(4, s.share)}%`, background: s.cor }} /></i>
      <div className="cofre-cats-top3-foot"><strong className="cofre-mono">{pct.toFixed(0)}%</strong><small>do total</small></div>
    </div>
  );
}

function Spec({ rotulo, valor }: { rotulo: string; valor: string }) {
  return <div className="cofre-cats-spec"><span>{rotulo}</span><b className="cofre-mono">{valor}</b></div>;
}

function Metrica({ rotulo, stats, valor, formato }: { rotulo: string; stats: Stat[]; valor: (s: Stat) => number; formato: (v: number) => string }) {
  const max = Math.max(1, ...stats.map(valor));
  return (
    <div className="cofre-cats-metric" style={{ gridTemplateColumns: `110px repeat(${stats.length}, minmax(0,1fr))` }}>
      <span>{rotulo}</span>
      {stats.map((s, i) => {
        const v = valor(s);
        return (
          <div key={s.id}>
            <i className="cofre-cats-bar"><u className="cofre-grow" style={{ ...estiloI(i), width: `${Math.max(4, (v / max) * 100)}%`, background: s.cor }} /></i>
            <b className="cofre-mono">{formato(v)}</b>
          </div>
        );
      })}
    </div>
  );
}

function Variacao({ v }: { v: number | null }) {
  if (v === null) return <span className="cofre-cats-var">—</span>;
  const sobe = v > 0;
  const Seta = sobe ? ArrowUp : ArrowDown;
  return <span className="cofre-cats-var cofre-mono" data-sobe={sobe}><Seta size={10} strokeWidth={2.6} />{Math.abs(v).toFixed(0)}%</span>;
}

function Destaque({ s, periodo, total }: { s: Stat; periodo: string; total: number }) {
  const Icone = resolverIcone(s.icone);
  const nota = useContagem(s.share);
  return (
    <div className="cofre-card cofre-cats-card cofre-cats-highlight cofre-rise" style={{ ...estiloI(1), ["--destaque" as string]: s.cor }}>
      <div className="cofre-cats-highlight-head"><span>{periodo}</span><span className="cofre-mono">{formatMoeda(total)}</span></div>
      <div className="cofre-cats-highlight-body">
        <span className="cofre-cats-icon lg" style={{ background: s.cor, color: corDoTexto(s.cor) }}><Icone size={18} /></span>
        <span className="cofre-cats-highlight-name"><small>Destaque</small><b>{s.nome}</b></span>
        <span className="cofre-cats-highlight-score"><b className="cofre-mono">{nota.toFixed(0)}</b><small>/100</small></span>
      </div>
    </div>
  );
}
