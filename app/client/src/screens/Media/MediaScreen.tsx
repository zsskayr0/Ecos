import { useEffect, useState } from "react";
import { FileText, Image as ImageIcon, Library, Trash2, X } from "lucide-react";
import { EmptyState } from "@/components/common/EmptyState";
import { ApiError, media, type Midia } from "@/lib/api";
import { useRefreshBus } from "@/lib/refresh-bus";

function tamanho(n: number) { return n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`; }

/** Biblioteca separada dos ativos globais do cofre. O caminho mostrado é o
 * mesmo que pode ser colado em qualquer Markdown do Ecos. */
export function MediaScreen() {
  const [itens, setItens] = useState<Midia[] | null>(null);
  const [copiado, setCopiado] = useState<string | null>(null);
  const [selecionada, setSelecionada] = useState<Midia | null>(null);
  const [confirmando, setConfirmando] = useState<Midia | null>(null);
  const [excluindo, setExcluindo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const { versao, notificar } = useRefreshBus();
  useEffect(() => {
    let ativo = true;
    media.listar().then((lista) => { if (ativo) { setItens(lista); setErro(null); } }).catch((e) => {
      if (ativo) { setItens([]); setErro(e instanceof ApiError ? e.message : "Não foi possível carregar os arquivos. Tente novamente."); }
    });
    return () => { ativo = false; };
  }, [versao]);

  async function excluir() {
    if (!confirmando) return;
    setExcluindo(true);
    setErro(null);
    try {
      await media.excluir(confirmando.caminho);
      setItens((lista) => lista?.filter((item) => item.caminho !== confirmando.caminho) ?? []);
      if (selecionada?.caminho === confirmando.caminho) setSelecionada(null);
      setConfirmando(null);
      notificar();
    } catch (e) { setErro(e instanceof ApiError ? e.message : "Não foi possível excluir o arquivo. Tente novamente."); }
    finally { setExcluindo(false); }
  }

  return <div className="px-4 pt-1 pb-nav-safe">
    <h1 className="mb-1 font-display text-2xl text-text-primary">Media</h1>
    <p className="mb-5 text-sm text-text-muted">Arquivos reutilizáveis do seu cofre</p>
    {erro && <p role="alert" className="mb-4 text-sm text-error">{erro}</p>}
    {confirmando && <div role="alertdialog" aria-modal="true" aria-label="Confirmar exclusão" className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4"><div className="w-full max-w-sm rounded-2xl border border-error/40 bg-surface-1 p-4">
      <p className="mb-2 break-words text-sm text-text-primary">Excluir {confirmando.nome}?</p>
      <p className="mb-3 text-xs text-text-secondary">O arquivo será movido para a lixeira e deixará de abrir nas notas ou tarefas que o utilizam.</p>
      {erro && <p role="alert" className="mb-3 text-sm text-error">{erro}</p>}
      <div className="flex gap-2"><button type="button" disabled={excluindo} onClick={() => setConfirmando(null)} className="rounded-xl bg-surface-2 px-4 py-2 text-sm text-text-primary">Cancelar</button><button type="button" disabled={excluindo} onClick={excluir} className="rounded-xl bg-error px-4 py-2 text-sm font-medium text-white disabled:opacity-40">{excluindo ? "Excluindo..." : "Excluir"}</button></div>
    </div></div>}
    {itens === null ? <p className="py-10 text-center text-sm text-text-muted">Carregando mídia...</p> : !itens.length && !erro ? <EmptyState icon={Library} title="Sua biblioteca está vazia" subtitle="Anexe imagens, PDFs e outros arquivos às notas ou tarefas para vê-los aqui." /> : <div className="grid grid-cols-2 gap-3">
      {itens.map((item) => <div key={item.caminho} className="overflow-hidden rounded-2xl border border-border bg-surface-1">
        <button type="button" onClick={() => setSelecionada(item)} className="block w-full text-left">{item.mime.startsWith("image/") ? <img src={media.urlArquivo(item.caminho)} alt={item.nome} className="h-32 w-full object-cover" loading="lazy" /> : <div className="flex h-32 items-center justify-center bg-surface-2"><FileText size={34} className="text-steel-300" /></div>}</button>
        <div className="p-3"><p className="truncate text-sm font-medium text-text-primary" title={item.nome}>{item.nome}</p><p className="mt-1 flex items-center gap-1 text-xs text-text-muted">{item.mime.startsWith("image/") && <ImageIcon size={12} />}{tamanho(item.tamanho_bytes)}</p>
          <div className="mt-2 flex items-center justify-between gap-1"><button type="button" onClick={async () => { try { await navigator.clipboard.writeText(media.referencia(item)); setCopiado(item.caminho); } catch { setErro("Não foi possível copiar a referência. Permita o acesso à área de transferência e tente novamente."); } }} className="text-xs font-medium text-steel-300">{copiado === item.caminho ? "Referência copiada" : "Copiar referência"}</button><button type="button" aria-label={`Excluir ${item.nome}`} onClick={() => setConfirmando(item)} className="rounded-lg p-1.5 text-error"><Trash2 size={16} /></button></div>
        </div>
      </div>)}
    </div>}
    {selecionada && <Visualizador item={selecionada} fechar={() => setSelecionada(null)} />}
  </div>;
}

function Visualizador({ item, fechar }: { item: Midia; fechar: () => void }) {
  const url = media.urlArquivo(item.caminho);
  return <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true"><div className="flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-surface-1"><div className="flex items-center gap-3 border-b border-border px-4 py-3"><p className="flex-1 truncate text-sm font-medium text-text-primary">{item.nome}</p><a href={url} target="_blank" rel="noreferrer" className="text-xs text-steel-300">Abrir</a><button type="button" onClick={fechar} aria-label="Fechar"><X size={20} className="text-text-muted" /></button></div><div className="flex min-h-0 flex-1 items-center justify-center bg-surface-2 p-3">{item.mime.startsWith("image/") ? <img src={url} alt={item.nome} className="max-h-[75vh] max-w-full rounded-xl object-contain" /> : item.mime === "application/pdf" ? <iframe src={url} title={item.nome} className="h-[75vh] w-full rounded-xl bg-white" /> : <div className="p-12 text-center"><FileText size={44} className="mx-auto mb-3 text-steel-300" /><p className="text-sm text-text-secondary">Este formato não tem prévia interna.</p><a href={url} target="_blank" rel="noreferrer" className="mt-3 inline-block text-sm text-steel-300 underline">Abrir ou baixar arquivo</a></div>}</div></div></div>;
}
