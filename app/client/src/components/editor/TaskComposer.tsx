import { ArvorePastas } from "@/components/common/ArvorePastas";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { ChevronDown, Clock, Folder, Plus, SlidersHorizontal, Trash2, X } from "lucide-react";
import { TaskPriority } from "@/components/common/TaskPriority";
import { FloatingSaveButton } from "@/components/common/FloatingSaveButton";
import { ApiError, pastas } from "@/lib/api";
import { descriptionTags, type TaskFields } from "@/lib/task-fields";
import { useIsMobile } from "@/lib/use-viewport";
import { TempoEdicao } from "@/components/common/TempoEdicao";
import { AttachmentsField } from "./AttachmentsField";
import { CorpoEditor } from "./CorpoEditor";
import { TaskDateTimePicker } from "./TaskDateTimePicker";
import { EquipeSelector } from "./EquipeSelector";
import { TitleField } from "@/components/common/TitleField";
import { formatDataHoraCompleta } from "@/lib/format";

const LABELS = { baixa: "Baixa", media: "Média", alta: "Alta" };
const FIELD = "ecos-input min-w-0 !rounded-lg border border-border !text-[16px] text-text-primary focus-visible:!outline focus-visible:!outline-2 focus-visible:!outline-steel-400";
const LARGURA_SIDEBAR_PADRAO = 250;
const LARGURA_SIDEBAR_MIN = 200;
const LARGURA_DESCRICAO_MIN = 260;
const LARGURA_DIVISORIA = 13;
const CHAVE_LARGURA_SIDEBAR = "ecos.task-sidebar-px";

function lerLarguraSidebar(): number {
  try {
    const salvo = Number(localStorage.getItem(CHAVE_LARGURA_SIDEBAR));
    return Number.isFinite(salvo) && salvo >= LARGURA_SIDEBAR_MIN ? salvo : LARGURA_SIDEBAR_PADRAO;
  } catch {
    return LARGURA_SIDEBAR_PADRAO;
  }
}
const ACTION = "flex min-h-11 min-w-11 items-center justify-center rounded-lg bg-surface-2 text-text-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-steel-400";

export function TaskComposer({ createdAt, editedAt, completedAt, value, onChange, onSave, saving = false, itemId, editing = false, dirty = false, floatingSave = true, showPriority = true, titleActions, timePanel, onUploadingChange }: {
  value: TaskFields; onChange: (patch: Partial<TaskFields>) => void; onSave: () => void;
  saving?: boolean; itemId?: string; editing?: boolean; dirty?: boolean;
  /** false quando quem hospeda o compositor já oferece o próprio botão Salvar fixo (desktop). */
  floatingSave?: boolean; showPriority?: boolean; titleActions?: ReactNode; timePanel?: ReactNode; onUploadingChange?: (uploading: boolean) => void;
  /** Última edição (só em tarefa existente) — aparece no rodapé no formato de feed. */
  createdAt?: string;
  editedAt?: string;
  /** Quando a tarefa foi concluída (ISO) — só aparece se houver. */
  completedAt?: string | null;
}) {
  const id = useId();
  const [expanded, setExpanded] = useState(false);
  const [descriptionOpened, setDescriptionOpened] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [folders, setFolders] = useState<{ caminho: string; nome: string }[]>([]);
  const [newTag, setNewTag] = useState("");
  const [newFolder, setNewFolder] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [folderError, setFolderError] = useState<string | null>(null);
  const [newSubtask, setNewSubtask] = useState("");
  const [folderMenuOpen, setFolderMenuOpen] = useState(false);
  const [durationMenuOpen, setDurationMenuOpen] = useState(false);
  const largo = !useIsMobile();
  const [larguraSidebar, setLarguraSidebar] = useState(lerLarguraSidebar);
  const grade = useRef<HTMLDivElement>(null);
  const folderMenuRef = useRef<HTMLDivElement>(null);
  const durationMenuRef = useRef<HTMLDivElement>(null);
  const arraste = useRef<{ x: number; largura: number } | null>(null);
  const inlineTags = descriptionTags(value.corpo);
  const allTags = [...new Set([...value.tags, ...inlineTags])];
  // A file reference alone should not expand the description during quick capture.
  const hasDescription = Boolean(value.corpo.replace(/!?\[[^\]]*\]\((?:src\/Media\/|_anexos\/)[^)]+\)/g, "").trim());

  useEffect(() => onUploadingChange?.(uploading), [uploading, onUploadingChange]);

  useEffect(() => {
    let active = true;
    setFolders([]);
    pastas.listar({ recursivo: true, tipo: "tarefa", espaco: value.espaco }).then((r) => { if (active) setFolders(r.subpastas); }).catch(() => {});
    return () => { active = false; };
  }, [value.espaco]);

  async function criarPasta() {
    const nome = newFolder.trim();
    if (!nome || creatingFolder) return;
    setCreatingFolder(true);
    setFolderError(null);
    try {
      const r = await pastas.criar({ tipo: "tarefa", nome, espaco: value.espaco, pasta_pai: value.pasta || undefined });
      setFolders((atual) => atual.some((p) => p.caminho === r.caminho) ? atual : [...atual, { caminho: r.caminho, nome }]);
      onChange({ pasta: r.caminho });
      setNewFolder("");
      setFolderMenuOpen(false);
    } catch (e) { setFolderError(e instanceof ApiError ? e.message : "Não foi possível criar a pasta."); } finally { setCreatingFolder(false); }
  }

  useEffect(() => {
    function fecharAoClicarFora(event: MouseEvent) { if (!durationMenuRef.current?.contains(event.target as Node)) setDurationMenuOpen(false); }
    document.addEventListener("mousedown", fecharAoClicarFora);
    return () => document.removeEventListener("mousedown", fecharAoClicarFora);
  }, []);

  useEffect(() => {
    function fecharAoClicarFora(event: MouseEvent) {
      if (!folderMenuRef.current?.contains(event.target as Node)) setFolderMenuOpen(false);
    }
    document.addEventListener("mousedown", fecharAoClicarFora);
    return () => document.removeEventListener("mousedown", fecharAoClicarFora);
  }, []);

  /** Limites: a descrição nunca some e a coluna de planejamento nunca fica menor que seus campos. */
  function limitarSidebar(largura: number): number {
    const total = grade.current?.getBoundingClientRect().width ?? Infinity;
    return Math.round(Math.max(LARGURA_SIDEBAR_MIN, Math.min(largura, total - LARGURA_DIVISORIA - LARGURA_DESCRICAO_MIN)));
  }
  function persistirSidebar(largura: number) {
    try { localStorage.setItem(CHAVE_LARGURA_SIDEBAR, String(largura)); } catch { /* só não persiste */ }
  }
  function iniciarArraste(e: PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    arraste.current = { x: e.clientX, largura: larguraSidebar };
  }
  function moverArraste(e: PointerEvent<HTMLDivElement>) {
    const a = arraste.current;
    if (a) setLarguraSidebar(limitarSidebar(a.largura + (a.x - e.clientX)));
  }
  function encerrarArraste() {
    if (arraste.current) persistirSidebar(larguraSidebar);
    arraste.current = null;
  }
  function aoTeclarDivisoria(e: KeyboardEvent<HTMLDivElement>) {
    const passo = e.key === "ArrowLeft" ? 16 : e.key === "ArrowRight" ? -16 : 0;
    if (!passo) return;
    e.preventDefault();
    const nova = limitarSidebar(larguraSidebar + passo);
    setLarguraSidebar(nova);
    persistirSidebar(nova);
  }
  function restaurarSidebar() {
    setLarguraSidebar(LARGURA_SIDEBAR_PADRAO);
    persistirSidebar(LARGURA_SIDEBAR_PADRAO);
  }

  function addTag() {
    const tag = newTag.trim().replace(/^#/, "").replace(/\s+/g, "-").toLowerCase();
    if (tag && !allTags.includes(tag)) onChange({ tags: [...value.tags, tag] });
    setNewTag("");
  }
  function addSubtask() {
    const titulo = newSubtask.trim();
    if (titulo) onChange({ subtarefas: [...value.subtarefas, { titulo, concluida: false }] });
    setNewSubtask("");
  }
  const summary = `${LABELS[value.prioridade]} · ${value.duracao} min · ${value.data ? value.data.split("-").reverse().join("/") + (value.horario ? ` às ${value.horario}` : "") : "Sem data"} · ${value.pasta ? folders.find((p) => p.caminho === value.pasta)?.nome ?? value.pasta : "Sem pasta"}`;

  return <div className="flex min-w-0 flex-col gap-6" data-task-composer>
    <div className="flex min-w-0 items-center gap-3">
      <TitleField id={`${id}-title`} value={value.titulo} onChange={(titulo) => onChange({ titulo })}
        placeholder="O que precisa ser feito?" ariaLabel="Título da tarefa" autoFocus={!editing}
        className={`${FIELD} flex-1 !py-3 !text-xl`} />
      {titleActions}
    </div>
    {showPriority && <TaskPriority value={value.prioridade} onChange={(prioridade) => onChange({ prioridade })} disabled={saving} />}
    <AttachmentsField tipo="tarefa" espaco={value.espaco} itemId={itemId} corpo={value.corpo} onCorpoChange={(corpo) => onChange({ corpo })} onBusyChange={setUploading} disabled={saving} compact />
    <div ref={grade} className="grid min-w-0 gap-7 md:gap-0" style={largo ? { gridTemplateColumns: `minmax(0,1fr) ${LARGURA_DIVISORIA}px ${larguraSidebar}px` } : undefined}>
      <div className="min-w-0 space-y-6 md:pr-3">
        <section aria-label="Descrição" className="block">
          <CorpoEditor tipo="tarefa" itemId={itemId} corpo={value.corpo} onCorpoChange={(corpo) => { setDescriptionOpened(true); onChange({ corpo }); }} initialPreview
            rows={10} layout="document" placeholder="Contexto, decisões, links ou um projeto inteiro… Use #tags para organizar." />
        </section>
        <button type="button" aria-expanded={expanded} aria-controls={`${id}-subtasks ${id}-planning`} onClick={() => setExpanded(!expanded)}
          className="flex min-h-12 w-full flex-col gap-2 border-t border-border pt-5 text-left md:hidden">
          <span className="flex w-full items-center gap-2 text-sm font-medium text-text-primary"><SlidersHorizontal size={17} />Mais detalhes<ChevronDown size={18} className={`ml-auto transition-transform motion-reduce:transition-none ${expanded ? "rotate-180" : ""}`} /></span>
          <span className="text-sm text-text-secondary">"Agenda, subtarefas e organização"{value.subtarefas.length > 0 ? ` · ${value.subtarefas.length} subtarefas` : ""}</span>
        </button>
      </div>
      {largo && <div role="separator" aria-orientation="vertical" aria-label="Redimensionar descrição e planejamento"
        aria-valuenow={larguraSidebar} aria-valuemin={LARGURA_SIDEBAR_MIN} tabIndex={0} title="Arraste para redimensionar — duplo clique restaura"
        onPointerDown={iniciarArraste} onPointerMove={moverArraste} onPointerUp={encerrarArraste} onPointerCancel={encerrarArraste}
        onKeyDown={aoTeclarDivisoria} onDoubleClick={restaurarSidebar}
        className="group relative cursor-col-resize touch-none focus-visible:outline-none">
        <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border transition-all group-hover:w-0.5 group-hover:bg-steel-400 group-focus-visible:w-0.5 group-focus-visible:bg-steel-400" />
      </div>}
      <aside id={`${id}-planning`} className={`${expanded ? "block" : "hidden"} min-w-0 border-t border-border pt-6 md:block md:border-t-0 md:pl-4 md:pt-0`} aria-label="Planejamento e organização">
        <section className="space-y-4">
          <h2 className="font-semibold text-text-primary">Planejamento</h2>
          <div className="flex flex-wrap items-end gap-4">
            <label className="flex min-w-[190px] flex-1 flex-col gap-2 text-sm text-text-secondary">Data e horário (opcional)<TaskDateTimePicker data={value.data} horario={value.horario} onChange={(data, horario) => onChange({ data, horario })} disabled={saving} /></label>
            <div ref={durationMenuRef} className="relative flex flex-col gap-2 text-sm text-text-secondary"><span id={`${id}-duration-label`}>Duração estimada</span><button type="button" aria-haspopup="listbox" aria-expanded={durationMenuOpen} aria-labelledby={`${id}-duration-label`} onClick={() => setDurationMenuOpen((open) => !open)} className="flex h-10 items-center gap-2 rounded-lg bg-surface-2 px-3 font-mono-value text-sm text-text-primary hover:bg-surface-3"><Clock size={15} className="text-steel-300" />{`${Math.floor(value.duracao / 60)}h ${String(value.duracao % 60).padStart(2, "0")}m`}</button>{durationMenuOpen && <div role="listbox" aria-labelledby={`${id}-duration-label`} className="absolute right-0 top-full z-30 mt-1 max-h-56 w-28 overflow-y-auto rounded-lg border border-border bg-surface-1 p-1 shadow-nav">{Array.from({ length: 49 }, (_, index) => index * 15).map((minutes) => <button key={minutes} type="button" role="option" aria-selected={value.duracao === minutes} onClick={() => { onChange({ duracao: Math.max(1, minutes) }); setDurationMenuOpen(false); }} className={`flex min-h-9 w-full items-center rounded-md px-2 font-mono-value text-xs ${value.duracao === minutes ? "bg-steel-700/40 text-text-primary" : "text-text-secondary hover:bg-surface-2"}`}>{`${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`}</button>)}</div>}</div>
          </div>
        </section>
        {timePanel && <section className="mt-6 border-t border-border pt-6" aria-label="Tempo dedicado">{timePanel}</section>}
        <section className="mt-6 space-y-4 border-t border-border pt-6">
          <h2 className="font-semibold text-text-primary">Organização</h2>
          <EquipeSelector espaco={value.espaco} onChange={(espaco) => onChange({ espaco, pasta: null })} disabled={saving} />
          <div ref={folderMenuRef} className="relative flex flex-col gap-2 text-sm text-text-secondary">
            <span id={`${id}-folder-label`}>Pasta</span>
            <button type="button" aria-haspopup="menu" aria-expanded={folderMenuOpen} aria-labelledby={`${id}-folder-label`} onClick={() => setFolderMenuOpen((open) => !open)} className={`${FIELD} flex min-h-11 items-center gap-3 !py-2.5 text-left transition-colors hover:border-steel-400`}>
              <Folder size={17} className="shrink-0 text-steel-300" /><span className="min-w-0 flex-1 truncate">{value.pasta ? folders.find((p) => p.caminho === value.pasta)?.nome ?? value.pasta : "Nenhuma pasta"}</span><ChevronDown size={17} className={`shrink-0 text-text-muted transition-transform ${folderMenuOpen ? "rotate-180" : ""}`} />
            </button>
            {folderMenuOpen && !largo && <button type="button" aria-label="Fechar seleção de pasta" onClick={() => setFolderMenuOpen(false)} className="fixed inset-0 z-40 cursor-default bg-black/60" />}
            {folderMenuOpen && <div role="menu" aria-labelledby={`${id}-folder-label`} className={`${largo ? "absolute top-full z-30 mt-1 max-h-64 w-full rounded-xl p-1" : "fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-50 max-h-[min(70vh,34rem)] rounded-2xl p-2"} overflow-y-auto border border-border bg-surface-1 shadow-nav`}>
              {!largo && <div className="mb-1 flex items-center justify-between px-2 pt-1"><div><p className="text-base font-semibold text-text-primary">Mover para pasta</p><p className="text-xs text-text-muted">Escolha onde esta tarefa será organizada.</p></div><button type="button" onClick={() => setFolderMenuOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-lg text-text-secondary hover:bg-surface-2" aria-label="Fechar"><X size={17} /></button></div>}
              <p className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Pastas</p>
              <ArvorePastas opcoes={[{ valor: "", rotulo: "Nenhuma pasta" }, ...folders.map((p) => ({ valor: p.caminho, rotulo: p.nome, pasta: true })), ...(value.pasta && !folders.some((p) => p.caminho === value.pasta) ? [{ valor: value.pasta, rotulo: value.pasta, pasta: true }] : [])]} valores={[value.pasta ?? ""]} onSelect={(pasta) => { onChange({ pasta: pasta || null }); setFolderMenuOpen(false); }} />
              {value.pasta && <p className="px-3 pt-2 text-xs text-text-muted break-words">Criar dentro de {value.pasta.split("/").join(" / ")}</p>}
              {folderError && <p role="alert" className="px-3 text-xs text-error">{folderError}</p>}
              <div className="mt-1 flex gap-2 border-t border-border p-2"><input value={newFolder} onChange={(e) => setNewFolder(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void criarPasta(); } }} placeholder={value.pasta ? "Nova subpasta" : "Nova pasta"} aria-label="Nome da nova pasta" className={FIELD} /><button type="button" onClick={() => void criarPasta()} disabled={!newFolder.trim() || creatingFolder} className={`${ACTION} shrink-0 disabled:opacity-40`} aria-label="Criar pasta"><Plus size={18} /></button></div>
            </div>}
          </div>
          <div><label htmlFor={`${id}-tag`} className="mb-2 block text-sm text-text-secondary">Tags</label><div className="flex gap-2"><input id={`${id}-tag`} value={newTag} onChange={(e) => setNewTag(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }} className={FIELD} placeholder="Tag e Enter" /><button type="button" onClick={addTag} className={`${ACTION} shrink-0`} aria-label="Adicionar tag"><Plus size={18} /></button></div></div>
          <div className="flex flex-wrap gap-2" aria-live="polite">{allTags.map((tag) => <span key={tag} className="flex min-w-0 max-w-full items-center gap-1 rounded-lg bg-surface-2 pl-3 text-sm text-text-secondary"><span className="break-all">#{tag}</span>{inlineTags.includes(tag) ? <span className="px-2 py-3 text-xs">na descrição</span> : <button type="button" onClick={() => onChange({ tags: value.tags.filter((t) => t !== tag) })} aria-label={`Remover tag ${tag}`} className="flex min-h-11 min-w-11 items-center justify-center"><X size={15} /></button>}</span>)}</div>
          <div className="flex flex-wrap gap-2">{["cliente", "projeto"].filter((t) => !allTags.includes(t)).map((tag) => <button key={tag} type="button" onClick={() => onChange({ tags: [...value.tags, tag] })} className="min-h-11 rounded-lg border border-border px-3 text-sm text-text-secondary">#{tag}</button>)}</div>
        </section>
        <section id={`${id}-subtasks`} aria-label="Subtarefas" className="mt-6 border-t border-border pt-6">
          <div className="mb-3 flex items-center justify-between gap-2"><label htmlFor={`${id}-subtask`} className="text-sm font-semibold text-text-primary">Subtarefas</label><span className="text-sm text-text-secondary" aria-live="polite">{value.subtarefas.length ? `${value.subtarefas.filter((s) => s.concluida).length}/${value.subtarefas.length} concluídas` : "Opcional"}</span></div>
          <ul className="mb-3 space-y-1">{value.subtarefas.map((sub, index) => <li key={sub.id ?? index} className="flex min-w-0 items-center gap-2 border-b border-border py-1"><label className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-3 text-sm"><input type="checkbox" checked={sub.concluida} onChange={(e) => onChange({ subtarefas: value.subtarefas.map((s, i) => i === index ? { ...s, concluida: e.target.checked } : s) })} className="h-5 w-5 shrink-0 accent-steel-500" /><span className={`min-w-0 break-words ${sub.concluida ? "text-text-secondary line-through" : "text-text-primary"}`}>{sub.titulo}</span></label><button type="button" className={ACTION} onClick={() => onChange({ subtarefas: value.subtarefas.filter((_, i) => i !== index) })} aria-label={`Remover subtarefa ${sub.titulo}`}><Trash2 size={16} /></button></li>)}</ul>
          <div className="flex gap-2"><input id={`${id}-subtask`} value={newSubtask} onChange={(e) => setNewSubtask(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addSubtask(); } }} placeholder="Adicionar uma etapa" className={FIELD} /><button type="button" onClick={addSubtask} className={`${ACTION} shrink-0`} aria-label="Adicionar subtarefa"><Plus size={18} /></button></div>
        </section>
      </aside>
    </div>
    <footer className="flex flex-col gap-3 border-t border-border pt-4 md:flex-row md:items-center md:justify-between">
      <p className="min-w-0 break-words text-sm text-text-secondary">{summary}{createdAt && <> · Criada em {formatDataHoraCompleta(createdAt)}</>}{completedAt && <> · Concluída em {formatDataHoraCompleta(completedAt)}</>}{editedAt && <> · Editada <TempoEdicao iso={editedAt} /></>}</p>
    </footer>
    {editing && floatingSave && (dirty || saving) && <FloatingSaveButton onSave={onSave} disabled={!value.titulo.trim() || uploading} saving={saving} />}
  </div>;
}
