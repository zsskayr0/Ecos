import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { AcoesFocusContext, ModoFocusDocumentoContext, PainelFocusControleContext, PainelFocusTarefaContext } from "@/lib/documento-popup";

const CHAVE_LARGURA = "ecos.aba-documento.painel-largura.v1";
const LARGURA_PADRAO = 380;
const LARGURA_MIN = 300;
const LARGURA_MAX = 680;
const limitar = (n: number) => Math.round(Math.min(LARGURA_MAX, Math.max(LARGURA_MIN, n)));

function larguraSalva(): number {
  try { const n = Number(localStorage.getItem(CHAVE_LARGURA)); return Number.isFinite(n) && n > 0 ? limitar(n) : LARGURA_PADRAO; } catch { return LARGURA_PADRAO; }
}
function guardarLargura(n: number) { try { localStorage.setItem(CHAVE_LARGURA, String(n)); } catch { /* só não persiste */ } }

/**
 * Tarefa ou nota fixada como aba: o mesmo documento do modo Focus (título com divisória, editor sem moldura, painel "Opções"),
 * só que embutido na aba — sem camada flutuante nem blur. A tela da tarefa já sabe se montar assim quando o contexto
 * do Focus está ligado; aqui só entregamos o cabeçalho de ações e a coluna lateral onde ela se monta.
 */
export function AbaTarefa({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  if (!pathname.startsWith("/tarefa/") && !pathname.startsWith("/notas/nota/")) return <>{children}</>;
  return <LayoutAbaTarefa>{children}</LayoutAbaTarefa>;
}

function LayoutAbaTarefa({ children }: { children: ReactNode }) {
  const [painelAberto, setPainelAberto] = useState(true);
  const [largura, setLargura] = useState(larguraSalva);
  const [arrastando, setArrastando] = useState(false);
  const arraste = useRef<{ x: number; largura: number } | null>(null);
  const [montagem, setMontagem] = useState<HTMLElement | null>(null);
  const [acoes, setAcoes] = useState<HTMLElement | null>(null);
  const controle = useMemo(() => ({ aberto: painelAberto, alternar: () => setPainelAberto((v) => !v) }), [painelAberto]);

  function iniciarArraste(e: PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    arraste.current = { x: e.clientX, largura };
    setArrastando(true);
  }
  function moverArraste(e: PointerEvent<HTMLDivElement>) {
    const a = arraste.current;
    if (a) setLargura(limitar(a.largura + (a.x - e.clientX))); // arrastar para a esquerda alarga o painel
  }
  function encerrarArraste() {
    if (!arraste.current) return;
    arraste.current = null;
    setArrastando(false);
    guardarLargura(largura);
  }
  function aoTeclar(e: KeyboardEvent<HTMLDivElement>) {
    const passo = e.key === "ArrowLeft" ? 24 : e.key === "ArrowRight" ? -24 : 0;
    if (!passo) return;
    e.preventDefault();
    const nova = limitar(largura + passo);
    setLargura(nova);
    guardarLargura(nova);
  }
  function restaurar() { setLargura(LARGURA_PADRAO); guardarLargura(LARGURA_PADRAO); }

  return (
    <ModoFocusDocumentoContext.Provider value={true}>
      <PainelFocusTarefaContext.Provider value={montagem}>
        <PainelFocusControleContext.Provider value={controle}>
          <AcoesFocusContext.Provider value={acoes}>
            <div className="flex h-full min-h-0 flex-col" data-aba-tarefa>
              <header className="flex h-10 shrink-0 items-center justify-end border-b border-border bg-surface-1 px-3">
                {/* O divisor que antecede o X do Focus não faz sentido aqui. */}
                <div ref={setAcoes} className="flex items-center gap-0.5 [&>span:last-child]:hidden" />
              </header>
              <div className="flex min-h-0 flex-1">
                <div className="min-w-0 flex-1 overflow-y-auto px-8 py-6">
                  <div className="mx-auto w-full max-w-[1380px]">{children}</div>
                </div>
                {painelAberto && (
                  <div role="separator" aria-orientation="vertical" aria-label="Redimensionar o painel de opções" aria-valuenow={largura} aria-valuemin={LARGURA_MIN} aria-valuemax={LARGURA_MAX} tabIndex={0}
                    title="Arraste para redimensionar — duplo clique restaura"
                    onPointerDown={iniciarArraste} onPointerMove={moverArraste} onPointerUp={encerrarArraste} onPointerCancel={encerrarArraste} onKeyDown={aoTeclar} onDoubleClick={restaurar}
                    className="group relative z-10 -mr-px w-2 shrink-0 cursor-col-resize touch-none focus-visible:outline-none">
                    <span className={`absolute inset-y-0 right-0 w-px transition-all group-hover:w-0.5 group-hover:bg-steel-400 group-focus-visible:w-0.5 group-focus-visible:bg-steel-400 ${arrastando ? "w-0.5 bg-steel-400" : "bg-border"}`} />
                  </div>
                )}
                <aside
                  aria-hidden={!painelAberto || undefined}
                  {...(painelAberto ? {} : ({ inert: "" } as object))}
                  className={`shrink-0 overflow-y-auto bg-surface-1 ease-out motion-reduce:transition-none ${arrastando ? "" : "transition-[width,opacity,padding] duration-300"} ${painelAberto ? "p-5 opacity-100" : "w-0 p-0 opacity-0"}`}
                  style={painelAberto ? { width: largura } : undefined}
                >
                  <div ref={setMontagem} className="min-w-[260px]" />
                </aside>
              </div>
            </div>
          </AcoesFocusContext.Provider>
        </PainelFocusControleContext.Provider>
      </PainelFocusTarefaContext.Provider>
    </ModoFocusDocumentoContext.Provider>
  );
}
