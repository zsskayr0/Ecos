import { useEffect, useRef, useState } from "react";
import { ChevronDown, FileText, Image as ImageIcon, Library, Trash2, X } from "lucide-react";
import { EmptyState } from "@/components/common/EmptyState";
import { ApiError, media, notas, tarefas, type Midia } from "@/lib/api";
import { useRefreshBus } from "@/lib/refresh-bus";
import { useAbrirDocumento } from "@/lib/documento-popup";

function tamanho(n: number) { return n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`; }

function MenuProprio<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (value: T) => void }) {
  const [aberto, setAberto] = useState(false); const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { const fora = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setAberto(false); }; document.addEventListener("mousedown", fora); return () => document.removeEventListener("mousedown", fora); }, []);
  const atual = options.find((option) => option.value === value)?.label ?? label;
  return <div ref={ref} className="relative flex min-w-[150px] flex-1 flex-col gap-1.5 sm:max-w-xs"><span className="text-xs font-medium text-text-muted">{label}</span><button type="button" aria-haspopup="listbox" aria-expanded={aberto} onClick={() => setAberto((open) => !open)} className="relative flex h-12 items-center rounded-lg border border-border bg-surface-2 px-3 pr-10 text-left text-sm text-text-primary hover:border-steel-400"><span className="truncate">{atual}</span><ChevronDown size={16} className={`pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary transition-transform duration-200 motion-reduce:transition-none ${aberto ? "rotate-180" : ""}`} /></button>{aberto && <div role="listbox" aria-label={label} className="absolute top-full z-30 mt-1 w-full overflow-hidden rounded-lg border border-border bg-surface-1 p-1 shadow-nav">{options.map((option) => <button key={option.value} type="button" role="option" aria-selected={option.value === value} onClick={() => { onChange(option.value); setAberto(false); }} className={`flex min-h-11 w-full items-center rounded-md px-3 text-left text-sm ${option.value === value ? "bg-steel-700/40 text-text-primary" : "text-text-secondary hover:bg-surface-2 hover:text-text-primary"}`}>{option.label}</button>)}</div>}</div>;
}

/** Biblioteca separada dos ativos globais do cofre. O caminho mostrado é o
 * mesmo que pode ser colado em qualquer Markdown do Ecos. */
export function MediaScreen() {
  const [itens, setItens] = useState<Midia[] | null>(null);
  const [copiado, setCopiado] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState<Midia | null>(null);
  const [excluindo, setExcluindo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [uso, setUso] = useState<Set<string>>(new Set());
  const [filtroUso, setFiltroUso] = useState<"todos" | "usados" | "nao-usados">("todos");
  const [filtroTipo, setFiltroTipo] = useState("todos");
  const [ordem, setOrdem] = useState<"recentes" | "antigos" | "nome" | "tamanho">("recentes");
  const { versao, notificar } = useRefreshBus();
  const abrirDocumento = useAbrirDocumento();
  useEffect(() => {
    let ativo = true;
    Promise.all([media.listar(), notas.listar({ limit: 100 }), tarefas.listar({ limit: 100 })]).then(async ([lista, listaNotas, listaTarefas]) => { if (ativo) {
      const detalhes = await Promise.all(listaTarefas.items.map((t) => tarefas.obter(t.id).catch(() => null)));
      const textos = [...listaNotas.items.map((n) => n.corpo), ...detalhes.flatMap((t) => t ? [t.corpo] : [])].join("\n");
      setUso(new Set(lista.filter((item) => textos.includes(item.caminho)).map((item) => item.caminho))); setItens(lista); setErro(null);
    } }).catch((e) => {
      if (ativo) { setItens([]); setErro(e instanceof ApiError ? e.message : "Não foi possível carregar os arquivos. Tente novamente."); }
    });
    return () => { ativo = false; };
  }, [versao]);

  const tipos = [...new Set(itens?.map((item) => item.mime) ?? [])];
  const filtrados = (itens ?? []).filter((item) => (filtroUso === "todos" || (filtroUso === "usados") === uso.has(item.caminho)) && (filtroTipo === "todos" || item.mime === filtroTipo)).sort((a, b) => ordem === "nome" ? a.nome.localeCompare(b.nome, "pt-BR") : ordem === "tamanho" ? b.tamanho_bytes - a.tamanho_bytes : ordem === "antigos" ? a.enviado_em.localeCompare(b.enviado_em) : b.enviado_em.localeCompare(a.enviado_em));

  async function excluir() {
    if (!confirmando) return;
    setExcluindo(true);
    setErro(null);
    try {
      await media.excluir(confirmando.caminho);
      setItens((lista) => lista?.filter((item) => item.caminho !== confirmando.caminho) ?? []);
      setConfirmando(null);
      notificar();
    } catch (e) { setErro(e instanceof ApiError ? e.message : "Não foi possível excluir o arquivo. Tente novamente."); }
    finally { setExcluindo(false); }
  }

  return <div className="px-4 pt-1 pb-nav-safe">
    <h1 className="mb-1 font-display text-2xl text-text-primary">Media</h1>
    <p className="mb-5 text-sm text-text-muted">Arquivos reutilizáveis do seu cofre</p>
    <section aria-label="Filtros da biblioteca" className="mb-5 flex flex-col gap-3 py-1 sm:flex-row sm:flex-wrap sm:items-start">
      <div className="flex flex-col gap-1.5"><span className="text-xs font-medium text-text-muted">Uso</span><div className="relative grid grid-cols-3 rounded-xl bg-surface-2 p-1" role="group" aria-label="Uso do arquivo"><span aria-hidden className={`pointer-events-none absolute inset-y-1 left-1 w-[calc((100%-8px)/3)] rounded-lg border transition-[transform,background-color,border-color] duration-200 motion-reduce:transition-none ${filtroUso === "todos" ? "border-steel-400 bg-steel-700/30" : filtroUso === "usados" ? "border-success bg-success/15" : "border-warning bg-warning/15"}`} style={{ transform: `translateX(${(["todos", "usados", "nao-usados"] as const).indexOf(filtroUso) * 100}%)` }} />{(["todos", "usados", "nao-usados"] as const).map((valor) => <button key={valor} type="button" aria-pressed={filtroUso === valor} onClick={() => setFiltroUso(valor)} className={`relative min-h-10 rounded-lg px-3 text-xs font-medium ${filtroUso === valor ? (valor === "todos" ? "text-steel-200" : valor === "usados" ? "text-success" : "text-warning") : "text-text-secondary"}`}>{valor === "todos" ? "Todos" : valor === "usados" ? "Em uso" : "Sem uso"}</button>)}</div></div>
      <MenuProprio label="Tipo de arquivo" value={filtroTipo} onChange={setFiltroTipo} options={[{ value: "todos", label: "Todos os tipos" }, ...tipos.map((tipo) => ({ value: tipo, label: tipo }))]} />
      <MenuProprio label="Ordenar por" value={ordem} onChange={setOrdem} options={[{ value: "recentes", label: "Upload mais recente" }, { value: "antigos", label: "Upload mais antigo" }, { value: "nome", label: "Nome A–Z" }, { value: "tamanho", label: "Maior tamanho" }]} />
    </section>
    {erro && <p role="alert" className="mb-4 text-sm text-error">{erro}</p>}
    {confirmando && <div role="alertdialog" aria-modal="true" aria-label="Confirmar exclusão" className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4"><div className="w-full max-w-sm rounded-2xl border border-error/40 bg-surface-1 p-4">
      <p className="mb-2 break-words text-sm text-text-primary">Excluir {confirmando.nome}?</p>
      <p className="mb-3 text-xs text-text-secondary">O arquivo será movido para a lixeira e deixará de abrir nas notas ou tarefas que o utilizam.</p>
      {erro && <p role="alert" className="mb-3 text-sm text-error">{erro}</p>}
      <div className="flex gap-2"><button type="button" disabled={excluindo} onClick={() => setConfirmando(null)} className="rounded-xl bg-surface-2 px-4 py-2 text-sm text-text-primary">Cancelar</button><button type="button" disabled={excluindo} onClick={excluir} className="rounded-xl bg-error px-4 py-2 text-sm font-medium text-white disabled:opacity-40">{excluindo ? "Excluindo..." : "Excluir"}</button></div>
    </div></div>}
    {itens === null ? <p className="py-10 text-center text-sm text-text-muted">Carregando mídia...</p> : !itens.length && !erro ? <EmptyState icon={Library} title="Sua biblioteca está vazia" subtitle="Anexe imagens, PDFs e outros arquivos às notas ou tarefas para vê-los aqui." /> : <div className="grid grid-cols-2 gap-3">
      {filtrados.map((item) => <div key={item.caminho} className="overflow-hidden rounded-2xl border border-border bg-surface-1">
        <button type="button" onClick={(e) => abrirDocumento(`/media/ver?c=${encodeURIComponent(item.caminho)}`, e)} className="block w-full text-left">{item.mime.startsWith("image/") ? <img src={media.urlArquivo(item.caminho)} alt={item.nome} className="h-32 w-full object-cover" loading="lazy" /> : <div className="flex h-32 items-center justify-center bg-surface-2"><FileText size={34} className="text-steel-300" /></div>}</button>
        <div className="p-3"><p className="truncate text-sm font-medium text-text-primary" title={item.nome}>{item.nome}</p><p className="mt-1 flex items-center gap-1 text-xs text-text-muted">{item.mime.startsWith("image/") && <ImageIcon size={12} />}{tamanho(item.tamanho_bytes)}</p>
          <div className="mt-2 flex items-center justify-between gap-1"><button type="button" onClick={async () => { try { await navigator.clipboard.writeText(media.referencia(item)); setCopiado(item.caminho); } catch { setErro("Não foi possível copiar a referência. Permita o acesso à área de transferência e tente novamente."); } }} className="text-xs font-medium text-steel-300">{copiado === item.caminho ? "Referência copiada" : "Copiar referência"}</button><button type="button" aria-label={`Excluir ${item.nome}`} onClick={() => setConfirmando(item)} className="rounded-lg p-1.5 text-error"><Trash2 size={16} /></button></div>
        </div>
      </div>)}
    </div>}
  </div>;
}
