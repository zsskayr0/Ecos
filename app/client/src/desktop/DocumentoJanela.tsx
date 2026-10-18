import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { Maximize2, Minimize2, Pin, X } from "lucide-react";
import { screenRoutes } from "@/routes/screen-routes";
import { AjusteJanelaContext, FecharDocumentoContext, ModoFocusDocumentoContext, AcoesFocusContext, PainelFocusControleContext, PainelFocusTarefaContext, PainelJanelaContext, TituloJanelaContext, type AjusteDeJanela } from "@/lib/documento-popup";
import { moduloDaRota, tituloDaRota } from "./modules";
import { DURACAO_SAIDA_JANELA_MS, reduzMovimento } from "./movimento";
import { lerPreferenciasAplicativo } from "@/lib/preferencias-aplicativo";

const ROTA_FECHAR = "/__fechar__";
const MARGEM = 16;
const LARGURA_MIN = 360;
const ALTURA_MIN = 260;
const BORDA = 2;
const ALTURA_TITULO = 36;
const ATRIBUTO_BARRA = "data-pane-tabbar";
const MARGEM_FOCUS = 40;
const MARGEM_FOCUS_X = 28;
const LARGURA_PAINEL_FOCUS = 420;
const ESPACO_FOCUS = 16;

/** Janelas flutuantes abertas, para o Esc global fechar só a da frente. */
const janelasAbertas = new Set<{ z: () => number; escapar: () => void }>();

interface Retangulo {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Direcao = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

/** Abre em 16:9 (até 1120px de largura), centralizada e levemente escalonada para não cobrir outra janela igual. */
function retanguloInicial(ordem: number, retrato = false): Retangulo {
  const folgaW = window.innerWidth - MARGEM * 4;
  const folgaH = window.innerHeight - MARGEM * 4;
  // Formulários altos (lançamento) nascem em retrato; dá para redimensionar e o conteúdo se reparte em colunas.
  const w = retrato ? Math.min(448, folgaW) : Math.min(1120, folgaW, ((folgaH - ALTURA_TITULO) * 16) / 9);
  const h = retrato ? Math.min(695, folgaH) : (w * 9) / 16 + ALTURA_TITULO;
  const deslocamento = (ordem % 6) * 28;
  return {
    x: Math.min((window.innerWidth - w) / 2 + deslocamento, window.innerWidth - MARGEM - w),
    y: Math.min((window.innerHeight - h) / 2 + deslocamento, window.innerHeight - MARGEM - h),
    w,
    h,
  };
}

function layoutFocus(painelAberto = true): { principal: Retangulo; painel: Retangulo } {
  // O calendário e seus controles precisam de uma largura confortável; em telas menores o painel encolhe antes da tarefa.
  const painelIdeal = Math.min(LARGURA_PAINEL_FOCUS, Math.max(320, Math.round(window.innerWidth * 0.30)));
  const painelW = Math.min(painelIdeal, Math.max(240, window.innerWidth - MARGEM_FOCUS_X * 2 - ESPACO_FOCUS - LARGURA_MIN));
  const totalDisponivel = window.innerWidth - MARGEM_FOCUS_X * 2 - ESPACO_FOCUS - painelW;
  // Ocupa quase toda a largura (sobra só uma moldura para o blur); recolher o painel não muda a largura da tarefa, só a recentraliza.
  const principalW = Math.min(1560, Math.max(240, totalDisponivel));
  const conjuntoW = principalW + ESPACO_FOCUS + painelW;
  const xConjunto = Math.max(MARGEM_FOCUS_X, Math.round((window.innerWidth - conjuntoW) / 2));
  const x = painelAberto ? xConjunto : Math.max(MARGEM_FOCUS_X, Math.round((window.innerWidth - principalW) / 2));
  const h = Math.max(ALTURA_MIN, Math.min(960, window.innerHeight - MARGEM_FOCUS * 2));
  const y = Math.max(MARGEM_FOCUS, Math.round((window.innerHeight - h) / 2));
  return { principal: { x, y, w: principalW, h }, painel: { x: xConjunto + principalW + ESPACO_FOCUS, y, w: painelW, h } };
}

/** Tamanho com que uma janela comum (Configurações, notas…) nasce; o painel de configurações do Cofre usa o mesmo, por consistência. */
export function tamanhoInicialDeJanela(): { w: number; h: number } {
  const { w, h } = retanguloInicial(0);
  return { w, h };
}

function redimensionar(r: Retangulo, dir: Direcao, dx: number, dy: number, alturaMin = ALTURA_MIN): Retangulo {
  let { x, y, w, h } = r;
  const direita = r.x + r.w;
  const base = r.y + r.h;

  if (dir.includes("e")) w = Math.min(Math.max(r.w + dx, LARGURA_MIN), window.innerWidth - MARGEM - r.x);
  if (dir.includes("s")) h = Math.min(Math.max(r.h + dy, alturaMin), window.innerHeight - MARGEM - r.y);
  if (dir.includes("w")) {
    x = Math.min(Math.max(r.x + dx, MARGEM), direita - LARGURA_MIN);
    w = direita - x;
  }
  if (dir.includes("n")) {
    y = Math.min(Math.max(r.y + dy, MARGEM), base - alturaMin);
    h = base - y;
  }
  return { x, y, w, h };
}

const ALCAS: { dir: Direcao; classe: string }[] = [
  { dir: "n", classe: "inset-x-3 -top-1 h-2 cursor-ns-resize" },
  { dir: "s", classe: "inset-x-3 -bottom-1 h-2 cursor-ns-resize" },
  { dir: "e", classe: "inset-y-3 -right-1 w-2 cursor-ew-resize" },
  { dir: "w", classe: "inset-y-3 -left-1 w-2 cursor-ew-resize" },
  { dir: "nw", classe: "-left-1 -top-1 h-4 w-4 cursor-nwse-resize" },
  { dir: "ne", classe: "-right-1 -top-1 h-4 w-4 cursor-nesw-resize" },
  { dir: "sw", classe: "-bottom-1 -left-1 h-4 w-4 cursor-nesw-resize" },
  { dir: "se", classe: "-bottom-1 -right-1 h-4 w-4 cursor-nwse-resize" },
];

/** Barra de abas de uma pane sob o ponteiro (o destino de "soltar para fixar"), se houver. */
function barraSobPonteiro(x: number, y: number): HTMLElement | null {
  const alvo = document.elementsFromPoint(x, y).find((el) => el.hasAttribute(ATRIBUTO_BARRA));
  return (alvo as HTMLElement | undefined) ?? null;
}

function limparDestaques() {
  document.querySelectorAll(`[${ATRIBUTO_BARRA}][data-drop-alvo]`).forEach((el) => el.removeAttribute("data-drop-alvo"));
}

function Fechar({ aoFechar }: { aoFechar: () => void }) {
  useEffect(aoFechar, [aoFechar]);
  return null;
}

interface Props {
  path: string;
  ordem: number;
  z: number;
  aoFechar: () => void;
  aoFocar: () => void;
  /** `paneId` quando a janela foi solta sobre a barra de abas de uma pane; ausente no botão "Fixar como aba". */
  aoFixar?: (paneId?: string) => void;
  conteudo?: ReactNode;
  titulo?: string;
  cabecalhoNoConteudo?: boolean;
}

/**
 * Tarefa/Nota numa janela flutuante: não bloqueia o resto do app, arrasta
 * pelo título, redimensiona pelas bordas e vira aba (botão ou soltando sobre
 * uma barra de abas). As telas de detalhe encerram com `navigate(-1)`
 * (voltar, salvar, apagar): o histórico começa em ROTA_FECHAR, então voltar
 * cai nela e fecha a janela — nenhuma tela precisa saber que está numa janela.
 */
/** No Modo Slide do lançamento a janela só fecha pelo X: o Esc não vale. */
const modoSlideAtivo = (janela: HTMLElement | null) => !!janela?.querySelector("[data-modo-slide]");

export function DocumentoJanela({ path, ordem, z, aoFechar: aoFecharDeVez, aoFocar, aoFixar, conteudo, titulo, cabecalhoNoConteudo: cabecalhoProp = false }: Props) {
  // Lançamentos (novo e edição) trazem o próprio cabeçalho dentro do formulário.
  const cabecalhoNoConteudo = cabecalhoProp || path.startsWith("/cofre/transacao/");
  const [saindo, setSaindo] = useState(false);
  const fechandoRef = useRef(false);
  const janelaDeConfiguracoes = path.startsWith("/configuracoes");
  // Toda saída (X, Esc, "voltar", salvar/apagar) anima antes de a janela deixar de existir.
  const aoFechar = useCallback(() => {
    if (fechandoRef.current) return;
    fechandoRef.current = true;
    if (reduzMovimento()) {
      aoFecharDeVez();
      return;
    }
    setSaindo(true);
    window.setTimeout(aoFecharDeVez, janelaDeConfiguracoes ? 240 : DURACAO_SAIDA_JANELA_MS);
  }, [aoFecharDeVez, janelaDeConfiguracoes]);

  const [rect, setRect] = useState(() => retanguloInicial(ordem, path.startsWith("/cofre/transacao")));
  const tarefa = path.startsWith("/tarefa/");
  const podeFocus = tarefa || path.startsWith("/notas/nota/");
  // Com a preferência ligada a tarefa já abre maximizada (modo Focus).
  const [emFocus, setEmFocus] = useState(() => tarefa && lerPreferenciasAplicativo().tarefaMaximizada);
  /** Animação de saída da camada Focus (a janela normal só volta a aparecer inteira depois dela). */
  const [saindoFocus, setSaindoFocus] = useState(false);
  /** Muda ao sair do Focus: a janela normal recarrega o documento já com o que foi editado na camada Focus. */
  const [chaveJanela, setChaveJanela] = useState(0);
  const [, setVersaoLayout] = useState(0);
  const janelaFocusRef = useRef<HTMLDivElement>(null);
  const [painelFocusAberto, setPainelFocusAberto] = useState(() => !lerPreferenciasAplicativo().focusPainelRecolhido);
  const painelFocusAbertoRef = useRef(painelFocusAberto);
  const saindoDoFocus = useRef(false);
  const [arrastando, setArrastando] = useState(false);
  const [ajustando, setAjustando] = useState(false);
  const [tituloDinamico, setTituloDinamico] = useState("");
  const rectRef = useRef(rect);
  rectRef.current = rect;
  const [painelPx, setPainelPx] = useState(0);
  const painelPxRef = useRef(0);
  const [larguraConteudo, setLarguraConteudo] = useState(0);
  const [montagem, setMontagem] = useState<HTMLElement | null>(null);
  const [montagemFocus, setMontagemFocus] = useState<HTMLElement | null>(null);
  const [acoesFocus, setAcoesFocus] = useState<HTMLElement | null>(null);
  const [animandoPainel, setAnimandoPainel] = useState(false);
  const jaAjustou = useRef(false);
  const usuarioMexeu = useRef(false);
  const janelaRef = useRef<HTMLDivElement>(null);
  const gesto = useRef<
    { tipo: "mover"; x: number; y: number; rect: Retangulo } | { tipo: Direcao; x: number; y: number; rect: Retangulo } | null
  >(null);

  useEffect(() => janelaRef.current?.focus(), []);

  const sairDoFocus = useCallback(() => {
    if (!emFocus || saindoDoFocus.current) return emFocus;
    saindoDoFocus.current = true;
    setSaindoFocus(true);
    // A janela de trás recarrega já agora, escondida pela camada que ainda está saindo: sem piscar o "Carregando…".
    setChaveJanela((k) => k + 1);
    window.setTimeout(() => {
      setEmFocus(false); setSaindoFocus(false); saindoDoFocus.current = false;
    }, reduzMovimento() ? 0 : 170);
    return true;
  }, [emFocus]);
  const alternarPainelFocus = useCallback(() => {
    const novo = !painelFocusAbertoRef.current;
    painelFocusAbertoRef.current = novo;
    setPainelFocusAberto(novo);
  }, []);
  const controlePainelFocus = useMemo(() => ({ aberto: painelFocusAberto, alternar: alternarPainelFocus }), [painelFocusAberto, alternarPainelFocus]);
  const alternarFocus = useCallback(() => {
    if (emFocus) { sairDoFocus(); return; }
    saindoDoFocus.current = false;
    // O painel lateral começa como a preferência pede (recolhido por padrão: o texto em primeiro plano).
    const aberto = !lerPreferenciasAplicativo().focusPainelRecolhido;
    painelFocusAbertoRef.current = aberto;
    setPainelFocusAberto(aberto);
    setEmFocus(true);
  }, [emFocus, sairDoFocus]);
  // A camada Focus nasce com o foco do teclado dentro dela.
  const estavaEmFocus = useRef(false);
  useEffect(() => {
    if (emFocus) janelaFocusRef.current?.focus();
    // Ao voltar, a janela normal (que estava inerte) recebe o foco de novo: o Esc já funciona sem clicar nela.
    else if (estavaEmFocus.current) janelaRef.current?.focus();
    estavaEmFocus.current = emFocus;
  }, [emFocus]);

  // Formulário de lançamento: a altura natural do conteúdo é o mínimo da janela e a altura inicial (sem barra de rolagem).
  const alturaMinRef = useRef(ALTURA_MIN);
  const medirConteudo = useCallback((): number | null => {
    const corpo = janelaRef.current?.querySelector<HTMLElement>(".cofre-launch-body");
    const form = corpo?.parentElement;
    if (!corpo || !form) return null;
    const antes = corpo.style.flex;
    corpo.style.flex = "none";
    const total = Array.from(form.children).reduce((soma, el) => soma + (el as HTMLElement).offsetHeight, 0);
    corpo.style.flex = antes;
    return Math.ceil(total) + BORDA + 6;
  }, []);
  useEffect(() => {
    if (!cabecalhoNoConteudo) return;
    const ajustar = () => {
      const natural = medirConteudo();
      if (!natural) return;
      const h = Math.min(natural, window.innerHeight - MARGEM * 2);
      alturaMinRef.current = h;
      if (!usuarioMexeu.current) setRect((r) => ({ ...r, h, y: Math.max(MARGEM, Math.min(r.y, window.innerHeight - MARGEM - h)) }));
    };
    const timers = [120, 500, 1200].map((ms) => window.setTimeout(ajustar, ms));
    return () => timers.forEach(window.clearTimeout);
  }, [cabecalhoNoConteudo, medirConteudo]);

  // Esc fecha mesmo que o foco não esteja dentro da janela (ex.: depois de carregar o conteúdo); com várias abertas, só a da frente.
  const zRef = useRef(z);
  zRef.current = z;
  const fecharRef = useRef(aoFechar);
  fecharRef.current = aoFechar;
  useEffect(() => {
    const registro = { z: () => zRef.current, escapar: () => fecharRef.current() };
    janelasAbertas.add(registro);
    function aoTeclar(e: KeyboardEvent) {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const foco = document.activeElement;
      const dentro = !!janelaRef.current && !!foco && janelaRef.current.contains(foco);
      if (dentro) return; // o onKeyDown da própria janela já trata
      if (foco && foco !== document.body) return; // foco em outra parte da interface
      const frente = [...janelasAbertas].sort((a, b) => b.z() - a.z())[0];
      if (frente === registro && !modoSlideAtivo(janelaRef.current)) registro.escapar();
    }
    window.addEventListener("keydown", aoTeclar);
    return () => { janelasAbertas.delete(registro); window.removeEventListener("keydown", aoTeclar); };
  }, [sairDoFocus]);

  // Janela do app encolheu: a janela flutuante nunca fica maior que ela.
  useEffect(() => {
    function aoRedimensionar() {
      if (emFocus) {
        setVersaoLayout((v) => v + 1); // a camada Focus se recalcula no render
        return;
      }
      setRect((r) => {
        const w = Math.min(r.w, window.innerWidth - MARGEM * 2);
        const h = Math.min(r.h, window.innerHeight - MARGEM * 2);
        return {
          w,
          h,
          x: Math.min(Math.max(r.x, MARGEM - w + 80), window.innerWidth - 80),
          y: Math.min(Math.max(r.y, 0), window.innerHeight - ALTURA_TITULO),
        };
      });
    }
    window.addEventListener("resize", aoRedimensionar);
    return () => window.removeEventListener("resize", aoRedimensionar);
  }, [emFocus]);

  // O conteúdo (imagem/PDF) informa o tamanho natural: a janela nasce ajustada a ele, uma única vez e só se ninguém a mexeu antes.
  const ajustarAoConteudo = useCallback(
    (a: AjusteDeJanela) => {
      if (jaAjustou.current || usuarioMexeu.current) return;
      jaAjustou.current = true;
      const maxW = window.innerWidth - MARGEM * 2 - BORDA;
      const maxH = window.innerHeight - MARGEM * 2 - BORDA - ALTURA_TITULO;
      const escala = Math.max(0.1, Math.min(a.ampliar ?? 1, (maxW - a.extraLargura) / a.larguraNatural, (maxH - a.extraAltura) / a.alturaNatural));
      const w = Math.max(LARGURA_MIN, Math.round(a.larguraNatural * escala + a.extraLargura + BORDA));
      const h = Math.max(ALTURA_MIN, Math.round(a.alturaNatural * escala + a.extraAltura + BORDA + ALTURA_TITULO));
      const deslocamento = (ordem % 6) * 28;
      setAjustando(true);
      setRect({
        w,
        h,
        x: Math.max(MARGEM, Math.min((window.innerWidth - w) / 2 + deslocamento, window.innerWidth - MARGEM - w)),
        y: Math.max(MARGEM, Math.min((window.innerHeight - h) / 2 + deslocamento, window.innerHeight - MARGEM - h)),
      });
      setTimeout(() => setAjustando(false), 260);
    },
    [ordem],
  );

  // Painel lateral (categorias): a janela se alarga, centralizada, e o painel vira parte dela.
  const animarPainel = useCallback(() => {
    setAnimandoPainel(true);
    window.setTimeout(() => setAnimandoPainel(false), 500);
  }, []);
  const abrirPainel = useCallback((largura: number) => {
    const r = rectRef.current;
    if (painelPxRef.current) return painelPxRef.current;
    const folga = window.innerWidth - MARGEM * 2;
    const w = Math.min(r.w + largura, folga);
    const concedida = Math.floor(w - r.w);
    if (concedida < 280) return 0;
    painelPxRef.current = concedida;
    animarPainel();
    setLarguraConteudo(r.w);
    setPainelPx(concedida);
    setRect({ ...r, w, x: Math.min(Math.max(MARGEM, r.x - concedida / 2), window.innerWidth - MARGEM - w) });
    return concedida;
  }, [animarPainel]);
  const fecharPainel = useCallback(() => {
    const g = painelPxRef.current;
    if (!g) return;
    const r = rectRef.current;
    painelPxRef.current = 0;
    animarPainel();
    setPainelPx(0);
    setRect({ ...r, w: Math.max(LARGURA_MIN, r.w - g), x: Math.max(MARGEM, Math.min(r.x + g / 2, window.innerWidth - MARGEM - (r.w - g))) });
  }, [animarPainel]);
  const painelJanela = useMemo(() => (cabecalhoNoConteudo ? { abrir: abrirPainel, fechar: fecharPainel, montagem } : null), [cabecalhoNoConteudo, abrirPainel, fecharPainel, montagem]);

  function iniciar(e: PointerEvent<HTMLElement>, tipo: "mover" | Direcao) {
    if (emFocus) return; // No Focus a janela é fixa: nem arrasta nem redimensiona.
    usuarioMexeu.current = true;
    if (cabecalhoNoConteudo) { const n = medirConteudo(); if (n) alturaMinRef.current = Math.min(n, window.innerHeight - MARGEM * 2); }
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    gesto.current = { tipo, x: e.clientX, y: e.clientY, rect } as NonNullable<typeof gesto.current>;
    if (tipo === "mover") setArrastando(true);
  }

  function mover(e: PointerEvent<HTMLElement>) {
    const g = gesto.current;
    if (!g) return;
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    if (g.tipo === "mover") {
      // A barra de título nunca sai da tela — senão não há como pegar a janela de volta.
      setRect({
        ...g.rect,
        x: Math.min(Math.max(g.rect.x + dx, 80 - g.rect.w), window.innerWidth - 80),
        y: Math.min(Math.max(g.rect.y + dy, 0), window.innerHeight - ALTURA_TITULO),
      });
      limparDestaques();
      barraSobPonteiro(e.clientX, e.clientY)?.setAttribute("data-drop-alvo", "true");
    } else {
      setRect(redimensionar(g.rect, g.tipo, dx, dy, alturaMinRef.current));
    }
  }

  function encerrar(e: PointerEvent<HTMLElement>) {
    const g = gesto.current;
    gesto.current = null;
    setArrastando(false);
    if (g?.tipo === "mover") {
      const barra = barraSobPonteiro(e.clientX, e.clientY);
      limparDestaques();
      const paneId = barra?.getAttribute(ATRIBUTO_BARRA);
      if (paneId && aoFixar) aoFixar(paneId);
    }
  }

  const corpo = conteudo ? <MemoryRouter>{conteudo}</MemoryRouter> : (
    <MemoryRouter initialEntries={[ROTA_FECHAR, path]} initialIndex={1}>
      <Routes><Route path={ROTA_FECHAR} element={<Fechar aoFechar={aoFechar} />} />{screenRoutes}</Routes>
    </MemoryRouter>
  );

  return (
    <div className="pointer-events-none fixed inset-0" style={{ zIndex: 50 + z }}>
      {/* Configurações (do Ecos e do Cofre) desfocam o fundo; o painel antigo do Cofre tinha este véu e foi unificado aqui. */}
      {janelaDeConfiguracoes && <div aria-hidden onPointerDown={(e) => e.stopPropagation()} className="pointer-events-auto absolute inset-0 bg-black/45 backdrop-blur-[6px] transition-opacity duration-200" style={{ opacity: saindo ? 0 : 1 }} />}
      {/* `transform` faz os elementos `fixed` das telas (botão flutuante de salvar) ancorarem na janela, não no app. */}
      <div
        ref={janelaRef}
        role="dialog"
        aria-hidden={emFocus || undefined}
        {...(emFocus ? ({ inert: "" } as object) : {})}
        aria-label={tituloDinamico || titulo || tituloDaRota(path)}
        tabIndex={-1}
        onPointerDownCapture={aoFocar}
        onPointerDown={(e) => { const alvo=e.target as HTMLElement;if (cabecalhoNoConteudo && alvo.closest("[data-window-drag-handle]")&&!alvo.closest("button,input,textarea,select")) iniciar(e, "mover"); }}
        onPointerMove={cabecalhoNoConteudo ? mover : undefined}
        onPointerUp={cabecalhoNoConteudo ? encerrar : undefined}
        onPointerCancel={cabecalhoNoConteudo ? encerrar : undefined}
        onKeyDown={(e) => {
          if (e.key === "Escape" && !modoSlideAtivo(janelaRef.current)) { e.preventDefault(); aoFechar(); }
          if (e.key === "Tab" && emFocus) {
            const seletor = 'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])';
            const focaveis = [...Array.from(janelaRef.current?.querySelectorAll<HTMLElement>(seletor) ?? []), ...Array.from(montagemFocus?.querySelectorAll<HTMLElement>(seletor) ?? [])].filter((el) => !el.closest("[inert]"));
            if (!focaveis.length) return;
            const atual = document.activeElement as HTMLElement;
            const indice = focaveis.indexOf(atual);
            if (indice === -1 || (e.shiftKey ? indice === 0 : indice === focaveis.length - 1)) { e.preventDefault(); focaveis[e.shiftKey ? focaveis.length - 1 : 0].focus(); }
          }
        }}
        className={`${saindo ? (janelaDeConfiguracoes ? "ecos-configuracoes-saindo" : "ecos-janela-saindo") : "ecos-fade-in"} pointer-events-auto absolute flex flex-col rounded-2xl border bg-base shadow-nav outline-none ${
          arrastando ? "border-cyan/60" : "border-border"
        }`}
        style={{
          left: rect.x,
          top: rect.y,
          width: rect.w,
          height: rect.h,
          // No Focus a janela normal passa para trás (menor e mais escura) e a camada Focus aparece na frente dela.
          transform: emFocus && !saindoFocus ? "translateZ(0) scale(0.965)" : "translateZ(0)",
          filter: emFocus && !saindoFocus ? "brightness(0.7)" : undefined,
          transition: [(ajustando ? "left 220ms ease, top 220ms ease, width 220ms ease, height 220ms ease" : animandoPainel ? "left 450ms cubic-bezier(.22,1,.36,1), width 450ms cubic-bezier(.22,1,.36,1)" : undefined), "transform 320ms cubic-bezier(.22,1,.36,1), filter 320ms ease"].filter(Boolean).join(", "),
        }}
      >
        {!cabecalhoNoConteudo&&<header
          onPointerDown={(e) => {
            if (!(e.target as HTMLElement).closest("button")) iniciar(e, "mover");
          }}
          onPointerMove={mover}
          onPointerUp={encerrar}
          onPointerCancel={encerrar}
          className={`flex shrink-0 touch-none select-none items-center gap-2 rounded-t-2xl border-b border-border bg-surface-1 pl-3.5 pr-1.5 ${
            arrastando ? "cursor-grabbing" : "cursor-grab"
          }`}
          style={{ height: ALTURA_TITULO }}
        >
          {(() => {
            const Icone = moduloDaRota(path).icone;
            return <Icone size={14} strokeWidth={1.75} className="pointer-events-none shrink-0 text-text-muted" />;
          })()}
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-text-secondary">
            {tituloDinamico || titulo || tituloDaRota(path)}
          </span>
          {aoFixar && !emFocus && <button
            type="button"
            title="Fixar como aba — ou arraste até uma barra de abas"
            aria-label="Fixar como aba"
            onClick={() => aoFixar()}
            className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted hover:bg-surface-3 hover:text-text-primary"
          >
            <Pin size={14} strokeWidth={1.75} />
          </button>}
          {podeFocus && <button
            type="button"
            title="Abrir em modo Focus"
            aria-label="Abrir em modo Focus"
            onClick={alternarFocus}
            className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted hover:bg-surface-3 hover:text-text-primary"
          >
            <Maximize2 size={14} strokeWidth={1.75} />
          </button>}
          <button
            type="button"
            title="Fechar (Esc)"
            aria-label="Fechar"
            onClick={aoFechar}
            className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted hover:bg-surface-3 hover:text-text-primary"
          >
            <X size={15} strokeWidth={1.75} />
          </button>
        </header>}

        <div className={`min-h-0 flex-1 ${cabecalhoNoConteudo ? "flex rounded-2xl overflow-hidden" : janelaDeConfiguracoes ? "rounded-b-2xl overflow-hidden" : "rounded-b-2xl overflow-y-auto"}`}>
          <AjusteJanelaContext.Provider value={ajustarAoConteudo}>
          <TituloJanelaContext.Provider value={setTituloDinamico}>
          <FecharDocumentoContext.Provider value={aoFechar}>
          <ModoFocusDocumentoContext.Provider value={false}>
          <PainelJanelaContext.Provider value={painelJanela}>
            {cabecalhoNoConteudo ? (
              <>
                <div className="h-full min-w-0" style={painelPx ? { width: larguraConteudo, flex: "none" } : { flex: "1 1 auto" }}><Fragment key={chaveJanela}>{corpo}</Fragment></div>
                <div ref={setMontagem} aria-hidden={!painelPx} className="h-full min-w-0 overflow-hidden border-border bg-surface-1" style={{ flex: painelPx ? "1 1 0" : "0 0 0", borderLeftWidth: painelPx ? 1 : 0 }} />
              </>
            ) : <Fragment key={chaveJanela}>{corpo}</Fragment>}
          </PainelJanelaContext.Provider>
          </ModoFocusDocumentoContext.Provider>
          </FecharDocumentoContext.Provider>
          </TituloJanelaContext.Provider>
          </AjusteJanelaContext.Provider>
        </div>

        {ALCAS.map(({ dir, classe }) => (
          <div
            key={dir}
            aria-hidden
            onPointerDown={(e) => iniciar(e, dir)}
            onPointerMove={mover}
            onPointerUp={encerrar}
            onPointerCancel={encerrar}
            className={`absolute z-40 touch-none ${classe}`}
          />
        ))}
      </div>

      {emFocus && (() => {
        const camadaSaindo = saindoFocus || saindo;
        const { principal } = layoutFocus(painelFocusAberto);
        const posPainel = layoutFocus(true).painel; // fechado, o painel só some no lugar: não desliza nem se espreme
        const Icone = moduloDaRota(path).icone;
        const aoTeclar = (e: React.KeyboardEvent) => {
          if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); aoFechar(); return; }
          if (e.key !== "Tab") return;
          const seletor = 'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [contenteditable="true"], [tabindex]:not([tabindex="-1"])';
          const focaveis = [...Array.from(janelaFocusRef.current?.querySelectorAll<HTMLElement>(seletor) ?? []), ...Array.from(montagemFocus?.querySelectorAll<HTMLElement>(seletor) ?? [])].filter((el) => !el.closest("[inert]"));
          if (!focaveis.length) return;
          const indice = focaveis.indexOf(document.activeElement as HTMLElement);
          if (indice === -1 || (e.shiftKey ? indice === 0 : indice === focaveis.length - 1)) { e.preventDefault(); focaveis[e.shiftKey ? focaveis.length - 1 : 0].focus(); }
        };
        return <div onKeyDown={aoTeclar} className="pointer-events-none absolute inset-0">
          {/* Mesmo padrão dos modais do Cofre: véu com blur por cima da janela normal; clicar nele volta. */}
          <div aria-hidden onClick={aoFechar} className={`pointer-events-auto absolute inset-0 bg-black/45 backdrop-blur-[10px] ${camadaSaindo ? "ecos-backdrop-out" : "ecos-backdrop-in"}`} />
          <div aria-hidden={!painelFocusAberto || undefined} {...(painelFocusAberto ? {} : ({ inert: "" } as object))}
            className={`pointer-events-auto absolute overflow-y-auto rounded-2xl border border-border bg-base p-5 shadow-nav transition-[opacity,transform,visibility] duration-300 ${camadaSaindo ? "ecos-modal-out" : "ecos-focus-in"}`}
            style={{ left: posPainel.x, top: posPainel.y, width: posPainel.w, height: posPainel.h, opacity: painelFocusAberto ? 1 : 0, visibility: painelFocusAberto ? "visible" : "hidden", pointerEvents: painelFocusAberto ? "auto" : "none", transform: painelFocusAberto ? "none" : "translateX(12px)" }}>
            <div ref={setMontagemFocus} />
          </div>
          <div ref={janelaFocusRef} role="dialog" aria-modal="true" aria-label={tituloDinamico || titulo || tituloDaRota(path)} tabIndex={-1}
            className={`pointer-events-auto absolute flex flex-col overflow-hidden rounded-2xl border border-border bg-base shadow-nav outline-none ${camadaSaindo ? "ecos-modal-out" : "ecos-focus-in"}`}
            style={{ left: principal.x, top: principal.y, width: principal.w, height: principal.h, transition: "left 280ms cubic-bezier(.22,1,.36,1)" }}>
            <header className="flex shrink-0 select-none items-center gap-2 border-b border-border bg-surface-1 pl-3.5 pr-1.5" style={{ height: ALTURA_TITULO }}>
              <Icone size={14} strokeWidth={1.75} className="pointer-events-none shrink-0 text-text-muted" />
              <span className="flex-1" aria-hidden />
              <div ref={setAcoesFocus} className="flex items-center gap-0.5" />
              <button type="button" title="Sair do modo Focus" aria-label="Sair do modo Focus" onClick={alternarFocus}
                className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted hover:bg-surface-3 hover:text-text-primary"><Minimize2 size={14} strokeWidth={1.75} /></button>
              <button type="button" title="Fechar (Esc)" aria-label="Fechar" onClick={aoFechar}
                className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted hover:bg-surface-3 hover:text-text-primary"><X size={15} strokeWidth={1.75} /></button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <AjusteJanelaContext.Provider value={ajustarAoConteudo}>
              <TituloJanelaContext.Provider value={setTituloDinamico}>
              <FecharDocumentoContext.Provider value={aoFechar}>
              <ModoFocusDocumentoContext.Provider value={true}>
              <PainelFocusTarefaContext.Provider value={montagemFocus}>
              <PainelFocusControleContext.Provider value={controlePainelFocus}>
              <AcoesFocusContext.Provider value={acoesFocus}>
                {corpo}
              </AcoesFocusContext.Provider>
              </PainelFocusControleContext.Provider>
              </PainelFocusTarefaContext.Provider>
              </ModoFocusDocumentoContext.Provider>
              </FecharDocumentoContext.Provider>
              </TituloJanelaContext.Provider>
              </AjusteJanelaContext.Provider>
            </div>
          </div>
        </div>;
      })()}
    </div>
  );
}
