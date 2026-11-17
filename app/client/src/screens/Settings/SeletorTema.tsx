import { useRef } from "react";
import { flushSync } from "react-dom";
import { Monitor, Moon, Sun, type LucideIcon } from "lucide-react";
import { resolverTema, type ModoTema } from "@/lib/theme";

/** Ordem do seletor: Escuro · Automático · Claro. */
const OPCOES: { modo: ModoTema; rotulo: string; dica: string; Icone: LucideIcon }[] = [
  { modo: "dark", rotulo: "Escuro", dica: "Sempre escuro", Icone: Moon },
  { modo: "sistema", rotulo: "Automático", dica: "Acompanha o sistema", Icone: Monitor },
  { modo: "light", rotulo: "Claro", dica: "Tom azulado", Icone: Sun },
];

type ViewTransitionDoc = Document & { startViewTransition?: (cb: () => void) => { ready: Promise<void>; finished: Promise<void> } };

/** Liga a trava das transições de cor (ver global.css) e a solta depois de pintado o tema novo. */
function travarTransicoes(): (soltar?: Promise<unknown>) => void {
  const raiz = document.documentElement;
  raiz.setAttribute("data-trocando-tema", "");
  return (soltar) => {
    const liberar = () => window.requestAnimationFrame(() => window.requestAnimationFrame(() => raiz.removeAttribute("data-trocando-tema")));
    if (soltar) void soltar.then(liberar, liberar); else liberar();
  };
}

const DURACAO_MS = 220;

/**
 * Fade curto: o tema novo surge por cima do antigo só com opacidade. Sem zoom: com ele, o texto antigo e o novo ficavam
 * desalinhados durante a mistura e a tela parecia "piscar" em dobro. Curto de propósito, para o quadro acinzentado do meio
 * (branco misturado com preto) quase não aparecer.
 */
function respiro(): void {
  document.documentElement.animate(
    { opacity: [0, 1] },
    { duration: DURACAO_MS, easing: "ease-out", pseudoElement: "::view-transition-new(root)" },
  );
}

/**
 * Seletor de tema no desenho dos outros controles do Ecos: um segmentado de largura total, com um realce que desliza
 * entre as três opções e um ícone que se anima ao ser escolhido (o sol gira, a lua se inclina). Ao trocar, o app inteiro
 * surge com um fade curto (View Transitions), a menos que o movimento esteja reduzido ou o
 * navegador não suporte.
 */
export function SeletorTema({ modo, aoEscolher, reduzirMovimento }: { modo: ModoTema; aoEscolher: (m: ModoTema) => void; reduzirMovimento: boolean }) {
  const celulas = useRef<Record<string, HTMLButtonElement | null>>({});
  const indice = OPCOES.findIndex((o) => o.modo === modo);

  function escolher(novo: ModoTema) {
    if (novo === modo) return;
    const doc = document as ViewTransitionDoc;
    const sistemaReduz = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (!doc.startViewTransition || reduzirMovimento || sistemaReduz) { const soltar = travarTransicoes(); aoEscolher(novo); soltar(); return; }
    const soltar = travarTransicoes();
    const transicao = doc.startViewTransition(() => {
      flushSync(() => aoEscolher(novo));
      document.documentElement.setAttribute("data-theme", resolverTema(novo));
    });
    soltar(transicao.finished);
    void transicao.ready.then(respiro).catch(() => undefined);
  }

  function aoTeclar(e: React.KeyboardEvent) {
    const passo = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!passo) return;
    e.preventDefault();
    const proximo = OPCOES[(indice + passo + OPCOES.length) % OPCOES.length];
    escolher(proximo.modo);
    celulas.current[proximo.modo]?.focus();
  }

  return (
    <section data-config="tema" className="mt-0">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Tema</p>
      <div className="rounded-2xl border border-border bg-surface-1 p-2">
        <div role="radiogroup" aria-label="Tema" onKeyDown={aoTeclar} className="relative grid grid-cols-3 overflow-hidden rounded-xl bg-surface-2 p-1">
          {/* Realce que desliza entre as opções */}
          <span aria-hidden className="absolute inset-y-1 left-1 rounded-lg border border-border bg-surface-3 shadow-sm transition-transform duration-500 ease-[cubic-bezier(.22,1,.36,1)]"
            style={{ width: "calc((100% - 0.5rem) / 3)", transform: `translateX(${indice * 100}%)` }} />
          {OPCOES.map(({ modo: m, rotulo, dica, Icone }) => {
            const ativo = modo === m;
            return (
              <button key={m} ref={(el) => { celulas.current[m] = el; }} type="button" role="radio" aria-checked={ativo} tabIndex={ativo ? 0 : -1} onClick={() => escolher(m)}
                className={`relative z-10 flex min-h-16 flex-col items-center justify-center gap-0.5 rounded-lg px-3 py-2 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-steel-400 ${ativo ? "text-text-primary" : "text-text-muted hover:text-text-secondary"}`}>
                <Icone size={20} strokeWidth={1.75} aria-hidden
                  className={`mb-0.5 transition-[transform,color] duration-500 ease-[cubic-bezier(.34,1.56,.64,1)] ${ativo ? (m === "light" ? "rotate-90 scale-110 text-warning" : m === "dark" ? "-rotate-12 scale-110 text-steel-300" : "scale-110 text-cyan") : "rotate-0 scale-100"}`} />
                <span className="text-sm font-medium">{rotulo}</span>
                <span className="text-[11px] text-text-muted">{dica}</span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
