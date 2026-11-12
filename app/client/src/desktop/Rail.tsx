import { useEffect, useRef, useState, type KeyboardEvent as TeclaReact, type PointerEvent as PonteiroReact } from "react";
import { ChevronDown, ChevronRight, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useModoExplorador } from "@/lib/use-modo-explorador";
import { ExploradorLateral } from "./ExploradorLateral";
import { RAIL_EXPLORADOR, RAIL_PRINCIPAL, RAIL_UTILITARIOS, moduloDaRota, moduloPorId, type ModuloId } from "./modules";
import { useWorkspace } from "./workspace-store";

const CHAVE_EXPANDIDA = "ecos.desktop.rail.expandida";
const CHAVE_LARGURAS = "ecos.desktop.rail.larguras.v1";
const LARGURA_MIN = 200;
const LARGURA_MAX = 560;
const LARGURA_PADRAO = { explorador: 288, normal: 208 } as const;
type ModoLargura = keyof typeof LARGURA_PADRAO;

/** Larguras escolhidas neste aparelho (uma por modo do menu); como as demais preferências, não sincronizam. */
function lerLarguras(): Partial<Record<ModoLargura, number>> {
  try {
    const salvo = JSON.parse(localStorage.getItem(CHAVE_LARGURAS) ?? "{}") as Record<string, unknown>;
    const ok = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.min(LARGURA_MAX, Math.max(LARGURA_MIN, Math.round(v))) : undefined);
    return { explorador: ok(salvo.explorador), normal: ok(salvo.normal) };
  } catch { return {}; }
}

const CHAVE_SECOES = "ecos.desktop.rail.secoes-recolhidas.v1";

function lerSecoes(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(CHAVE_SECOES) ?? "[]") as string[]); } catch { return new Set(); }
}

function lerExpandida(): boolean {
  try { return localStorage.getItem(CHAVE_EXPANDIDA) === "1"; } catch { return false; }
}

/** Rail lateral: fino (só ícones) ou expandido (ícone + nome). Ctrl/Cmd+B alterna; a escolha é lembrada. */
export function Rail({ abrirCofre }: { abrirCofre: () => void }) {
  const [expandida, setExpandida] = useState(lerExpandida);
  useEffect(() => { try { localStorage.setItem(CHAVE_EXPANDIDA, expandida ? "1" : "0"); } catch { /* cache indisponível */ } }, [expandida]);
  useEffect(() => {
    function aoTeclar(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "b") {
        e.preventDefault();
        setExpandida((v) => !v);
      }
    }
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, []);
  const explorador = useModoExplorador();
  const modoLargura: ModoLargura = explorador ? "explorador" : "normal";
  const [larguras, setLarguras] = useState(lerLarguras);
  const largura = larguras[modoLargura] ?? LARGURA_PADRAO[modoLargura];
  const [redimensionando, setRedimensionando] = useState(false);
  const nav = useRef<HTMLElement>(null);
  const definirLargura = (valor: number | null) => setLarguras((atual) => {
    const proximas = { ...atual };
    if (valor === null) delete proximas[modoLargura]; else proximas[modoLargura] = Math.min(LARGURA_MAX, Math.max(LARGURA_MIN, Math.round(valor)));
    try { localStorage.setItem(CHAVE_LARGURAS, JSON.stringify(proximas)); } catch { /* só conveniência */ }
    return proximas;
  });
  function arrastarAlca(e: PonteiroReact<HTMLDivElement>) {
    if (e.button !== 0) return;
    e.preventDefault();
    const esquerda = nav.current?.getBoundingClientRect().left ?? 0;
    const alca = e.currentTarget;
    alca.setPointerCapture(e.pointerId);
    setRedimensionando(true);
    const mover = (ev: PointerEvent) => definirLargura(ev.clientX - esquerda);
    const soltar = () => {
      setRedimensionando(false);
      alca.removeEventListener("pointermove", mover);
      alca.removeEventListener("pointerup", soltar);
      alca.removeEventListener("pointercancel", soltar);
    };
    alca.addEventListener("pointermove", mover);
    alca.addEventListener("pointerup", soltar);
    alca.addEventListener("pointercancel", soltar);
  }
  function alcaTeclado(e: TeclaReact<HTMLDivElement>) {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); definirLargura(largura + (e.key === "ArrowRight" ? 16 : -16) * (e.shiftKey ? 3 : 1)); }
    else if (e.key === "Home" || e.key === "Enter") { e.preventDefault(); definirLargura(null); }
  }
  const alcaLargura = expandida && (
    <div role="separator" aria-orientation="vertical" aria-label="Largura do menu lateral (setas ajustam; Enter volta ao padrão)" tabIndex={0}
      aria-valuemin={LARGURA_MIN} aria-valuemax={LARGURA_MAX} aria-valuenow={largura} title="Arraste para ajustar a largura. Duplo clique volta ao padrão."
      onPointerDown={arrastarAlca} onDoubleClick={() => definirLargura(null)} onKeyDown={alcaTeclado}
      className={`absolute inset-y-0 right-0 z-20 w-1.5 cursor-col-resize touch-none transition-colors hover:bg-cyan/40 focus-visible:bg-cyan/60 focus-visible:outline-none ${redimensionando ? "bg-cyan/60" : ""}`} />
  );
  const estiloLargura = expandida ? { width: largura } : undefined;
  const transicao = redimensionando ? "" : "transition-[width] duration-200 motion-reduce:transition-none";
  const [recolhidas, setRecolhidas] = useState(lerSecoes);
  useEffect(() => { try { localStorage.setItem(CHAVE_SECOES, JSON.stringify([...recolhidas])); } catch { /* só conveniência */ } }, [recolhidas]);
  const alternarSecao = (id: string) => setRecolhidas((r) => { const p = new Set(r); if (p.has(id)) p.delete(id); else p.add(id); return p; });
  const { state, dispatch } = useWorkspace();
  const focada = state.panes.find((p) => p.id === state.focusedPaneId);
  const abaAtiva = focada?.tabs.find((t) => t.id === focada.activeTabId);
  const moduloAtivo = abaAtiva ? moduloDaRota(abaAtiva.path).id : null;

  function botao(id: ModuloId) {
    const modulo = moduloPorId(id);
    const ativo = moduloAtivo === id;
    const compacto = explorador && expandida; // modo explorador aberto: botões mais baixos para sobrar altura à árvore
    return (
      <button
        key={id}
        type="button"
        aria-label={modulo.titulo}
        aria-current={ativo ? "page" : undefined}
        title={expandida ? "Ctrl+clique abre ao lado" : `${modulo.titulo} — Ctrl+clique abre ao lado`}
        onClick={(e) => {
          if (id === "cofre") {
            abrirCofre();
            return;
          }
          dispatch({
            type: "open",
            path: modulo.raiz,
            where: e.ctrlKey || e.metaKey ? "new-pane" : "focused",
            reuse: "modulo",
          });
        }}
        className={`relative flex ${compacto ? "h-9" : "h-10"} items-center rounded-xl transition-colors ${expandida ? "w-full gap-3 px-3" : "w-10 justify-center"} ${
          id === "lixeira" ? (ativo ? "bg-error/15 text-error" : "text-error/75 hover:bg-error/10 hover:text-error") : ativo ? "bg-surface-2 text-text-primary" : "text-text-muted hover:bg-surface-2 hover:text-text-primary"
        }`}
      >
        {ativo && <span className={`absolute -left-2 ${compacto ? "top-1.5 bottom-1.5" : "top-2 bottom-2"} w-0.5 rounded-full ${id === "lixeira" ? "bg-error" : "bg-cyan"}`} />}
        <modulo.icone size={19} strokeWidth={1.75} className="shrink-0" />
        {expandida && <span className="truncate text-sm font-medium">{modulo.titulo}</span>}
      </button>
    );
  }

  const botaoRecolher = (
    <button type="button" onClick={() => setExpandida((v) => !v)} aria-expanded={expandida}
      aria-label={expandida ? "Recolher menu lateral" : "Expandir menu lateral"} title={`${expandida ? "Recolher" : "Expandir"} menu (Ctrl+B)`}
      className={`flex h-10 items-center rounded-xl text-text-muted transition-colors hover:bg-surface-2 hover:text-text-primary ${expandida ? "w-full gap-3 px-3" : "w-10 justify-center"}`}>
      {expandida ? <PanelLeftClose size={19} strokeWidth={1.75} className="shrink-0" /> : <PanelLeftOpen size={19} strokeWidth={1.75} className="shrink-0" />}
      {expandida && <span className="truncate text-sm font-medium">Recolher menu</span>}
    </button>
  );

  function secao(id: string, titulo: string) {
    const aberta = !recolhidas.has(id);
    return (
      <button type="button" onClick={() => alternarSecao(id)} aria-expanded={aberta}
        className="flex h-8 w-full items-center gap-1 rounded-md px-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-text-muted hover:text-text-primary">
        {aberta ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        {titulo}
      </button>
    );
  }

  if (explorador) {
    return (
      <nav ref={nav} aria-label="Módulos" data-expandida={expandida} data-explorador="true" style={estiloLargura}
        className={`relative flex shrink-0 flex-col gap-1 overflow-hidden border-r border-border bg-surface-1 py-2.5 ${transicao} ${expandida ? "items-stretch px-2" : "w-14 items-center"}`}>
        {alcaLargura}
        {expandida ? (
          <>
            {/* Módulos + árvore rolam juntos, com uma única barra, que só aparece ao passar o mouse. */}
            <div className="relative flex min-h-0 flex-1 flex-col">
              <div className="scroll-discreto -mr-1.5 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto pr-1">
                {secao("modulos", "Módulos")}
                {!recolhidas.has("modulos") && <div className="flex flex-col gap-1">{RAIL_EXPLORADOR.map(botao)}</div>}
                <div className="my-2 border-t border-border" />
                {secao("arquivos", "Arquivos")}
                {!recolhidas.has("arquivos") && <ExploradorLateral />}
              </div>
              {/* Esmaece a última linha: deixa claro que a lista continua, em vez de parecer cortada. */}
              <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-5 bg-gradient-to-t from-surface-1 to-transparent" />
            </div>
            <div className="flex shrink-0 items-center gap-1 border-t border-border pt-1.5">
              <div className="min-w-0 flex-1">{RAIL_UTILITARIOS.map(botao)}</div>
              <button type="button" onClick={() => setExpandida(false)} aria-label="Recolher menu lateral" title="Recolher menu (Ctrl+B)"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-text-muted transition-colors hover:bg-surface-2 hover:text-text-primary">
                <PanelLeftClose size={19} strokeWidth={1.75} />
              </button>
            </div>
          </>
        ) : (
          <>
            {RAIL_EXPLORADOR.map(botao)}
            <div className="mt-auto flex flex-col items-center gap-1">
              {RAIL_UTILITARIOS.map(botao)}
              {botaoRecolher}
            </div>
          </>
        )}
      </nav>
    );
  }

  return (
    <nav ref={nav} aria-label="Módulos" data-expandida={expandida} style={estiloLargura}
      className={`relative flex shrink-0 flex-col gap-1 overflow-hidden border-r border-border bg-surface-1 py-2.5 ${transicao} ${expandida ? "items-stretch px-2" : "w-14 items-center"}`}>
      {alcaLargura}
      {RAIL_PRINCIPAL.map(botao)}
      <div className={`mt-auto flex flex-col gap-1 ${expandida ? "items-stretch" : "items-center"}`}>
        {RAIL_UTILITARIOS.map(botao)}
        <button type="button" onClick={() => setExpandida((v) => !v)} aria-expanded={expandida}
          aria-label={expandida ? "Recolher menu lateral" : "Expandir menu lateral"} title={`${expandida ? "Recolher" : "Expandir"} menu (Ctrl+B)`}
          className={`flex h-10 items-center rounded-xl text-text-muted transition-colors hover:bg-surface-2 hover:text-text-primary ${expandida ? "w-full gap-3 px-3" : "w-10 justify-center"}`}>
          {expandida ? <PanelLeftClose size={19} strokeWidth={1.75} className="shrink-0" /> : <PanelLeftOpen size={19} strokeWidth={1.75} className="shrink-0" />}
          {expandida && <span className="truncate text-sm font-medium">Recolher menu</span>}
        </button>
      </div>
    </nav>
  );
}
