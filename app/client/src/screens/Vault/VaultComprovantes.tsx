import { SeletorEcos } from "@/components/common/SeletorEcos";
import { SegmentedSlide } from "@/components/common/SegmentedSlide";

const CLASSE_FILTRO = "min-h-[40px] max-w-full rounded-[11px] border border-[var(--border)] bg-[var(--panel)] px-2.5 text-[13px] text-[var(--text)]";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ClipboardPaste, FileText, LayoutDashboard, Paperclip, Plus, Receipt, RectangleVertical, RefreshCw, Search } from "lucide-react";
import { ApiError, vault, type BeneficiarioApi, type CategoriaApi, type ComprovanteApi, type ContaApi, type OcrStatus, type RascunhoApi, type TipoAnexo } from "@/lib/api";
import { formatMoeda } from "@/lib/format";
import { inscreverFila, tomarComprovantes } from "@/lib/fila-comprovantes";
import { prepararComprovante } from "@/lib/preparar-comprovante";
import { arquivosColados, lerAreaDeTransferencia } from "@/lib/colar-comprovante";
import type { Periodo } from "./types";
import { ComprovanteViewer } from "./comprovantes/ComprovanteViewer";
import { RevisarComprovante } from "./comprovantes/RevisarComprovante";
import { exibivelComoImagem } from "./comprovantes/use-blob-url";
import { Miniatura } from "./comprovantes/Miniatura";
import { resolverIcone } from "./VaultCategories";
import { SeloConta } from "./contas/SeloConta";

type ModoGrade = "dinamico" | "4x3";
const CHAVE_MODO = "ecos.cofre.comprovantes.grade";
function lerModoGrade(): ModoGrade {
  try { return localStorage.getItem(CHAVE_MODO) === "4x3" ? "4x3" : "dinamico"; } catch { return "dinamico"; }
}

const POR_PAGINA = 24;
/** Quantidade por página arredondada para cima ao múltiplo de colunas, para a última linha da grade nunca ficar pela metade. */
const porPaginaDe = (colunas: number) => Math.ceil(POR_PAGINA / colunas) * colunas;
const ACEITOS = "image/jpeg,image/png,image/webp,image/heic,application/pdf";
const ROTULO_STATUS: Record<OcrStatus, string> = {
  processando: "Lendo…",
  pronto: "Lido",
  sem_texto: "Sem texto legível",
  indisponivel: "Preencher na mão",
  falhou: "Falha na leitura",
};

/** Todos os comprovantes arquivados, organizados pelos dados da transação a que pertencem, e a fila dos que ainda esperam revisão. */
export function VaultComprovantes({ recarregar, periodo, categorias, abrir, atualizar, irParaData }: { recarregar: number; periodo: Periodo; categorias: CategoriaApi[]; abrir: (transacaoId: string) => void; atualizar?: () => void; /** Leva a lista para o mês da data (o comprovante guardado pode ser de outro mês). */ irParaData?: (dataISO: string) => void }) {
  const [itens, setItens] = useState<ComprovanteApi[]>([]);
  const [temMais, setTemMais] = useState(false);
  const [carregando, setCarregando] = useState(true);
  // Trocar de filtro não esvazia a grade (isso piscava a tela): a lista antiga esmaece até a nova chegar.
  const [trocando, setTrocando] = useState(false);
  const [erro, setErro] = useState("");
  const [versao, setVersao] = useState(0);
  const [consulta, setConsulta] = useState("");
  const [termo, setTermo] = useState("");
  const [categoriaId, setCategoriaId] = useState("");
  const [beneficiarioId, setBeneficiarioId] = useState("");
  const [contaId, setContaId] = useState("");
  const [beneficiarios, setBeneficiarios] = useState<BeneficiarioApi[]>([]);
  const [contas, setContas] = useState<ContaApi[]>([]);
  const [aberto, setAberto] = useState<ComprovanteApi | null>(null);
  const [rascunhos, setRascunhos] = useState<RascunhoApi[]>([]);
  const [revisando, setRevisando] = useState<{ id: string; jaAnexadoEm: string | null } | null>(null);
  const [guardado, setGuardado] = useState<{ id: string; data: string; descricao: string; mudouMes: boolean } | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [erroEnvio, setErroEnvio] = useState<string | null>(null);
  const [tipoFiltro, setTipoFiltro] = useState<"" | TipoAnexo>("");
  const entrada = useRef<HTMLInputElement>(null);
  const entradaNota = useRef<HTMLInputElement>(null);
  // O que chega por colar, soltar ou compartilhar entra como nota fiscal se a pessoa está olhando só as notas fiscais.
  const tipoPadraoRef = useRef<TipoAnexo>("comprovante");
  tipoPadraoRef.current = tipoFiltro === "nota_fiscal" ? "nota_fiscal" : "comprovante";

  // A busca por texto espera a pessoa parar de digitar.
  useEffect(() => {
    const t = window.setTimeout(() => setTermo(consulta.trim()), 300);
    return () => window.clearTimeout(t);
  }, [consulta]);

  useEffect(() => {
    let vivo = true;
    vault.beneficiarios.listar().then((l) => { if (vivo) setBeneficiarios(l); }).catch(() => { /* o filtro some; a lista continua */ });
    vault.contas.listar().then((l) => { if (vivo) setContas(l); }).catch(() => { /* idem */ });
    return () => { vivo = false; };
  }, [recarregar]);

  // Fila de revisão: atualiza sozinha enquanto algum comprovante ainda está sendo lido.
  const [lendoAlgum, setLendoAlgum] = useState(false);
  useEffect(() => {
    let vivo = true;
    let timer: number | undefined;
    async function carregarFila() {
      try {
        const r = await vault.comprovantes.rascunhos.listar();
        if (!vivo) return;
        setRascunhos(r.items);
        const lendo = r.items.some((x) => x.ocr_status === "processando");
        setLendoAlgum(lendo);
        if (lendo) timer = window.setTimeout(() => void carregarFila(), 3000);
      } catch { /* a fila é secundária; a lista de comprovantes mostra o erro principal */ }
    }
    void carregarFila();
    return () => { vivo = false; if (timer) window.clearTimeout(timer); };
  }, [versao, recarregar]);

  const filtros = useMemo(() => ({
    data_de: periodo.data_de,
    data_ate: periodo.data_ate,
    categoria_id: categoriaId || undefined,
    beneficiario_id: beneficiarioId || undefined,
    conta_id: contaId || undefined,
    tipo: tipoFiltro || undefined,
    q: termo || undefined,
  }), [periodo.data_de, periodo.data_ate, categoriaId, beneficiarioId, contaId, tipoFiltro, termo]);
  const chave = JSON.stringify(filtros);

  // Mudar filtro/período esvazia e mostra "Carregando"; recarregar depois de guardar ou editar troca no lugar, sem
  // esvaziar: senão a página encolhe por um instante e a rolagem volta para o topo. Na recarga, traz o que já estava na tela.
  const [colunas, setColunas] = useState(1);
  const colunasRef = useRef(1);
  colunasRef.current = colunas;
  const chaveAnterior = useRef<string | null>(null);
  const tamanhoAtual = useRef(0);
  tamanhoAtual.current = itens.length;
  useEffect(() => {
    let vivo = true;
    const mudouFiltro = chaveAnterior.current !== chave;
    chaveAnterior.current = chave;
    if (mudouFiltro) { setCarregando(true); setTrocando(true); }
    setErro("");
    const c = colunasRef.current;
    const quantos = Math.min(Math.floor(199 / c) * c, Math.ceil(Math.max(porPaginaDe(c), mudouFiltro ? 0 : tamanhoAtual.current) / c) * c);
    vault.comprovantes.listar({ ...JSON.parse(chave), limit: quantos + 1 })
      .then((r) => {
        if (!vivo) return;
        setTemMais(r.items.length > quantos);
        setItens(r.items.slice(0, quantos));
      })
      .catch((e: Error) => { if (vivo) setErro(e.message); })
      .finally(() => { if (vivo) { setCarregando(false); setTrocando(false); } });
    return () => { vivo = false; };
  }, [chave, versao, recarregar]);

  // Quantas colunas a grade tem agora (muda com a largura da janela).
  const temItens = itens.length > 0;
  useEffect(() => {
    const el = gradeRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const medir = () => setColunas(Math.max(1, getComputedStyle(el).gridTemplateColumns.split(" ").filter(Boolean).length));
    medir();
    const obs = new ResizeObserver(medir);
    obs.observe(el);
    return () => obs.disconnect();
  }, [temItens]);
  // Se a largura mudou o número de colunas, completa a última linha com mais itens.
  useEffect(() => {
    if (temMais && !carregando && !erro && itens.length > 0 && itens.length % colunas !== 0) void maisItens(true);
  }, [colunas, temMais, carregando, erro, itens.length]); // eslint-disable-line react-hooks/exhaustive-deps

  async function maisItens(soCompletarLinha = false) {
    setCarregando(true);
    try {
      const c = colunasRef.current;
      const falta = (c - (itens.length % c)) % c;
      const n = soCompletarLinha ? falta : falta + porPaginaDe(c);
      const r = await vault.comprovantes.listar({ ...filtros, limit: n + 1, offset: itens.length });
      setTemMais(r.items.length > n);
      setItens((antigos) => [...antigos, ...r.items.slice(0, n)]);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  }

  /** Prepara (reduz foto grande), envia cada arquivo e abre a revisão do primeiro; os demais ficam na fila "Para revisar". */
  async function enviarArquivos(lista: File[], tipo: TipoAnexo = tipoPadraoRef.current) {
    if (!lista.length) return;
    setErroEnvio(null);
    setEnviando(true);
    const erros: string[] = [];
    let primeiro: { id: string; jaAnexadoEm: string | null } | null = null;
    try {
      for (const original of lista) {
        try {
          const r = await vault.comprovantes.receber(await prepararComprovante(original), tipo);
          primeiro ??= { id: r.id, jaAnexadoEm: r.ja_anexado_em };
        } catch (e) {
          erros.push(e instanceof ApiError || e instanceof Error ? e.message : `Não foi possível enviar “${original.name}”.`);
        }
      }
    } finally {
      setEnviando(false);
    }
    if (erros.length) setErroEnvio(erros.join(" "));
    setVersao((v) => v + 1);
    if (primeiro) setRevisando(primeiro);
  }

  function aoEscolher(arquivos: FileList | null, tipo: TipoAnexo) {
    const lista = Array.from(arquivos ?? []);
    if (entrada.current) entrada.current.value = "";
    if (entradaNota.current) entradaNota.current.value = "";
    void enviarArquivos(lista, tipo);
  }

  // Comprovantes compartilhados do celular que esperavam o Cofre abrir (e os que chegarem com a tela já aberta).
  const enviarRef = useRef(enviarArquivos);
  enviarRef.current = enviarArquivos;
  // Com a revisão ou o visualizador abertos, Ctrl+V é de quem está na frente (campos do formulário), não um novo comprovante.
  const ocupadoRef = useRef(false);
  ocupadoRef.current = !!revisando || !!aberto;
  useEffect(() => {
    const aoColar = (e: ClipboardEvent) => {
      if (ocupadoRef.current) return;
      const colados = arquivosColados(e);
      if (!colados.length) return;
      e.preventDefault();
      void enviarRef.current(colados);
    };
    window.addEventListener("paste", aoColar);
    return () => window.removeEventListener("paste", aoColar);
  }, []);

  async function colarDaAreaDeTransferencia() {
    setErroEnvio(null);
    try {
      await enviarArquivos(await lerAreaDeTransferencia());
    } catch (e) {
      setErroEnvio(e instanceof Error ? e.message : "Não foi possível colar.");
    }
  }
  useEffect(() => {
    const esvaziar = () => {
      const chegados = tomarComprovantes();
      if (chegados.length) void enviarRef.current(chegados);
    };
    esvaziar();
    return inscreverFila(esvaziar);
  }, []);

  const categoriasPorId = useMemo(() => new Map(categorias.map((c) => [c.id, c])), [categorias]);
  const beneficiariosPorId = useMemo(() => new Map(beneficiarios.map((b) => [b.id, b])), [beneficiarios]);
  const [modoGrade, setModoGrade] = useState<ModoGrade>(lerModoGrade);
  const gradeRef = useRef<HTMLUListElement>(null);
  const secaoRef = useRef<HTMLElement>(null);
  // O título da página fica fixo no topo; os filtros grudam logo abaixo dele, então precisam saber a altura do título.
  useLayoutEffect(() => {
    const secao = secaoRef.current;
    const cab = secao?.closest(".cofre-content")?.querySelector(":scope > .cofre-page-heading");
    if (!secao || !(cab instanceof HTMLElement)) return;
    // O título gruda com `top` negativo (cobre o respiro de cima da área de rolagem); os filtros ficam logo abaixo dele.
    const medir = () => secao.style.setProperty("--cofre-cab-h", `${cab.getBoundingClientRect().height + (parseFloat(getComputedStyle(cab).top) || 0)}px`);
    medir();
    if (typeof ResizeObserver === "undefined") return;
    const obs = new ResizeObserver(medir);
    obs.observe(cab);
    return () => obs.disconnect();
  }, []);
  const antes = useRef<Map<string, { r: DOMRect; h: number }> | null>(null);
  function trocarModo(m: ModoGrade) {
    if (m === modoGrade) return;
    const mapa = new Map<string, { r: DOMRect; h: number }>();
    gradeRef.current?.querySelectorAll<HTMLElement>("li[data-id]").forEach((li) => {
      mapa.set(li.dataset.id!, { r: li.getBoundingClientRect(), h: li.querySelector(".cofre-comprovante-thumb")?.getBoundingClientRect().height ?? 0 });
    });
    antes.current = mapa;
    setModoGrade(m);
    try { localStorage.setItem(CHAVE_MODO, m); } catch { /* sem armazenamento: vale só nesta visita */ }
  }
  // Troca de formato: os cards deslizam da posição antiga para a nova e a prévia cresce/encolhe (a ordem não muda).
  useLayoutEffect(() => {
    const mapa = antes.current;
    antes.current = null;
    if (!mapa || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    gradeRef.current?.querySelectorAll<HTMLElement>("li[data-id]").forEach((li) => {
      const a = mapa.get(li.dataset.id!);
      if (!a) return;
      const r = li.getBoundingClientRect();
      const opcoes = { duration: 380, easing: "cubic-bezier(.2,.8,.2,1)" };
      li.animate([{ transform: `translate(${a.r.left - r.left}px, ${a.r.top - r.top}px)` }, { transform: "none" }], opcoes);
      const thumb = li.querySelector<HTMLElement>(".cofre-comprovante-thumb");
      const h = thumb?.getBoundingClientRect().height ?? 0;
      if (thumb && a.h && h && Math.abs(a.h - h) > 1) thumb.animate([{ height: `${a.h}px`, maxHeight: `${a.h}px` }, { height: `${h}px`, maxHeight: `${h}px` }], opcoes);
    });
  }, [modoGrade]);

  const filtrando = !!(categoriaId || beneficiarioId || contaId || tipoFiltro || termo);

  return (
    <section ref={secaoRef} className="cofre-comprovantes">
      <div className="cofre-comprovantes-filtros">
        <label className="cofre-search">
          <Search size={15} aria-hidden />
          <input value={consulta} onChange={(e) => setConsulta(e.target.value)} placeholder="Buscar por descrição, arquivo ou texto…" aria-label="Buscar comprovante" />
        </label>
        <SegmentedSlide className="cofre-launch-slide cofre-slide cofre-comprovantes-modo" tamanho="lg" ariaLabel="Formato da grade" value={modoGrade} onChange={(v) => trocarModo(v === "4x3" ? "4x3" : "dinamico")} opcoes={[
          { value: "dinamico", label: <span className="inline-flex items-center gap-1.5"><LayoutDashboard size={14} aria-hidden />Dinâmica</span>, cor: "ecos-steel-300", ariaLabel: "Grade dinâmica, com a proporção real de cada prévia" },
          { value: "4x3", label: <span className="inline-flex items-center gap-1.5"><RectangleVertical size={14} aria-hidden />4:3</span>, cor: "ecos-steel-300", ariaLabel: "Grade fixa 4:3, com a prévia recortada" },
        ]} />
        <SegmentedSlide className="cofre-launch-slide cofre-slide" tamanho="lg" ariaLabel="Tipo de arquivo" value={tipoFiltro || "todos"} onChange={(v) => setTipoFiltro(v === "todos" ? "" : v)} opcoes={[
          { value: "todos", label: "Todos", cor: "ecos-steel-300" },
          { value: "comprovante", label: <span className="inline-flex items-center gap-1.5"><Paperclip size={14} aria-hidden />Comprovantes</span>, cor: "cofre-blue", ariaLabel: "Comprovantes" },
          { value: "nota_fiscal", label: <span className="inline-flex items-center gap-1.5"><Receipt size={14} aria-hidden />Notas fiscais</span>, cor: "cofre-pink", ariaLabel: "Notas fiscais" },
        ]} />
        <SeletorEcos classeMenu="cofre-menu" ariaLabel="Filtrar por conta" classe={CLASSE_FILTRO} valor={contaId} onChange={setContaId} opcoes={[{ valor: "", rotulo: "Todas as contas" }, ...contas.map((c) => ({ valor: c.id, rotulo: c.nome, visual: <SeloConta nome={c.nome} cor={c.cor} tipo={c.tipo} codigoBanco={c.codigo_banco} sigla={c.sigla} tamanho="xs" /> }))]} />
        <SeletorEcos classeMenu="cofre-menu" buscar ariaLabel="Filtrar por quem pagou ou recebeu" classe={CLASSE_FILTRO} valor={beneficiarioId} onChange={setBeneficiarioId} opcoes={[{ valor: "", rotulo: "Quem pagou ou recebeu" }, ...beneficiarios.map((b) => ({ valor: b.id, rotulo: b.nome }))]} />
        <SeletorEcos classeMenu="cofre-menu" buscar ariaLabel="Filtrar por categoria" classe={CLASSE_FILTRO} valor={categoriaId} onChange={setCategoriaId} opcoes={[{ valor: "", rotulo: "Todas as categorias" }, ...categorias.map((c) => ({ valor: c.id, rotulo: c.nome, cor: c.cor, icone: resolverIcone(c.icone) }))]} />
        <button className="cofre-secondary cofre-comprovantes-acoes-ini" disabled={enviando} onClick={() => void colarDaAreaDeTransferencia()} title="Cole a imagem copiada (ou use Ctrl+V nesta aba)">
          <ClipboardPaste size={14} aria-hidden />Colar
        </button>
        <button className="cofre-new-button" disabled={enviando} onClick={() => entrada.current?.click()}>
          <Plus size={14} aria-hidden />{enviando ? "Enviando…" : "Comprovante"}
        </button>
        <button className="cofre-new-button" disabled={enviando} onClick={() => entradaNota.current?.click()}>
          <Plus size={14} aria-hidden />Nota fiscal
        </button>
        <input ref={entrada} type="file" accept={ACEITOS} multiple hidden aria-label="Escolher comprovantes para adicionar"onChange={(e) => aoEscolher(e.target.files, "comprovante")} />
        <input ref={entradaNota} type="file" accept={ACEITOS} multiple hidden aria-label="Escolher notas fiscais para adicionar" onChange={(e) => aoEscolher(e.target.files, "nota_fiscal")} />
      </div>
      {erroEnvio && <p role="alert" className="cofre-transactions-error">{erroEnvio}</p>}
      {guardado && (
        <p role="status" className="cofre-transactions-feedback cofre-guardado">
          Comprovante guardado em “{guardado.descricao}” ({guardado.data.split("-").reverse().join("/")}).{guardado.mudouMes && " A lista foi para o mês desse lançamento."}{" "}
          <button type="button" className="cofre-link" onClick={() => abrir(guardado.id)}>Abrir lançamento</button>
          <button type="button" className="cofre-link" aria-label="Dispensar aviso" onClick={() => setGuardado(null)}>Dispensar</button>
        </p>
      )}

      {rascunhos.length > 0 && (
        <section className="cofre-fila" aria-label="Comprovantes para revisar">
          <h2>Para revisar <span>{rascunhos.length}</span>{lendoAlgum && <small role="status"> · lendo…</small>}</h2>
          <ul className="cofre-comprovantes-grade" data-modo={modoGrade}>
            {rascunhos.map((r) => (
              <li key={r.id}>
                <button className="cofre-comprovante-card" onClick={() => setRevisando({ id: r.id, jaAnexadoEm: null })} aria-label={`Revisar ${r.nome_arquivo}`}>
                  <Miniatura mime={r.mime_type} carregar={() => vault.comprovantes.rascunhos.miniatura(r.id)} chave={`r-${r.id}-${r.tem_miniatura}`} habilitada={r.tem_miniatura} />
                  <span className="cofre-comprovante-info">
                    <b>{r.nome_arquivo}</b>
                    <small>{ROTULO_STATUS[r.ocr_status]}</small>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {erro && (
        <div role="alert" className="cofre-error-card">
          <h2>Não foi possível carregar os comprovantes</h2>
          <p>{erro}</p>
          <div><button className="cofre-solid" onClick={() => setVersao((v) => v + 1)}><RefreshCw size={15} />Tentar novamente</button></div>
        </div>
      )}
      {!erro && carregando && itens.length === 0 && <p className="cofre-table-empty" role="status">Carregando comprovantes…</p>}
      {!erro && !carregando && itens.length === 0 && (
        <div className="cofre-card cofre-empty-page">
          <Paperclip size={28} aria-hidden />
          <h2>{filtrando ? "Nada encontrado com esses filtros" : "Nenhum comprovante neste período"}</h2>
          <p>{filtrando ? "Limpe os filtros ou mude o período." : "Use “Adicionar comprovante” (ou “Adicionar nota fiscal”) para guardar um PDF ou uma foto: o Cofre lê o valor e a data para você conferir."}</p>
        </div>
      )}
      {itens.length > 0 && (
        <ul ref={gradeRef} className="cofre-comprovantes-grade" data-modo={modoGrade} data-trocando={trocando || undefined}>
          {itens.map((c, i) => (
            <li key={c.id} data-id={c.id} className="cofre-comprovante-entra" style={{ "--i": Math.min(i, 12) } as CSSProperties}>
              <Cartao c={c} categoria={categoriasPorId.get(c.transacao.categoria_id ?? "")} quem={beneficiariosPorId.get(c.transacao.beneficiario_id ?? "")?.nome} onAbrir={() => setAberto(c)} />
            </li>
          ))}
        </ul>
      )}
      {temMais && <div className="cofre-transactions-footer"><button disabled={carregando} onClick={() => void maisItens()}>Carregar mais</button></div>}

      {aberto && (
        <ComprovanteViewer
          arquivo={aberto}
          lancamentoId={aberto.transacao.id}
          onFechar={() => setAberto(null)}
          aoMudar={() => { setVersao((v) => v + 1); atualizar?.(); }}
        />
      )}
      {revisando && (
        <RevisarComprovante
          id={revisando.id}
          jaAnexadoEm={revisando.jaAnexadoEm}
          onFechar={() => setRevisando(null)}
          onMudou={(g) => {
            setVersao((v) => v + 1);
            atualizar?.();
            if (!g) return;
            // O lançamento vale pela data do comprovante, que pode estar fora do período em tela: vai até lá, senão ele "some".
            const fora = g.data < periodo.data_de || g.data > periodo.data_ate;
            if (fora) irParaData?.(g.data);
            setGuardado({ ...g, mudouMes: fora && !!irParaData });
          }}
          abrirLancamento={(id) => { setRevisando(null); abrir(id); }}
        />
      )}
    </section>
  );
}

function Cartao({ c, categoria, quem, onAbrir }: { c: ComprovanteApi; categoria?: CategoriaApi; quem?: string; onAbrir: () => void }) {
  const t = c.transacao;
  // Miniatura gerada no servidor; se ainda não existir (anexo antigo), uma imagem usa o próprio arquivo.
  const carregar = async () => (await vault.anexos.miniatura(c.id)) ?? (exibivelComoImagem(c.mime_type) ? vault.anexos.conteudo(c.id) : null);
  return (
    <button className="cofre-comprovante-card" onClick={onAbrir} aria-label={`Abrir ${c.tipo === "nota_fiscal" ? "nota fiscal" : "comprovante"} de ${t.descricao}`} data-tipo={c.tipo}>
      <Miniatura mime={c.mime_type} carregar={carregar} chave={`a-${c.id}`} habilitada={exibivelComoImagem(c.mime_type)} />
      <span className="cofre-comprovante-info">
        <b>{t.descricao}</b>
        <small>{t.data.split("-").reverse().join("/")}{quem ? ` · ${quem}` : ""}{c.tipo === "nota_fiscal" && <i className="cofre-via-anexo">Nota fiscal</i>}</small>
        <span>
          <strong data-tipo={t.tipo}>{t.tipo === "entrada" ? "+" : "−"}{formatMoeda(t.valor_centavos)}</strong>
          {categoria && <em style={{ borderColor: categoria.cor }}>{categoria.nome}</em>}
        </span>
      </span>
    </button>
  );
}
