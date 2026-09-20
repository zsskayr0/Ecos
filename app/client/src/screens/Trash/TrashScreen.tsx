import { useEffect, useState } from "react";
import { FileText, Image as ImageIcon, RotateCcw, Trash2 } from "lucide-react";
import { ApiError, lixeira, type ItemLixeira } from "@/lib/api";
import { EmptyState } from "@/components/common/EmptyState";
import { useRefreshBus } from "@/lib/refresh-bus";

export function TrashScreen() {
  const [itens, setItens] = useState<ItemLixeira[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [restaurando, setRestaurando] = useState<string | null>(null);
  const [mensagem, setMensagem] = useState<string | null>(null);
  const { versao, notificar } = useRefreshBus();
  useEffect(() => {
    let ativo = true;
    lixeira.listar().then((lista) => { if (ativo) { setItens(lista); setErro(null); } }).catch((e) => {
      if (ativo) { setItens([]); setErro(e instanceof ApiError ? e.message : "Não foi possível carregar a lixeira. Tente novamente."); }
    });
    return () => { ativo = false; };
  }, [versao]);
  async function restaurar(item: ItemLixeira) {
    setRestaurando(item.id);
    setErro(null);
    try {
      await lixeira.restaurar(item.id);
      setItens((lista) => lista?.filter((i) => i.id !== item.id) ?? []);
      setMensagem(`${item.nome} foi restaurado em ${item.tipo === "nota" ? "Notas" : item.tipo === "tarefa" ? "Tarefas" : item.tipo === "evento" ? "Eventos" : "Media"}.`);
      notificar();
    } catch (e) { setErro(e instanceof ApiError ? e.message : "Não foi possível restaurar o arquivo. Tente novamente."); }
    finally { setRestaurando(null); }
  }
  return <div className="px-4 pt-1 pb-nav-safe">
    <h1 className="mb-1 font-display text-2xl text-text-primary">Lixeira</h1>
    <p className="mb-5 text-sm text-text-muted">Restaure notas, tarefas e arquivos da Media. Itens do Cofre não vão para a lixeira.</p>
    {erro && <p role="alert" className="mb-4 text-sm text-error">{erro}</p>}
    {mensagem && <p role="status" className="mb-4 text-sm text-steel-300">{mensagem}</p>}
    {itens === null ? <p className="py-10 text-center text-sm text-text-muted">Carregando lixeira...</p> : !itens.length && !erro ? <EmptyState icon={Trash2} title="A lixeira está vazia." subtitle="Notas, tarefas e arquivos da Media excluídos aparecerão aqui." /> : <div className="flex flex-col gap-3">{itens.map((item) => <div key={item.id} className="flex items-center gap-3 rounded-2xl border border-border bg-surface-1 p-4">
      {item.mime.startsWith("image/") ? <ImageIcon size={22} className="shrink-0 text-text-muted" /> : <FileText size={22} className="shrink-0 text-text-muted" />}
      <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-text-primary">{item.nome}</p><p className="mt-1 text-xs text-text-muted">{item.tipo === "nota" ? "Nota" : item.tipo === "tarefa" ? "Tarefa" : item.tipo === "evento" ? "Evento" : "Media"} · Excluído em {new Date(item.excluido_em).toLocaleDateString("pt-BR")}</p></div>
      <button type="button" disabled={!!restaurando} onClick={() => restaurar(item)} aria-label={`Restaurar ${item.nome}`} className="flex items-center gap-1.5 rounded-xl bg-surface-2 px-3 py-2 text-xs font-medium text-steel-300 disabled:opacity-40"><RotateCcw size={15} />{restaurando === item.id ? "Restaurando..." : "Restaurar"}</button>
    </div>)}</div>}
  </div>;
}
