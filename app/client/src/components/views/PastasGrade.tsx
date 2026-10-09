import { ArvorePastas } from "@/components/common/ArvorePastas";
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { Check, ChevronRight, FileText, Folder, FolderInput, FolderPlus, ListChecks, MoreHorizontal, Pencil, StickyNote, Trash2, X } from "lucide-react";
import { ApiError, pastas as pastasApi } from "@/lib/api";
import { useRefreshBus } from "@/lib/refresh-bus";
import { avisar } from "@/lib/toast";
import { lerPreferenciasAplicativo } from "@/lib/preferencias-aplicativo";
import { TOM, misturar } from "@/components/common/MenuSuspenso";

export interface PastaResumo {
  caminho: string;
  nome: string;
  contagem_itens: number;
}

export interface ItemExplorador {
  tipo: "nota" | "tarefa" | "documento";
  id?: string;
  titulo?: string;
  nome?: string;
  caminho?: string;
}

interface Props {
  pastas: PastaResumo[];
  /** Identifica o módulo (`notas`/`tarefas`): ocultar pastas vale para todas as telas dele. */
  chave: "notas" | "tarefas";
  titulo?: string;
  corIcone: string;
  aoAbrir: (pasta: PastaResumo) => void;
  /** Quando presente, mostra o bloco tracejado "Nova pasta". */
  aoCriar?: () => void;
  rotuloCriar?: string;
  /** Espaço da árvore administrada. */
  espaco?: string;
  /** Organização usa linhas de explorador; as telas de conteúdo continuam em grade. */
  visualizacao?: "grade" | "explorador";
  itens?: ItemExplorador[];
  aoAbrirItem?: (item: ItemExplorador, evento: MouseEvent<HTMLButtonElement>) => void;
}

/** Escolha feita no próprio botão. Some quando a pessoa muda o padrão em Configurações (ver `limparEscolhaDePastas`). */
const chaveOcultas = (chave: string) => `ecos:pastas-ocultas:v2:${chave}`;

/** Esquece o que foi escolhido no botão, para o padrão das Configurações valer de novo. */
export function limparEscolhaDePastas() {
  try { (["notas", "tarefas"] as const).forEach((c) => localStorage.removeItem(chaveOcultas(c))); } catch { /* sem armazenamento */ }
}

function lerOcultas(chave: string, padraoOculto: boolean): boolean {
  try {
    const escolha = localStorage.getItem(chaveOcultas(chave));
    return escolha === null ? padraoOculto : escolha === "1";
  } catch {
    return padraoOculto;
  }
}

const DURACAO_MS = 250;

/**
 * Olho que abre e fecha: a pálpebra (amêndoa) se achata e a pupila encolhe; ao abrir, volta com uma piscada
 * (leve overshoot). Fechado, o risco diagonal é desenhado por cima.
 */
function Olho({ aberto }: { aberto: boolean }) {
  const mola = "cubic-bezier(0.34, 1.56, 0.64, 1)";
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <g style={{ transformBox: "fill-box", transformOrigin: "center", transform: `scaleY(${aberto ? 1 : 0.18})`, transition: `transform 380ms ${aberto ? mola : "cubic-bezier(0.4, 0, 0.2, 1)"}` }}>
        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      </g>
      <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" style={{ transformBox: "fill-box", transformOrigin: "center", transform: `scale(${aberto ? 1 : 0})`, opacity: aberto ? 1 : 0, transition: `transform 320ms ${aberto ? mola : "ease-in"}, opacity 200ms ease` }} />
      <path d="M4 4l16 16" pathLength={1} strokeDasharray={1} strokeDashoffset={aberto ? 1 : 0} style={{ transition: `stroke-dashoffset ${aberto ? 200 : 320}ms ease-out ${aberto ? 0 : 120}ms` }} />
    </svg>
  );
}

/** Atraso escalonado: cada pasta entra um instante depois da anterior; ao ocultar, somem juntas. */
const entrada = (indice: number, oculto: boolean) => ({ transitionDelay: oculto ? "0ms" : `${Math.min(indice, 10) * 25}ms` });

/** Recolhe e expande a altura com animação (grid 0fr→1fr). Fechado, o conteúdo fica inerte para teclado e leitor de tela. */
function Recolhivel({ oculto, cortar, children }: { oculto: boolean; cortar: boolean; children: ReactNode }) {
  return (
    <div className={`grid transition-[grid-template-rows,opacity] ease-out ${oculto ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100"}`} style={{ transitionDuration: `${DURACAO_MS}ms` }} aria-hidden={oculto} {...(oculto ? ({ inert: "" } as object) : {})}>
      <div className={`min-h-0 ${oculto || cortar ? "overflow-hidden" : "overflow-visible"}`}>{children}</div>
    </div>
  );
}

/**
 * Pastas como blocos quadrados (1:1), quantos couberem por linha. O botão do
 * cabeçalho oculta e mostra todas de uma vez — a escolha vale para o módulo
 * inteiro e fica guardada.
 */
export function PastasGrade({ pastas, chave, titulo = "Pastas", corIcone, aoAbrir, aoCriar, rotuloCriar = "Nova pasta", espaco, visualizacao = "grade", itens = [], aoAbrirItem }: Props) {
  // No explorador (Organização) a lista também traz os itens: ele abre mostrando tudo, sem seguir o padrão de pastas.
  const padraoOculto = visualizacao === "grade" && !lerPreferenciasAplicativo().pastasVisiveis;
  const [ocultas, setOcultas] = useState(() => lerOcultas(chave, padraoOculto));
  const [estilo, setEstilo] = useState(() => lerPreferenciasAplicativo().estiloPastas);
  // Durante a animação o conteúdo é cortado; depois solta, para o menu de cada pasta não ser cortado.
  const [animando, setAnimando] = useState(false);
  const temporizador = useRef<number>();
  const [menu, setMenu] = useState<string | null>(null);
  const [acao, setAcao] = useState<"renomear" | "mover" | "excluir" | null>(null);
  const [pastaAtiva, setPastaAtiva] = useState<PastaResumo | null>(null);
  const [novoNome, setNovoNome] = useState("");
  const [destinos, setDestinos] = useState<PastaResumo[]>([]);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const { notificar } = useRefreshBus();
  const tipo = chave === "tarefas" ? "tarefa" : "nota";
  const tom = chave === "tarefas" ? TOM.ciano : TOM.aco;

  useEffect(() => {
    if (acao !== "mover") return;
    pastasApi.listar({ recursivo: true, tipo, espaco }).then((resultado) => setDestinos(resultado.subpastas)).catch(() => setDestinos([]));
  }, [acao, tipo, espaco]);

  useEffect(() => {
    const aoMudarPreferencias = () => {
      const prefs = lerPreferenciasAplicativo();
      setEstilo(prefs.estiloPastas);
      setOcultas(lerOcultas(chave, visualizacao === "grade" && !prefs.pastasVisiveis));
    };
    window.addEventListener("ecos:preferencias-aplicativo", aoMudarPreferencias);
    return () => { window.removeEventListener("ecos:preferencias-aplicativo", aoMudarPreferencias); window.clearTimeout(temporizador.current); };
  }, [chave, visualizacao]);

  function alternar() {
    const proximo = !ocultas;
    setMenu(null);
    setAnimando(true);
    window.clearTimeout(temporizador.current);
    temporizador.current = window.setTimeout(() => setAnimando(false), DURACAO_MS + 400);
    setOcultas(proximo);
    try {
      localStorage.setItem(chaveOcultas(chave), proximo ? "1" : "0");
    } catch {
      /* só não persiste */
    }
  }
  function abrirAcao(pasta: PastaResumo, proxima: "renomear" | "mover" | "excluir") {
    setMenu(null); setPastaAtiva(pasta); setAcao(proxima); setNovoNome(pasta.nome); setErro(null);
  }
  function fecharAcao() { setAcao(null); setPastaAtiva(null); setErro(null); }
  async function renomear() {
    if (!pastaAtiva || !novoNome.trim() || ocupado) return;
    const pai = pastaAtiva.caminho.split("/").slice(0, -1).join("/");
    setOcupado(true); setErro(null);
    try { await pastasApi.renomear({ tipo, espaco, caminho_atual: pastaAtiva.caminho, novo_caminho: pai ? `${pai}/${novoNome.trim()}` : novoNome.trim() }); notificar(); fecharAcao(); avisar("Pasta renomeada com sucesso.", "sucesso"); }
    catch (e) { setErro(e instanceof ApiError ? e.message : "Não foi possível renomear a pasta."); }
    finally { setOcupado(false); }
  }
  async function mover(destino: string) {
    if (!pastaAtiva || ocupado) return;
    const novoCaminho = destino ? `${destino}/${pastaAtiva.nome}` : pastaAtiva.nome;
    if (novoCaminho === pastaAtiva.caminho || novoCaminho.startsWith(`${pastaAtiva.caminho}/`)) { setErro("Uma pasta não pode ser movida para dentro dela mesma."); return; }
    setOcupado(true); setErro(null);
    try { await pastasApi.renomear({ tipo, espaco, caminho_atual: pastaAtiva.caminho, novo_caminho: novoCaminho }); notificar(); fecharAcao(); avisar("Pasta movida com sucesso.", "sucesso"); }
    catch (e) { setErro(e instanceof ApiError ? e.message : "Não foi possível mover a pasta."); }
    finally { setOcupado(false); }
  }
  async function excluir() {
    if (!pastaAtiva || ocupado) return;
    setOcupado(true); setErro(null);
    try { await pastasApi.excluir({ tipo, espaco, caminho: pastaAtiva.caminho }); notificar(); fecharAcao(); avisar("Pasta excluída com sucesso.", "sucesso"); }
    catch (e) { setErro(e instanceof ApiError ? e.message : "Não foi possível excluir a pasta. Ela pode precisar estar vazia."); }
    finally { setOcupado(false); }
  }

  return (
    <section aria-label={titulo}>
      <div className="mb-2 flex items-center gap-2">
        <div className="flex items-center gap-1.5">
        <button
          type="button"
          aria-pressed={!ocultas}
          aria-label={titulo}
          title={ocultas ? `Mostrar ${titulo.toLowerCase()}` : `Ocultar ${titulo.toLowerCase()}`}
          onClick={alternar}
          style={ocultas ? undefined : { color: tom }}
          className={`flex h-8 w-8 items-center justify-center rounded-lg transition-[background-color,color,transform] duration-200 hover:bg-surface-2 active:scale-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-steel-400 ${ocultas ? "text-text-muted hover:text-text-primary" : ""}`}
        >
          <Olho aberto={!ocultas} />
        </button>
        <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
          {titulo}
          <span className="ml-1.5 font-mono-value normal-case tracking-normal">{pastas.length}</span>
        </p>
        </div>
      </div>

      {visualizacao === "grade" && (
        <Recolhivel oculto={ocultas} cortar={animando}>
        <div className="grid gap-3 pb-1" style={{ gridTemplateColumns: estilo === "compacta" ? "repeat(auto-fill, minmax(190px, 1fr))" : "repeat(auto-fill, minmax(140px, 1fr))" }}>
          {pastas.map((p, i) => (
            <div key={p.caminho} style={entrada(i, ocultas)} className={`relative flex min-w-0 rounded-card bg-surface-1 transition-[opacity,transform,background-color] duration-[230ms] hover:bg-surface-2 ${estilo === "compacta" ? "h-12 !rounded-xl" : "aspect-square"} ${ocultas ? "scale-95 opacity-0" : "scale-100 opacity-100"}`}>
            <button type="button" onClick={() => aoAbrir(p)} className={`flex min-w-0 flex-1 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-steel-400 ${estilo === "compacta" ? "items-center gap-2.5 pl-3 pr-10" : "flex-col justify-between p-4 pr-11"}`}>
              <Folder size={estilo === "compacta" ? 18 : 28} strokeWidth={1.5} className={`shrink-0 ${corIcone}`} />
              {estilo === "compacta" ? (
                <span className="flex min-w-0 flex-1 items-baseline gap-2"><span className="truncate text-sm font-semibold text-text-primary">{p.nome}</span><span className="shrink-0 text-xs text-text-muted">{p.contagem_itens}</span></span>
              ) : (
                <span className="min-w-0">
                  <span className="line-clamp-2 block break-words font-body text-[15px] font-semibold leading-snug text-text-primary">{p.nome}</span>
                  <span className="mt-0.5 block text-xs text-text-muted">{p.contagem_itens} {p.contagem_itens === 1 ? "item" : "itens"}</span>
                </span>
              )}
            </button>
            <button type="button" aria-label={`Ações para ${p.nome}`} aria-haspopup="menu" aria-expanded={menu === p.caminho} onClick={() => setMenu((atual) => atual === p.caminho ? null : p.caminho)} className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-lg text-text-muted hover:bg-surface-3 hover:text-text-primary"><MoreHorizontal size={18} /></button>
            {menu === p.caminho && <div role="menu" className="absolute right-2 top-11 z-20 w-44 rounded-xl border border-border bg-surface-1 p-1 shadow-nav"><button type="button" role="menuitem" onClick={() => { setMenu(null); aoAbrir(p); }} className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-sm text-text-primary hover:bg-surface-2"><Folder size={15} />Editar</button><button type="button" role="menuitem" onClick={() => abrirAcao(p, "renomear")} className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-sm text-text-primary hover:bg-surface-2"><Pencil size={15} />Renomear</button><button type="button" role="menuitem" onClick={() => abrirAcao(p, "mover")} className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-sm text-text-primary hover:bg-surface-2"><FolderInput size={15} />Mover</button><button type="button" role="menuitem" onClick={() => abrirAcao(p, "excluir")} className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-error hover:bg-error/10"><Trash2 size={15} />Excluir</button></div>}
            </div>
          ))}
          {aoCriar && (
            <button
              type="button"
              onClick={aoCriar}
              style={entrada(pastas.length, ocultas)}
              className={`flex items-center justify-center gap-2 border border-dashed border-border text-text-muted transition-[opacity,transform,border-color,color] duration-[230ms] hover:border-steel-500/60 hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-steel-400 ${estilo === "compacta" ? "h-12 rounded-xl" : "aspect-square flex-col rounded-card"} ${ocultas ? "scale-95 opacity-0" : "scale-100 opacity-100"}`}
            >
              <FolderPlus size={estilo === "compacta" ? 18 : 22} strokeWidth={1.5} />
              <span className="text-xs font-medium">{rotuloCriar}</span>
            </button>
          )}
        </div>
        </Recolhivel>
      )}
      {visualizacao === "explorador" && !ocultas && (
        <div className="overflow-hidden rounded-2xl border border-border bg-surface-1">
          <div className="flex min-h-11 items-center border-b border-border bg-surface-2/60 px-3 text-xs font-medium text-text-muted"><span className="flex-1">Nome</span><span className="hidden sm:block sm:w-24">Tipo</span><span className="w-8" /></div>
          {pastas.map((p) => <div key={p.caminho} className="group relative flex min-h-12 items-center border-b border-border px-3 last:border-b-0 hover:bg-surface-2"><button type="button" onClick={() => aoAbrir(p)} className="flex min-w-0 flex-1 items-center gap-3 text-left"><Folder size={18} strokeWidth={1.65} className={corIcone} /><span className="min-w-0 flex-1 truncate text-sm font-medium text-text-primary">{p.nome}</span><span className="hidden text-xs text-text-muted sm:block sm:w-24">{p.contagem_itens} {p.contagem_itens === 1 ? "item" : "itens"}</span><ChevronRight size={16} className="text-text-muted" /></button><button type="button" aria-label={`Ações para ${p.nome}`} aria-haspopup="menu" aria-expanded={menu === p.caminho} onClick={() => setMenu((atual) => atual === p.caminho ? null : p.caminho)} className="ml-1 flex h-8 w-8 items-center justify-center rounded-lg text-text-muted hover:bg-surface-3 hover:text-text-primary"><MoreHorizontal size={18} /></button>{menu === p.caminho && <div role="menu" className="absolute right-3 top-10 z-20 w-44 rounded-xl border border-border bg-surface-1 p-1 shadow-nav"><button type="button" role="menuitem" onClick={() => { setMenu(null); aoAbrir(p); }} className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-sm text-text-primary hover:bg-surface-2"><Folder size={15} />Editar</button><button type="button" role="menuitem" onClick={() => abrirAcao(p, "renomear")} className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-sm text-text-primary hover:bg-surface-2"><Pencil size={15} />Renomear</button><button type="button" role="menuitem" onClick={() => abrirAcao(p, "mover")} className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-sm text-text-primary hover:bg-surface-2"><FolderInput size={15} />Mover</button><button type="button" role="menuitem" onClick={() => abrirAcao(p, "excluir")} className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-sm text-error hover:bg-error/10"><Trash2 size={15} />Excluir</button></div>}</div>)}
          {itens.map((item, indice) => { const Icone = item.tipo === "nota" ? StickyNote : item.tipo === "tarefa" ? ListChecks : FileText; const nome = item.titulo ?? item.nome ?? "Sem nome"; return <button key={`${item.tipo}:${item.id ?? item.caminho ?? indice}`} type="button" onClick={(evento) => aoAbrirItem?.(item, evento)} className="flex min-h-12 w-full items-center gap-3 border-b border-border px-3 text-left last:border-b-0 hover:bg-surface-2"><Icone size={18} strokeWidth={1.65} className="text-text-secondary" /><span className="min-w-0 flex-1 truncate text-sm text-text-primary">{nome}</span><span className="hidden text-xs capitalize text-text-muted sm:block sm:w-24">{item.tipo === "documento" ? "arquivo" : item.tipo}</span><ChevronRight size={16} className="text-text-muted" /></button>; })}
          {!pastas.length && !itens.length && <p className="px-4 py-8 text-center text-sm text-text-muted">Esta pasta está vazia.</p>}
          {aoCriar && <button type="button" onClick={aoCriar} className="flex min-h-12 w-full items-center gap-3 px-3 text-left text-sm font-medium text-steel-300 hover:bg-surface-2"><FolderPlus size={18} />{rotuloCriar}</button>}
        </div>
      )}
      {acao && pastaAtiva && (
        <div role="dialog" aria-modal="true" aria-labelledby="pasta-acao-titulo" className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4">
          <div className="w-full max-w-sm rounded-2xl border border-border bg-surface-1 p-5 shadow-nav">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 id="pasta-acao-titulo" className="font-semibold text-text-primary">{acao === "renomear" ? "Renomear pasta" : acao === "mover" ? "Mover pasta" : "Excluir pasta"}</h2>
              <button type="button" onClick={fecharAcao} className="flex h-9 w-9 items-center justify-center rounded-lg text-text-secondary hover:bg-surface-2" aria-label="Fechar"><X size={17} /></button>
            </div>
            {acao === "renomear" && <><label className="mb-2 block text-sm text-text-secondary" htmlFor="novo-nome-pasta">Nome</label><input id="novo-nome-pasta" autoFocus value={novoNome} onChange={(e) => setNovoNome(e.target.value)} className="ecos-input w-full !rounded-lg" /><button type="button" disabled={ocupado || !novoNome.trim()} onClick={() => void renomear()} className="mt-4 flex min-h-10 items-center gap-2 rounded-lg bg-steel-700 px-3 text-sm font-medium text-white disabled:opacity-40"><Check size={16} />Renomear</button></>}
            {acao === "mover" && <><p className="mb-3 text-sm text-text-secondary">Escolha qualquer pasta na árvore como destino para <span className="font-medium text-text-primary">{pastaAtiva.nome}</span>.</p><div className="max-h-[min(60vh,28rem)] space-y-1 overflow-y-auto"><button type="button" disabled={ocupado} onClick={() => void mover("")} className="flex min-h-10 w-full items-center rounded-lg px-3 text-left text-sm text-text-primary hover:bg-surface-2">Raiz</button><ArvorePastas opcoes={destinos.filter((d) => d.caminho !== pastaAtiva.caminho && !d.caminho.startsWith(`${pastaAtiva.caminho}/`)).map((p) => ({ valor: p.caminho, rotulo: p.nome, pasta: true }))} valores={[]} onSelect={(p) => { if (!ocupado) void mover(p); }} /></div></>}
            {acao === "excluir" && <><p className="text-sm text-text-secondary">Excluir <span className="font-medium text-text-primary">{pastaAtiva.nome}</span>? A pasta precisa estar vazia.</p><button type="button" disabled={ocupado} onClick={() => void excluir()} className="mt-4 flex min-h-10 items-center gap-2 rounded-lg bg-error px-3 text-sm font-medium text-white disabled:opacity-40"><Trash2 size={16} />Excluir pasta</button></>}
            {erro && <p role="alert" className="mt-3 text-sm text-error">{erro}</p>}
          </div>
        </div>
      )}
    </section>
  );
}
