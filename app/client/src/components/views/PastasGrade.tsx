import { useEffect, useState } from "react";
import { Check, ChevronDown, Folder, FolderInput, FolderPlus, MoreHorizontal, Pencil, Trash2, X } from "lucide-react";
import { ApiError, pastas as pastasApi } from "@/lib/api";
import { useRefreshBus } from "@/lib/refresh-bus";

export interface PastaResumo {
  caminho: string;
  nome: string;
  contagem_itens: number;
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
}

const chaveOcultas = (chave: string) => `ecos:pastas-ocultas:${chave}`;

function lerOcultas(chave: string): boolean {
  try {
    return localStorage.getItem(chaveOcultas(chave)) === "1";
  } catch {
    return false;
  }
}

/**
 * Pastas como blocos quadrados (1:1), quantos couberem por linha. O botão do
 * cabeçalho oculta e mostra todas de uma vez — a escolha vale para o módulo
 * inteiro e fica guardada.
 */
export function PastasGrade({ pastas, chave, titulo = "Pastas", corIcone, aoAbrir, aoCriar }: Props) {
  const [ocultas, setOcultas] = useState(() => lerOcultas(chave));
  const [menu, setMenu] = useState<string | null>(null);
  const [acao, setAcao] = useState<"renomear" | "mover" | "excluir" | null>(null);
  const [pastaAtiva, setPastaAtiva] = useState<PastaResumo | null>(null);
  const [novoNome, setNovoNome] = useState("");
  const [destinos, setDestinos] = useState<PastaResumo[]>([]);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const { notificar } = useRefreshBus();
  const tipo = chave === "tarefas" ? "tarefa" : "nota";

  useEffect(() => {
    if (acao !== "mover") return;
    pastasApi.listar({ tipo }).then((resultado) => setDestinos(resultado.subpastas)).catch(() => setDestinos([]));
  }, [acao, tipo]);

  function alternar() {
    const proximo = !ocultas;
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
    try { await pastasApi.renomear({ tipo, caminho_atual: pastaAtiva.caminho, novo_caminho: pai ? `${pai}/${novoNome.trim()}` : novoNome.trim() }); notificar(); fecharAcao(); }
    catch (e) { setErro(e instanceof ApiError ? e.message : "Não foi possível renomear a pasta."); }
    finally { setOcupado(false); }
  }
  async function mover(destino: string) {
    if (!pastaAtiva || ocupado) return;
    const novoCaminho = destino ? `${destino}/${pastaAtiva.nome}` : pastaAtiva.nome;
    if (novoCaminho === pastaAtiva.caminho || novoCaminho.startsWith(`${pastaAtiva.caminho}/`)) { setErro("Uma pasta não pode ser movida para dentro dela mesma."); return; }
    setOcupado(true); setErro(null);
    try { await pastasApi.renomear({ tipo, caminho_atual: pastaAtiva.caminho, novo_caminho: novoCaminho }); notificar(); fecharAcao(); }
    catch (e) { setErro(e instanceof ApiError ? e.message : "Não foi possível mover a pasta."); }
    finally { setOcupado(false); }
  }
  async function excluir() {
    if (!pastaAtiva || ocupado) return;
    setOcupado(true); setErro(null);
    try { await pastasApi.excluir({ tipo, caminho: pastaAtiva.caminho }); notificar(); fecharAcao(); }
    catch (e) { setErro(e instanceof ApiError ? e.message : "Não foi possível excluir a pasta. Ela pode precisar estar vazia."); }
    finally { setOcupado(false); }
  }

  return (
    <section aria-label={titulo}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
          {titulo}
          <span className="ml-1.5 font-mono-value normal-case tracking-normal">{pastas.length}</span>
        </p>
        <button
          type="button"
          aria-expanded={!ocultas}
          onClick={alternar}
          className="flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-text-secondary hover:bg-surface-2 hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-steel-400"
        >
          {ocultas ? "Mostrar" : "Ocultar"}
          <ChevronDown size={14} strokeWidth={1.75} className={`transition-transform ${ocultas ? "" : "rotate-180"}`} />
        </button>
      </div>

      {!ocultas && (
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))" }}>
          {pastas.map((p) => (
            <div key={p.caminho} className="relative flex aspect-square min-w-0 rounded-card bg-surface-1 transition-colors hover:bg-surface-2">
            <button type="button" onClick={() => aoAbrir(p)} className="flex min-w-0 flex-1 flex-col justify-between p-4 pr-11 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-steel-400">
              <Folder size={28} strokeWidth={1.5} className={corIcone} />
              <span className="min-w-0">
                <span className="line-clamp-2 block break-words font-body text-[15px] font-semibold leading-snug text-text-primary">{p.nome}</span>
                <span className="mt-0.5 block text-xs text-text-muted">{p.contagem_itens} {p.contagem_itens === 1 ? "item" : "itens"}</span>
              </span>
            </button>
            <button type="button" aria-label={`Ações para ${p.nome}`} aria-haspopup="menu" aria-expanded={menu === p.caminho} onClick={() => setMenu((atual) => atual === p.caminho ? null : p.caminho)} className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-lg text-text-muted hover:bg-surface-3 hover:text-text-primary"><MoreHorizontal size={18} /></button>
            {menu === p.caminho && <div role="menu" className="absolute right-2 top-11 z-20 w-40 rounded-xl border border-border bg-surface-1 p-1 shadow-nav"><button type="button" role="menuitem" onClick={() => abrirAcao(p, "renomear")} className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-sm text-text-primary hover:bg-surface-2"><Pencil size={15} />Editar</button><button type="button" role="menuitem" onClick={() => abrirAcao(p, "mover")} className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-sm text-text-primary hover:bg-surface-2"><FolderInput size={15} />Mover</button><button type="button" role="menuitem" onClick={() => abrirAcao(p, "excluir")} className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-error hover:bg-error/10"><Trash2 size={15} />Excluir</button></div>}
            </div>
          ))}
          {aoCriar && (
            <button
              type="button"
              onClick={aoCriar}
              className="flex aspect-square flex-col items-center justify-center gap-2 rounded-card border border-dashed border-border text-text-muted transition-colors hover:border-steel-500/60 hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-steel-400"
            >
              <FolderPlus size={22} strokeWidth={1.5} />
              <span className="text-xs font-medium">Nova pasta</span>
            </button>
          )}
        </div>
      )}
      {acao && pastaAtiva && <div role="dialog" aria-modal="true" aria-labelledby="pasta-acao-titulo" className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4"><div className="w-full max-w-sm rounded-2xl border border-border bg-surface-1 p-5 shadow-nav"><div className="mb-4 flex items-center justify-between gap-3"><h2 id="pasta-acao-titulo" className="font-semibold text-text-primary">{acao === "renomear" ? "Editar pasta" : acao === "mover" ? "Mover pasta" : "Excluir pasta"}</h2><button type="button" onClick={fecharAcao} className="flex h-9 w-9 items-center justify-center rounded-lg text-text-secondary hover:bg-surface-2" aria-label="Fechar"><X size={17} /></button></div>{acao === "renomear" && <><label className="mb-2 block text-sm text-text-secondary" htmlFor="novo-nome-pasta">Nome</label><input id="novo-nome-pasta" autoFocus value={novoNome} onChange={(e) => setNovoNome(e.target.value)} className="ecos-input w-full !rounded-lg" /><button type="button" disabled={ocupado || !novoNome.trim()} onClick={() => void renomear()} className="mt-4 flex min-h-10 items-center gap-2 rounded-lg bg-steel-700 px-3 text-sm font-medium text-white disabled:opacity-40"><Check size={16} />Salvar</button></>}{acao === "mover" && <><p className="mb-3 text-sm text-text-secondary">Escolha a pasta de destino para <span className="font-medium text-text-primary">{pastaAtiva.nome}</span>.</p><div className="max-h-52 space-y-1 overflow-y-auto"><button type="button" disabled={ocupado} onClick={() => void mover("")} className="flex min-h-10 w-full items-center rounded-lg px-3 text-left text-sm text-text-primary hover:bg-surface-2">Raiz</button>{destinos.filter((destino) => destino.caminho !== pastaAtiva.caminho).map((destino) => <button key={destino.caminho} type="button" disabled={ocupado} onClick={() => void mover(destino.caminho)} className="flex min-h-10 w-full items-center rounded-lg px-3 text-left text-sm text-text-primary hover:bg-surface-2">{destino.nome}</button>)}</div></>}{acao === "excluir" && <><p className="text-sm text-text-secondary">Excluir <span className="font-medium text-text-primary">{pastaAtiva.nome}</span>? A pasta precisa estar vazia.</p><button type="button" disabled={ocupado} onClick={() => void excluir()} className="mt-4 flex min-h-10 items-center gap-2 rounded-lg bg-error px-3 text-sm font-medium text-white disabled:opacity-40"><Trash2 size={16} />Excluir pasta</button></>}{erro && <p role="alert" className="mt-3 text-sm text-error">{erro}</p>}</div></div>}
    </section>
  );
}
