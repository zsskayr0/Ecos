import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { ArrowDown, ArrowUp, Check, Columns3, Grid2X2, List, Plus, RefreshCw, Search, Table2, Trash2, X } from "lucide-react";
import { financeiro, vault, type CategoriaApi, type TransacaoApi } from "@/lib/api";
import { formatMoeda } from "@/lib/format";
import { casaBusca } from "@/lib/texto-busca";
import { useAppUI } from "@/lib/ui-context";
import { useAutoriaDoCofre } from "@/lib/use-autoria-cofre";
import type { Periodo } from "./types";
import type { Filtro } from "./VaultDashboard";
import { PeriodPicker } from "./nexus/PeriodPicker";
import type { Period } from "./nexus/period";
import { BotaoAnexos } from "./comprovantes/BotaoAnexos";
import { CategoriaIcone } from "./VaultCategories";
import { CaixaEcos } from "./CaixaEcos";
import { AvatarAutor } from "./AvatarAutor";

type Visualizacao = "lista" | "tabela";
type Tipo = "todos" | "entrada" | "saida";
type Status = "todos" | "efetivada" | "pendente";
type Ordem = "data" | "descricao" | "pagador" | "categoria" | "pagamento" | "valor";
type Gesto = Pick<MouseEvent | KeyboardEvent, "shiftKey" | "ctrlKey" | "metaKey">;

const PAGAMENTOS: Record<string, string> = { pix: "Pix", pix_automatico: "Pix automático", ted: "Transferência", cartao: "Cartão", dinheiro: "Dinheiro", boleto: "Boleto", outro: "Outro" };
const LIMITE_SELECAO = 1000;
/** Segurar o dedo numa linha por este tempo (toque) começa a seleção: no celular não há "passar o mouse". */
const TEMPO_TOQUE_LONGO_MS = 450;
/** Aba escondida (o desktop mantém as inativas montadas com `hidden`) ou sem exibição: o atalho de teclado não é dela. */
function estaVisivel(el: HTMLElement): boolean {
  if (el.closest("[hidden]")) return false;
  return typeof el.checkVisibility === "function" ? el.checkVisibility() : true;
}
const dataBr = (iso: string) => iso.split("-").reverse().join("/");

interface Contexto {
  categorias: Map<string, CategoriaApi>;
  pagadores: Map<string, string>;
  /** Nome de quem lançou; `undefined` fora de Cofre de equipe com mais de uma pessoa. */
  autor?: (id?: string | null) => string | undefined;
  selecionando: boolean;
  selecionados: Set<string>;
  /** Linhas achadas só pelo texto lido do comprovante (e que a busca simples não acharia). */
  viaComprovante: Set<string>;
  clicar: (t: TransacaoApi, e: MouseEvent) => void;
  alternar: (id: string, gesto?: Gesto) => void;
  aoAnexar: () => void;
}

export function VaultTransactions({ recarregar, periodo, period, onPeriodChange, filtro, categorias, abrir, atualizar }: {
  recarregar: number;
  periodo: Periodo;
  period: Period;
  onPeriodChange: (p: Period) => void;
  filtro: Filtro;
  categorias: CategoriaApi[];
  abrir: (id: string) => void;
  atualizar: () => void;
}) {
  const { abrirCaptura } = useAppUI();
  const autoria = useAutoriaDoCofre();
  const secao = useRef<HTMLElement>(null);
  const [rows, setRows] = useState<TransacaoApi[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [selecionados, setSelecionados] = useState<string[]>([]);
  const [erro, setErro] = useState("");
  const [feedback, setFeedback] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [versao, setVersao] = useState(0);
  const [pagadores, setPagadores] = useState<Map<string, string>>(new Map());
  const [consulta, setConsulta] = useState("");
  const [achados, setAchados] = useState<{ q: string; ids: Map<string, boolean> } | null>(null);
  const [tipo, setTipo] = useState<Tipo>(filtro.tipo ?? "todos");
  const [status, setStatus] = useState<Status>("todos");
  const [view, setView] = useState<Visualizacao>("lista");
  const [ordem, setOrdem] = useState<{ chave: Ordem; dir: 1 | -1 }>({ chave: "data", dir: -1 });
  const ancora = useRef<string | null>(null);
  const categoriasPorId = useMemo(() => new Map(categorias.map((c) => [c.id, c])), [categorias]);
  const params = { ...periodo, tipo: filtro.tipo, limit: 100, ...(filtro.categoria === null ? { sem_categoria: true } : filtro.categoria ? { categoria_id: filtro.categoria } : {}), ...(filtro.pagamento === null ? { sem_pagamento: true } : filtro.pagamento ? { forma_pagamento: filtro.pagamento } : {}), ...(filtro.data_de ? { data_de: filtro.data_de } : {}), ...(filtro.data_ate ? { data_ate: filtro.data_ate } : {}) };
  const chave = JSON.stringify(params);

  // Carga da lista. Trocar período/filtro esvazia e mostra "Carregando"; já recarregar depois de concluir, anexar ou
  // editar algo troca os dados no lugar, SEM esvaziar a lista: senão a página encolhe por um instante e a rolagem
  // volta para o topo. Na recarga, busca tantas páginas quantas já estavam na tela.
  const chaveAnterior = useRef<string | null>(null);
  const tamanhoAtual = useRef(0);
  tamanhoAtual.current = rows.length;
  useEffect(() => {
    let vivo = true;
    const mudouFiltro = chaveAnterior.current !== chave;
    chaveAnterior.current = chave;
    if (mudouFiltro) { setCarregando(true); setRows([]); setSelecionados([]); setCursor(null); ancora.current = null; }
    setErro("");
    const queroAo = mudouFiltro ? 0 : tamanhoAtual.current;
    (async () => {
      try {
        let itens: TransacaoApi[] = [];
        let proximo: string | null = null;
        for (let pagina = 0; pagina < 20; pagina++) {
          const r = await vault.transacoes.listar({ ...JSON.parse(chave), ...(proximo ? { cursor: proximo } : {}) });
          itens = [...itens, ...r.items];
          proximo = r.next_cursor;
          if (!proximo || itens.length >= queroAo) break;
        }
        if (!vivo) return;
        setRows(itens);
        setCursor(proximo);
        const ids = new Set(itens.map((t) => t.id));
        setSelecionados((s) => (mudouFiltro ? [] : s.filter((id) => ids.has(id))));
      } catch (e) {
        if (vivo) setErro((e as Error).message);
      } finally {
        if (vivo) setCarregando(false);
      }
    })();
    return () => { vivo = false; };
  }, [chave, versao, recarregar]);

  // Quem pagou/recebeu: o nome vem do cadastro de pagadores.
  useEffect(() => {
    let vivo = true;
    vault.beneficiarios.listar().then((lista) => { if (vivo) setPagadores(new Map(lista.map((b) => [b.id, b.nome]))); }).catch(() => undefined);
    return () => { vivo = false; };
  }, [recarregar, versao]);

  // Pesquisa tolerante feita pelo Cofre (erro de digitação, texto lido dos comprovantes). O filtro simples abaixo
  // responde na hora; este soma os resultados que ele não acharia, um instante depois.
  const q = consulta.trim();
  useEffect(() => {
    if (!q) { setAchados(null); return; }
    let vivo = true;
    const espera = window.setTimeout(() => {
      vault.busca(q, { data_de: periodo.data_de, data_ate: periodo.data_ate })
        .then((r) => { if (vivo) setAchados({ q, ids: new Map(r.items.map((i) => [i.id, i.so_no_anexo])) }); })
        .catch(() => { if (vivo) setAchados({ q, ids: new Map() }); });
    }, 250);
    return () => { vivo = false; window.clearTimeout(espera); };
  }, [q, periodo.data_de, periodo.data_ate, recarregar, versao]);
  const buscando = !!q && achados?.q !== q;

  const textoDe = (t: TransacaoApi) => {
    const centavos = t.valor_centavos;
    return [t.descricao, t.observacoes, categoriasPorId.get(t.categoria_id ?? "")?.nome, pagadores.get(t.beneficiario_id ?? ""), PAGAMENTOS[t.forma_pagamento ?? ""],
      `${Math.floor(centavos / 100)},${String(centavos % 100).padStart(2, "0")}`, t.data, dataBr(t.data)].join(" ");
  };

  const { exibidas, viaComprovante } = useMemo(() => {
    const collator = new Intl.Collator("pt-BR");
    const via = new Set<string>();
    let lista = rows.filter((t) => (tipo === "todos" || t.tipo === tipo) && (status === "todos" || t.status === status));
    if (q) {
      const ids = achados?.q === q ? achados.ids : null;
      lista = lista.filter((t) => {
        if (casaBusca(q, textoDe(t))) return true;
        if (!ids?.has(t.id)) return false;
        if (ids.get(t.id)) via.add(t.id);
        return true;
      });
    }
    const texto = (t: TransacaoApi) => ordem.chave === "categoria" ? categoriasPorId.get(t.categoria_id ?? "")?.nome ?? ""
      : ordem.chave === "pagador" ? pagadores.get(t.beneficiario_id ?? "") ?? ""
      : ordem.chave === "pagamento" ? PAGAMENTOS[t.forma_pagamento ?? ""] ?? ""
      : ordem.chave === "descricao" ? t.descricao : t.data;
    const ordenadas = [...lista].sort((a, b) => ordem.dir * (ordem.chave === "valor" ? a.valor_centavos - b.valor_centavos : collator.compare(texto(a), texto(b))));
    return { exibidas: ordenadas, viaComprovante: via };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, tipo, status, q, achados, ordem, categoriasPorId, pagadores]);

  const idsVisiveis = useMemo(() => exibidas.map((t) => t.id), [exibidas]);
  const marcados = useMemo(() => new Set(selecionados), [selecionados]);

  async function mais() {
    if (!cursor) return;
    setOcupado(true);
    try {
      const r = await vault.transacoes.listar({ ...params, cursor });
      setRows((old) => [...old, ...r.items]);
      setCursor(r.next_cursor);
    } catch (e) { setErro((e as Error).message); } finally { setOcupado(false); }
  }

  async function lote(acao: "conciliar" | "desconciliar" | "excluir") {
    if (acao === "excluir" && !window.confirm(`Excluir ${selecionados.length} lançamentos?`)) return;
    setOcupado(true);
    setErro("");
    setFeedback("");
    try {
      const r = await financeiro.lote(selecionados, acao);
      if (r.erros.length) setErro(r.erros.map((e) => `Linha ${e.linha}: ${e.erro}`).join("; "));
      else setFeedback(`${r.aplicadas} operações aplicadas.`);
      sairDaSelecao();
      setVersao((v) => v + 1);
      atualizar();
    } catch (e) { setErro((e as Error).message); } finally { setOcupado(false); }
  }

  const saldoSelecionado = useMemo(() => rows.reduce((s, t) => marcados.has(t.id) ? s + (t.tipo === "entrada" ? t.valor_centavos : -t.valor_centavos) : s, 0), [rows, marcados]);
  const aoAnexar = () => { setVersao((v) => v + 1); atualizar(); };

  function sairDaSelecao() { setSelecionados([]); ancora.current = null; }

  /** Marca/desmarca uma linha. Com Shift, seleciona a faixa entre a última marcada e esta (Ctrl+Shift soma à seleção). */
  function alternar(id: string, gesto?: Gesto) {
    const de = ancora.current ? idsVisiveis.indexOf(ancora.current) : -1;
    if (gesto?.shiftKey && de >= 0) {
      const ate = idsVisiveis.indexOf(id);
      const faixa = idsVisiveis.slice(Math.min(de, ate), Math.max(de, ate) + 1);
      setSelecionados((s) => [...new Set(gesto.ctrlKey || gesto.metaKey ? [...s, ...faixa] : faixa)].slice(0, LIMITE_SELECAO));
      return;
    }
    ancora.current = id;
    setSelecionados((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id].slice(0, LIMITE_SELECAO));
  }

  /** Clique na linha: abre o lançamento, a menos que a pessoa esteja selecionando (modo seleção, Ctrl ou Shift). */
  function clicar(t: TransacaoApi, e: MouseEvent) {
    if (e.shiftKey || e.ctrlKey || e.metaKey || selecionados.length > 0) {
      e.preventDefault();
      window.getSelection()?.removeAllRanges();
      alternar(t.id, e);
      return;
    }
    abrir(t.id);
  }

  // Ctrl+A seleciona tudo o que está na lista; Esc sai da seleção. Ignora quando a pessoa digita, quando há uma janela
  // aberta por cima e quando o Cofre não está à vista (o desktop mantém abas escondidas montadas).
  useEffect(() => {
    const aoTeclar = (e: globalThis.KeyboardEvent) => {
      if (e.defaultPrevented || document.querySelector('[aria-modal="true"]')) return;
      if (!secao.current || !estaVisivel(secao.current)) return;
      const alvo = e.target as HTMLElement | null;
      const digitando = !!alvo && (alvo.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(alvo.tagName));
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
        if (digitando || idsVisiveis.length === 0) return;
        e.preventDefault();
        setSelecionados(idsVisiveis.slice(0, LIMITE_SELECAO));
      } else if (e.key === "Escape" && selecionados.length > 0) {
        e.preventDefault();
        sairDaSelecao();
      }
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [idsVisiveis, selecionados.length]);

  const ordenar = (chaveOrdem: Ordem) => setOrdem((o) => o.chave === chaveOrdem ? { chave: chaveOrdem, dir: o.dir === 1 ? -1 : 1 } : { chave: chaveOrdem, dir: 1 });
  const contexto: Contexto = {
    categorias: categoriasPorId, pagadores, autor: autoria.ativo ? autoria.nomeDe : undefined,
    selecionando: selecionados.length > 0, selecionados: marcados, viaComprovante, clicar, alternar, aoAnexar,
  };

  return <section className="cofre-transactions" ref={secao}>
    <div className="cofre-transactions-top"><h1>Transações</h1><div className="cofre-transactions-actions">
      <label className="cofre-search"><Search size={15} /><input value={consulta} onChange={(e) => setConsulta(e.target.value)} placeholder="Buscar transação…" aria-label="Buscar transação" />{consulta && <button type="button" className="cofre-search-limpar" aria-label="Limpar busca" onClick={() => setConsulta("")}><X size={13} /></button>}</label>
      <PeriodPicker value={period} onChange={onPeriodChange} />
      <button className="cofre-new-button" onClick={() => abrirCaptura("transacao")}><Plus size={14} />Novo lançamento</button>
    </div></div>
    <div className="cofre-transactions-toolbar">
      <div className="cofre-filter-group">
        <FiltroChip ativo={tipo === "todos"} onClick={() => setTipo("todos")} icone={<Grid2X2 size={14} />}>Todas</FiltroChip>
        <FiltroChip ativo={tipo === "entrada"} onClick={() => setTipo("entrada")} icone={<ArrowUp size={14} />}>Apenas receitas</FiltroChip>
        <FiltroChip ativo={tipo === "saida"} onClick={() => setTipo("saida")} icone={<ArrowDown size={14} />}>Apenas despesas</FiltroChip>
        <span className="cofre-filter-divider" />
        <FiltroChip ativo={status === "efetivada"} onClick={() => setStatus(status === "efetivada" ? "todos" : "efetivada")} icone={<Check size={14} />}>Efetivadas</FiltroChip>
        <FiltroChip ativo={status === "pendente"} onClick={() => setStatus(status === "pendente" ? "todos" : "pendente")} icone={<Check size={14} />}>Previstas</FiltroChip>
      </div>
      <div className="cofre-view-controls">
        <div className="cofre-view-toggle"><button aria-pressed={view === "lista"} onClick={() => setView("lista")}><List size={14} />Lista</button><button aria-pressed={view === "tabela"} onClick={() => setView("tabela")}><Table2 size={14} />Tabela</button></div>
        <button className="cofre-columns-button" title="Colunas" aria-label="Configurar colunas"><Columns3 size={15} /></button>
      </div>
    </div>
    {erro && <p role="alert" className="cofre-transactions-error">{erro}</p>}{feedback && <p role="status" className="cofre-transactions-feedback">{feedback}</p>}
    {selecionados.length > 0 && <div className="cofre-selection-bar">
      <b>{selecionados.length} selecionado{selecionados.length > 1 ? "s" : ""}</b><ContadorSaldo centavos={saldoSelecionado} /><span className="cofre-selection-dica">Esc para sair</span>
      <button onClick={() => void lote("conciliar")}>Conciliar</button><button onClick={() => void lote("desconciliar")}>Desconciliar</button>
      <button className="danger" onClick={() => void lote("excluir")}><Trash2 size={13} />Excluir selecionados</button><button onClick={sairDaSelecao}>Cancelar</button>
    </div>}
    <div className="cofre-transactions-card" data-selecionando={contexto.selecionando || undefined} data-autoria={contexto.autor ? "" : undefined}>
      {carregando ? <p className="cofre-table-empty">Carregando lançamentos…</p>
        : !exibidas.length ? <p className="cofre-table-empty" role="status">{buscando ? "Buscando…" : q ? `Nada encontrado para “${q}”.` : "Nenhum lançamento encontrado."}</p>
        : view === "lista" ? <div>{exibidas.map((t) => <Linha key={t.id} t={t} ctx={contexto} />)}</div>
        : <Tabela rows={exibidas} ctx={contexto} ordem={ordem} ordenar={ordenar} />}
    </div>
    <div className="cofre-transactions-footer"><span>{exibidas.length} lançamento{exibidas.length === 1 ? "" : "s"}</span><button disabled={ocupado || carregando} onClick={() => setVersao((v) => v + 1)}><RefreshCw size={13} />Atualizar</button>{cursor && <button disabled={ocupado} onClick={() => void mais()}>Carregar mais</button>}</div>
  </section>;
}

function ContadorSaldo({ centavos }: { centavos: number }) {
  const [valor, setValor] = useState(centavos);
  const atual = useRef(centavos);
  useEffect(() => {
    const de = atual.current, ate = centavos;
    if (de === ate) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { atual.current = ate; setValor(ate); return; }
    let raf = 0;
    const ini = performance.now(), dur = 450;
    const passo = (agora: number) => {
      const p = Math.min(1, (agora - ini) / dur), v = Math.round(de + (ate - de) * (1 - Math.pow(1 - p, 3)));
      atual.current = v;
      setValor(v);
      if (p < 1) raf = requestAnimationFrame(passo);
    };
    raf = requestAnimationFrame(passo);
    return () => cancelAnimationFrame(raf);
  }, [centavos]);
  const alvo = centavos > 0 ? "positivo" : centavos < 0 ? "negativo" : "zero";
  return <span className={`cofre-selection-total ${alvo}`} title="Receitas menos despesas dos itens selecionados" aria-live="polite">{valor > 0 ? "+" : ""}{formatMoeda(valor)}</span>;
}

function FiltroChip({ ativo, onClick, icone, children }: { ativo: boolean; onClick: () => void; icone: React.ReactNode; children: React.ReactNode }) {
  return <button className="cofre-filter-chip" aria-pressed={ativo} onClick={onClick}>{icone}{children}</button>;
}

/** Célula do começo da linha: o ícone da categoria, que dá lugar à caixa de seleção (mouse em cima ou modo seleção). */
function Inicio({ t, categoria, ctx }: { t: TransacaoApi; categoria?: CategoriaApi; ctx: Contexto }) {
  return <span className="cofre-row-lead">
    <CategoriaIcone categoria={categoria} tamanho={15} className="cofre-cats-icon" />
    <CaixaEcos marcada={ctx.selecionados.has(t.id)} rotulo={`Selecionar ${t.descricao}`} aoAlternar={(e) => ctx.alternar(t.id, e)} />
  </span>;
}

function Anexos({ t, ctx }: { t: TransacaoApi; ctx: Contexto }) {
  return <span className="cofre-row-anexos">
    <BotaoAnexos transacaoId={t.id} quantidade={t.anexos ?? 0} descricao={t.descricao} aoMudar={ctx.aoAnexar} />
    <BotaoAnexos transacaoId={t.id} quantidade={t.notas_fiscais ?? 0} descricao={t.descricao} aoMudar={ctx.aoAnexar} tipo="nota_fiscal" />
  </span>;
}

function Autor({ t, ctx, comNome }: { t: TransacaoApi; ctx: Contexto; comNome?: boolean }) {
  return <AvatarAutor id={t.criado_por} nome={ctx.autor?.(t.criado_por)} comNome={comNome} />;
}

function Status({ t }: { t: TransacaoApi }) {
  return <span className={`cofre-status ${t.status}`}>{t.status === "efetivada" ? "Efetivada" : "Prevista"}</span>;
}

function Linha({ t, ctx }: { t: TransacaoApi; ctx: Contexto }) {
  const categoria = ctx.categorias.get(t.categoria_id ?? "");
  const pagador = ctx.pagadores.get(t.beneficiario_id ?? "");
  const marcado = ctx.selecionados.has(t.id);
  // No toque não existe "passar o mouse": segurar a linha começa a seleção.
  const toque = useRef<{ timer: number; disparou: boolean } | null>(null);
  const cancelarToque = () => { if (toque.current) window.clearTimeout(toque.current.timer); };
  return <div
    className={`cofre-transaction-list-row ${marcado ? "selected" : ""}`}
    style={categoria ? { boxShadow: `inset 3px 0 0 ${categoria.cor}` } : {}}
    onClick={(e) => { if (toque.current?.disparou) { toque.current = null; return; } ctx.clicar(t, e); }}
    onMouseDown={(e) => { if (e.shiftKey) e.preventDefault(); }}
    onPointerDown={(e) => {
      if (e.pointerType !== "touch" || ctx.selecionando) return;
      toque.current = { disparou: false, timer: window.setTimeout(() => { if (toque.current) toque.current.disparou = true; ctx.alternar(t.id); }, TEMPO_TOQUE_LONGO_MS) };
    }}
    onPointerUp={cancelarToque} onPointerLeave={cancelarToque} onPointerCancel={cancelarToque}
  >
    <Inicio t={t} categoria={categoria} ctx={ctx} />
    <span className="cofre-transaction-description">
      <b>{t.descricao}</b>
      <small data-vazio={pagador ? undefined : ""}>{pagador ?? "Sem pagador"}{ctx.viaComprovante.has(t.id) && <i className="cofre-via-anexo">achado no comprovante</i>}</small>
    </span>
    <span className="cofre-transaction-category"><span>{categoria?.nome ?? "Sem categoria"}</span><small>{PAGAMENTOS[t.forma_pagamento ?? ""] ?? "Pagamento não informado"}</small></span>
    <time>{dataBr(t.data)}</time>
    <strong data-tipo={t.tipo}>{t.tipo === "entrada" ? "+" : "−"}{formatMoeda(t.valor_centavos)}</strong>
    <Anexos t={t} ctx={ctx} />
    <Status t={t} />
    {ctx.autor && <Autor t={t} ctx={ctx} />}
  </div>;
}

function Tabela({ rows, ctx, ordem, ordenar }: { rows: TransacaoApi[]; ctx: Contexto; ordem: { chave: Ordem; dir: 1 | -1 }; ordenar: (k: Ordem) => void }) {
  const cols: [Ordem, string][] = [["data", "Data"], ["descricao", "Descrição"], ["pagador", "Pagador"], ["categoria", "Categoria"], ["pagamento", "Pagamento"], ["valor", "Valor"]];
  return <div className="cofre-table-scroll"><table className="cofre-transactions-table">
    <thead><tr><th />{cols.map(([k, n]) => <th key={k}><button onClick={() => ordenar(k)}>{n}<span>{ordem.chave === k ? (ordem.dir === 1 ? "↑" : "↓") : "↕"}</span></button></th>)}<th aria-label="Anexos" /><th>Status</th>{ctx.autor && <th>Lançado por</th>}</tr></thead>
    <tbody>{rows.map((t) => {
      const cat = ctx.categorias.get(t.categoria_id ?? "");
      const marcado = ctx.selecionados.has(t.id);
      return <tr key={t.id} className={marcado ? "selected" : ""} onClick={(e) => ctx.clicar(t, e)} onMouseDown={(e) => { if (e.shiftKey) e.preventDefault(); }} style={cat ? { boxShadow: `inset 3px 0 0 ${cat.cor}` } : {}}>
        <td><Inicio t={t} categoria={cat} ctx={ctx} /></td>
        <td>{dataBr(t.data)}</td>
        <td><b>{t.descricao}</b>{ctx.viaComprovante.has(t.id) && <i className="cofre-via-anexo">achado no comprovante</i>}</td>
        <td>{ctx.pagadores.get(t.beneficiario_id ?? "") ?? "—"}</td>
        <td>{cat?.nome ?? "—"}</td>
        <td>{PAGAMENTOS[t.forma_pagamento ?? ""] ?? "—"}</td>
        <td><strong data-tipo={t.tipo}>{t.tipo === "entrada" ? "+" : "−"}{formatMoeda(t.valor_centavos)}</strong></td>
        <td><Anexos t={t} ctx={ctx} /></td>
        <td><Status t={t} /></td>
        {ctx.autor && <td><Autor t={t} ctx={ctx} comNome /></td>}
      </tr>;
    })}</tbody>
  </table></div>;
}
