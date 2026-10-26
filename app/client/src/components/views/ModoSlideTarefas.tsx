import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { Archive, Check, CheckCheck, Trash2, ChevronLeft, ChevronRight, ListChecks, PanelRightClose, PanelRightOpen, X } from "lucide-react";
import { AcoesFocusContext, FecharDocumentoContext, ModoFocusDocumentoContext, PainelFocusControleContext, PainelFocusTarefaContext } from "@/lib/documento-popup";
import { movimentoReduzido } from "@/lib/movimento";
import { tarefas as tarefasApi } from "@/lib/api";
import { avisarExcluido, restaurarUltimoExcluido } from "@/lib/desfazer";
import { mensagemDeErro } from "@/lib/erros";
import { useRefreshBus } from "@/lib/refresh-bus";
import { definirStatusOtimista } from "@/lib/status-otimista";
import { ConfirmDeleteDialog } from "@/components/common/ConfirmDeleteDialog";
import type { Tarefa } from "@/lib/types";

const CHAVE_LISTA = "ecos:slide-tarefas:lista-aberta";
/** A lista lateral começa recolhida (como o painel do modo Focus) e a escolha é lembrada. */
const listaSalva = () => { try { return localStorage.getItem(CHAVE_LISTA) === "1"; } catch { return false; } };

type Acao = "concluida" | "arquivada" | "apagar";
/** Como cada decisão aparece na lista, na régua e no painel da tarefa já decidida. */
const VISUAL_ACAO: Record<Acao, { rotulo: string; texto: string; fundo: string; marca: string; Icone: typeof Check }> = {
  concluida: { rotulo: "Concluída", texto: "text-success", fundo: "bg-success/10", marca: "bg-success", Icone: Check },
  arquivada: { rotulo: "Arquivada", texto: "text-steel-300", fundo: "bg-steel-400/10", marca: "bg-steel-300", Icone: Archive },
  apagar: { rotulo: "Excluída", texto: "text-error", fundo: "bg-error/10", marca: "bg-error", Icone: Trash2 },
};

const ROTA_FECHAR = "/__fechar__";
const MARGEM_Y = 24;
/** O conjunto ocupa 75% da largura da janela do app; com a lista lateral aberta, 80% (a largura anima). */
const FRACAO_LARGURA = 0.75;
const FRACAO_LARGURA_COM_LISTA = 0.8;
const LARGURA_LISTA = 300;
const ALTURA_MAX = 900;
const COR_PRIORIDADE = { alta: "bg-error", media: "bg-warning", baixa: "bg-cyan" } as const;

function Fechar({ aoFechar }: { aoFechar: () => void }) {
  useEffect(aoFechar, [aoFechar]);
  return null;
}

/**
 * Uma tarefa montada em camada própria. A nova tarefa carrega por baixo (invisível) enquanto a anterior continua à
 * vista; quando ela está pronta as duas trocam num fade com leve deslize, sem "Carregando…" nem piscada.
 */
function CamadaTarefa({ id, rotas, ativa, inicial, direcao, controlePainel, acoes, aoResolver, aoPronta }: {
  id: string; rotas: ReactNode; ativa: boolean; inicial: boolean; direcao: 1 | -1;
  controlePainel: { aberto: boolean; alternar: () => void; disponivel?: boolean }; acoes: HTMLElement | null;
  aoResolver: () => void; aoPronta: (id: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pronta, setPronta] = useState(inicial);
  const [visivel, setVisivel] = useState(inicial);
  useEffect(() => {
    const el = ref.current;
    if (!el || pronta) return;
    const achou = () => { if (el.querySelector("[data-task-composer], [role=\"alert\"]")) { setPronta(true); return true; } return false; };
    if (achou()) return;
    const mo = new MutationObserver(() => { if (achou()) mo.disconnect(); });
    mo.observe(el, { childList: true, subtree: true });
    const limite = window.setTimeout(() => setPronta(true), 1500);
    return () => { mo.disconnect(); window.clearTimeout(limite); };
  }, [pronta]);
  useEffect(() => {
    if (!pronta) return;
    const quadro = window.requestAnimationFrame(() => setVisivel(true));
    aoPronta(id);
    return () => window.cancelAnimationFrame(quadro);
  }, [pronta, id, aoPronta]);
  const mostrar = ativa && visivel;
  const reduzido = movimentoReduzido();
  const resolver = ativa ? aoResolver : () => {};
  return (
    <div ref={ref} aria-hidden={!ativa || undefined} {...(ativa ? {} : ({ inert: "" } as object))}
      className={`px-6 py-5 ${ativa ? "relative" : "pointer-events-none absolute inset-x-0 top-0"}`}
      style={{ opacity: mostrar ? 1 : 0, transform: mostrar || reduzido ? "none" : `translateX(${(ativa ? direcao : -direcao) * 14}px)`, transition: reduzido ? "none" : "opacity 130ms ease, transform 170ms cubic-bezier(0.22, 1, 0.36, 1)" }}>
      <FecharDocumentoContext.Provider value={resolver}>
        <ModoFocusDocumentoContext.Provider value={true}>
          <PainelFocusTarefaContext.Provider value={null}>
            <PainelFocusControleContext.Provider value={controlePainel}>
              <AcoesFocusContext.Provider value={acoes}>
                <MemoryRouter initialEntries={[ROTA_FECHAR, `/tarefa/${id}`]} initialIndex={1}>
                  <Routes><Route path={ROTA_FECHAR} element={<Fechar aoFechar={resolver} />} />{rotas}</Routes>
                </MemoryRouter>
              </AcoesFocusContext.Provider>
            </PainelFocusControleContext.Provider>
          </PainelFocusTarefaContext.Provider>
        </ModoFocusDocumentoContext.Provider>
      </FecharDocumentoContext.Provider>
    </div>
  );
}

const editavel = (alvo: EventTarget | null) => !!(alvo as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]');

/**
 * Modo Slide das tarefas: a camada do modo Focus, mas em vez do painel lateral há uma aba com a contagem da visualização
 * acima da tarefa e uma galeria (estilo "fotos") abaixo, com as setas para andar de uma tarefa à outra. Concluir,
 * arquivar ("não farei") ou apagar tira a tarefa da fila e já mostra a próxima.
 */
export function ModoSlideTarefas({ tarefas, inicial, aoFechar }: { tarefas: readonly Tarefa[]; inicial?: string; aoFechar: () => void }) {
  const [fila] = useState<readonly Tarefa[]>(tarefas);
  const [idx, setIdx] = useState(() => Math.max(0, tarefas.findIndex((t) => t.id === inicial)));
  const [decisoes, setDecisoes] = useState<Record<string, Acao>>({});
  const [fim, setFim] = useState(false);
  const [balanco, setBalanco] = useState({ concluida: 0, arquivada: 0, apagar: 0 });
  const [saindo, setSaindo] = useState(false);
  const [listaAberta, setListaAberta] = useState(listaSalva);
  const [confirmandoApagar, setConfirmandoApagar] = useState(false);
  const [erroAcao, setErroAcao] = useState<string | null>(null);
  const { notificar } = useRefreshBus();
  const [acoes, setAcoes] = useState<HTMLElement | null>(null);
  const [rotas, setRotas] = useState<ReactNode>(null);
  const [, setVersaoLayout] = useState(0);
  const raiz = useRef<HTMLDivElement>(null);
  const rolagem = useRef<HTMLDivElement>(null);
  const primeiraId = useRef(tarefas[Math.max(0, tarefas.findIndex((t) => t.id === inicial))]?.id);
  const [camadas, setCamadas] = useState<string[]>(() => (tarefas.length ? [tarefas[Math.max(0, tarefas.findIndex((t) => t.id === inicial))].id] : []));
  const tira = useRef<HTMLDivElement>(null);
  const direcao = useRef<1 | -1>(1);
  const filaRef = useRef(fila);
  filaRef.current = fila;
  const idxRef = useRef(idx);
  idxRef.current = idx;
  const decisoesRef = useRef(decisoes);
  decisoesRef.current = decisoes;

  const atual = fila[Math.min(idx, fila.length - 1)] as Tarefa | undefined;
  const atualId = atual?.id ?? null;
  const decisaoAtual = atual ? decisoes[atual.id] : undefined;
  const resolvidas = Object.keys(decisoes).length;

  // As rotas do app importam as listas (que abrem este modo): carregar sob demanda evita o ciclo de módulos.
  useEffect(() => {
    let ativo = true;
    void import("@/routes/screen-routes").then((m) => { if (ativo) setRotas(m.screenRoutes); });
    return () => { ativo = false; };
  }, []);
  useEffect(() => { raiz.current?.focus(); }, []);
  useEffect(() => {
    const aoRedimensionar = () => setVersaoLayout((v) => v + 1);
    window.addEventListener("resize", aoRedimensionar);
    return () => window.removeEventListener("resize", aoRedimensionar);
  }, []);

  const alternarLista = () => setListaAberta((v) => { try { localStorage.setItem(CHAVE_LISTA, v ? "0" : "1"); } catch { /* só não lembra */ } return !v; });

  const fechar = useCallback(() => {
    if (movimentoReduzido()) { aoFechar(); return; }
    setSaindo(true);
    window.setTimeout(aoFechar, 160);
  }, [aoFechar]);

  /** Próxima tarefa ainda sem decisão: primeiro à frente, depois as de trás. `-1` = todas decididas. */
  const proximaPendente = (de: number, dec: Record<string, Acao>) => {
    const f = filaRef.current;
    for (let i = de + 1; i < f.length; i++) if (!dec[f[i].id]) return i;
    for (let i = de - 1; i >= 0; i--) if (!dec[f[i].id]) return i;
    return -1;
  };

  /** As telas avisam por "fechar documento" (o que só acontece fora dos botões do slide): segue para a próxima pendente. */
  const resolverAtual = useCallback(() => {
    const prox = proximaPendente(idxRef.current, decisoesRef.current);
    if (prox >= 0) { direcao.current = prox > idxRef.current ? 1 : -1; setIdx(prox); }
  }, []);

  /**
   * Otimista: a decisão vale na tela na hora (a tarefa fica marcada na lista e na régua, o contador sobe, a próxima
   * pendente aparece) e o servidor é avisado em segundo plano. Se falhar, a marca sai e a tarefa volta a ser a atual.
   */
  function decidir(acao: Acao) {
    if (!atual) return;
    const tarefa = atual;
    const posicaoNaFila = filaRef.current.findIndex((t) => t.id === tarefa.id);
    setErroAcao(null);
    setConfirmandoApagar(false);
    const novas = { ...decisoesRef.current, [tarefa.id]: acao };
    decisoesRef.current = novas;
    setDecisoes(novas);
    setBalanco((b) => ({ ...b, [acao]: b[acao] + 1 }));
    const prox = proximaPendente(posicaoNaFila, novas);
    if (prox >= 0) { direcao.current = prox > posicaoNaFila ? 1 : -1; setIdx(prox); } else setFim(true);
    const reverterLista = acao === "apagar" ? null : definirStatusOtimista([tarefa.id], acao);
    const pedido = acao === "apagar" ? tarefasApi.excluir(tarefa.id) : tarefasApi.atualizarStatus(tarefa.id, acao);
    pedido.then(() => {
      notificar();
      if (acao === "apagar") avisarExcluido("tarefa", tarefa.titulo, notificar);
    }).catch((e) => {
      reverterLista?.();
      setDecisoes((d) => { const { [tarefa.id]: _, ...resto } = d; decisoesRef.current = resto; return resto; });
      direcao.current = -1;
      setIdx(Math.max(0, posicaoNaFila));
      setFim(false);
      setBalanco((b) => ({ ...b, [acao]: Math.max(0, b[acao] - 1) }));
      setErroAcao(mensagemDeErro(e, `Não deu para ${acao === "concluida" ? "concluir" : acao === "arquivada" ? "arquivar" : "apagar"} “${tarefa.titulo || "Sem título"}”.`));
    });
  }

  /** Volta a tarefa decidida a pendente (ou a tira da Lixeira), também de forma otimista. */
  function desfazer() {
    if (!atual || !decisaoAtual) return;
    const tarefa = atual;
    const acao = decisaoAtual;
    setErroAcao(null);
    setDecisoes((d) => { const { [tarefa.id]: _, ...resto } = d; decisoesRef.current = resto; return resto; });
    setBalanco((b) => ({ ...b, [acao]: Math.max(0, b[acao] - 1) }));
    setFim(false);
    if (acao !== "apagar") definirStatusOtimista([tarefa.id], "pendente");
    const pedido = acao === "apagar" ? restaurarUltimoExcluido("tarefa", tarefa.titulo) : tarefasApi.atualizarStatus(tarefa.id, "pendente");
    pedido.then(() => notificar()).catch((e) => {
      setDecisoes((d) => { const novas = { ...d, [tarefa.id]: acao }; decisoesRef.current = novas; return novas; });
      setBalanco((b) => ({ ...b, [acao]: b[acao] + 1 }));
      setErroAcao(mensagemDeErro(e, `Não deu para desfazer “${tarefa.titulo || "Sem título"}”.`));
    });
  }

  const ir = useCallback((destino: number) => {
    const n = filaRef.current.length;
    const alvo = Math.min(n - 1, Math.max(0, destino));
    if (alvo === idxRef.current) return;
    direcao.current = alvo > idxRef.current ? 1 : -1;
    setFim(false);
    setIdx(alvo);
  }, []);

  // A tarefa nova entra como uma camada a mais (a anterior sai quando ela estiver pronta); a lista acompanha a escolhida.
  useLayoutEffect(() => {
    if (!atualId) return;
    if (decisaoAtual) {
      // Tarefa já decidida: o painel de estado ocupa o lugar e as camadas carregadas saem.
      const limpar = window.setTimeout(() => { if (decisoesRef.current[filaRef.current[idxRef.current]?.id ?? ""]) setCamadas([]); }, movimentoReduzido() ? 0 : 180);
      return () => window.clearTimeout(limpar);
    }
    setCamadas((c) => (c.includes(atualId) ? c : [...c, atualId]));
  }, [atualId, decisaoAtual]);
  useLayoutEffect(() => {
    if (atualId) tira.current?.querySelector<HTMLElement>(`[data-slide-id="${atualId}"]`)?.scrollIntoView({ inline: "nearest", block: "nearest", behavior: movimentoReduzido() ? "auto" : "smooth" });
  }, [atualId]);
  const aoPronta = useCallback((id: string) => {
    if (id !== (filaRef.current[Math.min(idxRef.current, filaRef.current.length - 1)]?.id)) return;
    rolagem.current?.scrollTo({ top: 0 });
    window.setTimeout(() => setCamadas((c) => (c.includes(id) ? [id] : c)), movimentoReduzido() ? 0 : 180);
  }, []);

  function aoTeclar(e: KeyboardEvent) {
    if (e.defaultPrevented) return;
    if (e.key === "Escape" && !confirmandoApagar) { e.preventDefault(); e.stopPropagation(); fechar(); return; }
    if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && (e.altKey || !editavel(e.target))) {
      e.preventDefault();
      ir(idxRef.current + (e.key === "ArrowRight" ? 1 : -1));
    }
  }

  const largura = Math.max(320, Math.round(window.innerWidth * (listaAberta ? FRACAO_LARGURA_COM_LISTA : FRACAO_LARGURA)));
  const altura = Math.min(ALTURA_MAX, Math.max(420, window.innerHeight - MARGEM_Y * 2));
  const total = fila.length;
  const posicao = Math.min(idx, total - 1) + 1;
  const animacao = saindo ? "ecos-modal-out" : "ecos-focus-in";
  const controlePainel = useMemo(() => ({ aberto: false, alternar: () => {}, disponivel: false }), []);

  const BTN_SETA_FLUTUANTE = "flex size-[52px] shrink-0 items-center justify-center rounded-2xl border border-border bg-base text-text-secondary shadow-nav transition-all hover:bg-surface-2 hover:text-text-primary active:scale-95 disabled:pointer-events-none disabled:opacity-35";
  const BTN_SETA = "flex size-10 shrink-0 items-center justify-center rounded-xl border border-border text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary disabled:pointer-events-none disabled:opacity-35";

  return createPortal(
    <div ref={raiz} role="dialog" aria-modal="true" aria-label="Modo Slide das tarefas" tabIndex={-1} onKeyDown={aoTeclar} className="fixed inset-0 outline-none" style={{ zIndex: 300 }}>
      <div aria-hidden className={`absolute inset-0 bg-black/45 backdrop-blur-[10px] ${saindo ? "ecos-backdrop-out" : "ecos-backdrop-in"}`} />
      <div className="pointer-events-none absolute flex flex-col gap-3 transition-[left,width] duration-300 ease-out motion-reduce:transition-none" style={{ left: Math.round((window.innerWidth - largura) / 2), top: Math.round((window.innerHeight - altura) / 2), width: largura, height: altura }}>
        {/* Balanço da sessão: aba fininha acima da decisão, só os números (cada um dá um pulinho ao mudar). */}
        <div role="status" aria-label="Balanço desta sessão" className={`pointer-events-auto mx-auto flex h-10 shrink-0 items-center gap-1 rounded-2xl border border-border bg-base px-2 shadow-nav ${animacao}`}>
          {([["concluida", Check, "text-success", "Concluídas"], ["arquivada", Archive, "text-steel-300", "Arquivadas"], ["apagar", Trash2, "text-error", "Excluídas"]] as const).map(([chave, Icone, cor, rotulo], i) => (
            <Fragment key={chave}>
              {i > 0 && <span aria-hidden className="h-4 w-px bg-border" />}
              <span title={`${rotulo} nesta sessão`} className={`flex min-w-[58px] items-center justify-center gap-1.5 px-2.5 text-sm font-semibold ${cor}`}>
                <Icone size={15} strokeWidth={2.25} />
                <b key={balanco[chave]} className="ecos-focus-in inline-block tabular-nums">{balanco[chave]}</b>
              </span>
            </Fragment>
          ))}
        </div>
        {/* Decisão: aba flutuante própria, acima da tarefa. Reaparece a cada tarefa. */}
        {atual && (
          <div className="pointer-events-none mx-auto flex shrink-0 items-center gap-2">
          <button type="button" onClick={() => ir(idx - 1)} disabled={posicao <= 1} title="Anterior (←)" aria-label="Tarefa anterior" className={`pointer-events-auto ${BTN_SETA_FLUTUANTE} ${animacao}`}><ChevronLeft size={18} /></button>
          <div className={`pointer-events-auto flex shrink-0 items-center gap-1.5 rounded-2xl border border-border bg-base p-1.5 shadow-nav ${animacao}`}>
            {!decisaoAtual && !fim ? <>
              <button type="button" onClick={() => decidir("concluida")} className="group flex h-11 items-center gap-2 rounded-xl bg-success/12 px-5 text-sm font-semibold text-success transition-all hover:bg-success hover:text-white active:scale-[0.97]"><Check size={17} strokeWidth={2.25} />Concluir</button>
              <button type="button" onClick={() => decidir("arquivada")} className="flex h-11 items-center gap-2 rounded-xl bg-surface-2 px-5 text-sm font-semibold text-text-secondary transition-all hover:bg-steel-500 hover:text-white active:scale-[0.97]"><Archive size={17} strokeWidth={2} />Arquivar</button>
              <button type="button" onClick={() => setConfirmandoApagar(true)} className="flex h-11 items-center gap-2 rounded-xl bg-error/12 px-5 text-sm font-semibold text-error transition-all hover:bg-error hover:text-white active:scale-[0.97]"><Trash2 size={17} strokeWidth={2} />Apagar</button>
            </> : decisaoAtual ? (
              <span key={decisaoAtual} className={`ecos-focus-in flex h-11 items-center gap-2 rounded-xl px-6 text-sm font-semibold ${VISUAL_ACAO[decisaoAtual].fundo} ${VISUAL_ACAO[decisaoAtual].texto}`}>{(() => { const { Icone } = VISUAL_ACAO[decisaoAtual]; return <Icone size={17} strokeWidth={2.25} />; })()}{VISUAL_ACAO[decisaoAtual].rotulo}</span>
            ) : <span className="flex h-11 items-center gap-2 rounded-xl bg-success/10 px-6 text-sm font-semibold text-success"><CheckCheck size={17} strokeWidth={2.25} />Tudo feito</span>}
            {erroAcao && <p role="alert" className="max-w-xs truncate px-3 text-xs text-error" title={erroAcao}>{erroAcao}</p>}
            <ConfirmDeleteDialog open={confirmandoApagar} title="Apagar esta tarefa?" busy={false} onCancel={() => setConfirmandoApagar(false)} onConfirm={() => decidir("apagar")} />
          </div>
          <button type="button" onClick={() => ir(idx + 1)} disabled={posicao >= total} title="Próxima (→)" aria-label="Próxima tarefa" className={`pointer-events-auto ${BTN_SETA_FLUTUANTE} ${animacao}`}><ChevronRight size={18} /></button>
          </div>
        )}
        <div className="flex min-h-0 flex-1 gap-3">
          {/* Aba da tarefa: a mesma tela do modo Focus, sem o painel lateral de opções. */}
          <div className={`pointer-events-auto flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-base shadow-nav ${animacao}`}>
            <header className="flex h-9 shrink-0 select-none items-center gap-2 border-b border-border bg-surface-1 pl-3.5 pr-1.5">
              <span className="min-w-0 flex-1 truncate text-xs font-medium text-text-muted">{atual ? `Tarefa ${posicao} de ${total}` : "Fila concluída"}</span>
              <div ref={setAcoes} className="hidden" />
              <button type="button" onClick={alternarLista} aria-pressed={listaAberta} title={listaAberta ? "Recolher a lista de tarefas" : "Mostrar a lista de tarefas"} aria-label={listaAberta ? "Recolher a lista de tarefas" : "Mostrar a lista de tarefas"} className="flex size-7 items-center justify-center rounded-md text-text-muted hover:bg-surface-3 hover:text-text-primary">{listaAberta ? <PanelRightClose size={15} strokeWidth={1.75} /> : <PanelRightOpen size={15} strokeWidth={1.75} />}</button>
              <button type="button" onClick={fechar} title="Sair do Modo Slide (Esc)" aria-label="Sair do Modo Slide" className="flex size-7 items-center justify-center rounded-md text-text-muted hover:bg-surface-3 hover:text-text-primary"><X size={15} strokeWidth={1.75} /></button>
            </header>
            <div ref={rolagem} className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {fim || !atual ? (
                <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
                  <CheckCheck size={42} strokeWidth={1.5} className="text-success" />
                  <h2 className="font-display text-2xl text-text-primary">Tudo feito por aqui</h2>
                  <p className="text-sm text-text-secondary">{resolvidas > 0 ? `${resolvidas} ${resolvidas === 1 ? "tarefa resolvida" : "tarefas resolvidas"} nesta sessão. Escolha uma na lista ou na régua para rever ou desfazer.` : "Não há tarefas nesta visualização."}</p>
                </div>
              ) : decisaoAtual ? (
                <div key={atual.id} className="ecos-focus-in flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
                  {(() => { const v = VISUAL_ACAO[decisaoAtual]; return <span className={`flex size-16 items-center justify-center rounded-3xl ${v.fundo} ${v.texto}`}><v.Icone size={30} strokeWidth={2} /></span>; })()}
                  <div>
                    <p className={`font-display text-2xl font-semibold ${VISUAL_ACAO[decisaoAtual].texto}`}>{VISUAL_ACAO[decisaoAtual].rotulo}</p>
                    <p className={`mx-auto mt-2 line-clamp-3 max-w-md text-base text-text-secondary ${decisaoAtual === "apagar" ? "line-through" : ""}`}>{atual.titulo || "Sem título"}</p>
                  </div>
                  <button type="button" onClick={desfazer} className="min-h-11 rounded-xl border border-border px-6 text-sm font-medium text-text-primary transition-colors hover:bg-surface-2">Desfazer</button>
                </div>
              ) : (
                <div className="relative mx-auto w-full max-w-[1000px]">
                  {rotas ? camadas.map((id) => <CamadaTarefa key={id} id={id} rotas={rotas} ativa={id === atual.id} inicial={id === primeiraId.current && camadas.length === 1} direcao={direcao.current} controlePainel={controlePainel} acoes={acoes} aoResolver={resolverAtual} aoPronta={aoPronta} />) : <p className="py-10 text-center text-sm text-text-muted">Carregando…</p>}
                </div>
              )}
            </div>
          </div>

          {/* Coluna da visualização: a contagem e, abaixo, as tarefas como um feed miúdo (só os nomes). */}
          <aside aria-label="Tarefas da visualização" aria-hidden={!listaAberta || undefined} {...(listaAberta ? {} : ({ inert: "" } as object))}
            className={`flex shrink-0 flex-col overflow-hidden rounded-2xl border bg-base shadow-nav transition-[width,opacity,margin] duration-300 ease-out motion-reduce:transition-none ${animacao} ${listaAberta ? "pointer-events-auto border-border opacity-100" : "pointer-events-none -ml-3 border-transparent opacity-0"}`} style={{ width: listaAberta ? LARGURA_LISTA : 0 }}>
            <div className="flex shrink-0 items-center gap-2.5 whitespace-nowrap border-b border-border bg-surface-1 px-4 py-3" style={{ width: LARGURA_LISTA }}>
              <ListChecks size={16} strokeWidth={1.75} className="shrink-0 text-steel-300" />
              <p className="min-w-0 flex-1 text-sm leading-snug text-text-secondary" aria-live="polite">
                <b className="font-semibold text-text-primary">{total}</b> {total === 1 ? "tarefa" : "tarefas"} nesta visualização
                {resolvidas > 0 && <span className="block text-xs text-text-muted">{resolvidas} {resolvidas === 1 ? "resolvida" : "resolvidas"} nesta sessão</span>}
              </p>
            </div>
            <div ref={tira} role="listbox" aria-label="Tarefas" className="min-h-0 flex-1 overflow-y-auto p-1.5" style={{ width: LARGURA_LISTA }}>
              {fila.map((t, i) => {
                const ativa = i === posicao - 1;
                const d = decisoes[t.id];
                const v = d ? VISUAL_ACAO[d] : null;
                return (
                  <button key={t.id} type="button" role="option" aria-selected={ativa} data-slide-id={t.id} onClick={() => ir(i)} title={t.titulo || "Sem título"}
                    className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs leading-tight transition-colors ${ativa ? "ring-1 ring-inset ring-steel-400/60" : ""} ${v ? `${v.fundo} ${v.texto}` : ativa ? "bg-surface-3 font-medium text-text-primary" : "text-text-secondary hover:bg-surface-2"}`}>
                    <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${v ? v.marca : COR_PRIORIDADE[t.prioridade]}`} />
                    <span className={`truncate ${d === "apagar" ? "line-through" : ""}`}>{t.titulo || "Sem título"}</span>
                    {v && <span className="ml-auto shrink-0 text-[10px] font-semibold uppercase tracking-wide opacity-90">{v.rotulo}</span>}
                  </button>
                );
              })}
            </div>
          </aside>
        </div>

        {/* Barra de baixo: setas e a posição (pontinhos e "3 de 12"), sem nomes. */}
        {total > 0 && (
          <div className={`pointer-events-auto flex h-14 shrink-0 items-center gap-3 rounded-2xl border border-border bg-base px-2.5 shadow-nav ${animacao}`}>
            <button type="button" onClick={() => ir(idx - 1)} disabled={posicao <= 1} title="Anterior (←)" aria-label="Tarefa anterior" className={BTN_SETA}><ChevronLeft size={18} /></button>
            <div className="flex min-w-0 flex-1 items-center justify-center gap-3">
              {/* Régua de posição: o preenchimento e a bolinha deslizam até a tarefa; clicar na régua pula para ela. */}
              <div role="slider" tabIndex={-1} aria-label="Posição na fila" aria-valuemin={1} aria-valuemax={total} aria-valuenow={posicao}
                onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); ir(Math.round(((e.clientX - r.left) / r.width) * (total - 1))); }}
                className="group relative flex h-8 w-full max-w-[560px] cursor-pointer items-center">
                <div className="relative h-1.5 w-full rounded-full bg-surface-3">
                  <i className="absolute inset-y-0 left-0 rounded-full bg-steel-400/70 transition-[width] duration-300 ease-out motion-reduce:transition-none" style={{ width: total > 1 ? `${((posicao - 1) / (total - 1)) * 100}%` : "100%" }} />
                  {total <= 60 && total > 1 && fila.map((t, i) => { const d = decisoes[t.id]; return <span key={t.id} aria-hidden title={d ? VISUAL_ACAO[d].rotulo : undefined} className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full transition-all duration-300 ${d ? `size-2 ${VISUAL_ACAO[d].marca}` : `size-1 ${i < posicao ? "bg-base/60" : "bg-text-muted/50"}`}`} style={{ left: `${(i / (total - 1)) * 100}%` }} />; })}
                  <span aria-hidden className="absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-steel-400 bg-base shadow transition-[left,transform] duration-300 ease-out group-hover:scale-110 motion-reduce:transition-none" style={{ left: total > 1 ? `${((posicao - 1) / (total - 1)) * 100}%` : "100%" }} />
                </div>
              </div>
              <span className="shrink-0 text-xs text-text-secondary"><b key={posicao} className="ecos-focus-in inline-block font-semibold text-text-primary">{posicao}</b> de {total}</span>
            </div>
            <button type="button" onClick={() => ir(idx + 1)} disabled={posicao >= total} title="Próxima (→)" aria-label="Próxima tarefa" className={BTN_SETA}><ChevronRight size={18} /></button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
