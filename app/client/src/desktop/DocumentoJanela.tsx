import { useCallback, useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { Pin, X } from "lucide-react";
import { screenRoutes } from "@/routes/screen-routes";
import { AjusteJanelaContext, FecharDocumentoContext, TituloJanelaContext, type AjusteDeJanela } from "@/lib/documento-popup";
import { moduloDaRota, tituloDaRota } from "./modules";
import { DURACAO_SAIDA_JANELA_MS, reduzMovimento } from "./movimento";

const ROTA_FECHAR = "/__fechar__";
const MARGEM = 16;
const LARGURA_MIN = 360;
const ALTURA_MIN = 260;
const BORDA = 2;
const ALTURA_TITULO = 36;
const ATRIBUTO_BARRA = "data-pane-tabbar";

interface Retangulo {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Direcao = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

/** Abre sempre em 16:9 (até 1120px de largura), centralizada e levemente escalonada para não cobrir outra janela igual. */
function retanguloInicial(ordem: number): Retangulo {
  const folgaW = window.innerWidth - MARGEM * 4;
  const folgaH = window.innerHeight - MARGEM * 4;
  const w = Math.min(1120, folgaW, ((folgaH - ALTURA_TITULO) * 16) / 9);
  const h = (w * 9) / 16 + ALTURA_TITULO;
  const deslocamento = (ordem % 6) * 28;
  return {
    x: Math.min((window.innerWidth - w) / 2 + deslocamento, window.innerWidth - MARGEM - w),
    y: Math.min((window.innerHeight - h) / 2 + deslocamento, window.innerHeight - MARGEM - h),
    w,
    h,
  };
}

function redimensionar(r: Retangulo, dir: Direcao, dx: number, dy: number): Retangulo {
  let { x, y, w, h } = r;
  const direita = r.x + r.w;
  const base = r.y + r.h;

  if (dir.includes("e")) w = Math.min(Math.max(r.w + dx, LARGURA_MIN), window.innerWidth - MARGEM - r.x);
  if (dir.includes("s")) h = Math.min(Math.max(r.h + dy, ALTURA_MIN), window.innerHeight - MARGEM - r.y);
  if (dir.includes("w")) {
    x = Math.min(Math.max(r.x + dx, MARGEM), direita - LARGURA_MIN);
    w = direita - x;
  }
  if (dir.includes("n")) {
    y = Math.min(Math.max(r.y + dy, MARGEM), base - ALTURA_MIN);
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
  aoFixar: (paneId?: string) => void;
  conteudo?: ReactNode;
  titulo?: string;
}

/**
 * Tarefa/Nota numa janela flutuante: não bloqueia o resto do app, arrasta
 * pelo título, redimensiona pelas bordas e vira aba (botão ou soltando sobre
 * uma barra de abas). As telas de detalhe encerram com `navigate(-1)`
 * (voltar, salvar, apagar): o histórico começa em ROTA_FECHAR, então voltar
 * cai nela e fecha a janela — nenhuma tela precisa saber que está numa janela.
 */
export function DocumentoJanela({ path, ordem, z, aoFechar: aoFecharDeVez, aoFocar, aoFixar, conteudo, titulo }: Props) {
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

  const [rect, setRect] = useState(() => retanguloInicial(ordem));
  const [arrastando, setArrastando] = useState(false);
  const [ajustando, setAjustando] = useState(false);
  const [tituloDinamico, setTituloDinamico] = useState("");
  const jaAjustou = useRef(false);
  const usuarioMexeu = useRef(false);
  const janelaRef = useRef<HTMLDivElement>(null);
  const gesto = useRef<
    { tipo: "mover"; x: number; y: number; rect: Retangulo } | { tipo: Direcao; x: number; y: number; rect: Retangulo } | null
  >(null);

  useEffect(() => janelaRef.current?.focus(), []);

  // Janela do app encolheu: a janela flutuante nunca fica maior que ela.
  useEffect(() => {
    function aoRedimensionar() {
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
  }, []);

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

  function iniciar(e: PointerEvent<HTMLElement>, tipo: "mover" | Direcao) {
    usuarioMexeu.current = true;
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
      setRect(redimensionar(g.rect, g.tipo, dx, dy));
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
      if (paneId) aoFixar(paneId);
    }
  }

  return (
    <div className="pointer-events-none fixed inset-0" style={{ zIndex: 50 + z }}>
      {/* `transform` faz os elementos `fixed` das telas (botão flutuante de salvar) ancorarem na janela, não no app. */}
      <div
        ref={janelaRef}
        role="dialog"
        aria-label={tituloDinamico || titulo || tituloDaRota(path)}
        tabIndex={-1}
        onPointerDownCapture={aoFocar}
        onKeyDown={(e) => e.key === "Escape" && aoFechar()}
        className={`${saindo ? (janelaDeConfiguracoes ? "ecos-configuracoes-saindo" : "ecos-janela-saindo") : "ecos-fade-in"} pointer-events-auto absolute flex flex-col rounded-2xl border bg-base shadow-nav outline-none ${
          arrastando ? "border-cyan/60" : "border-border"
        }`}
        style={{
          left: rect.x,
          top: rect.y,
          width: rect.w,
          height: rect.h,
          transform: "translateZ(0)",
          transition: ajustando ? "left 220ms ease, top 220ms ease, width 220ms ease, height 220ms ease" : undefined,
        }}
      >
        <header
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
          <button
            type="button"
            title="Fixar como aba — ou arraste até uma barra de abas"
            aria-label="Fixar como aba"
            onClick={() => aoFixar()}
            className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted hover:bg-surface-3 hover:text-text-primary"
          >
            <Pin size={14} strokeWidth={1.75} />
          </button>
          <button
            type="button"
            title="Fechar (Esc)"
            aria-label="Fechar"
            onClick={aoFechar}
            className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted hover:bg-surface-3 hover:text-text-primary"
          >
            <X size={15} strokeWidth={1.75} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto rounded-b-2xl">
          <AjusteJanelaContext.Provider value={ajustarAoConteudo}>
          <TituloJanelaContext.Provider value={setTituloDinamico}>
          <FecharDocumentoContext.Provider value={aoFechar}>
            {conteudo ? <MemoryRouter>{conteudo}</MemoryRouter> : <MemoryRouter initialEntries={[ROTA_FECHAR, path]} initialIndex={1}>
              <Routes><Route path={ROTA_FECHAR} element={<Fechar aoFechar={aoFechar} />} />{screenRoutes}</Routes>
            </MemoryRouter>}
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
    </div>
  );
}
