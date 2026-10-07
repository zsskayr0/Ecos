import { useEffect, useRef, useState } from "react";
import { ChevronLeft, Receipt } from "lucide-react";
import { vault, ApiError, type TransacaoApi, type FormaPagamento } from "@/lib/api";
import { EmptyState } from "@/components/common/EmptyState";
import { useRefreshBus } from "@/lib/refresh-bus";
import { useAppUI } from "@/lib/ui-context";
import { TransactionForm } from "@/screens/Create/TransactionForm";
import { useAutoriaDoCofre } from "@/lib/use-autoria-cofre";
import { DRAFT_VAZIO, type CapturaDraft } from "@/screens/Create/CreateFlow";
import { ComprovantesDaTransacao } from "./comprovantes/ComprovantesDaTransacao";
import { useListaDeLancamentos, useResumoDaLista } from "@/lib/lista-lancamentos";
import { BarraSlide } from "./BarraSlide";

const CHAVE_SLIDE = "ecos:cofre:modo-slide";
const lerSlide = () => { try { return localStorage.getItem(CHAVE_SLIDE) === "1"; } catch { return false; } };

/**
 * Edição de um lançamento: carrega, edita, salva e apaga (`GET`/`PATCH`/`DELETE /vault/transacoes/:id`). Usa o mesmo
 * formulário do novo lançamento, preenchido com a transação. Apagar dado financeiro continua com a cópia literal da
 * spec (seção 1.4): sem humor. Vive em dois lugares: a tela de detalhe e o painel ao lado do comprovante.
 */
export function EditorDeLancamento({ id: idDaRota, aoSalvar, aoExcluir, aoFechar, aninhado = false, comComprovantes = true }: {
  id?: string;
  aoSalvar: () => void;
  aoExcluir: () => void;
  aoFechar: () => void;
  /** Dentro de outra janela do Cofre (o painel do comprovante): não repete o contêiner de página inteira. */
  aninhado?: boolean;
  /** `false` esconde o container de anexos do formulário. */
  comComprovantes?: boolean;
}) {
  const { notificar } = useRefreshBus();
  const { abrirCaptura } = useAppUI();
  const autoria = useAutoriaDoCofre();
  const raiz = useRef<HTMLDivElement>(null);
  const lista = useListaDeLancamentos();
  const resumo = useResumoDaLista();
  // Modo Slide: a janela fica aberta (só o X fecha) e as setas passam pelos lançamentos da lista, na ordem e com os filtros escolhidos.
  const [slide, setSlide] = useState(() => !aninhado && lerSlide());
  const [id, setId] = useState(idDaRota);
  useEffect(() => { setId(idDaRota); }, [idDaRota]);
  const [excluidos, setExcluidos] = useState<ReadonlySet<string>>(new Set());
  const [direcao, setDirecao] = useState<"next" | "prev">("next");
  const [pendente, setPendente] = useState<1 | -1 | null>(null);
  const [salvoTick, setSalvoTick] = useState(0);
  const [salvoVisivel, setSalvoVisivel] = useState(false);
  useEffect(() => {
    if (!salvoVisivel) return;
    const t = window.setTimeout(() => setSalvoVisivel(false), 2200);
    return () => window.clearTimeout(t);
  }, [salvoVisivel, salvoTick]);
  const [batida, setBatida] = useState<{ tick: number; dir: 1 | -1 } | null>(null);
  const base = useRef("");
  const [tx, setTx] = useState<TransacaoApi | null>(null);
  const [naoEncontrada, setNaoEncontrada] = useState(false);
  const [draft, setDraft] = useState<CapturaDraft>(DRAFT_VAZIO);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!id) { setNaoEncontrada(true); return; }
    setNaoEncontrada(false);
    if (!slide) setTx(null);
    Promise.all([vault.transacoes.obter(id), vault.beneficiarios.listar().catch(() => [])])
      .then(([t, bens]) => {
        setTx(t);
        const carregado: CapturaDraft = {
          ...DRAFT_VAZIO,
          texto: t.descricao,
          valorCentavos: t.valor_centavos,
          tipoTransacao: t.tipo,
          categoriaId: t.categoria_id,
          contaId: t.conta_id,
          formaPagamento: (t.forma_pagamento as FormaPagamento | null) ?? null,
          beneficiarioNome: bens.find((b) => b.id === t.beneficiario_id)?.nome ?? "",
          statusTransacao: t.status,
          dataTransacao: t.data,
          observacoesTransacao: t.observacoes ?? "",
        };
        base.current = JSON.stringify(carregado);
        setDraft(carregado);
        setPendente(null);
      })
      .catch(() => setNaoEncontrada(true));
  }, [id]);

  const visiveis = lista.filter((i) => !excluidos.has(i));
  const indice = id ? visiveis.indexOf(id) : -1;
  const sujo = !!tx && base.current !== "" && JSON.stringify(draft) !== base.current;
  function ir(dir: 1 | -1, forcar = false) {
    const alvo = indice >= 0 ? visiveis[indice + dir] : undefined;
    if (!alvo) { setBatida((b) => ({ tick: (b?.tick ?? 0) + 1, dir })); return; }
    if (sujo && !forcar) { setPendente(dir); return; }
    setErro(null);
    setPendente(null);
    setDirecao(dir === 1 ? "next" : "prev");
    setId(alvo);
  }
  const irRef = useRef(ir);
  irRef.current = ir;
  async function salvarEIr() { const dir = pendente; if (dir && await salvar(false)) ir(dir, true); }
  function alternarSlide() {
    setSlide((v) => { const n = !v; try { localStorage.setItem(CHAVE_SLIDE, n ? "1" : "0"); } catch { /* vale só nesta sessão */ } return n; });
    setPendente(null);
  }
  // Setas do teclado: ← → andam pela lista (dentro de um campo de texto elas movem o cursor; com Alt/Ctrl valem em qualquer lugar).
  useEffect(() => {
    if (!slide) return;
    function aoTeclar(e: KeyboardEvent) {
      if ((e.key !== "ArrowLeft" && e.key !== "ArrowRight") || e.defaultPrevented) return;
      const alvo = e.target as HTMLElement | null;
      if (alvo?.closest(".cofre-calc")) return;
      const editando = !!alvo && (alvo.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(alvo.tagName));
      if (editando && !(e.altKey || e.ctrlKey || e.metaKey)) return;
      const foco = document.activeElement;
      if (foco && foco !== document.body && !raiz.current?.contains(foco)) return;
      e.preventDefault();
      irRef.current(e.key === "ArrowRight" ? 1 : -1);
    }
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [slide]);

  /** Abre um lançamento novo já preenchido com os dados deste (sem anexos), para editar antes de salvar. */
  function duplicar() {
    if (!tx) return;
    const copia: Partial<CapturaDraft> = { ...draft, texto: `${draft.texto.trim()} (cópia)` };
    aoFechar();
    abrirCaptura("transacao", null, copia);
  }

  async function salvar(avancar = true): Promise<boolean> {
    if (!id || !tx) return false;
    setSalvando(true);
    setErro(null);
    try {
      let beneficiarioId: string | undefined;
      if (draft.beneficiarioNome.trim()) {
        const b = await vault.beneficiarios.criarOuEncontrar({ nome: draft.beneficiarioNome.trim() });
        beneficiarioId = b.id;
      }
      await vault.transacoes.atualizar(id, {
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
      notificar();
      if (slide) {
        base.current = JSON.stringify(draft);
        setSalvoTick((n) => n + 1);
        setSalvoVisivel(true);
        // No Modo Slide salvar já passa para o próximo da lista; no último, fica por aqui mostrando "Salvo".
        const proximo = indice >= 0 ? visiveis[indice + 1] : undefined;
        if (avancar && proximo) { setErro(null); setPendente(null); setDirecao("next"); setId(proximo); }
      } else aoSalvar();
      return true;
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível salvar.");
      return false;
    } finally {
      setSalvando(false);
    }
  }

  async function excluir() {
    if (!id) return;
    setSalvando(true);
    try {
      await vault.transacoes.excluir(id);
      notificar();
      if (slide) {
        const alvo = visiveis[indice + 1] ?? visiveis[indice - 1];
        setExcluidos((e) => new Set(e).add(id));
        setSalvando(false);
        if (alvo) { setDirecao("next"); setId(alvo); } else aoExcluir();
        return;
      }
      aoExcluir();
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível apagar.");
      setSalvando(false);
    }
  }

  if (naoEncontrada || !tx) {
    return (
      <div className="px-4 pt-1">
        <button onClick={() => aoFechar()} className="mb-4 text-text-muted" aria-label="Voltar">
          <ChevronLeft />
        </button>
        {naoEncontrada
          ? <EmptyState icon={Receipt} title="Essa transação sumiu." subtitle="Pode ter sido apagada." />
          : <p className="py-10 text-center text-sm text-text-muted" role="status">Carregando...</p>}
      </div>
    );
  }

  return (
    <div ref={raiz} data-modo-slide={slide || undefined} className={aninhado ? "cofre-capture-scope" : "cofre-app cofre-capture-scope"}>
      <TransactionForm
        draft={draft}
        setDraft={setDraft}
        onSalvar={() => { void salvar(); }}
        onFechar={aoFechar}
        modoSlide={aninhado ? undefined : { ativo: slide, alternar: alternarSlide }}
        slideChave={slide ? tx.id : undefined}
        slideDir={direcao}
        barraSlide={slide ? <BarraSlide posicao={indice >= 0 ? indice + 1 : null} total={visiveis.length} onAnterior={() => ir(-1)} onProximo={() => ir(1)} sujo={sujo} salvoTick={salvoVisivel ? salvoTick : 0} pendente={pendente} onSalvarEIr={() => { void salvarEIr(); }} onDescartarEIr={() => pendente && ir(pendente, true)} onFicar={() => setPendente(null)} salvando={salvando} batida={batida} faltaPagar={resumo.pagar} /> : undefined}
        salvando={salvando}
        eyebrow="EDITAR REGISTRO"
        titulo="Editar lançamento"
        rotuloSalvar="Salvar alterações"
        erro={erro}
        onExcluir={() => { void excluir(); }}
        onDuplicar={duplicar}
        criadoPor={autoria.nomeDe(tx.criado_por)}
        anexos={comComprovantes ? <div className="cofre-anexos-par"><ComprovantesDaTransacao transacaoId={tx.id} aoMudar={notificar} /><ComprovantesDaTransacao transacaoId={tx.id} aoMudar={notificar} tipo="nota_fiscal" /></div> : undefined}
      />
    </div>
  );
}
