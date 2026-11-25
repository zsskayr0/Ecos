import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, Check, CheckCheck } from "lucide-react";
import { notificacoes as notificacoesApi, type NotificacaoApi } from "@/lib/api";
import { formatTempoRelativo } from "@/lib/format";
import { mensagemDeErro } from "@/lib/erros";
import { useAppUI } from "@/lib/ui-context";
import { useAuth } from "@/lib/auth-context";
import { useRefreshBus } from "@/lib/refresh-bus";

const DURACAO_SAIDA_MS = 200;
/** Quanto arrastar para o lado (px) para o gesto valer. */
const LIMITE_SWIPE_PX = 88;
const TEMPO_RISCO_MS = 300;
const TEMPO_SAIDA_MS = 240;
const TEMPO_RECOLHE_MS = 220;
const DIAS_PARA_ESQUECER = 120;

type Aba = NotificacaoApi["categoria"] | "tudo" | "revisadas";
const ABAS: { valor: Aba; label: string }[] = [
  { valor: "tudo", label: "Tudo" },
  { valor: "cofre", label: "Cofre" },
  { valor: "agenda", label: "Agenda" },
  { valor: "equipes", label: "Equipes" },
  { valor: "sync", label: "Sincronização" },
  { valor: "revisadas", label: "Revisadas" },
];

function agruparPorData(itens: NotificacaoApi[]) {
  const grupos: Record<string, NotificacaoApi[]> = { Hoje: [], Ontem: [], "Esta semana": [], Antes: [] };
  const agora = Date.now();
  for (const n of itens) {
    const diffDias = Math.floor((agora - new Date(n.criado_em).getTime()) / 86_400_000);
    if (diffDias < 1) grupos.Hoje.push(n);
    else if (diffDias < 2) grupos.Ontem.push(n);
    else if (diffDias < 7) grupos["Esta semana"].push(n);
    else grupos.Antes.push(n);
  }
  return grupos;
}

/** Quais avisos a pessoa já revisou (id → quando). Fica neste aparelho; ids muito antigos são esquecidos. */
function useRevisadas() {
  const { perfil } = useAuth();
  const chave = `ecos:notificacoes-revisadas:${perfil?.id ?? "anon"}`;
  const [mapa, setMapa] = useState<Record<string, number>>(() => {
    try {
      const bruto = JSON.parse(localStorage.getItem(chave) ?? "{}") as Record<string, number>;
      const corte = Date.now() - DIAS_PARA_ESQUECER * 86_400_000;
      return Object.fromEntries(Object.entries(bruto).filter(([, t]) => t > corte));
    } catch { return {}; }
  });
  function alternar(id: string) {
    setMapa((atual) => {
      const proximo = { ...atual };
      if (proximo[id]) delete proximo[id]; else proximo[id] = Date.now();
      try { localStorage.setItem(chave, JSON.stringify(proximo)); } catch { /* sem armazenamento local: vale só nesta sessão */ }
      return proximo;
    });
  }
  /** Revisa (ou devolve) vários de uma vez. */
  function definir(ids: string[], revisar: boolean) {
    setMapa((atual) => {
      const proximo = { ...atual };
      for (const id of ids) { if (revisar) proximo[id] = proximo[id] ?? Date.now(); else delete proximo[id]; }
      try { localStorage.setItem(chave, JSON.stringify(proximo)); } catch { /* vale só nesta sessão */ }
      return proximo;
    });
  }
  return { revisadas: mapa, alternar, definir };
}

/**
 * Notificações no mesmo véu desfocado da busca: abre por cima da tela em uso, com entrada e saída animadas,
 * abas por área e a lista ocupando o espaço que sobra (com rolagem). Tocar fora, Esc ou Fechar volta para onde você estava.
 * Arrastar um aviso para qualquer lado o risca e o manda para "Revisadas"; lá, o mesmo gesto o traz de volta.
 */
export function NotificacoesRapidas() {
  const { notificacoesAbertas, fecharNotificacoes } = useAppUI();
  const [montada, setMontada] = useState(false);
  const [saindo, setSaindo] = useState(false);
  useEffect(() => {
    if (notificacoesAbertas) { setMontada(true); setSaindo(false); return; }
    if (!montada) return;
    setSaindo(true);
    const t = window.setTimeout(() => { setMontada(false); setSaindo(false); }, DURACAO_SAIDA_MS);
    return () => window.clearTimeout(t);
  }, [notificacoesAbertas, montada]);
  if (!montada) return null;
  return <Painel saindo={saindo} fechar={fecharNotificacoes} />;
}

/**
 * Faixa de abas rolável por arrasto. Toque já rola sozinho (touch-action: pan-x); mouse e S Pen
 * não rolam uma faixa sem barra, então o arrasto é feito aqui. O clique que termina um arrasto é descartado.
 */
function useArrastarParaRolar<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const estado = useRef<{ x: number; rolagem: number; id: number; arrastou: boolean } | null>(null);
  return {
    ref,
    props: {
      style: { touchAction: "pan-x" } as React.CSSProperties,
      onPointerDown(e: React.PointerEvent<T>) {
        if (e.pointerType === "touch" || (e.pointerType === "mouse" && e.button !== 0)) return;
        estado.current = { x: e.clientX, rolagem: e.currentTarget.scrollLeft, id: e.pointerId, arrastou: false };
      },
      onPointerMove(e: React.PointerEvent<T>) {
        const s = estado.current;
        if (!s || s.id !== e.pointerId) return;
        const dx = e.clientX - s.x;
        if (!s.arrastou) {
          if (Math.abs(dx) < 5) return;
          s.arrastou = true;
          try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* segue sem captura */ }
        }
        e.currentTarget.scrollLeft = s.rolagem - dx;
      },
      onPointerUp(e: React.PointerEvent<T>) {
        const s = estado.current;
        if (!s || s.id !== e.pointerId) return;
        // mantém o "arrastou" até o clique que sucede o soltar ser engolido
        window.setTimeout(() => { if (estado.current === s) estado.current = null; }, 0);
      },
      onPointerCancel() { estado.current = null; },
      onClickCapture(e: React.MouseEvent<T>) {
        if (estado.current?.arrastou) { e.preventDefault(); e.stopPropagation(); }
      },
    },
  };
}

function Painel({ saindo, fechar }: { saindo: boolean; fechar: () => void }) {
  const navigate = useNavigate();
  const faixa = useArrastarParaRolar<HTMLDivElement>();
  const { versao, notificar } = useRefreshBus();
  const { revisadas, alternar, definir } = useRevisadas();
  const [aba, setAba] = useState<Aba>("tudo");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const selecionando = sel.size > 0;
  useEffect(() => { setSel(new Set()); }, [aba]);
  const [itens, setItens] = useState<NotificacaoApi[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => { if (e.key === "Escape") fechar(); };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [fechar]);

  // A aba escolhida sempre fica à vista, mesmo quando a faixa precisa rolar.
  useEffect(() => {
    faixa.ref.current?.querySelector<HTMLElement>(`[data-aba="${aba}"]`)?.scrollIntoView({ inline: "nearest", block: "nearest", behavior: "smooth" });
  }, [aba, faixa.ref]);

  useEffect(() => {
    let vivo = true;
    setErro(null);
    notificacoesApi
      .listar({ categoria: aba === "tudo" || aba === "revisadas" ? undefined : aba, limit: 100 })
      .then((p) => { if (vivo) setItens(p.items); })
      .catch((e) => { if (vivo) setErro(mensagemDeErro(e, "Não consegui carregar os avisos. Confira sua conexão e tente de novo.")); });
    return () => { vivo = false; };
  }, [aba, versao]);

  // "Revisadas" só mostra as revisadas; as outras abas escondem as revisadas.
  const visiveis = useMemo(() => (itens ?? []).filter((n) => (aba === "revisadas" ? !!revisadas[n.id] : !revisadas[n.id])), [itens, aba, revisadas]);
  const grupos = useMemo(() => agruparPorData(visiveis), [visiveis]);
  const naoLidas = visiveis.filter((n) => !n.lida).length;
  const totalRevisadas = (itens ?? []).filter((n) => !!revisadas[n.id]).length;

  async function marcarLida(n: NotificacaoApi) {
    if (n.lida) return;
    try {
      await notificacoesApi.marcarLida(n.id);
      notificar();
    } catch (e) {
      setErro(mensagemDeErro(e, "Não consegui marcar o aviso como lido. Tente de novo."));
    }
  }

  /** Revisar também marca como lido (some a bolinha e o aviso do sino); desfazer não mexe no "lido". */
  function alternarRevisada(n: NotificacaoApi) {
    const revisando = !revisadas[n.id];
    alternar(n.id);
    if (revisando) void marcarLida(n);
  }

  /** "Resolver": marca como lido, fecha o véu e leva à tela onde o aviso se resolve (só rotas internas). */
  async function resolver(n: NotificacaoApi) {
    await marcarLida(n);
    if (n.acao_url?.startsWith("/")) { fechar(); navigate(n.acao_url); }
  }

  function alternarSelecao(id: string) {
    setSel((atual) => { const p = new Set(atual); if (p.has(id)) p.delete(id); else p.add(id); return p; });
  }

  /** Revisa (ou, em "Revisadas", devolve) uma lista de avisos de uma vez; revisar também marca como lido. */
  async function aplicarEm(lista: NotificacaoApi[]) {
    const revisar = aba !== "revisadas";
    definir(lista.map((n) => n.id), revisar);
    setSel(new Set());
    if (!revisar) return;
    try {
      await Promise.all(lista.filter((n) => !n.lida).map((n) => notificacoesApi.marcarLida(n.id)));
      notificar();
    } catch (e) {
      setErro(mensagemDeErro(e, "Não consegui marcar os avisos como lidos. Tente de novo."));
    }
  }

  async function marcarTodas() {
    try {
      await notificacoesApi.marcarTodasLidas();
      notificar();
    } catch (e) {
      setErro(mensagemDeErro(e, "Não consegui marcar os avisos como lidos. Tente de novo."));
    }
  }

  const emRevisadas = aba === "revisadas";

  return (
    <div
      className={`ecos-busca-veu ${saindo ? "ecos-busca-saindo" : "ecos-busca-entrando"}`}
      style={{ overflow: "hidden" }}
      role="dialog"
      aria-modal="true"
      aria-label="Notificações"
      onMouseDown={(e) => { if (e.target === e.currentTarget) fechar(); }}
    >
      <div className="ecos-busca-painel mx-auto flex h-full w-full max-w-xl flex-col px-4 pb-2 pt-[calc(env(safe-area-inset-top)+14px)] lg:max-w-3xl">
        <div className="shrink-0 rounded-2xl border border-border/60 bg-surface-1/80 px-4 pb-3 pt-3 shadow-nav backdrop-blur-nav">
          <div className="flex items-center gap-2">
            <Bell size={18} strokeWidth={1.75} className="shrink-0 text-text-muted" aria-hidden />
            <h2 className="font-display text-[17px] text-text-primary">Notificações</h2>
            {selecionando && <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${emRevisadas ? "bg-error/15 text-error" : "bg-success/15 text-success"}`}>{sel.size} selecionada{sel.size > 1 ? "s" : ""}</span>}
            {!selecionando && !emRevisadas && naoLidas > 0 && <span className="rounded-full bg-cyan/15 px-2 py-0.5 text-[11px] font-semibold text-cyan">{naoLidas} nova{naoLidas > 1 ? "s" : ""}</span>}
            <div className="ml-auto flex shrink-0 items-center gap-3">
              {selecionando ? (
                <button type="button" onClick={() => setSel(new Set())} className="text-sm font-medium text-text-muted">Cancelar</button>
              ) : (
                <>
                  {!emRevisadas && visiveis.length > 0 && (
                    <button type="button" onClick={() => void aplicarEm(visiveis)} className="text-sm font-semibold text-success">Limpar tudo</button>
                  )}
                  <button type="button" onClick={fechar} className="text-sm font-medium text-text-muted">Fechar</button>
                </>
              )}
            </div>
          </div>
          <div ref={faixa.ref} {...faixa.props} className="no-scrollbar mt-3 flex cursor-grab select-none gap-2 overflow-x-auto active:cursor-grabbing">
            {ABAS.map((a) => (
              <button
                key={a.valor}
                type="button"
                data-aba={a.valor}
                onClick={() => setAba(a.valor)}
                aria-pressed={aba === a.valor}
                className={`shrink-0 rounded-pill px-3.5 py-1.5 text-sm font-medium ${aba === a.valor ? "bg-surface-3 text-text-primary" : "bg-surface-2/70 text-text-secondary"}`}
              >
                {a.label}{a.valor === "revisadas" && totalRevisadas > 0 ? <span className="ml-1.5 text-xs text-text-muted">{totalRevisadas}</span> : null}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-2 flex min-h-0 flex-1 flex-col">
          <div className="ecos-busca-lista no-scrollbar flex max-h-full min-h-0 flex-col overflow-y-auto overscroll-contain rounded-2xl border border-border/60 bg-surface-1/80 p-1.5 shadow-nav backdrop-blur-nav">
            {erro && <p role="alert" className="px-3 py-3 text-sm text-error">{erro}</p>}
            {itens === null ? (
              !erro && <p className="px-3 py-6 text-center text-sm text-text-muted">Carregando…</p>
            ) : visiveis.length === 0 ? (
              <div className="px-4 py-10 text-center">
                {emRevisadas ? <Check size={26} strokeWidth={1.5} className="mx-auto mb-3 text-text-muted" aria-hidden /> : <Bell size={30} strokeWidth={1.5} className="ecos-sino-batendo mx-auto mb-3 text-text-muted" aria-hidden />}
                <p className="text-[15px] font-medium text-text-primary">{emRevisadas ? "Nenhuma revisada ainda." : "Nada por aqui."}</p>
                {emRevisadas && <p className="mt-1 text-sm text-text-muted">Arraste um aviso para o lado para revisá-lo. Ele vem parar aqui.</p>}
              </div>
            ) : (
              <>
                {totalRevisadas === 0 && !emRevisadas && <p className="px-3 pb-1 pt-2 text-center text-xs text-text-muted">Arraste um aviso para o lado para revisá-lo.</p>}
                {Object.entries(grupos)
                  .filter(([, lista]) => lista.length > 0)
                  .map(([grupo, lista]) => (
                    <section key={grupo} className="mb-1">
                      <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted">{grupo}</p>
                      {lista.map((n, i) => (
                        <LinhaNotificacao key={n.id} n={n} indice={i} revisada={emRevisadas} aoAlternar={() => alternarRevisada(n)} selecionando={selecionando} selecionada={sel.has(n.id)} aoSelecionar={() => alternarSelecao(n.id)} aoLer={() => void marcarLida(n)} aoResolver={() => void resolver(n)} />
                      ))}
                    </section>
                  ))}
              </>
            )}
          </div>
          {selecionando && (
            <button type="button" onClick={() => void aplicarEm(visiveis.filter((n) => sel.has(n.id)))} className={`mt-2 flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-2xl border text-sm font-semibold shadow-nav backdrop-blur-nav ${emRevisadas ? "border-error/40 bg-error/15 text-error" : "border-success/40 bg-success/15 text-success"}`}>
              <Check size={16} strokeWidth={2} aria-hidden />{emRevisadas ? "Devolver" : "Revisar"} {sel.size}
            </button>
          )}
          {!selecionando && !emRevisadas && naoLidas > 0 && (
            <button type="button" onClick={() => void marcarTodas()} className="mt-2 flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-2xl border border-border/60 bg-surface-1/80 text-sm font-medium text-steel-300 shadow-nav backdrop-blur-nav">
              <CheckCheck size={16} strokeWidth={1.75} aria-hidden />Marcar todas como lidas
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

type Etapa = "parada" | "riscando" | "saindo" | "recolhendo";

/**
 * Uma notificação que se arrasta para qualquer lado. Ao passar do limite: o texto é riscado, a linha escorrega para
 * fora na direção do gesto e o espaço se fecha; só então o aviso muda de aba. Em "Revisadas" o texto já está riscado:
 * o mesmo gesto tira o risco e o aviso volta para as outras abas.
 */
function LinhaNotificacao({ n, indice, revisada, selecionando, selecionada, aoSelecionar, aoAlternar, aoLer, aoResolver }: { n: NotificacaoApi; indice: number; revisada: boolean; selecionando: boolean; selecionada: boolean; aoSelecionar: () => void; aoAlternar: () => void; aoLer: () => void; aoResolver: () => void }) {
  const segurou = useRef(false);
  const timerSegurar = useRef<number | undefined>(undefined);
  const cancelarSegurar = () => window.clearTimeout(timerSegurar.current);
  useEffect(() => () => window.clearTimeout(timerSegurar.current), []);
  const [dx, setDx] = useState(0);
  const [arrastando, setArrastando] = useState(false);
  const [etapa, setEtapa] = useState<Etapa>("parada");
  const [direcao, setDirecao] = useState<1 | -1>(1);
  const [altura, setAltura] = useState<number | null>(null);
  const linha = useRef<HTMLDivElement>(null);
  const inicio = useRef<{ x: number; y: number; id: number } | null>(null);
  const moveu = useRef(false);
  const dxRef = useRef(0);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);


  function concluir(lado: 1 | -1) {
    setDirecao(lado);
    setEtapa("riscando");
    timers.current.push(window.setTimeout(() => {
      setEtapa("saindo");
      timers.current.push(window.setTimeout(() => {
        setAltura(linha.current?.offsetHeight ?? 0);
        // dois quadros para a altura fixa "pegar" antes de zerar e animar o recolhimento
        requestAnimationFrame(() => requestAnimationFrame(() => {
          setEtapa("recolhendo");
          timers.current.push(window.setTimeout(aoAlternar, TEMPO_RECOLHE_MS));
        }));
      }, TEMPO_SAIDA_MS));
    }, TEMPO_RISCO_MS));
  }

  function aoPressionar(e: React.PointerEvent<HTMLDivElement>) {
    if (selecionando || etapa !== "parada" || (e.target as HTMLElement).closest("button[data-sem-swipe]")) return;
    inicio.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
    moveu.current = false;
    segurou.current = false;
    // Segurar parado entra no modo de seleção com este aviso marcado.
    cancelarSegurar();
    timerSegurar.current = window.setTimeout(() => {
      if (moveu.current) return;
      segurou.current = true;
      inicio.current = null;
      try { navigator.vibrate?.(15); } catch { /* sem vibração */ }
      aoSelecionar();
    }, 450);
  }
  function aoMover(e: React.PointerEvent<HTMLDivElement>) {
    const ini = inicio.current;
    if (!ini || e.pointerId !== ini.id) return;
    const mx = e.clientX - ini.x;
    const my = e.clientY - ini.y;
    if (!moveu.current) {
      if (Math.abs(mx) < 8 || Math.abs(mx) < Math.abs(my)) return; // ainda é toque ou rolagem vertical
      moveu.current = true;
      cancelarSegurar();
      setArrastando(true);
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* segue pelos eventos da linha */ }
    }
    dxRef.current = mx;
    setDx(mx);
  }
  function aoSoltar(e: React.PointerEvent<HTMLDivElement>) {
    const ini = inicio.current;
    cancelarSegurar();
    if (!ini || e.pointerId !== ini.id) return;
    inicio.current = null;
    const final = dxRef.current;
    dxRef.current = 0;
    setArrastando(false);
    setDx(0);
    if (moveu.current && Math.abs(final) >= LIMITE_SWIPE_PX) concluir(final > 0 ? 1 : -1);
    if (moveu.current) window.setTimeout(() => { moveu.current = false; }, 0);
  }

  const saiu = etapa === "saindo" || etapa === "recolhendo";
  const deslocamento = saiu ? direcao * 140 : dx;
  const progresso = Math.min(1, Math.abs(dx) / LIMITE_SWIPE_PX);
  // Verde enquanto o risco se forma (arrasto e logo após soltar); depois esmaece para o cinza.
  const verde = !revisada && (arrastando || etapa === "riscando");
  // Quanto do risco está desenhado (0..1): acompanha o dedo; em "Revisadas" o risco se desfaz conforme arrasta.
  const alvo = etapa === "parada" ? (revisada ? 1 - progresso : progresso) : revisada ? 0 : 1;
  const ancora = (etapa === "parada" ? dx : direcao) >= 0 ? "0%" : "100%";

  return (
    <div
      className="relative overflow-hidden rounded-xl"
      style={{
        height: etapa === "recolhendo" ? 0 : altura ?? undefined,
        opacity: etapa === "recolhendo" ? 0 : undefined,
        transition: etapa === "recolhendo" ? `height ${TEMPO_RECOLHE_MS}ms ease, opacity ${TEMPO_RECOLHE_MS}ms ease` : undefined,
      }}
    >
      <div
        ref={linha}
        onPointerDown={aoPressionar}
        onPointerMove={aoMover}
        onPointerUp={aoSoltar}
        onPointerCancel={aoSoltar}
        onContextMenu={(e) => e.preventDefault()}
        style={{
          touchAction: "pan-y",
          transform: deslocamento ? `translateX(${deslocamento}px)` : undefined,
          opacity: saiu ? 0 : 1 - progresso * 0.35,
          transition: arrastando ? "none" : `transform ${TEMPO_SAIDA_MS}ms cubic-bezier(.4,0,.2,1), opacity ${TEMPO_SAIDA_MS}ms ease`,
          animationDelay: `${Math.min(indice, 8) * 22}ms`,
        }}
        className={`ecos-busca-item relative flex select-none items-start gap-3 rounded-xl px-3 py-2.5 ${selecionada ? (revisada ? "bg-error/10" : "bg-success/10") : "bg-transparent"}`}
      >
        {selecionando && (
          <span aria-hidden className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${selecionada ? (revisada ? "border-error bg-error" : "border-success bg-success") + " text-on-accent" : "border-border-control"}`}>
            {selecionada && <Check size={13} strokeWidth={3} />}
          </span>
        )}
        <button
          type="button"
          onClick={() => {
            if (moveu.current) return;
            if (segurou.current) { segurou.current = false; return; }
            if (selecionando) { aoSelecionar(); return; }
            aoLer();
          }}
          className="min-w-0 flex-1 text-left"
          aria-label={`${n.corpo}${n.lida ? "" : " (não lida)"}`}
        >
          <p
            className={`text-[15px] ${n.lida || revisada ? "text-text-muted" : "text-text-primary"}`}
            style={{ opacity: 1 - 0.4 * alvo, transition: arrastando ? "none" : `opacity ${TEMPO_RISCO_MS}ms ease` }}
          >
            {/* O risco é um fundo de 1.5px que cresce a partir do lado do arrasto; em cada linha do texto, ao mesmo tempo. */}
            <span
              style={{
                backgroundImage: "linear-gradient(var(--risco-cor), var(--risco-cor))",
                ["--risco-cor" as string]: verde ? "rgb(var(--ecos-success-rgb))" : "rgb(var(--ecos-text-muted-rgb))",
                backgroundRepeat: "no-repeat",
                backgroundPosition: `${ancora} 58%`,
                backgroundSize: `${alvo * 100}% 1.5px`,
                transition: `--risco-cor 600ms ease${arrastando ? "" : `, background-size ${TEMPO_RISCO_MS}ms ease`}`,
                WebkitBoxDecorationBreak: "clone",
                boxDecorationBreak: "clone",
              }}
            >
              {n.corpo}
            </span>
          </p>
          <p className="mt-0.5 text-xs text-text-muted">{formatTempoRelativo(n.criado_em)}</p>
        </button>
        {!revisada && !selecionando && n.acao_url?.startsWith("/") && (
          <button type="button" data-sem-swipe onClick={aoResolver} className="min-h-10 shrink-0 self-center rounded-xl bg-surface-3 px-3 text-sm font-medium text-text-primary">Resolver</button>
        )}
        {!n.lida && !revisada && etapa === "parada" && <span aria-hidden className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-cyan" />}
      </div>
    </div>
  );
}
