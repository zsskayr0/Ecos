import { SeletorEcos } from "@/components/common/SeletorEcos";
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import * as Icons from "lucide-react";
import { ArrowDown, ArrowUp, Check, Download, LayoutGrid, Plus, RefreshCw, Search, Tag, X } from "lucide-react";
import { vault, financeiro, ApiError, type CategoriaApi, type CategoriaUsoApi, type TransacaoApi } from "@/lib/api";
import { formatMoeda } from "@/lib/format";
import { SegmentedSlide } from "@/components/common/SegmentedSlide";
import { DonutChart } from "./nexus/DonutChart";
import { PeriodPicker } from "./nexus/PeriodPicker";
import { RadarChart } from "./nexus/RadarChart";
import { periodNoun, periodRange, toISO, type Period } from "./nexus/period";
import { casaBusca } from "@/lib/texto-busca";
import { avisar } from "@/lib/toast";
import { AlcaOrdem, useOrdemPessoal } from "./ordem-pessoal";
import { SeletorCor } from "./contas/SeletorCor";

const IconPicker = lazy(() => import("./IconPicker"));

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
const COR_SEM_CATEGORIA = "#6b6c72";
const TIPO_ROTULO: Record<CategoriaApi["tipo"], string> = { saida: "Despesa", entrada: "Receita", ambos: "Ambas" };
const EIXOS = ["Total gasto", "Nº lançamentos", "Ticket médio", "Recorrências ativas"];
export const CORES = ["#f29a9f", "#fda4af", "#fdba74", "#fcd34d", "#bef264", "#86d7ad", "#5eead4", "#7dd3fc", "#93c5fd", "#a5b4fc", "#c4b5fd", "#f0abfc", "#f9a8d4", "#d4d4d8", "#a8a29e", "#94a3b8"];

export function resolverIcone(nome?: string | null): Icons.LucideIcon {
  if (!nome) return Icons.Tag;
  const mapa = Icons as unknown as Record<string, Icons.LucideIcon>;
  if (mapa[nome]) return mapa[nome];
  const pascal = nome.split(/[-_ ]/).map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join("");
  return mapa[pascal] ?? Icons.Tag;
}

/** Ícone da categoria sobre a cor dela (o mesmo da tela de Categorias); sem categoria, um ponto de interrogação neutro. */
export function CategoriaIcone({ categoria, tamanho = 16, className = "cofre-cats-icon" }: { categoria?: Pick<CategoriaApi, "icone" | "cor" | "nome"> | null; tamanho?: number; className?: string }) {
  if (!categoria) return <span className={className} style={{ background: COR_SEM_CATEGORIA, color: "#ffffff" }} aria-hidden><Icons.CircleHelp size={tamanho} /></span>;
  const Icone = resolverIcone(categoria.icone);
  return <span className={className} style={{ background: categoria.cor, color: corDoTexto(categoria.cor) }} aria-hidden><Icone size={tamanho} /></span>;
}

/** Texto legível sobre a cor da categoria (preto ou branco, pela luminância). */
export function corDoTexto(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "#0b0b0b";
  const n = parseInt(m[1]!, 16);
  const luz = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return luz > 0.6 ? "#0b0b0b" : "#ffffff";
}

function somarDias(iso: string, dias: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + dias);
  return toISO(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

function periodoAnterior(de: string, ate: string): { de: string; ate: string } {
  const dias = Math.round((new Date(`${ate}T12:00:00`).getTime() - new Date(`${de}T12:00:00`).getTime()) / 86_400_000) + 1;
  const fim = somarDias(de, -1);
  return { de: somarDias(fim, -(dias - 1)), ate: fim };
}

async function listarDespesas(de: string, ate: string): Promise<TransacaoApi[]> {
  const itens: TransacaoApi[] = [];
  let cursor: string | undefined;
  for (let pagina = 0; pagina < 40; pagina++) {
    const r = await vault.transacoes.listar({ tipo: "saida", data_de: de, data_ate: ate, limit: 500, cursor });
    itens.push(...r.items);
    if (!r.next_cursor) break;
    cursor = r.next_cursor;
  }
  return itens;
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

const estiloI = (i: number) => ({ "--i": i }) as CSSProperties;

function csv(campo: string | number): string {
  const s = String(campo);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function VaultCategories({ period, onPeriodChange, categorias, atualizar }: {
  period: Period;
  onPeriodChange: (p: Period) => void;
  categorias: CategoriaApi[];
  atualizar: () => void;
}) {
  const range = periodRange(period);
  const [despesas, setDespesas] = useState<TransacaoApi[] | null>(null);
  const [anteriores, setAnteriores] = useState<TransacaoApi[]>([]);
  const [recorrencias, setRecorrencias] = useState<Recorrencia[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [tentativa, setTentativa] = useState(0);
  const [editando, setEditando] = useState<CategoriaApi | "nova" | null>(null);
  const [busca, setBusca] = useState("");
  const [filtroTipo, setFiltroTipo] = useState<"todas" | CategoriaApi["tipo"]>("todas");
  const [foco, setFoco] = useState<string | null>(null);
  // A ordem das categorias é da pessoa, neste Cofre. O servidor já devolve `categorias` nessa ordem.
  const ordem = useOrdemPessoal(categorias, async (ids) => { await vault.preferencias.salvarOrdem("ordem_categorias", ids); atualizar(); }, () => avisar("Não foi possível guardar a nova ordem das categorias."));

  useEffect(() => {
    let vivo = true;
    setDespesas(null);
    setErro(null);
    const ant = periodoAnterior(range.from, range.to);
    Promise.all([listarDespesas(range.from, range.to), listarDespesas(ant.de, ant.ate), financeiro.recorrencias().catch(() => [] as Recorrencia[])])
      .then(([atual, prev, recs]) => { if (vivo) { setDespesas(atual); setAnteriores(prev); setRecorrencias(recs); } })
      .catch((e) => { if (vivo) setErro(e instanceof ApiError ? e.message : "Não foi possível carregar as categorias."); });
    return () => { vivo = false; };
  }, [range.from, range.to, tentativa]);

  const porId = useMemo(() => new Map(categorias.map((c) => [c.id, c])), [categorias]);

  const stats = useMemo<Stat[]>(() => {
    if (!despesas) return [];
    const totais = new Map<string, { total: number; count: number }>();
    for (const t of despesas) {
      const k = t.categoria_id ?? SEM_CATEGORIA;
      const cur = totais.get(k) ?? { total: 0, count: 0 };
      cur.total += t.valor_centavos;
      cur.count += 1;
      totais.set(k, cur);
    }
    const prev = new Map<string, number>();
    for (const t of anteriores) { const k = t.categoria_id ?? SEM_CATEGORIA; prev.set(k, (prev.get(k) ?? 0) + t.valor_centavos); }
    const recs = new Map<string, number>();
    for (const r of recorrencias) { if (r.ativa && r.tipo === "saida") { const k = r.categoria_id ?? SEM_CATEGORIA; recs.set(k, (recs.get(k) ?? 0) + 1); } }
    const geral = [...totais.values()].reduce((s, v) => s + v.total, 0);
    return [...totais.entries()]
      .map(([id, { total, count }]): Stat => {
        const c = porId.get(id);
        const anterior = prev.get(id) ?? 0;
        return { id, nome: c?.nome ?? "Sem categoria", icone: c?.icone ?? null, cor: c?.cor ?? COR_SEM_CATEGORIA, total, count, ticket: Math.round(total / count), anterior, variacao: anterior > 0 ? ((total - anterior) / anterior) * 100 : null, share: geral > 0 ? (total / geral) * 100 : 0, recorrencias: recs.get(id) ?? 0 };
      })
      .sort((a, b) => b.total - a.total);
  }, [despesas, anteriores, recorrencias, porId]);

  const statPorId = useMemo(() => new Map(stats.map((s) => [s.id, s])), [stats]);
  const top3 = stats.slice(0, 3);
  const totalGeral = stats.reduce((s, c) => s + c.total, 0);
  const totalLancamentos = stats.reduce((s, c) => s + c.count, 0);
  const maxRanking = Math.max(1, ...stats.map((s) => s.total));
  const segmentos = stats.map((s) => ({ label: s.nome, valueCents: s.total, color: s.cor }));

  const visiveis = ordem.ordenados.filter((c) => (filtroTipo === "todas" || c.tipo === filtroTipo) && casaBusca(busca, c.nome));
  const filtrando = busca.trim() !== "" || filtroTipo !== "todas";

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
    a.download = `categorias_${range.from}_a_${range.to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const carregando = despesas === null && !erro;

  return (
    <section className="cofre-cats">
      <div className="cofre-cats-top cofre-rise" style={estiloI(0)}>
        <h1>Categorias</h1>
        <div className="cofre-cats-actions">
          <PeriodPicker value={period} onChange={onPeriodChange} />
          <button type="button" className="cofre-new-button" onClick={() => setEditando("nova")}><Plus size={14} />Nova categoria</button>
        </div>
      </div>

      <div className="cofre-cats-layout">
        <aside className="cofre-cats-list-col cofre-rise" style={estiloI(1)}>
          <div className="cofre-cats-list-head">
            <h3>Todas as categorias</h3>
            <span>{categorias.length} cadastradas</span>
          </div>
          {categorias.length > 0 && (
            <div className="cofre-cats-tools">
              <label className="cofre-cats-search"><Search size={13} /><input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar categoria…" aria-label="Buscar categoria" />{busca && <button type="button" aria-label="Limpar busca" onClick={() => setBusca("")}><X size={12} /></button>}</label>
              <div className="cofre-cats-chips" role="group" aria-label="Filtrar por tipo">
                {(["todas", "saida", "entrada", "ambos"] as const).map((t) => (
                  <button key={t} type="button" aria-pressed={filtroTipo === t} onClick={() => setFiltroTipo(t)}>{t === "todas" ? "Todas" : TIPO_ROTULO[t]}</button>
                ))}
              </div>
            </div>
          )}
          {categorias.length === 0 ? (
            <div className="cofre-card cofre-cats-empty">
              <Tag size={30} />
              <p>Nenhuma categoria cadastrada</p>
              <button type="button" className="cofre-solid" onClick={() => setEditando("nova")}>Nova categoria</button>
            </div>
          ) : (
            <div className="cofre-card cofre-cats-list" data-focando={foco ? "true" : undefined}>
              {visiveis.length === 0 && <p className="cofre-cats-none">Nenhuma categoria encontrada.</p>}
              {visiveis.map((c, i) => {
                const s = statPorId.get(c.id);
                return (
                  <div key={c.id} role="button" tabIndex={0} aria-label={`Editar categoria ${c.nome}`} className="cofre-cats-row" data-ordem-linha data-foco={foco === c.id ? "true" : undefined} style={estiloI(i)} {...ordem.linha(c.id)}
                    onClick={() => setEditando(c)} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); setEditando(c); } }}
                    onMouseEnter={() => setFoco(c.id)} onMouseLeave={() => setFoco(null)} onFocus={() => setFoco(c.id)} onBlur={() => setFoco(null)}>
                    <AlcaOrdem nome={c.nome} desativada={filtrando} {...ordem.alca(c.id)} />
                    <CategoriaIcone categoria={c} />
                    <span className="cofre-cats-row-main">
                      <span className="cofre-cats-row-name"><b>{c.nome}</b>{c.padrao && <em>Padrão</em>}</span>
                      <small>{TIPO_ROTULO[c.tipo]}</small>
                    </span>
                    {s ? (
                      <span className="cofre-cats-row-total"><b className="cofre-mono">{formatMoeda(s.total)}</b><i><u style={{ width: `${Math.max(4, s.share)}%`, background: c.cor }} /></i></span>
                    ) : (
                      <span className="cofre-cats-row-total muted">—</span>
                    )}
                    <Icons.Pencil size={13} className="cofre-cats-edit" aria-hidden />
                  </div>
                );
              })}
            </div>
          )}
        </aside>

        <div className="cofre-cats-main">
          {erro && (
            <div role="alert" className="cofre-card cofre-cats-empty">
              <Icons.CloudOff size={28} />
              <p>{erro}</p>
              <button type="button" className="cofre-solid" onClick={() => setTentativa((n) => n + 1)}><RefreshCw size={14} />Tentar novamente</button>
            </div>
          )}
          {carregando && (
            <div className="cofre-cats-skeleton" role="status" aria-label="Carregando análise">
              {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} style={estiloI(i)} />)}
            </div>
          )}
          {!carregando && !erro && stats.length === 0 && (
            <div className="cofre-card cofre-cats-empty cofre-rise">
              <LayoutGrid size={28} />
              <p>Nada para analisar {periodNoun(period)}</p>
              <small>Lance algumas despesas com categoria neste período para ver o comparativo.</small>
            </div>
          )}
          {!carregando && !erro && stats.length > 0 && lider && (
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
                    <RadarChart
                      axes={EIXOS}
                      series={top3.map((s) => ({ label: s.nome, color: s.cor, values: [s.total / 100, s.count, s.ticket / 100, s.recorrencias] }))}
                    />
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
        </div>
      </div>

      {editando && createPortal(
        <CategoriaModal
          categoria={editando === "nova" ? undefined : editando}
          categorias={categorias}
          onClose={() => setEditando(null)}
          onSaved={() => { setEditando(null); atualizar(); setTentativa((n) => n + 1); }}
        />,
        document.querySelector(".cofre-app") ?? document.body,
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

/** Lixeira com a tampa separada do corpo: no hover a tampa levanta e abre (CSS em `.cofre-lixeira-tampa`). */
export function LixeiraAnimada() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <g className="cofre-lixeira-tampa"><path d="M3 6h18" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" /></g>
      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
      <line x1="10" x2="10" y1="11" y2="17" />
      <line x1="14" x2="14" y1="11" y2="17" />
    </svg>
  );
}

export function CategoriaModal({ categoria, categorias, onClose, onSaved }: { categoria?: CategoriaApi; categorias: CategoriaApi[]; onClose: () => void; onSaved: () => void }) {
  const [nome, setNome] = useState(categoria?.nome ?? "");
  const [tipo, setTipo] = useState<CategoriaApi["tipo"]>(categoria?.tipo ?? "saida");
  const [icone, setIcone] = useState(categoria?.icone ?? "Tag");
  const [cor, setCor] = useState(categoria?.cor ?? CORES[0]!);
  const [ocupado, setOcupado] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  /** Preenchido quando a categoria tem itens: abre o menu de "para onde mover". */
  const [uso, setUso] = useState<CategoriaUsoApi | null>(null);
  const [destino, setDestino] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [saindo, setSaindo] = useState(false);
  const nomeRef = useRef<HTMLInputElement>(null);
  const Previa = resolverIcone(icone);

  useEffect(() => {
    nomeRef.current?.focus();
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape") fechar(); };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function fechar() {
    setSaindo(true);
    window.setTimeout(onClose, 160);
  }

  async function salvar() {
    if (!nome.trim()) { setErro("Informe um nome para a categoria."); return; }
    setOcupado(true);
    setErro(null);
    try {
      if (categoria) await vault.categorias.atualizar(categoria.id, { nome: nome.trim(), tipo, icone, cor });
      else await vault.categorias.criar({ nome: nome.trim(), tipo, icone, cor });
      onSaved();
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível salvar.");
      setOcupado(false);
    }
  }

  /** Só oferece destino do mesmo tipo dos itens (despesa não vai para categoria de receita). */
  function compativel(c: CategoriaApi, u: CategoriaUsoApi) {
    return c.id !== categoria?.id && (c.tipo === "ambos" || u.tipos.every((t) => t === c.tipo));
  }

  /** Primeiro olha o que usa a categoria: sem uso, pede só a confirmação; com uso, abre o menu de destino. */
  async function pedirExclusao() {
    if (!categoria) return;
    setOcupado(true);
    setErro(null);
    try {
      const u = await vault.categorias.uso(categoria.id);
      if (u.transacoes + u.recorrencias + u.pendencias === 0) {
        setConfirmando(true);
      } else {
        setDestino(""); // "Sem categoria" é o padrão; mover para outra é escolha da pessoa
        setUso(u);
      }
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível verificar o uso da categoria.");
    } finally {
      setOcupado(false);
    }
  }

  async function excluir(decisao?: { mover_para: string } | { sem_categoria: true }) {
    if (!categoria) return;
    setOcupado(true);
    try {
      await vault.categorias.excluir(categoria.id, decisao);
      onSaved();
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível apagar.");
      setOcupado(false);
    }
  }

  return (
    <div className="cofre-cats-modal" data-saindo={saindo || undefined}>
      <div className="cofre-cats-backdrop" onClick={fechar} />
      <form className="cofre-card cofre-cats-dialog cofre-categoria-dialog" role="dialog" aria-modal="true" aria-label={categoria ? "Editar categoria" : "Nova categoria"} onSubmit={(e) => { e.preventDefault(); void salvar(); }}>
        <header>
          <span className="cofre-cats-icon lg" style={{ background: cor, color: corDoTexto(cor) }}><Previa size={18} /></span>
          <div><p>{categoria ? "EDITAR CATEGORIA" : "NOVA CATEGORIA"}</p><h2>{nome.trim() || "Sem nome"}</h2></div>
          <span className="cofre-cats-header-acoes">
            {categoria && (
              <button
                type="button"
                className="cofre-cats-iconbtn cofre-cats-lixeira"
                aria-label="Apagar categoria"
                title="Apagar categoria"
                disabled={ocupado || confirmando || !!uso}
                onClick={() => void pedirExclusao()}
              >
                <LixeiraAnimada />
              </button>
            )}
            <button type="button" className="cofre-cats-iconbtn cofre-cats-fechar" aria-label="Fechar" onClick={fechar}><X size={18} /></button>
          </span>
        </header>

        {erro && <p className="cofre-launch-alert" role="alert">{erro}</p>}

        <div className="cofre-contas-corpo cofre-categoria-corpo">
          <div className="cofre-contas-esq">
        <div className="cofre-cats-field">
          <span>Ícone</span>
          <Suspense fallback={<p className="cofre-cats-none">Carregando ícones…</p>}><IconPicker value={icone} onChange={setIcone} cor={cor} /></Suspense>
        </div>

          </div>
          <div className="cofre-contas-dir">
        <label className="cofre-cats-field"><span>Nome</span><input ref={nomeRef} value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Mercado" maxLength={40} /></label>

        <div className="cofre-cats-field">
          <span>Tipo</span>
          <SegmentedSlide className="cofre-launch-slide" ariaLabel="Tipo da categoria" tamanho="lg" value={tipo} onChange={setTipo} opcoes={[{ value: "saida", label: "Despesa", cor: "ecos-error" }, { value: "entrada", label: "Receita", cor: "ecos-success" }, { value: "ambos", label: "Ambas", cor: "cofre-blue" }]} />
        </div>

        <div className="cofre-cats-field">
          <span>Cor</span>
          <SeletorCor valor={cor} onChange={setCor} />
        </div>
          </div>
        </div>

        {confirmando && categoria && (
          <div className="cofre-launch-alert" role="alert">
            <p>Apagar “{categoria.nome}”? Nenhum lançamento usa esta categoria. Essa ação não pode ser desfeita.</p>
            <div><button type="button" onClick={() => setConfirmando(false)}>Cancelar</button><button type="button" disabled={ocupado} onClick={() => void excluir()}>{ocupado ? "Apagando…" : "Apagar"}</button></div>
          </div>
        )}

        {uso && categoria && (
          <section className="cofre-launch-alert cofre-cats-uso" role="alert" aria-label={`Apagar ${categoria.nome}`}>
            <p>
              “{categoria.nome}” é usada por <b>{uso.transacoes} {uso.transacoes === 1 ? "lançamento" : "lançamentos"}</b>
              {uso.recorrencias > 0 && <>, <b>{uso.recorrencias} {uso.recorrencias === 1 ? "recorrência" : "recorrências"}</b></>}
              {uso.pendencias > 0 && <>, <b>{uso.pendencias} {uso.pendencias === 1 ? "pendência" : "pendências"}</b></>}.
              Escolha para onde eles vão antes de apagar.
            </p>
            {uso.amostra.length > 0 && (
              <ul className="cofre-cats-uso-lista" aria-label="Lançamentos desta categoria">
                {uso.amostra.map((t) => (
                  <li key={t.id}>
                    <time>{t.data.split("-").reverse().join("/")}</time>
                    <span>{t.descricao}</span>
                    <strong data-tipo={t.tipo}>{t.tipo === "entrada" ? "+" : "−"}{formatMoeda(t.valor_centavos)}</strong>
                  </li>
                ))}
                {uso.transacoes > uso.amostra.length && <li className="cofre-cats-uso-mais">e mais {uso.transacoes - uso.amostra.length} {uso.transacoes - uso.amostra.length === 1 ? "lançamento" : "lançamentos"}</li>}
              </ul>
            )}
            <div className="cofre-cats-field">
              <span>Mover tudo para</span>
              <SeletorEcos ariaLabel="Mover tudo para" classe="min-h-[40px] max-w-full rounded-[11px] border border-[var(--border)] bg-[var(--panel)] px-2.5 text-[13px] text-[var(--text)]" valor={destino} onChange={setDestino} opcoes={[{ valor: "", rotulo: "Sem categoria" }, ...categorias.filter((c) => compativel(c, uso)).map((c) => ({ valor: c.id, rotulo: c.nome }))]} />
            </div>
            <div>
              <button type="button" onClick={() => setUso(null)} disabled={ocupado}>Cancelar</button>
              <button type="button" disabled={ocupado} onClick={() => void excluir(destino ? { mover_para: destino } : { sem_categoria: true })}>
                {ocupado ? "Movendo e apagando…" : destino ? "Mover e apagar" : "Deixar sem categoria e apagar"}
              </button>
            </div>
          </section>
        )}

        <footer>
          <button type="button" className="cofre-secondary" onClick={fechar}>Cancelar</button>
          <button type="submit" className="cofre-solid" disabled={ocupado || !nome.trim()}>{ocupado && !confirmando ? "Salvando…" : categoria ? "Salvar" : "Criar categoria"}</button>
        </footer>
      </form>
    </div>
  );
}
