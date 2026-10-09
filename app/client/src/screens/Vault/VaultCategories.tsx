import { SeletorEcos } from "@/components/common/SeletorEcos";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { ArrowDown, Archive, Boxes, Cloud, Columns3, CopyCheck, Keyboard, LayoutGrid, LayoutTemplate, List, Plus, RefreshCw, Search, Table, Tag, X, CloudOff } from "lucide-react";
import { vault, financeiro, ApiError, type CategoriaApi, type CategoriaUsoApi, type TransacaoApi } from "@/lib/api";
import { formatMoeda } from "@/lib/format";
import { SegmentedSlide } from "@/components/common/SegmentedSlide";
import { PeriodPicker } from "./nexus/PeriodPicker";
import { periodNoun, periodRange, toISO, type Period } from "./nexus/period";
import { avisar } from "@/lib/toast";
import { maesPossiveis, tipoAoMudarDeMae, tipoCabeNaMae } from "@/lib/categorias-hierarquia";
import { useOrdemPessoal } from "./ordem-pessoal";
import { SeletorCor } from "./contas/SeletorCor";
import { CORES, CategoriaIcone, corDoTexto, resolverIcone } from "./categorias/icone";
import { montarFamilias, ROTULO_CRITERIO, serieMensal, ultimosMeses, usoPorCategoria, type Criterio, type Familia } from "./categorias/dados";
import { acharDuplicatas, type GrupoDuplicado } from "./categorias/duplicatas";
import { MesclarModal } from "./categorias/MesclarModal";
import { DuplicatasModal } from "./categorias/DuplicatasModal";
import { ImportarModal } from "./categorias/ImportarModal";
import { DetalheCategoria } from "./categorias/DetalheCategoria";
import { BarraLote } from "./categorias/BarraLote";
import { VisoesSalvas, type Visao } from "./categorias/VisoesSalvas";
import { AtalhosAjuda, useAtalhos } from "./categorias/Atalhos";
import { VISTAS, type CamposEditaveis, type ContextoVista, type NomeVista } from "./categorias/contexto";
import { VistaGrade, VistaLista, VistaMapa, VistaNuvem } from "./categorias/Vistas";
import { VistaTabela } from "./categorias/TabelaCategorias";
import { VistaKanban, type AgruparKanban } from "./categorias/KanbanCategorias";
import { AnaliseCategorias } from "./categorias/AnaliseCategorias";
import "./categorias/categorias.css";

export { CORES, COR_SEM_CATEGORIA, CategoriaIcone, corDoTexto, resolverIcone } from "./categorias/icone";

const IconPicker = lazy(() => import("./IconPicker"));

type Recorrencia = Awaited<ReturnType<typeof financeiro.recorrencias>>[number];

const ICONE_VISTA = { grade: LayoutGrid, lista: List, tabela: Table, kanban: Columns3, mapa: Boxes, nuvem: Cloud } as const;
const CHAVE_PREFS = "ecos.cofre.categorias.preferencias";

interface Prefs { vista: NomeVista; criterio: Criterio; mostrarSubs: boolean; kanban: AgruparKanban; graficosEmBloco: boolean; arquivadas: boolean }
const PREFS_PADRAO: Prefs = { vista: "grade", criterio: "manual", mostrarSubs: true, kanban: "mae", graficosEmBloco: false, arquivadas: false };
const MESES_TENDENCIA = 6;
const CHAVE_DISPENSADAS = "ecos.cofre.categorias.duplicatas-dispensadas";
function lerDispensadas(): Set<string> {
  try { const v = JSON.parse(localStorage.getItem(CHAVE_DISPENSADAS) ?? "[]") as unknown; return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []); } catch { return new Set(); }
}

function lerPrefs(): Prefs {
  try {
    const v = JSON.parse(localStorage.getItem(CHAVE_PREFS) ?? "null") as Partial<Prefs> | null;
    if (!v) return PREFS_PADRAO;
    return {
      vista: VISTAS.some((x) => x.id === v.vista) ? v.vista! : PREFS_PADRAO.vista,
      criterio: v.criterio && v.criterio in ROTULO_CRITERIO ? v.criterio : PREFS_PADRAO.criterio,
      mostrarSubs: typeof v.mostrarSubs === "boolean" ? v.mostrarSubs : PREFS_PADRAO.mostrarSubs,
      kanban: v.kanban === "tipo" ? "tipo" : "mae",
      graficosEmBloco: v.graficosEmBloco === true,
      arquivadas: v.arquivadas === true,
    };
  } catch { return PREFS_PADRAO; }
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

/** Todos os lançamentos do período (receitas e despesas): a navegação mostra o movimento de cada categoria. */
async function listarPeriodo(de: string, ate: string): Promise<TransacaoApi[]> {
  const itens: TransacaoApi[] = [];
  let cursor: string | undefined;
  for (let pagina = 0; pagina < 80; pagina++) {
    const r = await vault.transacoes.listar({ data_de: de, data_ate: ate, limit: 500, cursor });
    itens.push(...r.items);
    if (!r.next_cursor) break;
    cursor = r.next_cursor;
  }
  return itens;
}

const estiloI = (i: number) => ({ "--i": i }) as CSSProperties;

export function VaultCategories({ period, onPeriodChange, categorias, atualizar, aoVerLancamentos }: {
  period: Period;
  onPeriodChange: (p: Period) => void;
  categorias: CategoriaApi[];
  atualizar: () => void;
  /** Abre a lista de lançamentos filtrada pela categoria (com as subcategorias, se `comSubs`). */
  aoVerLancamentos?: (categoriaId: string, comSubs: boolean) => void;
}) {
  const range = periodRange(period);
  const [lancamentos, setLancamentos] = useState<TransacaoApi[] | null>(null);
  const [anteriores, setAnteriores] = useState<TransacaoApi[]>([]);
  const [recorrencias, setRecorrencias] = useState<Recorrencia[]>([]);
  const [serie, setSerie] = useState<Map<string, number[]> | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [tentativa, setTentativa] = useState(0);
  const [editando, setEditando] = useState<{ categoria?: CategoriaApi; pai?: string } | null>(null);
  const [detalheId, setDetalheId] = useState<string | null>(null);
  const [mesclar, setMesclar] = useState<{ grupo: CategoriaApi[]; destino?: string } | null>(null);
  const [duplicatasAberto, setDuplicatasAberto] = useState(false);
  const [importar, setImportar] = useState<"modelos" | "arquivo" | "exportar" | null>(null);
  const [ajuda, setAjuda] = useState(false);
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [dispensadas, setDispensadas] = useState<Set<string>>(lerDispensadas);
  const [busca, setBusca] = useState("");
  const [filtroTipo, setFiltroTipo] = useState<"todas" | CategoriaApi["tipo"]>("todas");
  const [prefs, setPrefsEstado] = useState<Prefs>(lerPrefs);
  const analise = useRef<HTMLDivElement>(null);
  const campoBusca = useRef<HTMLInputElement>(null);
  const setPrefs = useCallback((mudanca: Partial<Prefs>) => setPrefsEstado((p) => {
    const n = { ...p, ...mudanca };
    try { localStorage.setItem(CHAVE_PREFS, JSON.stringify(n)); } catch { /* vale só nesta sessão */ }
    return n;
  }), []);
  const meses = useMemo(() => ultimosMeses(range.to, MESES_TENDENCIA), [range.to]);

  // A ordem das categorias é da pessoa, neste Cofre. O servidor já devolve `categorias` nessa ordem.
  const ordem = useOrdemPessoal(categorias, async (ids) => { await vault.preferencias.salvarOrdem("ordem_categorias", ids); atualizar(); }, () => avisar("Não foi possível guardar a nova ordem das categorias."));

  useEffect(() => {
    let vivo = true;
    setLancamentos(null);
    setErro(null);
    const ant = periodoAnterior(range.from, range.to);
    Promise.all([listarPeriodo(range.from, range.to), listarPeriodo(ant.de, ant.ate), financeiro.recorrencias().catch(() => [] as Recorrencia[])])
      .then(([atual, prev, recs]) => { if (vivo) { setLancamentos(atual); setAnteriores(prev); setRecorrencias(recs); } })
      .catch((e) => { if (vivo) setErro(e instanceof ApiError ? e.message : "Não foi possível carregar o movimento das categorias."); });
    return () => { vivo = false; };
  }, [range.from, range.to, tentativa]);

  // Tendência: volume mensal dos últimos meses, carregado à parte para não atrasar a tela.
  useEffect(() => {
    let vivo = true;
    setSerie(null);
    listarPeriodo(`${meses[0]}-01`, range.to).then((t) => { if (vivo) setSerie(serieMensal(t, meses)); }).catch(() => { if (vivo) setSerie(new Map()); });
    return () => { vivo = false; };
  }, [meses, range.to, tentativa]);

  const porId = useMemo(() => new Map(categorias.map((c) => [c.id, c])), [categorias]);
  const usos = useMemo(() => usoPorCategoria(lancamentos ?? []), [lancamentos]);
  const volumeTotal = useMemo(() => [...usos.values()].reduce((s, u) => s + u.volume, 0), [usos]);
  const despesas = useMemo(() => (lancamentos ?? []).filter((t) => t.tipo === "saida"), [lancamentos]);
  const despesasAnteriores = useMemo(() => anteriores.filter((t) => t.tipo === "saida"), [anteriores]);
  const totalArquivadas = categorias.filter((c) => c.arquivada).length;

  const filtrando = busca.trim() !== "" || filtroTipo !== "todas";
  const familias = useMemo<Familia[]>(() => montarFamilias(ordem.ordenados, usos, prefs.criterio, { busca, tipo: filtroTipo, arquivadas: prefs.arquivadas }), [ordem.ordenados, usos, prefs.criterio, busca, filtroTipo, prefs.arquivadas]);
  const ordenavel = prefs.criterio === "manual" && !filtrando;
  const totalSubs = categorias.filter((c) => c.pai_id && porId.has(c.pai_id)).length;
  const totalLancamentos = (lancamentos ?? []).filter((t) => t.categoria_id).length;
  const duplicatas = useMemo(() => acharDuplicatas(categorias, usos, dispensadas), [categorias, usos, dispensadas]);

  // Visível = o que as vistas mostram agora (para "selecionar tudo").
  const visiveis = useMemo(() => familias.flatMap((f) => [f.mae, ...(prefs.mostrarSubs ? f.filhas : [])]), [familias, prefs.mostrarSubs]);
  const selecionadas = useMemo(() => categorias.filter((c) => marcadas.has(c.id)), [categorias, marcadas]);
  // Categorias que sumiram (apagadas, mescladas) saem da seleção.
  useEffect(() => { setMarcadas((s) => { const n = new Set([...s].filter((id) => porId.has(id))); return n.size === s.size ? s : n; }); }, [porId]);
  const detalhe = detalheId ? porId.get(detalheId) ?? null : null;

  async function salvar(c: CategoriaApi, campos: CamposEditaveis & { arquivada?: boolean }, silencioso = false): Promise<boolean> {
    try {
      // Sob uma mãe só de despesa (ou só de receita) a subcategoria adota o tipo dela.
      const mae = campos.pai_id ? porId.get(campos.pai_id) : undefined;
      const tipo = campos.tipo ?? (mae ? tipoAoMudarDeMae(c.tipo, mae) : c.tipo);
      if (!silencioso && mae && tipo !== c.tipo && !campos.tipo) avisar(`“${c.nome}” passou a ser ${tipo === "saida" ? "despesa" : "receita"}, como “${mae.nome}”.`);
      await vault.categorias.atualizar(c.id, { nome: c.nome, icone: c.icone, cor: c.cor, pai_id: c.pai_id ?? null, ...campos, tipo });
      atualizar();
      return true;
    } catch (e) {
      avisar(e instanceof ApiError ? e.message : "Não foi possível salvar a categoria.", "erro");
      return false;
    }
  }

  async function arquivar(cats: CategoriaApi[], arquivada: boolean) {
    let ok = 0;
    for (const c of cats) { if (await salvar(c, { arquivada }, true)) ok++; }
    if (ok === 0) return;
    setMarcadas(new Set());
    avisar(ok === 1 ? `“${cats[0]!.nome}” ${arquivada ? "arquivada" : "desarquivada"}.` : `${ok} categorias ${arquivada ? "arquivadas" : "desarquivadas"}.`, "sucesso",
      { rotulo: "Desfazer", aoClicar: () => { void (async () => { for (const c of cats) await vault.categorias.atualizar(c.id, { nome: c.nome, tipo: c.tipo, icone: c.icone, cor: c.cor, pai_id: c.pai_id ?? null, arquivada: !arquivada }).catch(() => {}); atualizar(); })(); } });
  }

  async function moverEmLote(paiId: string | null) {
    let ok = 0;
    for (const c of selecionadas) { if (c.id !== paiId && (c.pai_id ?? null) !== paiId && await salvar(c, { pai_id: paiId }, true)) ok++; }
    if (ok > 0) { setMarcadas(new Set()); avisar(paiId ? `${ok} ${ok === 1 ? "categoria virou subcategoria" : "categorias viraram subcategorias"} de “${porId.get(paiId)?.nome}”.` : `${ok} ${ok === 1 ? "categoria virou principal" : "categorias viraram principais"}.`, "sucesso"); }
  }
  async function tipoEmLote(tipo: CategoriaApi["tipo"]) {
    let ok = 0;
    for (const c of selecionadas) { if (c.tipo !== tipo && await salvar(c, { tipo }, true)) ok++; }
    if (ok > 0) { setMarcadas(new Set()); avisar(`${ok} ${ok === 1 ? "categoria agora é" : "categorias agora são"} ${tipo === "saida" ? "despesa" : tipo === "entrada" ? "receita" : "ambas"}.`, "sucesso"); }
  }

  const alternarMarca = useCallback((id: string) => setMarcadas((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; }), []);

  const visaoAtual: Visao = { vista: prefs.vista, criterio: prefs.criterio, mostrarSubs: prefs.mostrarSubs, kanban: prefs.kanban, tipo: filtroTipo, arquivadas: prefs.arquivadas, busca };
  function aplicarVisao(v: Visao) {
    setPrefs({ vista: v.vista, criterio: v.criterio, mostrarSubs: v.mostrarSubs, kanban: v.kanban, arquivadas: v.arquivadas });
    setFiltroTipo(v.tipo);
    setBusca(v.busca);
  }

  const algumPainel = !!(editando || detalheId || mesclar || duplicatasAberto || importar || ajuda);
  useAtalhos({
    "/": () => campoBusca.current?.focus(),
    n: () => setEditando({}),
    "1": () => setPrefs({ vista: "grade" }), "2": () => setPrefs({ vista: "lista" }), "3": () => setPrefs({ vista: "tabela" }),
    "4": () => setPrefs({ vista: "kanban" }), "5": () => setPrefs({ vista: "mapa" }), "6": () => setPrefs({ vista: "nuvem" }),
    s: () => setPrefs({ mostrarSubs: !prefs.mostrarSubs }),
    a: () => setPrefs({ arquivadas: !prefs.arquivadas }),
    d: () => setDuplicatasAberto(true),
    i: () => setImportar("modelos"),
    "ctrl+a": () => setMarcadas(new Set(visiveis.map((c) => c.id))),
    escape: () => setMarcadas(new Set()),
    "?": () => setAjuda(true),
  }, !algumPainel && categorias.length > 0);

  /** Só irmãos trocam de lugar entre si: principal com principal, subcategoria com subcategoria da mesma mãe. */
  const linhaDeIrmaos = (id: string, eixo: "x" | "y" = "y") => {
    const base = ordem.linha(id, eixo);
    if (!ordem.arrastando) return base;
    if ((porId.get(ordem.arrastando)?.pai_id ?? null) === (porId.get(id)?.pai_id ?? null)) return base;
    const { onDragOver: _o, onDrop: _d, ...resto } = base as Record<string, unknown>;
    return resto;
  };

  const contexto: ContextoVista = {
    familias, usos, porId, todas: categorias, volumeTotal, mostrarSubs: prefs.mostrarSubs,
    abrir: (c) => setDetalheId(c.id),
    editar: (c) => setEditando({ categoria: c }),
    novaSub: (mae) => setEditando({ pai: mae.id }),
    selecao: { marcadas, alternar: alternarMarca, definir: (ids) => setMarcadas(new Set(ids)), ativa: marcadas.size > 0 },
    tendencia: serie, meses,
    ordenavel,
    ordem: { linha: linhaDeIrmaos, alca: ordem.alca },
    salvar,
  };

  function dispensar(g: GrupoDuplicado) {
    const n = new Set(dispensadas).add(g.chave);
    setDispensadas(n);
    try { localStorage.setItem(CHAVE_DISPENSADAS, JSON.stringify([...n])); } catch { /* vale só nesta sessão */ }
  }

  const carregando = lancamentos === null && !erro;

  return (
    <section className="cofre-cats" data-carregando={carregando || undefined}>
      <div className="cofre-cats-top cofre-rise" style={estiloI(0)}>
        <div>
          <h1>Categorias</h1>
          <p className="cofre-cats-sub">Organize, reordene e acompanhe o movimento de cada categoria {periodNoun(period)}.</p>
        </div>
        <div className="cofre-cats-actions">
          <PeriodPicker value={period} onChange={onPeriodChange} />
          <button type="button" className="cofre-secondary" onClick={() => setImportar("modelos")} title="Modelos prontos, importar e exportar (I)"><LayoutTemplate size={14} />Estrutura</button>
          <button type="button" className="cofre-new-button" onClick={() => setEditando({})}><Plus size={14} />Nova categoria</button>
        </div>
      </div>

      {categorias.length === 0 ? (
        <div className="cofre-card cofre-cats-empty">
          <Tag size={30} />
          <p>Nenhuma categoria cadastrada</p>
          <small>Comece por um modelo pronto, importe um arquivo ou crie a primeira.</small>
          <div className="cofre-cats-empty-acoes">
            <button type="button" className="cofre-solid" onClick={() => setImportar("modelos")}><LayoutTemplate size={14} />Usar um modelo</button>
            <button type="button" className="cofre-secondary" onClick={() => setEditando({})}>Nova categoria</button>
          </div>
        </div>
      ) : (
        <div className="cofre-cats-navegacao">
          {erro && (
            <div role="alert" className="cofre-card cofre-cats-erro">
              <CloudOff size={18} />
              <p>{erro}</p>
              <button type="button" className="cofre-secondary" onClick={() => setTentativa((n) => n + 1)}><RefreshCw size={13} />Tentar novamente</button>
            </div>
          )}

          <dl className="cofre-cats-resumo cofre-rise" style={estiloI(1)} aria-busy={carregando}>
            <div><dt>Categorias</dt><dd className="cofre-mono">{categorias.length - totalSubs}</dd></div>
            <div><dt>Subcategorias</dt><dd className="cofre-mono">{totalSubs}</dd></div>
            <div><dt>Lançamentos categorizados</dt><dd className="cofre-mono">{totalLancamentos}</dd></div>
            <div><dt>Volume movimentado</dt><dd className="cofre-mono">{formatMoeda(volumeTotal)}</dd></div>
          </dl>

          <div className="cofre-cats-barra cofre-rise" style={estiloI(2)}>
            <label className="cofre-cats-search"><Search size={14} /><input ref={campoBusca} value={busca} onChange={(e) => setBusca(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") { e.currentTarget.blur(); } }} placeholder="Buscar categoria ou subcategoria…  ( / )" aria-label="Buscar categoria" />{busca && <button type="button" aria-label="Limpar busca" onClick={() => setBusca("")}><X size={12} /></button>}</label>
            <div className="cofre-cats-chips" role="group" aria-label="Filtrar por tipo">
              {(["todas", "saida", "entrada", "ambos"] as const).map((t) => (
                <button key={t} type="button" aria-pressed={filtroTipo === t} onClick={() => setFiltroTipo(t)}>{t === "todas" ? "Todas" : t === "saida" ? "Despesa" : t === "entrada" ? "Receita" : "Ambas"}</button>
              ))}
            </div>
            <div className="cofre-cats-ordenar" title="Ordem manual permite arrastar. Mais usadas e Maior volume se reorganizam sozinhas conforme o movimento do período.">
              <span>Ordenar</span>
              <SeletorEcos ariaLabel="Ordenar categorias" classe="cofre-tb-seletor" valor={prefs.criterio} onChange={(c) => setPrefs({ criterio: c })} opcoes={(Object.keys(ROTULO_CRITERIO) as Criterio[]).map((c) => ({ valor: c, rotulo: ROTULO_CRITERIO[c] }))} />
            </div>
            {totalSubs > 0 || prefs.vista === "tabela" || prefs.vista === "mapa" ? (
              <button type="button" className="cofre-cats-interruptor" aria-pressed={prefs.mostrarSubs} onClick={() => setPrefs({ mostrarSubs: !prefs.mostrarSubs })} title="Mostrar as subcategorias dentro de cada categoria (S)">
                <i aria-hidden /><span>Subcategorias</span>
              </button>
            ) : null}
            {totalArquivadas > 0 && (
              <button type="button" className="cofre-cats-interruptor" aria-pressed={prefs.arquivadas} onClick={() => setPrefs({ arquivadas: !prefs.arquivadas })} title="Mostrar as categorias arquivadas (A)">
                <Archive size={13} /><span>Arquivadas ({totalArquivadas})</span>
              </button>
            )}
            {duplicatas.length > 0 && (
              <button type="button" className="cofre-cats-interruptor cofre-cats-alerta" onClick={() => setDuplicatasAberto(true)} title="Categorias com nomes parecidos (D)">
                <CopyCheck size={13} /><span>Parecidas ({duplicatas.length})</span>
              </button>
            )}
            <VisoesSalvas atual={visaoAtual} aoAplicar={aplicarVisao} />
            <div className="cofre-cats-vistas" role="group" aria-label="Forma de visualização">
              {VISTAS.map((x, i) => {
                const Icone = ICONE_VISTA[x.id];
                return <button key={x.id} type="button" aria-pressed={prefs.vista === x.id} title={`${x.rotulo} (${i + 1})`} aria-label={x.rotulo} onClick={() => setPrefs({ vista: x.id })}><Icone size={15} /><span>{x.rotulo}</span></button>;
              })}
            </div>
            <button type="button" className="cofre-cats-iconbtn cofre-cats-ajuda" aria-label="Atalhos de teclado" title="Atalhos de teclado (?)" onClick={() => setAjuda(true)}><Keyboard size={15} /></button>
          </div>

          {!ordenavel && prefs.criterio === "manual" && filtrando && <p className="cofre-cats-dica">Limpe a busca e o filtro para reordenar arrastando.</p>}
          {prefs.criterio !== "manual" && <p className="cofre-cats-dica">Ordenando por “{ROTULO_CRITERIO[prefs.criterio]}”. Escolha “Ordem manual” para arrastar e reorganizar.</p>}

          <div className="cofre-cats-vista" key={prefs.vista}>
            {prefs.vista === "grade" && <VistaGrade v={contexto} />}
            {prefs.vista === "lista" && <VistaLista v={contexto} />}
            {prefs.vista === "tabela" && <VistaTabela v={contexto} />}
            {prefs.vista === "kanban" && <VistaKanban v={contexto} agrupar={prefs.kanban} aoAgrupar={(kanban) => setPrefs({ kanban })} />}
            {prefs.vista === "mapa" && <VistaMapa v={contexto} />}
            {prefs.vista === "nuvem" && <VistaNuvem v={contexto} />}
          </div>

          <button type="button" className="cofre-cats-descer" onClick={() => analise.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" })}>
            <ArrowDown size={14} />Análise de gastos e gráficos
          </button>
        </div>
      )}

      <div ref={analise} className="cofre-cats-analise-ancora">
        {carregando && categorias.length > 0 && (
          <div className="cofre-cats-skeleton" role="status" aria-label="Carregando análise">
            {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} style={estiloI(i)} />)}
          </div>
        )}
        {!carregando && !erro && categorias.length > 0 && (
          <AnaliseCategorias despesas={despesas} anteriores={despesasAnteriores} recorrencias={recorrencias} categorias={categorias} period={period} intervalo={range}
            agrupar={prefs.graficosEmBloco} aoAgrupar={(graficosEmBloco) => setPrefs({ graficosEmBloco })} />
        )}
      </div>

      <BarraLote selecionadas={selecionadas} todas={categorias} aoMover={(p) => void moverEmLote(p)} aoTipo={(t) => void tipoEmLote(t)} aoArquivar={(a) => void arquivar(selecionadas, a)} aoMesclar={() => setMesclar({ grupo: selecionadas })} aoLimpar={() => setMarcadas(new Set())} />

      {detalhe && (
        <DetalheCategoria categoria={detalhe} v={contexto} lancamentos={lancamentos ?? []} recorrencias={recorrencias as never} aoFechar={() => setDetalheId(null)}
          aoEditar={() => setEditando({ categoria: detalhe })} aoNovaSub={() => setEditando({ pai: detalhe.id })}
          aoMesclar={() => setMesclar({ grupo: [detalhe] })} aoArquivar={() => void arquivar([detalhe], !detalhe.arquivada)}
          aoVerLancamentos={(comSubs) => aoVerLancamentos?.(detalhe.id, comSubs)} />
      )}

      {editando && createPortal(
        <CategoriaModal
          categoria={editando.categoria}
          paiInicial={editando.pai}
          categorias={categorias}
          onClose={() => setEditando(null)}
          onSaved={() => { setEditando(null); atualizar(); setTentativa((n) => n + 1); }}
        />,
        document.querySelector(".cofre-app") ?? document.body,
      )}
      {mesclar && createPortal(
        <MesclarModal grupo={mesclar.grupo} categorias={categorias} destinoInicial={mesclar.destino} onClose={() => setMesclar(null)}
          onFeito={(n) => { setMesclar(null); setMarcadas(new Set()); atualizar(); setTentativa((x) => x + 1); avisar(n === 1 ? "Categorias mescladas." : `${n} categorias mescladas.`, "sucesso"); }} />,
        document.querySelector(".cofre-app") ?? document.body,
      )}
      {duplicatasAberto && createPortal(
        <DuplicatasModal grupos={duplicatas} porId={porId} usos={usos} onClose={() => setDuplicatasAberto(false)} onDispensar={dispensar}
          onMesclar={(g) => { setDuplicatasAberto(false); setMesclar({ grupo: g.membros, destino: g.principal.id }); }} />,
        document.querySelector(".cofre-app") ?? document.body,
      )}
      {importar && createPortal(
        <ImportarModal categorias={categorias} abaInicial={importar} onClose={() => setImportar(null)}
          onFeito={(n) => { setImportar(null); atualizar(); avisar(`${n} ${n === 1 ? "categoria criada" : "categorias criadas"}.`, "sucesso"); }} />,
        document.querySelector(".cofre-app") ?? document.body,
      )}
      {ajuda && createPortal(<AtalhosAjuda onClose={() => setAjuda(false)} />, document.querySelector(".cofre-app") ?? document.body)}
    </section>
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

/** `paiInicial`: abre a criação já como subcategoria dessa categoria. */
export function CategoriaModal({ categoria, categorias, paiInicial, onClose, onSaved }: { categoria?: CategoriaApi; categorias: CategoriaApi[]; paiInicial?: string; onClose: () => void; onSaved: () => void }) {
  const maeInicial = categoria ? undefined : categorias.find((c) => c.id === paiInicial && !c.pai_id);
  const [nome, setNome] = useState(categoria?.nome ?? "");
  const [tipo, setTipo] = useState<CategoriaApi["tipo"]>(categoria?.tipo ?? (maeInicial && maeInicial.tipo !== "ambos" ? maeInicial.tipo : "saida"));
  const [paiId, setPaiId] = useState(categoria?.pai_id ?? maeInicial?.id ?? "");
  const [icone, setIcone] = useState(categoria?.icone ?? "Tag");
  const [cor, setCor] = useState(categoria?.cor ?? maeInicial?.cor ?? CORES[0]!);
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

  const filhas = categoria ? categorias.filter((c) => c.pai_id === categoria.id) : [];
  const maes = maesPossiveis(categorias, { id: categoria?.id, tipo });

  /** Escolher a mãe acompanha o tipo dela (quando ela é só de despesa ou só de receita). */
  function escolherMae(id: string) {
    setPaiId(id);
    const mae = categorias.find((c) => c.id === id);
    if (mae && mae.tipo !== "ambos") setTipo(mae.tipo);
  }
  /** Mudar o tipo solta a mãe se ela deixou de caber. */
  function mudarTipo(t: CategoriaApi["tipo"]) {
    setTipo(t);
    const mae = categorias.find((c) => c.id === paiId);
    if (mae && !tipoCabeNaMae(t, mae)) setPaiId("");
  }

  function fechar() {
    setSaindo(true);
    window.setTimeout(onClose, 160);
  }

  async function salvar() {
    if (!nome.trim()) { setErro("Informe um nome para a categoria."); return; }
    setOcupado(true);
    setErro(null);
    try {
      if (categoria) await vault.categorias.atualizar(categoria.id, { nome: nome.trim(), tipo, icone, cor, pai_id: paiId || null });
      else await vault.categorias.criar({ nome: nome.trim(), tipo, icone, cor, pai_id: paiId || null });
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
      <form className="cofre-card cofre-cats-dialog cofre-categoria-dialog" role="dialog" aria-modal="true" aria-label={categoria ? "Editar categoria" : paiId ? "Nova subcategoria" : "Nova categoria"} onSubmit={(e) => { e.preventDefault(); void salvar(); }}>
        <header>
          <span className="cofre-cats-icon lg" style={{ background: cor, color: corDoTexto(cor) }}><Previa size={18} /></span>
          <div><p>{categoria ? (categoria.pai_id ? "EDITAR SUBCATEGORIA" : "EDITAR CATEGORIA") : paiId ? "NOVA SUBCATEGORIA" : "NOVA CATEGORIA"}</p><h2>{nome.trim() || "Sem nome"}</h2></div>
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
          <SegmentedSlide className="cofre-launch-slide" ariaLabel="Tipo da categoria" tamanho="lg" value={tipo} onChange={mudarTipo} opcoes={[{ value: "saida", label: "Despesa", cor: "ecos-error" }, { value: "entrada", label: "Receita", cor: "ecos-success" }, { value: "ambos", label: "Ambas", cor: "cofre-blue" }]} />
        </div>

        <div className="cofre-cats-field">
          <span>Categoria-mãe</span>
          {filhas.length > 0 ? (
            <p className="cofre-cats-nota">Esta categoria tem {filhas.length} {filhas.length === 1 ? "subcategoria" : "subcategorias"} ({filhas.map((f) => f.nome).join(", ")}). Subcategorias não têm subcategorias, então ela fica como categoria principal.</p>
          ) : (
            <SeletorEcos ariaLabel="Categoria-mãe" buscar={maes.length > 8} classe="min-h-[40px] max-w-full rounded-[11px] border border-[var(--border)] bg-[var(--panel)] px-2.5 text-[13px] text-[var(--text)]" valor={paiId} onChange={escolherMae}
              opcoes={[{ valor: "", rotulo: "Nenhuma — categoria principal" }, ...maes.map((m) => ({ valor: m.id, rotulo: m.nome, visual: <CategoriaIcone categoria={m} tamanho={12} className="cofre-cats-icon sm" /> }))]} />
          )}
        </div>

        <div className="cofre-cats-field">
          <span>Cor</span>
          <SeletorCor valor={cor} onChange={setCor} />
        </div>
          </div>
        </div>

        {confirmando && categoria && (
          <div className="cofre-launch-alert" role="alert">
            <p>Apagar “{categoria.nome}”? Nenhum lançamento usa esta categoria.{filhas.length > 0 && <> As {filhas.length} {filhas.length === 1 ? "subcategoria vira" : "subcategorias viram"} categoria{filhas.length === 1 ? "" : "s"} principal{filhas.length === 1 ? "" : "is"}.</>} Essa ação não pode ser desfeita.</p>
            <div><button type="button" onClick={() => setConfirmando(false)}>Cancelar</button><button type="button" disabled={ocupado} onClick={() => void excluir()}>{ocupado ? "Apagando…" : "Apagar"}</button></div>
          </div>
        )}

        {uso && categoria && (
          <section className="cofre-launch-alert cofre-cats-uso" role="alert" aria-label={`Apagar ${categoria.nome}`}>
            <p>
              “{categoria.nome}” é usada por <b>{uso.transacoes} {uso.transacoes === 1 ? "lançamento" : "lançamentos"}</b>
              {uso.recorrencias > 0 && <>, <b>{uso.recorrencias} {uso.recorrencias === 1 ? "recorrência" : "recorrências"}</b></>}
              {uso.pendencias > 0 && <>, <b>{uso.pendencias} {uso.pendencias === 1 ? "pendência" : "pendências"}</b></>}.
              Escolha para onde eles vão antes de apagar.{filhas.length > 0 && <> As {filhas.length} {filhas.length === 1 ? "subcategoria vira" : "subcategorias viram"} categoria{filhas.length === 1 ? "" : "s"} principal{filhas.length === 1 ? "" : "is"}.</>}
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
              <SeletorEcos ariaLabel="Mover tudo para" classe="min-h-[40px] max-w-full rounded-[11px] border border-[var(--border)] bg-[var(--panel)] px-2.5 text-[13px] text-[var(--text)]" valor={destino} onChange={setDestino} opcoes={[{ valor: "", rotulo: "Sem categoria" }, ...categorias.filter((c) => compativel(c, uso)).map((c) => ({ valor: c.id, rotulo: c.nome, visual: <CategoriaIcone categoria={c} tamanho={12} className="cofre-cats-icon sm" /> }))]} />
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
