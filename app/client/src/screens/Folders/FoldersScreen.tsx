import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, ChevronRight, FileText, Folder, FolderTree, Image, ListChecks, StickyNote } from "lucide-react";
import { ApiError, media, pastas, type Midia } from "@/lib/api";
import { useRefreshBus } from "@/lib/refresh-bus";
import { useEspacoFiltro } from "@/lib/use-espaco-filtro";

type Pasta = { caminho: string; nome: string; contagem_itens: number };

function Grupo({ titulo, Icone, cor, pastas, raiz, onAbrir }: { titulo: string; Icone: typeof Folder; cor: string; pastas: Pasta[]; raiz: string; onAbrir: (caminho: string) => void }) {
  return <section className="overflow-hidden rounded-2xl border border-border bg-surface-1"><button type="button" onClick={() => onAbrir("")} className="flex min-h-14 w-full items-center gap-3 px-4 text-left hover:bg-surface-2"><span className={`flex h-9 w-9 items-center justify-center rounded-xl bg-surface-2 ${cor}`}><Icone size={18} /></span><span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-text-primary">{titulo}</span><span className="block text-xs text-text-muted">{pastas.length} pasta{pastas.length === 1 ? "" : "s"}</span></span><ChevronRight size={17} className="text-text-muted" /></button>{pastas.map((pasta) => <button key={pasta.caminho} type="button" onClick={() => onAbrir(pasta.caminho)} className="flex min-h-12 w-full items-center gap-3 border-t border-border px-4 pl-7 text-left hover:bg-surface-2"><Folder size={16} className={cor} /><span className="min-w-0 flex-1 truncate text-sm text-text-secondary">{pasta.caminho}</span>{pasta.contagem_itens > 0 && <span className="text-xs text-text-muted">{pasta.contagem_itens}</span>}<ChevronRight size={15} className="text-text-muted" /></button>)}</section>;
}

/** Navegador transversal de diretórios: oferece a mesma porta de entrada
 * para os espaços de Notas, Tarefas e biblioteca de arquivos. */
export function FoldersScreen() {
  const navigate = useNavigate();
  const { versao } = useRefreshBus();
  const [notas, setNotas] = useState<Pasta[] | null>(null);
  const [tarefas, setTarefas] = useState<Pasta[] | null>(null);
  const [arquivos, setArquivos] = useState<Midia[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const espaco = useEspacoFiltro();
  useEffect(() => {
    let ativo = true;
    Promise.all([pastas.listar({ tipo: "nota", espaco }), pastas.listar({ tipo: "tarefa", espaco }), media.listar(espaco)]).then(([notasResposta, tarefasResposta, arquivosResposta]) => {
      if (!ativo) return;
      setNotas(notasResposta.subpastas); setTarefas(tarefasResposta.subpastas); setArquivos(arquivosResposta.sort((a, b) => a.caminho.localeCompare(b.caminho, "pt-BR"))); setErro(null);
    }).catch((e) => { if (ativo) { setErro(e instanceof ApiError ? e.message : "Não foi possível carregar as pastas."); setNotas([]); setTarefas([]); setArquivos([]); } });
    return () => { ativo = false; };
  }, [versao, espaco]);

  const carregando = notas === null || tarefas === null || arquivos === null;
  const resumo = useMemo(() => (notas?.length ?? 0) + (tarefas?.length ?? 0), [notas, tarefas]);
  return <div className="px-4 pt-1"><header className="mb-5 flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-steel-700/20 text-steel-300"><FolderTree size={21} /></span><div><h1 className="font-display text-2xl text-text-primary">Pastas</h1><p className="text-sm text-text-secondary">{carregando ? "Carregando diretórios…" : `${resumo} pasta${resumo === 1 ? "" : "s"} e ${arquivos?.length ?? 0} arquivo${(arquivos?.length ?? 0) === 1 ? "" : "s"}`}</p></div></header>{erro && <div role="alert" className="mb-4 flex items-start gap-2 rounded-2xl border border-error/40 bg-error/10 p-3 text-sm text-error"><AlertTriangle size={16} className="mt-0.5 shrink-0" />{erro}</div>}{carregando ? <p className="py-10 text-center text-sm text-text-muted">Carregando…</p> : <div className="space-y-3"><Grupo titulo="Notas" Icone={StickyNote} cor="text-steel-300" pastas={notas ?? []} raiz="/notas" onAbrir={(pasta) => navigate(pasta ? `/notas/pasta/${encodeURIComponent(pasta)}` : "/notas")} /><Grupo titulo="Tarefas" Icone={ListChecks} cor="text-cyan" pastas={tarefas ?? []} raiz="/tarefas" onAbrir={(pasta) => navigate(pasta ? `/tarefas/pasta/${encodeURIComponent(pasta)}` : "/tarefas")} /><section className="overflow-hidden rounded-2xl border border-border bg-surface-1"><div className="flex min-h-14 items-center gap-3 px-4"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-surface-2 text-violet"><Image size={18} /></span><span><span className="block text-sm font-semibold text-text-primary">Arquivos</span><span className="block text-xs text-text-muted">PDFs, imagens e outros arquivos</span></span></div>{(arquivos ?? []).map((arquivo) => <button key={arquivo.caminho} type="button" onClick={() => navigate(`/media/ver?c=${encodeURIComponent(arquivo.caminho)}`)} className="flex min-h-12 w-full items-center gap-3 border-t border-border px-4 text-left hover:bg-surface-2"><FileText size={16} className="shrink-0 text-violet" /><span className="min-w-0 flex-1"><span className="block truncate text-sm text-text-primary">{arquivo.nome}</span><span className="block truncate text-xs text-text-muted">{arquivo.caminho.replace(/^src\/Media\//, "")}</span></span><ChevronRight size={15} className="text-text-muted" /></button>)}{!arquivos?.length && <p className="border-t border-border px-4 py-3 text-sm text-text-muted">Nenhum arquivo nesta pasta.</p>}</section></div>}</div>;
}
