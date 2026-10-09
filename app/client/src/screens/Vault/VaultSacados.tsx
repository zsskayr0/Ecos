import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { ArrowDownLeft, ArrowUpRight, Check, GitMerge, Pencil, RefreshCw, Search, Users, X } from "lucide-react";
import { vault, ApiError, type BeneficiarioApi, type TransacaoApi } from "@/lib/api";
import { formatMoeda } from "@/lib/format";
import { maiorValor, useModoValor } from "@/lib/exibicao-valores";
import { TotalDaLinha } from "./nexus/IndicadorValor";
import { casaBusca } from "@/lib/texto-busca";
import { avisar } from "@/lib/toast";
import { SegmentedSlide } from "@/components/common/SegmentedSlide";
import { DonutChart } from "./nexus/DonutChart";
import { HorizontalBarChart } from "./nexus/HorizontalBarChart";
import { PeriodPicker } from "./nexus/PeriodPicker";
import { periodNoun, periodRange, type Period } from "./nexus/period";
import { CORES } from "./VaultCategories";
import { agruparSimilares, type GrupoSimilar } from "./sacados/similares";

type Visao = "painel" | "conciliacao";
type Papel = "todos" | "pagador" | "recebedor";

interface Stat {
  id: string;
  nome: string;
  /** Entradas: o que esta pessoa/empresa pagou a você. */
  recebido: number;
  /** Saídas: o que você pagou a ela. */
  pago: number;
  count: number;
  ultima: string;
}

const estiloI = (i: number) => ({ "--i": i }) as CSSProperties;
const MOTIVO: Record<GrupoSimilar["motivo"], string> = { espacos: "Mesmo nome com espaços ou pontuação diferentes", digitacao: "Nomes muito parecidos — possível erro de digitação" };
const CHAVE_IGNORADOS = "ecos:cofre:sacados-ignorados";

function lerIgnorados(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(CHAVE_IGNORADOS) ?? "[]") as string[]); } catch { return new Set(); }
}

async function listarPeriodo(de: string, ate: string): Promise<TransacaoApi[]> {
  const itens: TransacaoApi[] = [];
  let cursor: string | undefined;
  for (let pagina = 0; pagina < 40; pagina++) {
    const r = await vault.transacoes.listar({ data_de: de, data_ate: ate, limit: 500, cursor });
    itens.push(...r.items);
    if (!r.next_cursor) break;
    cursor = r.next_cursor;
  }
  return itens;
}

/** Sacados: quem pagou ou recebeu nos lançamentos. Lista com análise por período e uma tela de conciliação para juntar cadastros duplicados. */
export function VaultSacados({ period, onPeriodChange, atualizar, irParaCadastros }: { period: Period; onPeriodChange: (p: Period) => void; atualizar: () => void; /** Atalho para gerenciar sacados na tela Cadastros. */ irParaCadastros?: () => void }) {
  const range = periodRange(period);
  const [visao, setVisao] = useState<Visao>("painel");
  const [cadastros, setCadastros] = useState<BeneficiarioApi[] | null>(null);
  const [transacoes, setTransacoes] = useState<TransacaoApi[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [tentativa, setTentativa] = useState(0);
  const [busca, setBusca] = useState("");
  const [papel, setPapel] = useState<Papel>("todos");
  const [selecionado, setSelecionado] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    setErro(null);
    Promise.all([vault.beneficiarios.listar(), listarPeriodo(range.from, range.to)])
      .then(([b, t]) => { if (vivo) { setCadastros(b); setTransacoes(t); } })
      .catch((e) => { if (vivo) setErro(e instanceof ApiError ? e.message : "Não foi possível carregar os sacados."); });
    return () => { vivo = false; };
  }, [range.from, range.to, tentativa]);

  const recarregar = useCallback(() => { setTentativa((n) => n + 1); atualizar(); }, [atualizar]);

  const stats = useMemo<Stat[]>(() => {
    if (!cadastros || !transacoes) return [];
    const mapa = new Map<string, Stat>(cadastros.map((b) => [b.id, { id: b.id, nome: b.nome, recebido: 0, pago: 0, count: 0, ultima: "" }]));
    for (const t of transacoes) {
      const s = t.beneficiario_id ? mapa.get(t.beneficiario_id) : undefined;
      if (!s) continue;
      if (t.tipo === "entrada") s.recebido += t.valor_centavos; else s.pago += t.valor_centavos;
      s.count += 1;
      if (t.data > s.ultima) s.ultima = t.data;
    }
    return [...mapa.values()];
  }, [cadastros, transacoes]);

  const semSacado = useMemo(() => (transacoes ?? []).filter((t) => !t.beneficiario_id).length, [transacoes]);
  const valorDe = useCallback((s: Stat) => (papel === "pagador" ? s.recebido : papel === "recebedor" ? s.pago : s.recebido + s.pago), [papel]);

  const modoValor = useModoValor("sacados");
  const maxValor = useMemo(() => maiorValor(stats.map(valorDe)), [stats, valorDe]);
  const lista = useMemo(() => stats
    .filter((s) => casaBusca(busca, s.nome) && (papel === "todos" || valorDe(s) > 0))
    .sort((a, b) => valorDe(b) - valorDe(a) || a.nome.localeCompare(b.nome, "pt-BR")), [stats, busca, papel, valorDe]);

  const pagadores = useMemo(() => stats.filter((s) => s.recebido > 0).sort((a, b) => b.recebido - a.recebido), [stats]);
  const recebedores = useMemo(() => stats.filter((s) => s.pago > 0).sort((a, b) => b.pago - a.pago), [stats]);
  const totalRecebido = pagadores.reduce((s, x) => s + x.recebido, 0);
  const totalPago = recebedores.reduce((s, x) => s + x.pago, 0);
  const ativoSel = stats.find((s) => s.id === selecionado) ?? null;

  const grupos = useMemo(() => cadastros ? agruparSimilares(cadastros.map((b) => ({ id: b.id, nome: b.nome, transacoes: b.transacoes ?? 0 }))) : [], [cadastros]);
  const [ignorados, setIgnorados] = useState(lerIgnorados);
  const pendentes = grupos.filter((g) => !ignorados.has(g.chave));

  function ignorar(chave: string) {
    setIgnorados((atual) => {
      const novo = new Set(atual).add(chave);
      try { localStorage.setItem(CHAVE_IGNORADOS, JSON.stringify([...novo])); } catch { /* vale só nesta sessão */ }
      return novo;
    });
  }

  const carregando = !erro && (cadastros === null || transacoes === null);
  const segmentos = (itens: Stat[], valor: (s: Stat) => number) => itens.slice(0, 8).map((s, i) => ({ label: s.nome, valueCents: valor(s), color: CORES[(i * 3) % CORES.length]! }));

  return (
    <section className="cofre-cats cofre-sacados">
      <div className="cofre-cats-top cofre-rise" style={estiloI(0)}>
        <h1>Sacados</h1>
        <div className="cofre-cats-actions">
          {irParaCadastros && <button type="button" className="cofre-secondary cad-link" onClick={irParaCadastros}>Gerenciar cadastros</button>}
          <SegmentedSlide className="cofre-launch-slide cofre-slide" tamanho="lg" ariaLabel="Visão de sacados" value={visao} onChange={setVisao} opcoes={[
            { value: "painel", label: <span className="inline-flex items-center gap-1.5"><Users size={14} aria-hidden />Análise</span>, cor: "cofre-blue", ariaLabel: "Análise" },
            { value: "conciliacao", label: <span className="inline-flex items-center gap-1.5"><GitMerge size={14} aria-hidden />Conciliação{pendentes.length > 0 && <b className="cofre-sacados-contagem">{pendentes.length}</b>}</span>, cor: "cofre-pink", ariaLabel: "Conciliação" },
          ]} />
          {visao === "painel" && <PeriodPicker value={period} onChange={onPeriodChange} />}
        </div>
      </div>

      {erro && (
        <div role="alert" className="cofre-card cofre-cats-empty">
          <p>{erro}</p>
          <button type="button" className="cofre-solid" onClick={() => setTentativa((n) => n + 1)}><RefreshCw size={14} />Tentar novamente</button>
        </div>
      )}
      {carregando && <div className="cofre-cats-skeleton" role="status" aria-label="Carregando sacados">{[0, 1, 2, 3].map((i) => <div key={i} style={estiloI(i)} />)}</div>}

      {!erro && !carregando && visao === "painel" && (
        <div className="cofre-cats-layout">
          <aside className="cofre-cats-list-col cofre-rise" style={estiloI(1)}>
            <div className="cofre-cats-list-head"><h3>Todos os sacados</h3><span>{stats.length} cadastrados</span></div>
            <div className="cofre-cats-tools">
              <label className="cofre-cats-search"><Search size={13} /><input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar sacado…" aria-label="Buscar sacado" />{busca && <button type="button" aria-label="Limpar busca" onClick={() => setBusca("")}><X size={12} /></button>}</label>
              <div className="cofre-cats-chips" role="group" aria-label="Filtrar por papel">
                {(["todos", "pagador", "recebedor"] as const).map((p) => (
                  <button key={p} type="button" aria-pressed={papel === p} onClick={() => setPapel(p)}>{p === "todos" ? "Todos" : p === "pagador" ? "Pagadores" : "Recebedores"}</button>
                ))}
              </div>
            </div>
            {stats.length === 0 ? (
              <div className="cofre-card cofre-cats-empty"><Users size={30} /><p>Nenhum sacado ainda</p><small>Eles aparecem quando você informa quem pagou ou recebeu num lançamento.</small></div>
            ) : (
              <div className="cofre-card cofre-cats-list">
                {lista.length === 0 && <p className="cofre-cats-none">Nenhum sacado encontrado.</p>}
                {lista.map((s, i) => {
                  const v = valorDe(s);
                  return (
                    <div key={s.id} role="button" tabIndex={0} aria-label={`Ver ${s.nome}`} className="cofre-cats-row" data-ativa={selecionado === s.id ? "" : undefined} style={estiloI(i)}
                      onClick={() => setSelecionado((atual) => (atual === s.id ? null : s.id))}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelecionado((atual) => (atual === s.id ? null : s.id)); } }}>
                      <span className="cofre-sacados-avatar" aria-hidden>{s.nome.trim().charAt(0).toUpperCase() || "?"}</span>
                      <span className="cofre-cats-row-main">
                        <span className="cofre-cats-row-name"><b>{s.nome}</b></span>
                        <small>{s.recebido > 0 && s.pago > 0 ? "Pagador e recebedor" : s.recebido > 0 ? "Pagador" : s.pago > 0 ? "Recebedor" : "Sem movimento no período"}</small>
                      </span>
                      <span className="cofre-cats-row-total">{v > 0 ? <TotalDaLinha modo={modoValor} valor={v} max={maxValor} texto={formatMoeda(v)} /> : <span className="muted">—</span>}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </aside>

          <div className="cofre-cats-main">
            {ativoSel && <Detalhe s={ativoSel} transacoes={transacoes ?? []} onFechar={() => setSelecionado(null)} aoRenomear={recarregar} />}
            {totalRecebido + totalPago === 0 ? (
              <div className="cofre-card cofre-cats-empty cofre-rise"><Users size={28} /><p>Nada para analisar {periodNoun(period)}</p><small>Lance receitas ou despesas informando quem pagou ou recebeu para ver o comparativo.</small></div>
            ) : (
              <>
                <div className="cofre-cats-trio">
                  <div className="cofre-card cofre-cats-card cofre-rise" style={estiloI(2)}><Spec rotulo="Recebido de pagadores" valor={formatMoeda(totalRecebido)} tom="pos" /><Spec rotulo="Pagadores" valor={String(pagadores.length)} /></div>
                  <div className="cofre-card cofre-cats-card cofre-rise" style={estiloI(3)}><Spec rotulo="Pago a recebedores" valor={formatMoeda(totalPago)} tom="neg" /><Spec rotulo="Recebedores" valor={String(recebedores.length)} /></div>
                  <div className="cofre-card cofre-cats-card cofre-rise" style={estiloI(4)}><Spec rotulo="Lançamentos sem sacado" valor={String(semSacado)} /><Spec rotulo="Período" valor={periodNoun(period)} /></div>
                </div>
                <div className="cofre-cats-duo" data-solo={papel !== "todos" ? "true" : undefined}>
                  {papel !== "recebedor" && (
                    <div className="cofre-card cofre-cats-card cofre-rise" style={estiloI(5)}>
                      <h4><ArrowDownLeft size={13} aria-hidden /> Quanto cada pagador me pagou</h4>
                      <DonutChart segments={segmentos(pagadores, (s) => s.recebido)} />
                    </div>
                  )}
                  {papel !== "pagador" && (
                    <div className="cofre-card cofre-cats-card cofre-rise" style={estiloI(6)}>
                      <h4><ArrowUpRight size={13} aria-hidden /> Quanto paguei a cada recebedor</h4>
                      <DonutChart segments={segmentos(recebedores, (s) => s.pago)} />
                    </div>
                  )}
                </div>
                <div className="cofre-cats-duo" data-solo={papel !== "todos" ? "true" : undefined}>
                  {papel !== "recebedor" && (
                    <div className="cofre-card cofre-cats-card cofre-rise" style={estiloI(7)}>
                      <h4>Ranking de pagadores</h4>
                      <HorizontalBarChart items={pagadores.slice(0, 10).map((s) => ({ label: s.nome, valueCents: s.recebido }))} color="var(--cofre-income)" />
                    </div>
                  )}
                  {papel !== "pagador" && (
                    <div className="cofre-card cofre-cats-card cofre-rise" style={estiloI(8)}>
                      <h4>Ranking de recebedores</h4>
                      <HorizontalBarChart items={recebedores.slice(0, 10).map((s) => ({ label: s.nome, valueCents: s.pago }))} color="var(--cofre-expense)" />
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {!erro && !carregando && visao === "conciliacao" && (
        <Conciliacao grupos={pendentes} ignorados={grupos.length - pendentes.length} onIgnorar={ignorar} aoMesclar={recarregar} />
      )}
    </section>
  );
}

function Spec({ rotulo, valor, tom }: { rotulo: string; valor: string; tom?: "pos" | "neg" }) {
  return <div className="cofre-cats-spec"><span>{rotulo}</span><b className="cofre-mono" data-tom={tom}>{valor}</b></div>;
}

/** Resumo de um sacado, com a correção do nome ali mesmo. */
function Detalhe({ s, transacoes, onFechar, aoRenomear }: { s: Stat; transacoes: TransacaoApi[]; onFechar: () => void; aoRenomear: () => void }) {
  const [editando, setEditando] = useState(false);
  const [nome, setNome] = useState(s.nome);
  const [salvando, setSalvando] = useState(false);
  useEffect(() => { setNome(s.nome); setEditando(false); }, [s.id, s.nome]);
  const recentes = useMemo(() => transacoes.filter((t) => t.beneficiario_id === s.id).sort((a, b) => b.data.localeCompare(a.data)).slice(0, 5), [transacoes, s.id]);

  async function salvar() {
    const novo = nome.trim();
    if (!novo || novo === s.nome) { setEditando(false); return; }
    setSalvando(true);
    try {
      await vault.beneficiarios.renomear(s.id, novo);
      setEditando(false);
      aoRenomear();
    } catch (e) {
      avisar(e instanceof ApiError ? e.message : "Não foi possível renomear.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="cofre-card cofre-cats-card cofre-sacados-detalhe cofre-rise">
      <div className="cofre-sacados-detalhe-head">
        {editando ? (
          <form onSubmit={(e) => { e.preventDefault(); void salvar(); }}>
            <input autoFocus value={nome} onChange={(e) => setNome(e.target.value)} aria-label="Nome do sacado" />
            <button type="submit" className="cofre-solid" disabled={salvando || !nome.trim()} aria-label="Salvar nome"><Check size={14} /></button>
            <button type="button" className="cofre-secondary" onClick={() => { setNome(s.nome); setEditando(false); }} aria-label="Cancelar"><X size={14} /></button>
          </form>
        ) : (
          <>
            <h3>{s.nome}</h3>
            <button type="button" className="cofre-secondary" onClick={() => setEditando(true)}><Pencil size={13} />Corrigir nome</button>
          </>
        )}
        <button type="button" className="cofre-sacados-fechar" aria-label="Fechar detalhes" onClick={onFechar}><X size={14} /></button>
      </div>
      <div className="cofre-cats-trio">
        <Spec rotulo="Recebido dele(a)" valor={formatMoeda(s.recebido)} tom="pos" />
        <Spec rotulo="Pago a ele(a)" valor={formatMoeda(s.pago)} tom="neg" />
        <Spec rotulo="Lançamentos" valor={String(s.count)} />
      </div>
      {recentes.length > 0 && (
        <ul className="cofre-sacados-recentes" aria-label="Lançamentos recentes">
          {recentes.map((t) => (
            <li key={t.id}><span>{t.data.split("-").reverse().join("/")}</span><span>{t.descricao}</span><b className="cofre-mono" data-tipo={t.tipo}>{t.tipo === "entrada" ? "+" : "−"}{formatMoeda(t.valor_centavos)}</b></li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Cadastros que parecem ser o mesmo sacado: a pessoa escolhe qual fica, confirma o nome e junta. */
function Conciliacao({ grupos, ignorados, onIgnorar, aoMesclar }: { grupos: GrupoSimilar[]; ignorados: number; onIgnorar: (chave: string) => void; aoMesclar: () => void }) {
  if (grupos.length === 0) {
    return (
      <div className="cofre-card cofre-cats-empty cofre-rise">
        <Check size={28} />
        <p>Nenhum nome parecido para conciliar</p>
        <small>{ignorados > 0 ? `${ignorados} ${ignorados === 1 ? "grupo foi marcado" : "grupos foram marcados"} como “não é o mesmo”.` : "Quando dois cadastros tiverem o mesmo nome com espaços, acentos ou um erro de digitação, eles aparecem aqui."}</small>
      </div>
    );
  }
  return (
    <div className="cofre-sacados-grupos">
      <p className="cofre-sacados-ajuda">Estes cadastros parecem ser a mesma pessoa ou empresa. Escolha o que permanece e junte: os lançamentos dos outros passam para ele.</p>
      {grupos.map((g, i) => <GrupoCard key={g.chave} grupo={g} i={i} onIgnorar={() => onIgnorar(g.chave)} aoMesclar={aoMesclar} />)}
    </div>
  );
}

function GrupoCard({ grupo, i, onIgnorar, aoMesclar }: { grupo: GrupoSimilar; i: number; onIgnorar: () => void; aoMesclar: () => void }) {
  const [principalId, setPrincipalId] = useState(grupo.principal.id);
  const [nome, setNome] = useState(grupo.principal.nome);
  const [juntando, setJuntando] = useState(false);
  const principal = grupo.membros.find((m) => m.id === principalId) ?? grupo.principal;
  const origens = grupo.membros.filter((m) => m.id !== principal.id);
  const total = grupo.membros.reduce((s, m) => s + m.transacoes, 0);

  function escolher(id: string) {
    setPrincipalId(id);
    setNome(grupo.membros.find((m) => m.id === id)?.nome ?? nome);
  }

  async function juntar() {
    const final = nome.trim().replace(/\s+/g, " ");
    if (!final) return;
    if (!window.confirm(`Juntar ${grupo.membros.length} cadastros em “${final}”? Os ${total} lançamentos passam para ele e os outros nomes deixam de existir.`)) return;
    setJuntando(true);
    try {
      const r = await vault.beneficiarios.mesclar({ destino_id: principal.id, origem_ids: origens.map((o) => o.id), nome: final });
      avisar(`${grupo.membros.length} cadastros juntados em “${final}” (${r.movidos} ${r.movidos === 1 ? "item movido" : "itens movidos"}).`);
      aoMesclar();
    } catch (e) {
      avisar(e instanceof ApiError ? e.message : "Não foi possível juntar os cadastros.");
      setJuntando(false);
    }
  }

  return (
    <div className="cofre-card cofre-cats-card cofre-sacados-grupo cofre-rise" style={estiloI(i)}>
      <p className="cofre-sacados-motivo" data-motivo={grupo.motivo}>{MOTIVO[grupo.motivo]}</p>
      <ul role="radiogroup" aria-label="Cadastro que permanece">
        {grupo.membros.map((m) => (
          <li key={m.id}>
            <label data-principal={m.id === principal.id ? "" : undefined}>
              <input type="radio" name={`principal-${grupo.chave}`} checked={m.id === principal.id} onChange={() => escolher(m.id)} />
              <span className="cofre-sacados-nome">{m.nome}</span>
              <small>{m.transacoes} {m.transacoes === 1 ? "lançamento" : "lançamentos"}</small>
              {m.id === principal.id && <em>Permanece</em>}
            </label>
          </li>
        ))}
      </ul>
      <label className="cofre-sacados-final">
        <span>Nome final</span>
        <input value={nome} onChange={(e) => setNome(e.target.value)} aria-label="Nome final" />
      </label>
      <div className="cofre-sacados-acoes">
        <button type="button" className="cofre-secondary" onClick={onIgnorar}>Não é o mesmo</button>
        <button type="button" className="cofre-solid" disabled={juntando || !nome.trim()} onClick={() => void juntar()}><GitMerge size={14} />{juntando ? "Juntando…" : `Juntar ${grupo.membros.length} cadastros`}</button>
      </div>
    </div>
  );
}
