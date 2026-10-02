import { SeletorEcos } from "@/components/common/SeletorEcos";

const CLASSE_FILTRO = "min-h-[40px] max-w-full rounded-[11px] border border-[var(--border)] bg-[var(--panel)] px-2.5 text-[13px] text-[var(--text)]";
import { useEffect, useMemo, useRef, useState } from "react";
import { ClipboardPaste, FileText, Paperclip, Plus, RefreshCw, Search } from "lucide-react";
import { ApiError, vault, type BeneficiarioApi, type CategoriaApi, type ComprovanteApi, type ContaApi, type OcrStatus, type RascunhoApi } from "@/lib/api";
import { formatMoeda } from "@/lib/format";
import { inscreverFila, tomarComprovantes } from "@/lib/fila-comprovantes";
import { prepararComprovante } from "@/lib/preparar-comprovante";
import { arquivosColados, lerAreaDeTransferencia } from "@/lib/colar-comprovante";
import type { Periodo } from "./types";
import { ComprovanteViewer } from "./comprovantes/ComprovanteViewer";
import { RevisarComprovante } from "./comprovantes/RevisarComprovante";
import { exibivelComoImagem } from "./comprovantes/use-blob-url";
import { Miniatura } from "./comprovantes/Miniatura";

const POR_PAGINA = 24;
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
  const entrada = useRef<HTMLInputElement>(null);

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
    q: termo || undefined,
  }), [periodo.data_de, periodo.data_ate, categoriaId, beneficiarioId, contaId, termo]);
  const chave = JSON.stringify(filtros);

  useEffect(() => {
    let vivo = true;
    setCarregando(true);
    setErro("");
    setItens([]);
    vault.comprovantes.listar({ ...JSON.parse(chave), limit: POR_PAGINA + 1 })
      .then((r) => {
        if (!vivo) return;
        setTemMais(r.items.length > POR_PAGINA);
        setItens(r.items.slice(0, POR_PAGINA));
      })
      .catch((e: Error) => { if (vivo) setErro(e.message); })
      .finally(() => { if (vivo) setCarregando(false); });
    return () => { vivo = false; };
  }, [chave, versao, recarregar]);

  async function maisItens() {
    setCarregando(true);
    try {
      const r = await vault.comprovantes.listar({ ...filtros, limit: POR_PAGINA + 1, offset: itens.length });
      setTemMais(r.items.length > POR_PAGINA);
      setItens((antigos) => [...antigos, ...r.items.slice(0, POR_PAGINA)]);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  }

  /** Prepara (reduz foto grande), envia cada arquivo e abre a revisão do primeiro; os demais ficam na fila "Para revisar". */
  async function enviarArquivos(lista: File[]) {
    if (!lista.length) return;
    setErroEnvio(null);
    setEnviando(true);
    const erros: string[] = [];
    let primeiro: { id: string; jaAnexadoEm: string | null } | null = null;
    try {
      for (const original of lista) {
        try {
          const r = await vault.comprovantes.receber(await prepararComprovante(original));
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

  function aoEscolher(arquivos: FileList | null) {
    const lista = Array.from(arquivos ?? []);
    if (entrada.current) entrada.current.value = "";
    void enviarArquivos(lista);
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
  const filtrando = !!(categoriaId || beneficiarioId || contaId || termo);

  return (
    <section className="cofre-comprovantes">
      <div className="cofre-comprovantes-filtros">
        <label className="cofre-search">
          <Search size={15} aria-hidden />
          <input value={consulta} onChange={(e) => setConsulta(e.target.value)} placeholder="Buscar por descrição, arquivo ou texto…" aria-label="Buscar comprovante" />
        </label>
        <SeletorEcos ariaLabel="Filtrar por categoria" classe={CLASSE_FILTRO} valor={categoriaId} onChange={setCategoriaId} opcoes={[{ valor: "", rotulo: "Todas as categorias" }, ...categorias.map((c) => ({ valor: c.id, rotulo: c.nome }))]} />
        <SeletorEcos ariaLabel="Filtrar por quem pagou ou recebeu" classe={CLASSE_FILTRO} valor={beneficiarioId} onChange={setBeneficiarioId} opcoes={[{ valor: "", rotulo: "Quem pagou ou recebeu" }, ...beneficiarios.map((b) => ({ valor: b.id, rotulo: b.nome }))]} />
        <SeletorEcos ariaLabel="Filtrar por conta" classe={CLASSE_FILTRO} valor={contaId} onChange={setContaId} opcoes={[{ valor: "", rotulo: "Todas as contas" }, ...contas.map((c) => ({ valor: c.id, rotulo: c.nome }))]} />
        <button className="cofre-new-button" disabled={enviando} onClick={() => entrada.current?.click()}>
          <Plus size={14} aria-hidden />{enviando ? "Enviando…" : "Adicionar comprovante"}
        </button>
        <button className="cofre-secondary" disabled={enviando} onClick={() => void colarDaAreaDeTransferencia()} title="Cole a imagem copiada (ou use Ctrl+V nesta aba)">
          <ClipboardPaste size={14} aria-hidden />Colar
        </button>
        <input ref={entrada} type="file" accept={ACEITOS} multiple hidden aria-label="Escolher comprovantes para adicionar" onChange={(e) => aoEscolher(e.target.files)} />
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
          <ul className="cofre-comprovantes-grade">
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
          <h2>{filtrando ? "Nenhum comprovante com esses filtros" : "Nenhum comprovante neste período"}</h2>
          <p>{filtrando ? "Limpe os filtros ou mude o período." : "Use “Adicionar comprovante” para guardar um PDF ou uma foto: o Cofre lê o valor e a data para você conferir."}</p>
        </div>
      )}
      {itens.length > 0 && (
        <ul className="cofre-comprovantes-grade">
          {itens.map((c) => (
            <li key={c.id}>
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
    <button className="cofre-comprovante-card" onClick={onAbrir} aria-label={`Abrir comprovante de ${t.descricao}`}>
      <Miniatura mime={c.mime_type} carregar={carregar} chave={`a-${c.id}`} habilitada={exibivelComoImagem(c.mime_type)} />
      <span className="cofre-comprovante-info">
        <b>{t.descricao}</b>
        <small>{t.data.split("-").reverse().join("/")}{quem ? ` · ${quem}` : ""}</small>
        <span>
          <strong data-tipo={t.tipo}>{t.tipo === "entrada" ? "+" : "−"}{formatMoeda(t.valor_centavos)}</strong>
          {categoria && <em style={{ borderColor: categoria.cor }}>{categoria.nome}</em>}
        </span>
      </span>
    </button>
  );
}
