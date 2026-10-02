import { useEffect, useRef, useState } from "react";
import { FileText, RefreshCw, Trash2, X } from "lucide-react";
import { ApiError, vault, type RascunhoApi } from "@/lib/api";
import { hojeISO } from "@/lib/format";
import { TransactionForm } from "@/screens/Create/TransactionForm";
import { DRAFT_VAZIO, type CapturaDraft } from "@/screens/Create/CreateFlow";
import { exibivelComoImagem, useBlobUrl } from "./use-blob-url";

const LIMITE_CONFIANCA = 0.85;
const INTERVALO_MS = 1500;

/** Campos que a leitura não cravou, em palavras de gente, para a pessoa saber onde olhar primeiro. */
export function camposParaConferir(r: RascunhoApi): string[] {
  const c = r.sugestao?.confianca;
  if (!c) return [];
  const lista: string[] = [];
  if (r.sugestao?.valor_centavos == null || c.valor < LIMITE_CONFIANCA) lista.push("valor");
  if (r.sugestao?.data == null || c.data < LIMITE_CONFIANCA) lista.push("data");
  if (c.tipo < LIMITE_CONFIANCA) lista.push("se é despesa ou receita");
  if (r.sugestao?.beneficiario_nome == null) lista.push("quem pagou ou recebeu");
  return lista;
}

function rascunhoParaDraft(r: RascunhoApi | null): CapturaDraft {
  const s = r?.sugestao;
  return {
    ...DRAFT_VAZIO,
    texto: s?.descricao ?? "",
    valorCentavos: s?.valor_centavos ?? 0,
    tipoTransacao: s?.tipo ?? "saida",
    dataTransacao: s?.data ?? hojeISO(), // DRAFT_VAZIO guarda o dia em que o app abriu; aqui vale o dia de agora
    formaPagamento: s?.forma_pagamento ?? null,
    beneficiarioNome: s?.beneficiario_nome ?? "",
    statusTransacao: "efetivada",
  };
}

/** Revisão de um comprovante recém-recebido: mostra o arquivo ao lado do formulário já preenchido pela leitura. Nada é salvo sem confirmar. */
export function RevisarComprovante({ id, jaAnexadoEm, onFechar, onMudou, abrirLancamento }: {
  id: string;
  jaAnexadoEm?: string | null;
  onFechar: () => void;
  /** Chamado quando algo mudou no Cofre: com `guardado` quando o lançamento foi criado; sem nada quando o rascunho foi descartado. */
  onMudou: (guardado?: { id: string; data: string; descricao: string }) => void;
  abrirLancamento?: (transacaoId: string) => void;
}) {
  const [rascunho, setRascunho] = useState<RascunhoApi | null>(null);
  const [erroCarga, setErroCarga] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  const [draft, setDraft] = useState<CapturaDraft>(DRAFT_VAZIO);
  const [preenchido, setPreenchido] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [tentativa, setTentativa] = useState(0);
  /** "Sair sem guardar?": o comprovante ainda não virou lançamento, então sair pede uma decisão. */
  const [saindo, setSaindo] = useState(false);
  const fechar = useRef<HTMLButtonElement>(null);

  // Consulta até a leitura terminar. O servidor dá a leitura por falha sozinho se ela travar.
  useEffect(() => {
    let vivo = true;
    let timer: number | undefined;
    async function consultar() {
      try {
        const r = await vault.comprovantes.rascunhos.obter(id);
        if (!vivo) return;
        setRascunho(r);
        setErroCarga(null);
        if (r.ocr_status === "processando") timer = window.setTimeout(() => void consultar(), INTERVALO_MS);
      } catch (e) {
        if (vivo) setErroCarga(e instanceof ApiError && e.status === 404 ? "Este comprovante não está mais na fila de revisão." : e instanceof Error ? e.message : "Não foi possível carregar o comprovante.");
      }
    }
    void consultar();
    return () => { vivo = false; if (timer) window.clearTimeout(timer); };
  }, [id, tentativa]);

  // Preenche o formulário uma única vez, quando a leitura termina (ou nunca, se a pessoa preferiu preencher na mão).
  useEffect(() => {
    if (preenchido || manual || !rascunho || rascunho.ocr_status === "processando") return;
    setDraft(rascunhoParaDraft(rascunho));
    setPreenchido(true);
  }, [rascunho, preenchido, manual]);

  useEffect(() => {
    fechar.current?.focus();
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || salvando) return;
      // Esc com a pergunta aberta = "continuar revisando".
      if (saindo) setSaindo(false);
      else tentarSair();
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onFechar, salvando, saindo, rascunho, erroCarga]);

  /** Com o comprovante carregado, sair (X ou Esc) pergunta o que fazer com ele; sem ele (erro de carga), só fecha. */
  function tentarSair() {
    if (salvando) return;
    if (!rascunho || erroCarga) { onFechar(); return; }
    setSaindo(true);
  }

  const imagem = rascunho ? exibivelComoImagem(rascunho.mime_type) : false;
  const { url } = useBlobUrl(imagem ? id : null, () => vault.comprovantes.rascunhos.conteudo(id));
  const lendo = !manual && (!rascunho || rascunho.ocr_status === "processando");
  const formularioPronto = manual || preenchido;
  const conferir = rascunho ? camposParaConferir(rascunho) : [];

  async function confirmar() {
    if (salvando) return;
    setSalvando(true);
    setErro(null);
    try {
      let beneficiarioId: string | undefined;
      if (draft.beneficiarioNome.trim()) beneficiarioId = (await vault.beneficiarios.criarOuEncontrar({ nome: draft.beneficiarioNome.trim() })).id;
      const criado = await vault.comprovantes.rascunhos.confirmar(id, {
        tipo: draft.tipoTransacao,
        valor_centavos: draft.valorCentavos,
        data: draft.dataTransacao,
        descricao: draft.texto.trim(),
        categoria_id: draft.categoriaId ?? undefined,
        conta_id: draft.contaId ?? undefined,
        beneficiario_id: beneficiarioId,
        forma_pagamento: draft.formaPagamento ?? undefined,
        status: draft.statusTransacao,
        observacoes: draft.observacoesTransacao.trim() || undefined,
      });
      onMudou({ id: criado.id, data: criado.data ?? draft.dataTransacao, descricao: criado.descricao ?? draft.texto.trim() });
      onFechar();
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível guardar o comprovante.");
      setSalvando(false);
    }
  }

  /** `confirmar = false` quando quem chama já perguntou (a pergunta de sair). */
  async function descartar(confirmar = true) {
    if (confirmar && !window.confirm("Descartar este comprovante? O arquivo será apagado do Cofre.")) return;
    try {
      await vault.comprovantes.rascunhos.descartar(id);
      onMudou();
      onFechar();
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível descartar o comprovante.");
    }
  }

  async function lerDeNovo() {
    setErro(null);
    try {
      await vault.comprovantes.rascunhos.reprocessar(id);
      setPreenchido(false);
      setManual(false);
      setTentativa((n) => n + 1);
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível tentar de novo.");
    }
  }

  return (
    <div className="cofre-viewer-backdrop">
      <div className="cofre-viewer cofre-review" role="dialog" aria-modal="true" aria-label="Revisar comprovante">
        <header>
          <div><b>Revisar comprovante</b><small>{rascunho?.nome_arquivo ?? "Carregando…"}</small></div>
          <button ref={fechar} className="cofre-icon-button" aria-label="Fechar" disabled={salvando} onClick={tentarSair}><X size={18} /></button>
        </header>

        {erroCarga ? (
          <div role="alert" className="cofre-viewer-body cofre-viewer-erro">
            <p>{erroCarga}</p>
            <button className="cofre-secondary" onClick={() => setTentativa((n) => n + 1)}><RefreshCw size={14} />Tentar novamente</button>
          </div>
        ) : (
          <div className="cofre-review-corpo">
            <aside className="cofre-review-arquivo" aria-label="Arquivo do comprovante">
              {imagem && url ? <img src={url} alt={`Comprovante ${rascunho?.nome_arquivo ?? ""}`} />
                : <div className="cofre-viewer-erro"><FileText size={36} aria-hidden /><p>{rascunho && !imagem ? "Este arquivo não pode ser exibido aqui, mas será guardado no Cofre." : "Carregando arquivo…"}</p></div>}
            </aside>
            <section className="cofre-review-form">
              {jaAnexadoEm && (
                <p role="alert" className="cofre-launch-alert">
                  Este comprovante já está guardado em outro lançamento.{" "}
                  {abrirLancamento && <button type="button" className="cofre-link" onClick={() => abrirLancamento(jaAnexadoEm)}>Abrir lançamento</button>}
                </p>
              )}
              {lendo && (
                <div role="status" className="cofre-review-aviso">
                  <RefreshCw size={14} aria-hidden /> Lendo o comprovante…
                  <button type="button" className="cofre-link" onClick={() => setManual(true)}>Preencher manualmente</button>
                </div>
              )}
              {!lendo && rascunho?.ocr_status === "pronto" && conferir.length > 0 && (
                <p role="status" className="cofre-review-aviso">Confira com atenção: {conferir.join(", ")}. A leitura automática pode errar.</p>
              )}
              {!lendo && rascunho?.ocr_status === "pronto" && conferir.length === 0 && (
                <p role="status" className="cofre-review-aviso">Dados lidos do comprovante. Confira antes de guardar.</p>
              )}
              {!lendo && rascunho && ["sem_texto", "indisponivel", "falhou"].includes(rascunho.ocr_status) && (
                <p role="status" className="cofre-review-aviso">
                  {rascunho.ocr_status === "sem_texto" && "Não encontrei texto legível neste arquivo. Preencha os dados abaixo."}
                  {rascunho.ocr_status === "indisponivel" && "Este servidor não lê este tipo de arquivo automaticamente. Preencha os dados abaixo."}
                  {rascunho.ocr_status === "falhou" && "A leitura automática falhou. Preencha os dados abaixo ou tente de novo."}{" "}
                  {rascunho.ocr_status !== "indisponivel" && <button type="button" className="cofre-link" onClick={() => void lerDeNovo()}>Ler de novo</button>}
                </p>
              )}
              {formularioPronto && (
                <div className="cofre-app cofre-capture-scope">
                  <TransactionForm
                    draft={draft}
                    setDraft={setDraft}
                    onSalvar={() => void confirmar()}
                    onFechar={tentarSair}
                    salvando={salvando}
                    eyebrow="NOVO COMPROVANTE"
                    titulo="Guardar no Cofre"
                    rotuloSalvar="Confirmar e guardar"
                    erro={erro}
                  />
                </div>
              )}
              {!formularioPronto && erro && <p role="alert" className="cofre-launch-alert">{erro}</p>}
            </section>
          </div>
        )}
        {saindo ? (
          <footer className="cofre-review-saida" role="alertdialog" aria-label="Sair da revisão">
            <p>Este comprovante ainda não foi guardado como lançamento. O que fazer com ele?</p>
            <div>
              <button className="cofre-secondary" onClick={() => setSaindo(false)}>Continuar revisando</button>
              <button className="cofre-secondary" onClick={onFechar}>Deixar na fila para depois</button>
              <button className="cofre-solid cofre-review-descartar" onClick={() => void descartar(false)}><Trash2 size={15} />Descartar</button>
            </div>
          </footer>
        ) : (
          <footer>
            <button className="cofre-secondary" disabled={salvando || !rascunho} onClick={() => void descartar()}><Trash2 size={15} />Descartar comprovante</button>
          </footer>
        )}
      </div>
    </div>
  );
}
