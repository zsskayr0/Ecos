import { createPortal } from "react-dom";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { ArrowDown, ArrowUp, Download, Landmark, Pencil, Plus, RefreshCw, Search, CloudOff, Wallet, X } from "lucide-react";
import { vault, financeiro, ApiError, type CategoriaApi, type ContaApi, type TipoConta, type TransacaoApi } from "@/lib/api";
import { formatMoeda } from "@/lib/format";
import { DonutChart } from "./nexus/DonutChart";
import { HorizontalBarChart } from "./nexus/HorizontalBarChart";
import { ComposedAreaChart } from "./nexus/ComposedAreaChart";
import { PeriodPicker } from "./nexus/PeriodPicker";
import { RadarChart } from "./nexus/RadarChart";
import { periodNoun, periodRange, toISO, type Period } from "./nexus/period";
import { ContaModal, SeloConta } from "./contas/ContaModal";
import { ROTULO_TIPO, bancoPorCodigo } from "./contas/bancos";
import { resumir, serieSaldo, somarSaidasPor, variacao, type Resumo, type Tx } from "./contas/analise";
import { SaldoChart } from "./contas/SaldoChart";
import { corDoTexto } from "./VaultCategories";

type Recorrencia = Awaited<ReturnType<typeof financeiro.recorrencias>>[number];

const TODAS = "__todas__";
const SEM_CONTA = "__sem__";
const COR_SEM_CATEGORIA = "#6b6c72";
const COR_ENTRADA = "var(--cofre-income)";
const COR_SAIDA = "var(--cofre-expense)";
const FORMAS: Record<string, string> = { pix: "Pix", pix_automatico: "Pix Automático", ted: "TED", cartao: "Cartão", dinheiro: "Dinheiro", boleto: "Boleto", outro: "Outro" };
const EIXOS = ["Entradas", "Saídas", "Lançamentos", "Ticket médio"];

const estiloI = (i: number) => ({ "--i": i }) as CSSProperties;

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

/** Tudo do período anterior em diante: serve às métricas, à comparação e ao cálculo do saldo no início do período. */
async function listarDesde(de: string): Promise<TransacaoApi[]> {
  const itens: TransacaoApi[] = [];
  let cursor: string | undefined;
  for (let pagina = 0; pagina < 60; pagina++) {
    const r = await vault.transacoes.listar({ data_de: de, limit: 500, cursor });
    itens.push(...r.items);
    if (!r.next_cursor) break;
    cursor = r.next_cursor;
  }
  return itens;
}

function useContagem(alvo: number, ms = 850): number {
  const [valor, setValor] = useState(0);
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) { setValor(alvo); return; }
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

function csv(campo: string | number): string {
  const s = String(campo);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

interface Linha {
  id: string;
  conta: ContaApi | null;
  nome: string;
  cor: string;
  tipo?: TipoConta;
  saldo: number;
  atual: Resumo;
  anterior: Resumo;
  recorrencias: number;
}

function descricaoConta(c: ContaApi): string {
  const banco = c.banco || bancoPorCodigo(c.codigo_banco)?.curto;
  const dados = [c.agencia && `ag. ${c.agencia}`, c.numero_conta && `cc ${c.numero_conta}`].filter(Boolean).join(" · ");
  return [banco, dados || ROTULO_TIPO[c.tipo]].filter(Boolean).join(" · ") || ROTULO_TIPO[c.tipo];
}

export function VaultAccounts({ period, onPeriodChange, categorias, atualizar }: {
  period: Period;
  onPeriodChange: (p: Period) => void;
  categorias: CategoriaApi[];
  atualizar: () => void;
}) {
  const range = periodRange(period);
  const [contas, setContas] = useState<ContaApi[] | null>(null);
  const [saldos, setSaldos] = useState<Map<string, number>>(new Map());
  const [txs, setTxs] = useState<TransacaoApi[]>([]);
  const [recorrencias, setRecorrencias] = useState<Recorrencia[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [tentativa, setTentativa] = useState(0);
  const [editando, setEditando] = useState<ContaApi | "nova" | null>(null);
  const [busca, setBusca] = useState("");
  const [filtroTipo, setFiltroTipo] = useState<"todas" | TipoConta>("todas");
  const [sel, setSel] = useState<string>(TODAS);
  const [foco, setFoco] = useState<string | null>(null);

  const ant = useMemo(() => periodoAnterior(range.from, range.to), [range.from, range.to]);

  useEffect(() => {
    let vivo = true;
    setErro(null);
    Promise.all([vault.contas.listar(), vault.config(), listarDesde(ant.de), financeiro.recorrencias().catch(() => [] as Recorrencia[])])
      .then(([cts, cfg, ts, recs]) => {
        if (!vivo) return;
        setContas(cts);
        setSaldos(new Map(cfg.saldos_por_conta.map((s) => [s.conta_id, s.saldo_centavos])));
        setTxs(ts);
        setRecorrencias(recs);
      })
      .catch((e) => { if (vivo) setErro(e instanceof ApiError ? e.message : "Não foi possível carregar as contas."); });
    return () => { vivo = false; };
  }, [ant.de, tentativa]);

  const porId = useMemo(() => new Map((categorias ?? []).map((c) => [c.id, c])), [categorias]);

  const linhas = useMemo<Linha[]>(() => {
    if (!contas) return [];
    const doConta = (id: string | null) => txs.filter((t) => (t.conta_id ?? null) === id);
    const recs = new Map<string | null, number>();
    for (const r of recorrencias) if (r.ativa) recs.set(r.conta_id ?? null, (recs.get(r.conta_id ?? null) ?? 0) + 1);
    const montar = (id: string, conta: ContaApi | null, nome: string, cor: string, saldo: number, lista: Tx[]): Linha => ({
      id, conta, nome, cor, tipo: conta?.tipo, saldo, recorrencias: recs.get(conta?.id ?? null) ?? 0,
      atual: resumir(lista, range.from, range.to), anterior: resumir(lista, ant.de, ant.ate),
    });
    const lista = contas.map((c) => montar(c.id, c, c.nome, c.cor, saldos.get(c.id) ?? c.saldo_inicial_centavos, doConta(c.id)));
    const semConta = doConta(null);
    if (semConta.length > 0) {
      const saldoSem = semConta.filter((t) => t.status !== "pendente").reduce((s, t) => s + (t.tipo === "entrada" ? t.valor_centavos : -t.valor_centavos), 0);
      lista.push(montar(SEM_CONTA, null, "Sem conta", COR_SEM_CATEGORIA, saldoSem, semConta));
    }
    return lista;
  }, [contas, txs, saldos, recorrencias, range.from, range.to, ant.de, ant.ate]);

  const total = useMemo(() => {
    const soma = (f: (r: Resumo) => number, k: "atual" | "anterior") => linhas.reduce((s, l) => s + f(l[k]), 0);
    return {
      saldo: linhas.reduce((s, l) => s + l.saldo, 0),
      entradas: soma((r) => r.entradas, "atual"), saidas: soma((r) => r.saidas, "atual"),
      entradasAnt: soma((r) => r.entradas, "anterior"), saidasAnt: soma((r) => r.saidas, "anterior"),
    };
  }, [linhas]);

  // Se a conta selecionada sumiu (apagada), volta para a visão geral.
  useEffect(() => { if (sel !== TODAS && contas && !linhas.some((l) => l.id === sel)) setSel(TODAS); }, [sel, contas, linhas]);

  const atual = sel === TODAS ? null : linhas.find((l) => l.id === sel) ?? null;
  const escopo = useMemo<Tx[]>(() => (atual ? txs.filter((t) => (t.conta_id ?? SEM_CONTA) === atual.id) : txs), [atual, txs]);
  const saldoEscopo = atual ? atual.saldo : total.saldo;
  const resumo = atual ? atual.atual : resumir(escopo, range.from, range.to);
  const resumoAnt = atual ? atual.anterior : resumir(escopo, ant.de, ant.ate);
  const pontos = useMemo(() => serieSaldo(escopo, saldoEscopo, range.from, range.to), [escopo, saldoEscopo, range.from, range.to]);
  const porCategoria = useMemo(() => somarSaidasPor(escopo, range.from, range.to, (t) => t.categoria_id), [escopo, range.from, range.to]);
  const porForma = useMemo(() => somarSaidasPor(escopo, range.from, range.to, (t) => t.forma_pagamento), [escopo, range.from, range.to]);
  const segmentosCat = porCategoria.map((g) => ({ label: porId.get(g.chave ?? "")?.nome ?? "Sem categoria", valueCents: g.valor, color: porId.get(g.chave ?? "")?.cor ?? COR_SEM_CATEGORIA }));

  const ranking = useMemo(() => [...linhas].sort((a, b) => b.saldo - a.saldo), [linhas]);
  const top3 = useMemo(() => {
    const ordem = [...linhas].sort((a, b) => (b.atual.entradas + b.atual.saidas) - (a.atual.entradas + a.atual.saidas));
    const base = ordem.slice(0, 3);
    return atual && !base.some((l) => l.id === atual.id) ? [atual, ...base.slice(0, 2)] : base;
  }, [linhas, atual]);
  const saldoPositivoTotal = linhas.reduce((s, l) => s + Math.max(0, l.saldo), 0);
  const segmentosSaldo = linhas.filter((l) => l.saldo > 0).sort((a, b) => b.saldo - a.saldo).map((l) => ({ label: l.nome, valueCents: l.saldo, color: l.cor }));

  const visiveis = (contas ?? []).filter((c) => (filtroTipo === "todas" || c.tipo === filtroTipo) && `${c.nome} ${c.banco ?? ""} ${c.codigo_banco ?? ""}`.toLowerCase().includes(busca.trim().toLowerCase()));
  const tiposPresentes = [...new Set((contas ?? []).map((c) => c.tipo))];
  const carregando = contas === null && !erro;
  const semDados = !carregando && !erro && (contas?.length ?? 0) === 0;

  const varEntradas = variacao(resumo.entradas, resumoAnt.entradas);
  const varSaidas = variacao(resumo.saidas, resumoAnt.saidas);
  const insight = (() => {
    if (resumo.lancamentos === 0) return null;
    const quando = period.kind === "month" ? "neste mês" : period.kind === "year" ? "neste ano" : "no período";
    const quem = atual ? `${atual.nome} fechou` : "Suas contas fecharam";
    const base = `${quem} ${quando} ${resumo.resultado >= 0 ? "no azul: sobraram" : "no vermelho: saíram a mais"} ${formatMoeda(Math.abs(resumo.resultado))}`;
    return resumo.taxaEconomia !== null && resumo.resultado > 0 ? `${base}, ${resumo.taxaEconomia.toFixed(0)}% do que entrou.` : `${base}.`;
  })();

  function exportar() {
    const cab = ["Conta", "Tipo", "Banco", "Saldo atual (R$)", "Entradas (R$)", "Saídas (R$)", "Resultado (R$)", "Lançamentos", "Ticket médio saída (R$)"].join(",");
    const reais = (c: number) => (c / 100).toFixed(2);
    const corpo = linhas.map((l) => [l.nome, l.tipo ? ROTULO_TIPO[l.tipo] : "", l.conta?.banco ?? "", reais(l.saldo), reais(l.atual.entradas), reais(l.atual.saidas), reais(l.atual.resultado), l.atual.lancamentos, reais(l.atual.ticketSaida)].map(csv).join(","));
    const url = URL.createObjectURL(new Blob(["﻿" + [cab, ...corpo].join("\n")], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `contas_${range.from}_a_${range.to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="cofre-cats cofre-contas">
      <div className="cofre-cats-top cofre-rise" style={estiloI(0)}>
        <h1>Contas</h1>
        <div className="cofre-cats-actions">
          <PeriodPicker value={period} onChange={onPeriodChange} />
          <button type="button" className="cofre-new-button" onClick={() => setEditando("nova")}><Plus size={14} />Nova conta</button>
        </div>
      </div>

      <div className="cofre-cats-layout">
        <aside className="cofre-cats-list-col cofre-rise" style={estiloI(1)}>
          <div className="cofre-cats-list-head">
            <h3>Todas as contas</h3>
            <span>{contas?.length ?? 0} cadastradas</span>
          </div>
          {(contas?.length ?? 0) > 0 && (
            <div className="cofre-cats-tools">
              <label className="cofre-cats-search"><Search size={13} /><input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar conta ou banco…" aria-label="Buscar conta" />{busca && <button type="button" aria-label="Limpar busca" onClick={() => setBusca("")}><X size={12} /></button>}</label>
              {tiposPresentes.length > 1 && (
                <div className="cofre-cats-chips" role="group" aria-label="Filtrar por tipo">
                  {(["todas", ...tiposPresentes] as const).map((t) => (
                    <button key={t} type="button" aria-pressed={filtroTipo === t} onClick={() => setFiltroTipo(t)}>{t === "todas" ? "Todas" : ROTULO_TIPO[t]}</button>
                  ))}
                </div>
              )}
            </div>
          )}
          {semDados ? (
            <div className="cofre-card cofre-cats-empty">
              <Landmark size={30} />
              <p>Nenhuma conta cadastrada</p>
              <small>Escolha seu banco numa lista pronta ou cadastre uma conta personalizada.</small>
              <button type="button" className="cofre-solid" onClick={() => setEditando("nova")}>Nova conta</button>
            </div>
          ) : (
            <div className="cofre-card cofre-cats-list" data-focando={foco ? "true" : undefined}>
              {linhas.length > 1 && (
                <button type="button" className="cofre-cats-row cofre-conta-todas" aria-pressed={sel === TODAS} data-ativa={sel === TODAS || undefined} onClick={() => setSel(TODAS)}>
                  <span className="cofre-cats-icon" style={{ background: "var(--panel-elevated)", color: "var(--text)" }}><Landmark size={16} /></span>
                  <span className="cofre-cats-row-main"><span className="cofre-cats-row-name"><b>Visão geral</b></span><small>Todas as contas juntas</small></span>
                  <span className="cofre-cats-row-total"><b className="cofre-mono" data-neg={total.saldo < 0 || undefined}>{formatMoeda(total.saldo)}</b></span>
                </button>
              )}
              {carregando && [0, 1, 2].map((i) => <div key={i} className="cofre-conta-skel" style={estiloI(i)} />)}
              {!carregando && visiveis.length === 0 && <p className="cofre-cats-none">Nenhuma conta encontrada.</p>}
              {visiveis.map((c, i) => {
                const l = linhas.find((x) => x.id === c.id);
                const share = saldoPositivoTotal > 0 && l ? Math.max(0, l.saldo) / saldoPositivoTotal * 100 : 0;
                return (
                  <div key={c.id} role="button" tabIndex={0} aria-pressed={sel === c.id} aria-label={`Conta ${c.nome}`} className="cofre-cats-row" data-ativa={sel === c.id || undefined} data-foco={foco === c.id ? "true" : undefined} style={estiloI(i)}
                    onClick={() => setSel(c.id)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSel(c.id); } }}
                    onMouseEnter={() => setFoco(c.id)} onMouseLeave={() => setFoco(null)} onFocus={() => setFoco(c.id)} onBlur={() => setFoco(null)}>
                    <SeloConta nome={c.nome} cor={c.cor} tipo={c.tipo} />
                    <span className="cofre-cats-row-main">
                      <span className="cofre-cats-row-name"><b>{c.nome}</b>{c.padrao && <em>Padrão</em>}</span>
                      <small>{descricaoConta(c)}</small>
                    </span>
                    <span className="cofre-cats-row-total">
                      <b className="cofre-mono" data-neg={(l?.saldo ?? 0) < 0 || undefined}>{formatMoeda(l?.saldo ?? c.saldo_inicial_centavos)}</b>
                      <i><u style={{ width: `${Math.max(share > 0 ? 4 : 0, share)}%`, background: c.cor }} /></i>
                    </span>
                    <button type="button" className="cofre-conta-editar" aria-label={`Editar ${c.nome}`} title="Editar conta" onClick={(e) => { e.stopPropagation(); setEditando(c); }}><Pencil size={13} /></button>
                  </div>
                );
              })}
              {!carregando && !busca && filtroTipo === "todas" && linhas.some((l) => l.id === SEM_CONTA) && (
                <button type="button" className="cofre-cats-row" data-ativa={sel === SEM_CONTA || undefined} aria-pressed={sel === SEM_CONTA} onClick={() => setSel(SEM_CONTA)}>
                  <SeloConta nome="Sem conta" cor={COR_SEM_CATEGORIA} />
                  <span className="cofre-cats-row-main"><span className="cofre-cats-row-name"><b>Sem conta</b></span><small>Lançamentos sem conta definida</small></span>
                </button>
              )}
            </div>
          )}
        </aside>

        <div className="cofre-cats-main">
          {erro && (
            <div role="alert" className="cofre-card cofre-cats-empty">
              <CloudOff size={28} />
              <p>{erro}</p>
              <button type="button" className="cofre-solid" onClick={() => setTentativa((n) => n + 1)}><RefreshCw size={14} />Tentar novamente</button>
            </div>
          )}
          {carregando && (
            <div className="cofre-cats-skeleton" role="status" aria-label="Carregando análise">
              {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} style={estiloI(i)} />)}
            </div>
          )}
          {semDados && (
            <div className="cofre-card cofre-cats-empty cofre-rise">
              <Wallet size={28} />
              <p>Cadastre sua primeira conta</p>
              <small>Com contas cadastradas você acompanha saldo, entradas, saídas e a evolução de cada uma.</small>
            </div>
          )}
          {!carregando && !erro && !semDados && (
            <>
              <div className="cofre-cats-grid">
                <div className="cofre-cats-left">
                  <div className="cofre-cats-trio">
                    <KpiConta i={2} rotulo={atual ? "Saldo atual" : "Patrimônio total"} valor={saldoEscopo} nota={atual?.conta ? `inicial ${formatMoeda(atual.conta.saldo_inicial_centavos)}` : `${linhas.length} conta${linhas.length === 1 ? "" : "s"}`} cor={atual?.cor ?? "var(--text)"} negativo={saldoEscopo < 0} />
                    <KpiConta i={3} rotulo="Entradas" valor={resumo.entradas} variacaoPct={varEntradas} bom="sobe" cor={COR_ENTRADA} />
                    <KpiConta i={4} rotulo="Saídas" valor={resumo.saidas} variacaoPct={varSaidas} bom="desce" cor={COR_SAIDA} />
                  </div>
                  <div className="cofre-card cofre-cats-card cofre-conta-specs cofre-rise" style={estiloI(5)}>
                    <Spec rotulo="Resultado do período" valor={`${resumo.resultado > 0 ? "+" : ""}${formatMoeda(resumo.resultado)}`} tom={resumo.resultado === 0 ? undefined : resumo.resultado > 0 ? "pos" : "neg"} />
                    <Spec rotulo="Taxa de economia" valor={resumo.taxaEconomia === null ? "—" : `${resumo.taxaEconomia.toFixed(0)}%`} />
                    <Spec rotulo="Lançamentos" valor={String(resumo.lancamentos)} />
                    <Spec rotulo="Ticket médio (saídas)" valor={formatMoeda(resumo.ticketSaida)} />
                    <Spec rotulo="Média diária de gasto" valor={formatMoeda(resumo.mediaDiariaSaida)} />
                    <Spec rotulo="Maior saída" valor={resumo.maiorSaida ? formatMoeda(resumo.maiorSaida.valor_centavos) : "—"} dica={resumo.maiorSaida?.descricao} />
                    <Spec rotulo="A receber (pendente)" valor={formatMoeda(resumo.pendentesEntrada)} />
                    <Spec rotulo="A pagar (pendente)" valor={formatMoeda(resumo.pendentesSaida)} />
                  </div>

                  <div className="cofre-card cofre-cats-card cofre-rise" style={estiloI(6)}>
                    <h4>Evolução do saldo{atual ? "" : " (todas as contas)"}</h4>
                    <SaldoChart pontos={pontos} cor={atual?.cor && !atual.cor.startsWith("#6b") ? atual.cor : "#7dd3fc"} />
                  </div>

                  <div className="cofre-card cofre-cats-card cofre-rise" style={estiloI(7)}>
                    <div className="cofre-card-heading"><h4>Entradas × saídas</h4><div className="cofre-legend"><span><i style={{ background: COR_ENTRADA }} />Entradas</span><span><i style={{ background: COR_SAIDA }} />Saídas</span></div></div>
                    <ComposedAreaChart
                      points={pontos.map((p) => ({ label: p.rotulo, incomeConfirmedCents: p.entradas, expenseConfirmedCents: p.saidas, incomeForecastCents: 0, expenseForecastCents: 0 }))}
                      incomeColor={COR_ENTRADA} expenseColor={COR_SAIDA}
                    />
                  </div>

                  <div className="cofre-cats-duo">
                    <div className="cofre-card cofre-cats-card cofre-rise" style={estiloI(8)}>
                      <h4>Gastos por categoria</h4>
                      <DonutChart segments={segmentosCat} />
                    </div>
                    <div className="cofre-card cofre-cats-card cofre-rise" style={estiloI(9)}>
                      <h4>Formas de pagamento</h4>
                      <HorizontalBarChart items={porForma.map((g) => ({ label: FORMAS[g.chave ?? ""] ?? "Não informada", valueCents: g.valor }))} color={COR_SAIDA} />
                    </div>
                  </div>

                  {!atual && linhas.length > 1 && (
                    <div className="cofre-cats-duo">
                      <div className="cofre-card cofre-cats-card cofre-rise" style={estiloI(10)}>
                        <h4>Distribuição do saldo</h4>
                        <DonutChart segments={segmentosSaldo} />
                      </div>
                      <div className="cofre-card cofre-cats-card cofre-rise" style={estiloI(11)}>
                        <h4>Ranking de saldo</h4>
                        <div className="cofre-cats-ranking" data-focando={foco ? "true" : undefined}>
                          {ranking.map((l, i) => (
                            <button key={l.id} type="button" className="cofre-conta-rank" data-foco={foco === l.id ? "true" : undefined} onClick={() => setSel(l.id)} onMouseEnter={() => setFoco(l.id)} onMouseLeave={() => setFoco(null)}>
                              <SeloConta nome={l.nome} cor={l.cor} tipo={l.tipo} tamanho="sm" />
                              <span className="cofre-cats-rank-name" title={l.nome}>{l.nome}</span>
                              <i className="cofre-cats-bar"><u className="cofre-grow" style={{ ...estiloI(i), width: `${Math.max(3, Math.max(0, l.saldo) / Math.max(1, ranking[0]?.saldo ?? 1) * 100)}%`, background: l.cor }} /></i>
                              <b className="cofre-mono" data-neg={l.saldo < 0 || undefined}>{formatMoeda(l.saldo)}</b>
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {top3.length > 1 && (
                    <div className="cofre-card cofre-cats-card cofre-rise" style={estiloI(12)}>
                      <h4>Comparativo por métrica</h4>
                      <div className="cofre-cats-metrics">
                        <Metrica rotulo="Entradas" itens={top3} valor={(l) => l.atual.entradas} formato={formatMoeda} />
                        <Metrica rotulo="Saídas" itens={top3} valor={(l) => l.atual.saidas} formato={formatMoeda} />
                        <Metrica rotulo="Nº lançamentos" itens={top3} valor={(l) => l.atual.lancamentos} formato={String} />
                        <Metrica rotulo="Ticket médio" itens={top3} valor={(l) => l.atual.ticketSaida} formato={formatMoeda} />
                        <Metrica rotulo="Recorrências ativas" itens={top3} valor={(l) => l.recorrencias} formato={String} />
                      </div>
                    </div>
                  )}
                </div>

                <div className="cofre-cats-right">
                  <Destaque linha={atual} total={total.saldo} saldoPositivoTotal={saldoPositivoTotal} saldoEscopo={saldoEscopo} />
                  {atual?.conta && <DadosConta conta={atual.conta} onEditar={() => setEditando(atual.conta!)} />}
                  {top3.length > 1 && (
                    <div className="cofre-card cofre-cats-card cofre-cats-radar cofre-rise" style={estiloI(4)}>
                      <h4>Comparativo visual</h4>
                      <RadarChart axes={EIXOS} series={top3.map((l) => ({ label: l.nome, color: l.cor, values: [l.atual.entradas / 100, l.atual.saidas / 100, l.atual.lancamentos, l.atual.ticketSaida / 100] }))} />
                    </div>
                  )}
                </div>
              </div>

              {insight && (
                <div className="cofre-card cofre-cats-insight cofre-rise" style={estiloI(13)}>
                  <span>{resumo.resultado >= 0 ? <ArrowUp size={14} /> : <ArrowDown size={14} />}</span>
                  <p>{insight}</p>
                </div>
              )}

              <div className="cofre-cats-footer cofre-rise" style={estiloI(14)}>
                <span>{linhas.length} conta{linhas.length === 1 ? "" : "s"} · {resumo.lancamentos} lançamento{resumo.lancamentos === 1 ? "" : "s"} efetivado{resumo.lancamentos === 1 ? "" : "s"} considerado{resumo.lancamentos === 1 ? "" : "s"}</span>
                <button type="button" className="cofre-secondary" onClick={exportar}><Download size={13} />Exportar CSV</button>
              </div>
            </>
          )}
        </div>
      </div>

      {editando && createPortal(
        <ContaModal
          conta={editando === "nova" ? undefined : editando}
          contas={contas ?? []}
          onClose={() => setEditando(null)}
          onSaved={(id) => { setEditando(null); if (id && editando === "nova") setSel(id); atualizar(); setTentativa((n) => n + 1); }}
        />,
        document.querySelector(".cofre-app") ?? document.body,
      )}
    </section>
  );
}

function KpiConta({ i, rotulo, valor, nota, cor, negativo, variacaoPct, bom }: { i: number; rotulo: string; valor: number; nota?: string; cor: string; negativo?: boolean; variacaoPct?: number | null; bom?: "sobe" | "desce" }) {
  const animado = useContagem(valor);
  return (
    <div className="cofre-card cofre-cats-card cofre-cats-top3 cofre-rise" style={estiloI(i)}>
      <div className="cofre-cats-top3-head"><b>{rotulo}</b>{variacaoPct !== undefined && <VariacaoTag v={variacaoPct} bom={bom} />}</div>
      <i className="cofre-cats-bar"><u className="cofre-grow" style={{ ...estiloI(i), width: "100%", background: negativo ? COR_SAIDA : cor, opacity: 0.85 }} /></i>
      <div className="cofre-cats-top3-foot"><strong className="cofre-mono" data-neg={negativo || undefined}>{formatMoeda(Math.round(animado))}</strong>{nota && <small>{nota}</small>}</div>
    </div>
  );
}

function VariacaoTag({ v, bom }: { v: number | null; bom?: "sobe" | "desce" }) {
  if (v === null) return <span className="cofre-conta-var">—</span>;
  const sobe = v > 0;
  const Seta = sobe ? ArrowUp : ArrowDown;
  const ruim = bom === "desce" ? sobe : !sobe;
  return <span className="cofre-conta-var cofre-mono" data-ruim={Math.abs(v) < 1 ? undefined : ruim} title="Em relação ao período anterior"><Seta size={10} strokeWidth={2.6} />{Math.abs(v).toFixed(0)}%</span>;
}

function Spec({ rotulo, valor, tom, dica }: { rotulo: string; valor: string; tom?: "pos" | "neg"; dica?: string }) {
  return <div className="cofre-cats-spec" title={dica}><span>{rotulo}</span><b className="cofre-mono" data-tom={tom}>{valor}</b></div>;
}

function Metrica({ rotulo, itens, valor, formato }: { rotulo: string; itens: Linha[]; valor: (l: Linha) => number; formato: (v: number) => string }) {
  const max = Math.max(1, ...itens.map(valor));
  return (
    <div className="cofre-cats-metric" style={{ gridTemplateColumns: `130px repeat(${itens.length}, minmax(0,1fr))` }}>
      <span>{rotulo}</span>
      {itens.map((l, i) => {
        const v = valor(l);
        return (
          <div key={l.id}>
            <i className="cofre-cats-bar"><u className="cofre-grow" style={{ ...estiloI(i), width: `${Math.max(4, (v / max) * 100)}%`, background: l.cor }} /></i>
            <b className="cofre-mono">{formato(v)}</b>
          </div>
        );
      })}
    </div>
  );
}

function Destaque({ linha, total, saldoPositivoTotal, saldoEscopo }: { linha: Linha | null; total: number; saldoPositivoTotal: number; saldoEscopo: number }) {
  const share = linha && saldoPositivoTotal > 0 ? Math.max(0, linha.saldo) / saldoPositivoTotal * 100 : 100;
  const nota = useContagem(share);
  const cor = linha?.cor ?? "#7dd3fc";
  return (
    <div className="cofre-card cofre-cats-card cofre-cats-highlight cofre-rise" style={{ ...estiloI(1), ["--destaque" as string]: cor }}>
      <div className="cofre-cats-highlight-head"><span>Saldo atual</span><span className="cofre-mono">{formatMoeda(linha ? saldoEscopo : total)}</span></div>
      <div className="cofre-cats-highlight-body">
        {linha ? <SeloConta nome={linha.nome} cor={linha.cor} tipo={linha.tipo} tamanho="lg" /> : <span className="cofre-cats-icon lg" style={{ background: cor, color: corDoTexto(cor) }}><Landmark size={18} /></span>}
        <span className="cofre-cats-highlight-name"><small>{linha ? "Conta selecionada" : "Visão geral"}</small><b>{linha?.nome ?? "Todas as contas"}</b></span>
        <span className="cofre-cats-highlight-score"><b className="cofre-mono">{nota.toFixed(0)}%</b><small>do patrimônio</small></span>
      </div>
    </div>
  );
}

function DadosConta({ conta, onEditar }: { conta: ContaApi; onEditar: () => void }) {
  const banco = bancoPorCodigo(conta.codigo_banco);
  const linhas: [string, string | null][] = [
    ["Banco", conta.banco || banco?.nome || null],
    ["Número do banco", conta.codigo_banco],
    ["Agência", conta.agencia],
    ["Conta", conta.numero_conta],
    ["Tipo", ROTULO_TIPO[conta.tipo]],
    ["Saldo inicial", formatMoeda(conta.saldo_inicial_centavos)],
  ];
  return (
    <div className="cofre-card cofre-cats-card cofre-rise" style={estiloI(3)}>
      <div className="cofre-card-heading"><h4>Dados da conta</h4><button type="button" className="cofre-conta-editlink" onClick={onEditar}><Pencil size={12} />Editar</button></div>
      <dl className="cofre-conta-dados">
        {linhas.filter(([, v]) => v).map(([k, v]) => <div key={k}><dt>{k}</dt><dd className="cofre-mono">{v}</dd></div>)}
      </dl>
    </div>
  );
}
