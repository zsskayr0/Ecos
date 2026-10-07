import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Check, ChevronDown, Columns3, Grid2X2, List, Plus, RefreshCw, Repeat, Search, Table2, Tag, Trash2, X } from "lucide-react";
import { financeiro, vault, type CategoriaApi, type ContaApi, type TransacaoApi } from "@/lib/api";
import { formatMoeda } from "@/lib/format";
import { publicarListaDeLancamentos } from "@/lib/lista-lancamentos";
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
type Origem = "todas" | "recorrente" | "pontual";
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
const CHAVE_VISTA = "ecos:cofre:lancamentos-vista";
const CHAVES_ORDEM: Ordem[] = ["data", "descricao", "pagador", "categoria", "pagamento", "valor"];
const ROTULO_ORDEM: Record<Ordem, string> = { data: "Data", descricao: "Descrição", pagador: "Pagador", categoria: "Categoria", pagamento: "Pagamento", valor: "Valor" };
interface Vista { view: Visualizacao; ordem: { chave: Ordem; dir: 1 | -1 }; tipo: Tipo; status: Status; origem: Origem; categorias: string[] }
/** A vista (lista/tabela, ordem e filtros) é lembrada neste aparelho: editar um lançamento não pode devolver tudo ao padrão. */
function lerVista(): Partial<Vista> {
  try {
    const v = JSON.parse(localStorage.getItem(CHAVE_VISTA) ?? "{}") as Partial<Vista>;
    const ok: Partial<Vista> = {};
    if (v.view === "lista" || v.view === "tabela") ok.view = v.view;
    if (v.ordem && CHAVES_ORDEM.includes(v.ordem.chave) && (v.ordem.dir === 1 || v.ordem.dir === -1)) ok.ordem = v.ordem;
    if (v.tipo === "todos" || v.tipo === "entrada" || v.tipo === "saida") ok.tipo = v.tipo;
    if (v.status === "todos" || v.status === "efetivada" || v.status === "pendente") ok.status = v.status;
    if (v.origem === "todas" || v.origem === "recorrente" || v.origem === "pontual") ok.origem = v.origem;
    if (Array.isArray(v.categorias)) ok.categorias = v.categorias.filter((x): x is string => typeof x === "string");
    return ok;
  } catch { return {}; }
}
const dataBr = (iso: string) => iso.split("-").reverse().join("/");

interface Contexto {
  categorias: Map<string, CategoriaApi>;
  pagadores: Map<string, string>;
  contas: Map<string, ContaApi>;
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
  const [editando, setEditando] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [versao, setVersao] = useState(0);
  const [pagadores, setPagadores] = useState<Map<string, string>>(new Map());
  const [consulta, setConsulta] = useState("");
  const [achados, setAchados] = useState<{ q: string; ids: Map<string, boolean> } | null>(null);
  const [vistaInicial] = useState(lerVista);
  const [tipo, setTipo] = useState<Tipo>(filtro.tipo ?? vistaInicial.tipo ?? "todos");
  const [status, setStatus] = useState<Status>(vistaInicial.status ?? "todos");
  const [origem, setOrigem] = useState<Origem>(vistaInicial.origem ?? "todas");
  const [catsSel, setCatsSel] = useState<Set<string>>(() => new Set(vistaInicial.categorias ?? []));
  const [contas, setContas] = useState<Map<string, ContaApi>>(new Map());
  const [colunasVisiveis, setColunasVisiveis] = useState<Set<string>>(lerColunasVisiveis);
  const [view, setView] = useState<Visualizacao>(vistaInicial.view ?? "lista");
  const [ordem, setOrdem] = useState<{ chave: Ordem; dir: 1 | -1 }>(vistaInicial.ordem ?? { chave: "data", dir: -1 });
  useEffect(() => {
    try { localStorage.setItem(CHAVE_VISTA, JSON.stringify({ view, ordem, tipo: filtro.tipo ? vistaInicial.tipo ?? "todos" : tipo, status, origem, categorias: [...catsSel] })); } catch { /* vale só nesta sessão */ }
  }, [view, ordem, tipo, status, origem, catsSel, filtro.tipo, vistaInicial.tipo]);
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

  // Ocorrências de recorrência ainda sem lançamento (as futuras): entram na lista como "previstas", só para consulta.
  const [previstas, setPrevistas] = useState<TransacaoApi[]>([]);
  const deFuturas = filtro.data_de ?? periodo.data_de, ateFuturas = filtro.data_ate ?? periodo.data_ate;
  useEffect(() => {
    let vivo = true;
    Promise.all([financeiro.recorrencias(), financeiro.ocorrenciasDoPeriodo({ data_de: deFuturas, data_ate: ateFuturas })]).then(([regras, ocorrencias]) => {
      if (!vivo) return;
      const porId = new Map(regras.map((r) => [r.id, r]));
      const agora = new Date().toISOString();
      setPrevistas(ocorrencias.flatMap((o): TransacaoApi[] => {
        const r = porId.get(o.recorrencia_id);
        if (!r || o.transacao_id) return [];
        return [{
          id: `${PREFIXO_PREVISTA}${o.recorrencia_id}:${o.data}`, tipo: r.tipo, valor_centavos: o.valor_centavos, moeda: "BRL", data: o.data, descricao: r.descricao,
          categoria_id: r.categoria_id, conta_id: r.conta_id, beneficiario_id: r.beneficiario_id, forma_pagamento: r.forma_pagamento, status: "pendente",
          observacoes: r.observacoes, origem: "recorrencia_prevista", espaco: r.espaco, criado_em: agora, atualizado_em: agora, transacao_recorrente_id: r.id, data_ocorrencia: o.data,
        }];
      }));
    }).catch(() => { if (vivo) setPrevistas([]); });
    return () => { vivo = false; };
  }, [deFuturas, ateFuturas, versao, recarregar]);

  // Quem pagou/recebeu: o nome vem do cadastro de pagadores.
  useEffect(() => {
    let vivo = true;
    vault.beneficiarios.listar().then((lista) => { if (vivo) setPagadores(new Map(lista.map((b) => [b.id, b.nome]))); }).catch(() => undefined);
    vault.contas.listar().then((lista) => { if (vivo) setContas(new Map(lista.map((c) => [c.id, c]))); }).catch(() => undefined);
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
    const previstasDoFiltro = previstas.filter((t) => (filtro.categoria === undefined || (t.categoria_id ?? null) === filtro.categoria) && (filtro.pagamento === undefined || (t.forma_pagamento ?? null) === filtro.pagamento) && (!filtro.tipo || t.tipo === filtro.tipo));
    let lista = [...rows, ...previstasDoFiltro].filter((t) => (tipo === "todos" || t.tipo === tipo) && (status === "todos" || t.status === status) && (origem === "todas" || (origem === "recorrente") === !!t.transacao_recorrente_id) && (catsSel.size === 0 || catsSel.has(t.categoria_id ?? SEM_CATEGORIA)));
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
  }, [rows, previstas, filtro, tipo, status, origem, catsSel, q, achados, ordem, categoriasPorId, pagadores]);

  const idsVisiveis = useMemo(() => exibidas.map((t) => t.id).filter((id) => !ehPrevista(id)), [exibidas]);
  useEffect(() => {
    let pagar = 0, receber = 0;
    for (const t of exibidas) if (t.status === "pendente") { if (t.tipo === "saida") pagar += t.valor_centavos; else receber += t.valor_centavos; }
    publicarListaDeLancamentos(idsVisiveis, { pagar, receber });
  }, [idsVisiveis, exibidas]);
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

  async function editarEmBloco(m: Mudancas) {
    const alvos = rows.filter((t) => marcados.has(t.id));
    setOcupado(true);
    setErro("");
    setFeedback("");
    let feitas = 0;
    const falhas: string[] = [];
    for (const t of alvos) {
      try {
        await vault.transacoes.atualizar(t.id, {
          tipo: t.tipo, valor_centavos: m.valor_centavos ?? t.valor_centavos, data: m.data ?? t.data, descricao: t.descricao,
          categoria_id: m.categoria_id ?? t.categoria_id ?? undefined, conta_id: m.conta_id ?? t.conta_id ?? undefined,
          beneficiario_id: m.beneficiario_id ?? t.beneficiario_id ?? undefined, forma_pagamento: m.forma_pagamento ?? t.forma_pagamento ?? undefined,
          status: t.status, observacoes: t.observacoes ?? undefined,
        });
        feitas++;
      } catch (e) { falhas.push(`${t.descricao}: ${(e as Error).message}`); }
    }
    if (falhas.length) setErro(falhas.join("; "));
    if (feitas) setFeedback(`${feitas} lançamento${feitas > 1 ? "s" : ""} editado${feitas > 1 ? "s" : ""}.`);
    setEditando(false);
    sairDaSelecao();
    setVersao((v) => v + 1);
    atualizar();
    setOcupado(false);
  }

  /** Abre o diálogo de impressão do sistema com os selecionados; ali se escolhe "Salvar como PDF". */
  function exportarPdf() {
    const alvos = exibidas.filter((t) => marcados.has(t.id));
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const linhas = alvos.map((t) => `<tr><td>${dataBr(t.data)}</td><td>${esc(t.descricao)}</td><td>${esc(categoriasPorId.get(t.categoria_id ?? "")?.nome ?? "")}</td><td>${esc(pagadores.get(t.beneficiario_id ?? "") ?? "")}</td><td>${esc(contas.get(t.conta_id ?? "")?.nome ?? "")}</td><td>${esc(PAGAMENTOS[t.forma_pagamento ?? ""] ?? "")}</td><td>${t.status === "efetivada" ? "Efetivada" : "Prevista"}</td><td class="v">${t.tipo === "entrada" ? "" : "-"}${esc(formatMoeda(t.valor_centavos))}</td></tr>`).join("");
    const html = `<!doctype html><meta charset="utf-8"><title>Transações</title><style>body{font:12px sans-serif;margin:24px}h1{font-size:16px}table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid #ccc;padding:4px 6px;text-align:left}.v{text-align:right;white-space:nowrap}</style><h1>Transações (${alvos.length}) · saldo ${esc(formatMoeda(saldoSelecionado))}</h1><table><thead><tr><th>Data</th><th>Descrição</th><th>Categoria</th><th>Pagador</th><th>Conta</th><th>Pagamento</th><th>Status</th><th class="v">Valor</th></tr></thead><tbody>${linhas}</tbody></table>`;
    const quadro = document.createElement("iframe");
    quadro.style.cssText = "position:fixed;width:0;height:0;border:0;right:0;bottom:0";
    document.body.appendChild(quadro);
    const doc = quadro.contentWindow?.document;
    if (!doc || !quadro.contentWindow) { quadro.remove(); setErro("Não foi possível preparar o PDF."); return; }
    doc.open(); doc.write(html); doc.close();
    quadro.contentWindow.onafterprint = () => quadro.remove();
    window.setTimeout(() => { quadro.contentWindow?.focus(); quadro.contentWindow?.print(); }, 100);
  }

  async function lote(acao: "efetivar" | "previsto" | "excluir") {
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
    if (ehPrevista(id)) return;
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
    // Lançamento gerado por recorrência: só se edita na tela de Recorrências.
    if (t.transacao_recorrente_id) return;
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
    categorias: categoriasPorId, pagadores, contas, autor: autoria.ativo ? autoria.nomeDe : undefined,
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
        <span className="cofre-filter-divider" />
        <FiltroChip ativo={origem === "recorrente"} onClick={() => setOrigem(origem === "recorrente" ? "todas" : "recorrente")} icone={<Repeat size={14} />}>Recorrentes</FiltroChip>
        <FiltroChip ativo={origem === "pontual"} onClick={() => setOrigem(origem === "pontual" ? "todas" : "pontual")} icone={<Check size={14} />}>Pontuais</FiltroChip>
        <span className="cofre-filter-divider" />
        <MenuCategorias categorias={categorias} selecionadas={catsSel} aoMudar={setCatsSel} />
      </div>
      <div className="cofre-view-controls">
        {view === "lista" && <div className="cofre-sort" role="group" aria-label="Ordenar lista">
          <MenuOrdenar valor={ordem.chave} aoMudar={(chave) => setOrdem((o) => ({ ...o, chave }))} />
          <button type="button" aria-label={ordem.dir === 1 ? "Ordem crescente" : "Ordem decrescente"} title={ordem.dir === 1 ? "Crescente" : "Decrescente"} onClick={() => setOrdem((o) => ({ ...o, dir: o.dir === 1 ? -1 : 1 }))}>{ordem.dir === 1 ? <ArrowUp size={14} /> : <ArrowDown size={14} />}</button>
        </div>}
        <div className="cofre-view-toggle"><button aria-pressed={view === "lista"} onClick={() => setView("lista")}><List size={14} />Lista</button><button aria-pressed={view === "tabela"} onClick={() => setView("tabela")}><Table2 size={14} />Tabela</button></div>
        {view === "tabela" && <MenuColunas visiveis={colunasVisiveis} autor={!!contexto.autor} aoMudar={(v) => { setColunasVisiveis(v); salvarColunasVisiveis(v); }} />}
      </div>
    </div>
    {erro && <p role="alert" className="cofre-transactions-error">{erro}</p>}{feedback && <p role="status" className="cofre-transactions-feedback">{feedback}</p>}
    {selecionados.length > 0 && <div className="cofre-selection-bar">
      <b>{selecionados.length} selecionado{selecionados.length > 1 ? "s" : ""}</b><ContadorSaldo centavos={saldoSelecionado} /><span className="cofre-selection-dica">Esc para sair</span>
      <button disabled={ocupado} onClick={() => void lote("efetivar")}>Efetivar</button><button disabled={ocupado} onClick={() => void lote("previsto")}>Previsto</button>
      <button disabled={ocupado} onClick={() => setEditando(true)}>Editar em bloco</button><button disabled={ocupado} onClick={exportarPdf}>Exportar PDF</button>
      <button className="danger" disabled={ocupado} onClick={() => void lote("excluir")}><Trash2 size={13} />Excluir</button><button onClick={sairDaSelecao}>Cancelar</button>
    </div>}
    {editando && selecionados.length > 0 && <EdicaoEmBloco total={selecionados.length} pagadores={pagadores} contas={contas} categorias={categorias} ocupado={ocupado} aoSalvar={(m) => void editarEmBloco(m)} aoCancelar={() => setEditando(false)} />}
    <div className="cofre-transactions-card" data-selecionando={contexto.selecionando || undefined} data-autoria={contexto.autor ? "" : undefined}>
      {carregando ? <p className="cofre-table-empty">Carregando lançamentos…</p>
        : !exibidas.length ? <p className="cofre-table-empty" role="status">{buscando ? "Buscando…" : q ? `Nada encontrado para “${q}”.` : "Nenhum lançamento encontrado."}</p>
        : view === "lista" ? <div>{exibidas.map((t) => <Linha key={t.id} t={t} ctx={contexto} />)}</div>
        : <Tabela rows={exibidas} ctx={contexto} ordem={ordem} ordenar={ordenar} visiveis={colunasVisiveis} />}
    </div>
    <div className="cofre-transactions-footer"><span>{exibidas.length} lançamento{exibidas.length === 1 ? "" : "s"}</span><Pendencias lista={exibidas} /><button disabled={ocupado || carregando} onClick={() => setVersao((v) => v + 1)}><RefreshCw size={13} />Atualizar</button>{cursor && <button disabled={ocupado} onClick={() => void mais()}>Carregar mais</button>}</div>
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

interface Mudancas { beneficiario_id?: string; conta_id?: string; categoria_id?: string; forma_pagamento?: string; valor_centavos?: number; data?: string }

/** Painel de edição em bloco: só os campos preenchidos mudam; os vazios ficam como estão em cada lançamento. */
function EdicaoEmBloco({ total, pagadores, contas, categorias, ocupado, aoSalvar, aoCancelar }: {
  total: number; pagadores: Map<string, string>; contas: Map<string, ContaApi>; categorias: CategoriaApi[]; ocupado: boolean;
  aoSalvar: (m: Mudancas) => void; aoCancelar: () => void;
}) {
  const [m, setM] = useState({ beneficiario_id: "", conta_id: "", categoria_id: "", forma_pagamento: "", valor: "", data: "" });
  const mudar = (campo: keyof typeof m) => (e: { target: { value: string } }) => setM((o) => ({ ...o, [campo]: e.target.value }));
  const centavos = m.valor.trim() ? Math.round(Number(m.valor.replace(/\./g, "").replace(",", ".")) * 100) : undefined;
  const valorInvalido = centavos !== undefined && (!Number.isFinite(centavos) || centavos <= 0);
  const vazio = !m.beneficiario_id && !m.conta_id && !m.categoria_id && !m.forma_pagamento && centavos === undefined && !m.data;
  const salvar = () => aoSalvar({
    ...(m.beneficiario_id ? { beneficiario_id: m.beneficiario_id } : {}), ...(m.conta_id ? { conta_id: m.conta_id } : {}),
    ...(m.categoria_id ? { categoria_id: m.categoria_id } : {}), ...(m.forma_pagamento ? { forma_pagamento: m.forma_pagamento } : {}),
    ...(centavos !== undefined ? { valor_centavos: centavos } : {}), ...(m.data ? { data: m.data } : {}),
  });
  const opcoes = (itens: [string, string][]) => <><option value="">Manter</option>{itens.map(([id, nome]) => <option key={id} value={id}>{nome}</option>)}</>;
  return <div className="cofre-selection-bar" role="group" aria-label={`Editar ${total} lançamentos em bloco`} style={{ flexWrap: "wrap", gap: 8 }}>
    <b>Editar {total} em bloco</b>
    <label>Pagador <select value={m.beneficiario_id} onChange={mudar("beneficiario_id")}>{opcoes([...pagadores])}</select></label>
    <label>Conta <select value={m.conta_id} onChange={mudar("conta_id")}>{opcoes([...contas.values()].map((c) => [c.id, c.nome]))}</select></label>
    <label>Categoria <select value={m.categoria_id} onChange={mudar("categoria_id")}>{opcoes(categorias.map((c) => [c.id, c.nome]))}</select></label>
    <label>Pagamento <select value={m.forma_pagamento} onChange={mudar("forma_pagamento")}>{opcoes(Object.entries(PAGAMENTOS))}</select></label>
    <label>Valor <input value={m.valor} onChange={mudar("valor")} placeholder="Manter" inputMode="decimal" size={8} aria-invalid={valorInvalido || undefined} /></label>
    <label>Data <input type="date" value={m.data} onChange={mudar("data")} /></label>
    <button disabled={ocupado || vazio || valorInvalido} onClick={salvar}>Aplicar</button><button onClick={aoCancelar}>Cancelar</button>
  </div>;
}

function FiltroChip({ ativo, onClick, icone, children }: { ativo: boolean; onClick: () => void; icone: React.ReactNode; children: React.ReactNode }) {
  return <button className="cofre-filter-chip" aria-pressed={ativo} onClick={onClick}>{icone}{children}</button>;
}

/** Célula do começo da linha: o ícone da categoria, que dá lugar à caixa de seleção (mouse em cima ou modo seleção). */
const PREFIXO_PREVISTA = "rec:";
const ehPrevista = (id: string) => id.startsWith(PREFIXO_PREVISTA);

function Inicio({ t, categoria, ctx }: { t: TransacaoApi; categoria?: CategoriaApi; ctx: Contexto }) {
  return <span className="cofre-row-lead">
    <CategoriaIcone categoria={categoria} tamanho={15} className="cofre-cats-icon" />
    {!ehPrevista(t.id) && <CaixaEcos marcada={ctx.selecionados.has(t.id)} rotulo={`Selecionar ${t.descricao}`} aoAlternar={(e) => ctx.alternar(t.id, e)} />}
  </span>;
}

function Anexos({ t, ctx }: { t: TransacaoApi; ctx: Contexto }) {
  if (ehPrevista(t.id)) return <span className="cofre-row-anexos" />;
  return <span className="cofre-row-anexos">
    <BotaoAnexos transacaoId={t.id} quantidade={t.anexos ?? 0} descricao={t.descricao} aoMudar={ctx.aoAnexar} />
    <BotaoAnexos transacaoId={t.id} quantidade={t.notas_fiscais ?? 0} descricao={t.descricao} aoMudar={ctx.aoAnexar} tipo="nota_fiscal" />
  </span>;
}

function Autor({ t, ctx, comNome }: { t: TransacaoApi; ctx: Contexto; comNome?: boolean }) {
  return <AvatarAutor id={t.criado_por} nome={ctx.autor?.(t.criado_por)} comNome={comNome} />;
}

function SeloRecorrencia({ t }: { t: TransacaoApi }) {
  return t.transacao_recorrente_id ? <i className="cofre-via-anexo cofre-selo-recorrencia" title="Gerado por uma recorrência. Edite em Recorrências."><Repeat size={9} />Recorrência</i> : null;
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
      <span className="cofre-transaction-titulo"><b>{t.descricao}</b><SeloRecorrencia t={t} /></span>
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

interface ColunaTabela { id: string; nome: string; largura: number; ordem?: Ordem; padrao?: boolean; celula: (t: TransacaoApi, ctx: Contexto, cat?: CategoriaApi) => ReactNode }
const VAZIO = <span className="cofre-table-vazio">—</span>;
const dataHora = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }); };
const COLUNAS: ColunaTabela[] = [
  { id: "categoria", nome: "Categoria", largura: 190, ordem: "categoria", padrao: true, celula: (t, ctx, cat) => <span className="cofre-table-cat"><Inicio t={t} categoria={cat} ctx={ctx} /><span>{cat?.nome ?? "—"}</span></span> },
  { id: "data", nome: "Data", largura: 100, ordem: "data", padrao: true, celula: (t) => dataBr(t.data) },
  { id: "descricao", nome: "Descrição", largura: 300, ordem: "descricao", padrao: true, celula: (t, ctx) => <><b>{t.descricao}</b>{ctx.viaComprovante.has(t.id) && <i className="cofre-via-anexo">achado no comprovante</i>}</> },
  { id: "pagador", nome: "Pagador", largura: 170, ordem: "pagador", padrao: true, celula: (t, ctx) => ctx.pagadores.get(t.beneficiario_id ?? "") ?? VAZIO },
  { id: "pagamento", nome: "Pagamento", largura: 120, ordem: "pagamento", padrao: true, celula: (t) => PAGAMENTOS[t.forma_pagamento ?? ""] ?? VAZIO },
  { id: "valor", nome: "Valor", largura: 130, ordem: "valor", padrao: true, celula: (t) => <strong data-tipo={t.tipo}>{t.tipo === "entrada" ? "+" : "−"}{formatMoeda(t.valor_centavos)}</strong> },
  { id: "anexos", nome: "Anexos", largura: 90, padrao: true, celula: (t, ctx) => <Anexos t={t} ctx={ctx} /> },
  { id: "status", nome: "Status", largura: 100, padrao: true, celula: (t) => <Status t={t} /> },
  { id: "autor", nome: "Lançado por", largura: 170, padrao: true, celula: (t, ctx) => <Autor t={t} ctx={ctx} comNome /> },
  { id: "conta", nome: "Conta", largura: 150, celula: (t, ctx) => ctx.contas.get(t.conta_id ?? "")?.nome ?? VAZIO },
  { id: "tipo", nome: "Tipo", largura: 100, celula: (t) => t.tipo === "entrada" ? "Receita" : "Despesa" },
  { id: "recorrencia", nome: "Recorrência", largura: 120, padrao: true, celula: (t) => t.transacao_recorrente_id ? "Recorrente" : "Pontual" },
  { id: "conciliada", nome: "Conciliada", largura: 110, celula: (t) => ehPrevista(t.id) ? VAZIO : t.conciliada ? "Sim" : "Não" },
  { id: "notas", nome: "Notas fiscais", largura: 110, celula: (t) => t.notas_fiscais ? String(t.notas_fiscais) : VAZIO },
  { id: "observacoes", nome: "Observações", largura: 240, celula: (t) => t.observacoes || VAZIO },
  { id: "origem", nome: "Origem", largura: 120, celula: (t) => t.origem || VAZIO },
  { id: "criado", nome: "Criado em", largura: 140, celula: (t) => ehPrevista(t.id) ? VAZIO : dataHora(t.criado_em) },
  { id: "atualizado", nome: "Atualizado em", largura: 140, celula: (t) => ehPrevista(t.id) ? VAZIO : dataHora(t.atualizado_em) },
];
const CHAVE_LARGURAS = "ecos:cofre:tabela-larguras";
const CHAVE_COLUNAS = "ecos:cofre:tabela-colunas";
const CHAVE_ORDEM_COLUNAS = "ecos:cofre:tabela-ordem";
function lerOrdemColunas(): string[] {
  try { const v = JSON.parse(localStorage.getItem(CHAVE_ORDEM_COLUNAS) ?? "[]"); return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []; } catch { return []; }
}
function lerLarguras(): Record<string, number> {
  try { const v = JSON.parse(localStorage.getItem(CHAVE_LARGURAS) ?? "{}"); return v && typeof v === "object" ? v : {}; } catch { return {}; }
}
function lerColunasVisiveis(): Set<string> {
  try {
    const v = JSON.parse(localStorage.getItem(CHAVE_COLUNAS) ?? "null");
    if (Array.isArray(v)) return new Set(v.filter((x): x is string => typeof x === "string"));
  } catch { /* usa o padrão */ }
  return new Set(COLUNAS.filter((c) => c.padrao).map((c) => c.id));
}
function salvarColunasVisiveis(v: Set<string>) { try { localStorage.setItem(CHAVE_COLUNAS, JSON.stringify([...v])); } catch { /* vale só nesta sessão */ } }

/** Número que "corre" até o novo valor (≈ 0,5 s), para a soma não trocar seca quando o filtro muda. */
function useNumeroAnimado(alvo: number): number {
  const [valor, setValor] = useState(alvo);
  const atual = useRef(alvo);
  useEffect(() => {
    if (typeof window.matchMedia !== "function" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) { atual.current = alvo; setValor(alvo); return; }
    const de = atual.current, inicio = performance.now();
    let quadro = 0;
    const passo = (agora: number) => {
      const t = Math.min(1, (agora - inicio) / 500), suave = 1 - Math.pow(1 - t, 3);
      atual.current = Math.round(de + (alvo - de) * suave);
      setValor(atual.current);
      if (t < 1) quadro = window.requestAnimationFrame(passo);
    };
    quadro = window.requestAnimationFrame(passo);
    return () => window.cancelAnimationFrame(quadro);
  }, [alvo]);
  return valor;
}

/** Quanto ainda falta pagar (e receber): soma das previstas (efetivadas não entram) da lista que está na tela, com os filtros aplicados. */
function Pendencias({ lista }: { lista: TransacaoApi[] }) {
  const { pagar, receber, qtdPagar, qtdReceber } = useMemo(() => {
    let pagar = 0, receber = 0, qtdPagar = 0, qtdReceber = 0;
    for (const t of lista) {
      if (t.status !== "pendente") continue;
      if (t.tipo === "saida") { pagar += t.valor_centavos; qtdPagar++; } else { receber += t.valor_centavos; qtdReceber++; }
    }
    return { pagar, receber, qtdPagar, qtdReceber };
  }, [lista]);
  const pagarAnimado = useNumeroAnimado(pagar), receberAnimado = useNumeroAnimado(receber);
  if (!qtdPagar && !qtdReceber) return null;
  return <div className="cofre-pendencias" role="status" aria-live="polite">
    {qtdPagar > 0 && <span className="cofre-pendencia" data-tipo="saida" title={`${qtdPagar} despesa${qtdPagar === 1 ? "" : "s"} prevista${qtdPagar === 1 ? "" : "s"} nesta lista`}><i />Falta pagar<b>{formatMoeda(pagarAnimado)}</b></span>}
    {qtdReceber > 0 && <span className="cofre-pendencia" data-tipo="entrada" title={`${qtdReceber} receita${qtdReceber === 1 ? "" : "s"} prevista${qtdReceber === 1 ? "" : "s"} nesta lista`}><i />Falta receber<b>{formatMoeda(receberAnimado)}</b></span>}
  </div>;
}

const SEM_CATEGORIA = "__sem_categoria__";
/** Filtro por categoria (várias de uma vez): botão no estilo dos chips, com a lista de categorias num menu. */
function MenuCategorias({ categorias, selecionadas, aoMudar }: { categorias: CategoriaApi[]; selecionadas: Set<string>; aoMudar: (s: Set<string>) => void }) {
  const [aberto, setAberto] = useState(false);
  const raiz = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: PointerEvent) => { if (!raiz.current?.contains(e.target as Node)) setAberto(false); };
    const esc = (e: globalThis.KeyboardEvent) => { if (e.key === "Escape") setAberto(false); };
    document.addEventListener("pointerdown", fora); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", fora); document.removeEventListener("keydown", esc); };
  }, [aberto]);
  const ordenadas = useMemo(() => [...categorias].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")), [categorias]);
  const alternar = (id: string) => { const n = new Set(selecionadas); if (n.has(id)) n.delete(id); else n.add(id); aoMudar(n); };
  const n = selecionadas.size;
  return <div className="cofre-cat-filter" ref={raiz}>
    <button type="button" className="cofre-filter-chip" data-ativo={n > 0 || undefined} aria-pressed={n > 0} aria-haspopup="listbox" aria-expanded={aberto} onClick={() => setAberto((v) => !v)}>
      <Tag size={14} />{n === 0 ? "Categorias" : n === 1 ? (selecionadas.has(SEM_CATEGORIA) ? "Sem categoria" : categorias.find((c) => selecionadas.has(c.id))?.nome ?? "1 categoria") : `${n} categorias`}<ChevronDown size={13} />
    </button>
    {aberto && <div className="cofre-cat-list" role="listbox" aria-multiselectable aria-label="Filtrar por categoria">
      <div className="cofre-cat-list-topo"><span>Categorias</span>{n > 0 && <button type="button" onClick={() => aoMudar(new Set())}>Limpar</button>}</div>
      <div className="cofre-cat-list-itens">
        {ordenadas.map((c) => <label key={c.id} role="option" aria-selected={selecionadas.has(c.id)}><input type="checkbox" checked={selecionadas.has(c.id)} onChange={() => alternar(c.id)} /><CategoriaIcone categoria={c} tamanho={13} className="cofre-cats-icon" /><span>{c.nome}</span></label>)}
        <label role="option" aria-selected={selecionadas.has(SEM_CATEGORIA)}><input type="checkbox" checked={selecionadas.has(SEM_CATEGORIA)} onChange={() => alternar(SEM_CATEGORIA)} /><span className="cofre-cat-sem"><X size={13} /></span><span>Sem categoria</span></label>
      </div>
    </div>}
  </div>;
}

/** Escolha do campo de ordenação da lista, num menu próprio (o seletor nativo do navegador destoa do resto do Cofre). */
function MenuOrdenar({ valor, aoMudar }: { valor: Ordem; aoMudar: (o: Ordem) => void }) {
  const [aberto, setAberto] = useState(false);
  const raiz = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: PointerEvent) => { if (!raiz.current?.contains(e.target as Node)) setAberto(false); };
    const esc = (e: globalThis.KeyboardEvent) => { if (e.key === "Escape") setAberto(false); };
    document.addEventListener("pointerdown", fora); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", fora); document.removeEventListener("keydown", esc); };
  }, [aberto]);
  return <div className="cofre-sort-menu" ref={raiz}>
    <button type="button" className="cofre-sort-trigger" aria-haspopup="listbox" aria-expanded={aberto} aria-label="Ordenar por" onClick={() => setAberto((v) => !v)}>{ROTULO_ORDEM[valor]}<ChevronDown size={13} /></button>
    {aberto && <div className="cofre-sort-list" role="listbox" aria-label="Ordenar por">
      {CHAVES_ORDEM.map((k) => <button key={k} type="button" role="option" aria-selected={k === valor} onClick={() => { aoMudar(k); setAberto(false); }}>{ROTULO_ORDEM[k]}{k === valor && <Check size={13} />}</button>)}
    </div>}
  </div>;
}

/** Botão "Colunas": escolhe quais informações do lançamento viram colunas da tabela. */
function MenuColunas({ visiveis, autor, aoMudar }: { visiveis: Set<string>; autor: boolean; aoMudar: (v: Set<string>) => void }) {
  const [aberto, setAberto] = useState(false);
  const raiz = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: PointerEvent) => { if (!raiz.current?.contains(e.target as Node)) setAberto(false); };
    const esc = (e: globalThis.KeyboardEvent) => { if (e.key === "Escape") setAberto(false); };
    document.addEventListener("pointerdown", fora); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", fora); document.removeEventListener("keydown", esc); };
  }, [aberto]);
  const alternar = (id: string) => { const n = new Set(visiveis); if (n.has(id)) n.delete(id); else n.add(id); aoMudar(n); };
  return <div className="cofre-columns-wrap" ref={raiz}>
    <button className="cofre-columns-button" title="Colunas" aria-label="Configurar colunas" aria-expanded={aberto} onClick={() => setAberto((v) => !v)}><Columns3 size={15} /></button>
    {aberto && <div className="cofre-columns-menu" role="menu" aria-label="Colunas da tabela">
      <p>Colunas</p>
      {COLUNAS.filter((c) => c.id !== "autor" || autor).map((c) => <label key={c.id}><input type="checkbox" checked={visiveis.has(c.id)} disabled={c.id === "descricao"} onChange={() => alternar(c.id)} />{c.nome}</label>)}
      <button type="button" onClick={() => aoMudar(new Set(COLUNAS.filter((c) => c.padrao).map((c) => c.id)))}>Restaurar padrão</button>
    </div>}
  </div>;
}

function Tabela({ rows, ctx, ordem, ordenar, visiveis }: { rows: TransacaoApi[]; ctx: Contexto; ordem: { chave: Ordem; dir: 1 | -1 }; ordenar: (k: Ordem) => void; visiveis: Set<string> }) {
  const [larguras, setLarguras] = useState(lerLarguras);
  const atuais = useRef(larguras);
  const [ordemIds, setOrdemIds] = useState(lerOrdemColunas);
  const [arrasto, setArrasto] = useState<{ id: string; dx: number } | null>(null);
  const arrastoRef = useRef<{ id: string; x: number; ativo: boolean; dx: number } | null>(null);
  const cliqueSuprimido = useRef(false);
  const arraste = useRef<{ id: string; x: number; largura: number } | null>(null);
  const posicao = (id: string) => { const i = ordemIds.indexOf(id); return i < 0 ? ordemIds.length + COLUNAS.findIndex((c) => c.id === id) : i; };
  const colunas = COLUNAS.filter((c) => (c.id === "descricao" || visiveis.has(c.id)) && (c.id !== "autor" || ctx.autor)).sort((a, b) => posicao(a.id) - posicao(b.id));
  const larguraDe = (c: ColunaTabela) => larguras[c.id] ?? c.largura;
  const total = colunas.reduce((soma, c) => soma + larguraDe(c), 0);
  /** Onde cada coluna fica durante o arrasto: a arrastada segue o ponteiro (só na horizontal) e as vizinhas abrem espaço. */
  function layoutArrasto() {
    if (!arrasto) return null;
    const larguras = colunas.map(larguraDe);
    const idx = colunas.findIndex((c) => c.id === arrasto.id);
    const esquerda = larguras.slice(0, idx).reduce((x, l) => x + l, 0);
    const dx = Math.min(Math.max(arrasto.dx, -esquerda), total - esquerda - larguras[idx]);
    const centro = esquerda + larguras[idx] / 2 + dx;
    const deslocamentos = new Map<string, number>();
    let inicio = 0, destino = idx;
    colunas.forEach((c, j) => {
      const centroJ = inicio + larguras[j] / 2;
      if (j > idx && centro > centroJ) { deslocamentos.set(c.id, -larguras[idx]); destino = j; }
      if (j < idx && centro < centroJ) { deslocamentos.set(c.id, larguras[idx]); if (destino === idx || j < destino) destino = j; }
      inicio += larguras[j];
    });
    deslocamentos.set(arrasto.id, dx);
    return { deslocamentos, destino, idx };
  }
  const arrastando = layoutArrasto();
  const estiloColuna = (id: string): CSSProperties | undefined => {
    const d = arrastando?.deslocamentos.get(id);
    return d === undefined ? undefined : { transform: `translateX(${d}px)` };
  };
  function iniciarArrasto(e: React.PointerEvent<HTMLElement>, id: string) {
    if (e.button !== 0 || (e.target as HTMLElement).closest('[role="separator"]')) return;
    arrastoRef.current = { id, x: e.clientX, ativo: false, dx: 0 };
    const mover = (ev: PointerEvent) => {
      const a = arrastoRef.current; if (!a) return;
      a.dx = ev.clientX - a.x;
      if (!a.ativo && Math.abs(a.dx) < 5) return;
      a.ativo = true;
      setArrasto({ id: a.id, dx: a.dx });
    };
    const terminar = () => {
      window.removeEventListener("pointermove", mover); window.removeEventListener("pointerup", terminar); window.removeEventListener("pointercancel", terminar);
      const a = arrastoRef.current; arrastoRef.current = null;
      if (!a?.ativo) return;
      cliqueSuprimido.current = true;
      window.setTimeout(() => { cliqueSuprimido.current = false; }, 0);
      setArrasto((atual) => {
        if (atual) {
          const ids = colunas.map((c) => c.id);
          const larguras = colunas.map(larguraDe);
          const idx = ids.indexOf(a.id);
          const esquerda = larguras.slice(0, idx).reduce((x, l) => x + l, 0);
          const dx = Math.min(Math.max(a.dx, -esquerda), total - esquerda - larguras[idx]);
          const centro = esquerda + larguras[idx] / 2 + dx;
          let destino = idx, inicio = 0;
          ids.forEach((_, j) => {
            const centroJ = inicio + larguras[j] / 2;
            if (j > idx && centro > centroJ) destino = j;
            if (j < idx && centro < centroJ && destino === idx) destino = j;
            inicio += larguras[j];
          });
          if (destino !== idx) {
            ids.splice(idx, 1); ids.splice(destino, 0, a.id);
            setOrdemIds(ids);
            try { localStorage.setItem(CHAVE_ORDEM_COLUNAS, JSON.stringify(ids)); } catch { /* vale só nesta sessão */ }
          }
        }
        return null;
      });
    };
    window.addEventListener("pointermove", mover); window.addEventListener("pointerup", terminar); window.addEventListener("pointercancel", terminar);
  }
  function salvar(l: Record<string, number>) { try { localStorage.setItem(CHAVE_LARGURAS, JSON.stringify(l)); } catch { /* vale só nesta sessão */ } }
  function mover(e: React.PointerEvent<HTMLElement>) {
    const a = arraste.current; if (!a) return;
    atuais.current = { ...atuais.current, [a.id]: Math.max(60, Math.round(a.largura + e.clientX - a.x)) };
    setLarguras(atuais.current);
  }
  function soltar() { if (!arraste.current) return; arraste.current = null; salvar(atuais.current); }
  return <div className="cofre-table-scroll"><table className="cofre-transactions-table" data-arrastando={arrasto ? "" : undefined} style={{ width: total }}>
    <colgroup>{colunas.map((c) => <col key={c.id} style={{ width: larguraDe(c) }} />)}</colgroup>
    <thead><tr>{colunas.map((c) => <th key={c.id} aria-label={c.nome} data-arrastada={arrasto?.id === c.id ? "" : undefined} style={estiloColuna(c.id)} onPointerDown={(e) => iniciarArrasto(e, c.id)} onClickCapture={(e) => { if (cliqueSuprimido.current) { e.stopPropagation(); e.preventDefault(); } }}>
      {c.ordem ? <button onClick={() => ordenar(c.ordem!)}>{c.nome}<span>{ordem.chave === c.ordem ? (ordem.dir === 1 ? "↑" : "↓") : "↕"}</span></button> : c.nome}
      <span role="separator" aria-orientation="vertical" aria-label={`Redimensionar ${c.nome}`} title="Arraste para redimensionar — duplo clique restaura" className="cofre-col-resize"
        onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); arraste.current = { id: c.id, x: e.clientX, largura: larguraDe(c) }; }}
        onPointerMove={mover} onPointerUp={soltar} onPointerCancel={soltar}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={() => { const { [c.id]: _, ...resto } = atuais.current; atuais.current = resto; setLarguras(resto); salvar(resto); }} />
    </th>)}</tr></thead>
    <tbody>{rows.map((t) => {
      const cat = ctx.categorias.get(t.categoria_id ?? "");
      return <tr key={t.id} className={ctx.selecionados.has(t.id) ? "selected" : ""} onClick={(e) => ctx.clicar(t, e)} onMouseDown={(e) => { if (e.shiftKey) e.preventDefault(); }} style={cat ? { boxShadow: `inset 3px 0 0 ${cat.cor}` } : {}}>
        {colunas.map((c) => <td key={c.id} data-arrastada={arrasto?.id === c.id ? "" : undefined} style={estiloColuna(c.id)}>{c.celula(t, ctx, cat)}</td>)}
      </tr>;
    })}</tbody>
  </table></div>;
}
