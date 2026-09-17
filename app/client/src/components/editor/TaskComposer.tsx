import { useEffect, useId, useState } from "react";
import { ArrowRight, ChevronDown, ListTree, Plus, SlidersHorizontal, Trash2, X } from "lucide-react";
import { TaskPriority } from "@/components/common/TaskPriority";
import { FloatingSaveButton } from "@/components/common/FloatingSaveButton";
import { pastas } from "@/lib/api";
import { descriptionTags, type TaskFields } from "@/lib/task-fields";
import { AttachmentsField } from "./AttachmentsField";
import { CorpoEditor } from "./CorpoEditor";

const ROADMAP = "## Objetivo\n\n## Roadmap\n- [ ] Descoberta e requisitos\n- [ ] Execução\n- [ ] Validação e entrega\n\n## Critérios de conclusão\n";
const LABELS = { baixa: "Baixa", media: "Média", alta: "Alta" };
const FIELD = "ecos-input min-w-0 !rounded-lg border border-border !text-[16px] text-text-primary focus-visible:!outline focus-visible:!outline-2 focus-visible:!outline-steel-400";
const ACTION = "flex min-h-11 min-w-11 items-center justify-center rounded-lg bg-surface-2 text-text-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-steel-400";

export function TaskComposer({ value, onChange, onSave, saving = false, itemId, editing = false, dirty = false }: {
  value: TaskFields; onChange: (patch: Partial<TaskFields>) => void; onSave: () => void;
  saving?: boolean; itemId?: string; editing?: boolean; dirty?: boolean;
}) {
  const id = useId();
  const [expanded, setExpanded] = useState(false);
  const [descriptionOpened, setDescriptionOpened] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [folders, setFolders] = useState<{ caminho: string; nome: string }[]>([]);
  const [newTag, setNewTag] = useState("");
  const [newSubtask, setNewSubtask] = useState("");
  const inlineTags = descriptionTags(value.corpo);
  const allTags = [...new Set([...value.tags, ...inlineTags])];
  // A file reference alone should not expand the description during quick capture.
  const hasDescription = Boolean(value.corpo.replace(/!?\[[^\]]*\]\((?:src\/Media\/|_anexos\/)[^)]+\)/g, "").trim());

  useEffect(() => {
    let active = true;
    pastas.listar({ tipo: "tarefa" }).then((r) => { if (active) setFolders(r.subpastas); }).catch(() => {});
    return () => { active = false; };
  }, []);

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
    <div>
      <label htmlFor={`${id}-title`} className="mb-2 flex items-center gap-2 text-sm font-medium text-text-secondary">Título <span className="font-normal">obrigatório</span></label>
      <input id={`${id}-title`} value={value.titulo} onChange={(e) => onChange({ titulo: e.target.value })}
        placeholder="O que precisa ser feito?" autoFocus={!editing}
        className={`${FIELD} !py-4 !text-xl`} />
    </div>
    <TaskPriority value={value.prioridade} onChange={(prioridade) => onChange({ prioridade })} disabled={saving} />
    <AttachmentsField tipo="tarefa" itemId={itemId} corpo={value.corpo} onCorpoChange={(corpo) => onChange({ corpo })} onBusyChange={setUploading} disabled={saving} compact />
    <div className="grid min-w-0 gap-7 md:grid-cols-[minmax(0,1fr)_250px]">
      <div className="min-w-0 space-y-6">
        <section aria-label="Descrição" className={`${expanded || hasDescription || descriptionOpened ? "block" : "hidden"} md:block`}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-text-primary">Descrição</h2>
            <button type="button" onClick={() => onChange({ corpo: `${value.corpo}${value.corpo ? "\n\n" : ""}${ROADMAP}` })} className="flex min-h-11 items-center gap-2 text-sm text-steel-300"><ListTree size={17} />Inserir roadmap</button>
          </div>
          <CorpoEditor tipo="tarefa" itemId={itemId} corpo={value.corpo} onCorpoChange={(corpo) => { setDescriptionOpened(true); onChange({ corpo }); }}
            rows={10} layout="document" placeholder="Contexto, decisões, links ou um projeto inteiro… Use #tags para organizar." />
        </section>
        <button type="button" aria-expanded={expanded} aria-controls={`${id}-subtasks ${id}-planning`} onClick={() => setExpanded(!expanded)}
          className="flex min-h-12 w-full flex-col gap-2 border-t border-border pt-5 text-left md:hidden">
          <span className="flex w-full items-center gap-2 text-sm font-medium text-text-primary"><SlidersHorizontal size={17} />Mais detalhes<ChevronDown size={18} className={`ml-auto transition-transform motion-reduce:transition-none ${expanded ? "rotate-180" : ""}`} /></span>
          <span className="text-sm text-text-secondary">{hasDescription || descriptionOpened ? "Agenda, subtarefas e organização" : "Descrição, agenda e organização"}{value.subtarefas.length > 0 ? ` · ${value.subtarefas.length} subtarefas` : ""}</span>
        </button>
        <section id={`${id}-subtasks`} aria-label="Subtarefas" className={`${expanded ? "block" : "hidden"} md:block`}>
          <div className="mb-3 flex items-center justify-between gap-2"><label htmlFor={`${id}-subtask`} className="text-sm font-semibold text-text-primary">Subtarefas</label><span className="text-sm text-text-secondary" aria-live="polite">{value.subtarefas.length ? `${value.subtarefas.filter((s) => s.concluida).length}/${value.subtarefas.length} concluídas` : "Opcional"}</span></div>
          <ul className="mb-3 space-y-1">
            {value.subtarefas.map((sub, index) => <li key={sub.id ?? index} className="flex min-w-0 items-center gap-2 border-b border-border py-1">
              <label className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-3 text-sm">
                <input type="checkbox" checked={sub.concluida} onChange={(e) => onChange({ subtarefas: value.subtarefas.map((s, i) => i === index ? { ...s, concluida: e.target.checked } : s) })} className="h-5 w-5 shrink-0 accent-steel-500" />
                <span className={`min-w-0 break-words ${sub.concluida ? "text-text-secondary line-through" : "text-text-primary"}`}>{sub.titulo}</span>
              </label>
              <button type="button" className={ACTION} onClick={() => onChange({ subtarefas: value.subtarefas.filter((_, i) => i !== index) })} aria-label={`Remover subtarefa ${sub.titulo}`}><Trash2 size={16} /></button>
            </li>)}
          </ul>
          <div className="flex gap-2"><input id={`${id}-subtask`} value={newSubtask} onChange={(e) => setNewSubtask(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addSubtask(); } }} placeholder="Adicionar uma etapa" className={FIELD} /><button type="button" onClick={addSubtask} className={`${ACTION} shrink-0`} aria-label="Adicionar subtarefa"><Plus size={18} /></button></div>
        </section>
      </div>
      <aside id={`${id}-planning`} className={`${expanded ? "block" : "hidden"} min-w-0 border-t border-border pt-6 md:block md:border-l md:border-t-0 md:pl-6 md:pt-0`} aria-label="Planejamento e organização">
        <section className="space-y-4">
          <h2 className="font-semibold text-text-primary">Planejamento</h2>
          <label className="flex flex-col gap-2 text-sm text-text-secondary">Data (opcional)<input type="date" value={value.data} onChange={(e) => onChange({ data: e.target.value, ...(!e.target.value ? { horario: "" } : {}) })} className={`${FIELD} font-mono-value`} /></label>
          {value.data && <button type="button" className="min-h-11 text-sm text-steel-300" onClick={() => onChange({ data: "", horario: "" })}>Remover data</button>}
          <label className="flex flex-col gap-2 text-sm text-text-secondary">Horário (opcional)<input type="time" value={value.horario} disabled={!value.data} onChange={(e) => onChange({ horario: e.target.value })} className={`${FIELD} font-mono-value disabled:opacity-40`} /></label>
          <p className="text-sm text-text-secondary">{value.data ? "Sem horário, a tarefa fica com a data definida." : "Escolha uma data para definir horário."}</p>
          <div className="flex flex-col gap-2 text-sm text-text-secondary"><label htmlFor={`${id}-duration`}>Duração estimada</label><div className="flex items-center gap-3"><input id={`${id}-duration`} type="number" min={1} step={1} value={value.duracao} onChange={(e) => { const minutes = Number(e.target.value); onChange({ duracao: Number.isFinite(minutes) ? Math.max(1, Math.round(minutes)) : 1 }); }} className={`${FIELD} max-w-28 font-mono-value`} /><span aria-hidden="true">min</span></div></div>
        </section>
        <section className="mt-6 space-y-4 border-t border-border pt-6">
          <h2 className="font-semibold text-text-primary">Organização</h2>
          <div className="flex flex-col gap-2 text-sm text-text-secondary"><label htmlFor={`${id}-folder`}>Pasta</label><select id={`${id}-folder`} value={value.pasta ?? ""} onChange={(e) => onChange({ pasta: e.target.value || null })} className={FIELD}><option value="">Nenhuma pasta</option>{value.pasta && !folders.some((p) => p.caminho === value.pasta) && <option value={value.pasta}>{value.pasta}</option>}{folders.map((p) => <option key={p.caminho} value={p.caminho}>{p.nome}</option>)}</select></div>
          <div><label htmlFor={`${id}-tag`} className="mb-2 block text-sm text-text-secondary">Tags</label><div className="flex gap-2"><input id={`${id}-tag`} value={newTag} onChange={(e) => setNewTag(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }} className={FIELD} placeholder="Tag e Enter" /><button type="button" onClick={addTag} className={`${ACTION} shrink-0`} aria-label="Adicionar tag"><Plus size={18} /></button></div></div>
          <div className="flex flex-wrap gap-2" aria-live="polite">{allTags.map((tag) => <span key={tag} className="flex min-w-0 max-w-full items-center gap-1 rounded-lg bg-surface-2 pl-3 text-sm text-text-secondary"><span className="break-all">#{tag}</span>{inlineTags.includes(tag) ? <span className="px-2 py-3 text-xs">na descrição</span> : <button type="button" onClick={() => onChange({ tags: value.tags.filter((t) => t !== tag) })} aria-label={`Remover tag ${tag}`} className="flex min-h-11 min-w-11 items-center justify-center"><X size={15} /></button>}</span>)}</div>
          <div className="flex flex-wrap gap-2">{["cliente", "projeto"].filter((t) => !allTags.includes(t)).map((tag) => <button key={tag} type="button" onClick={() => onChange({ tags: [...value.tags, tag] })} className="min-h-11 rounded-lg border border-border px-3 text-sm text-text-secondary">#{tag}</button>)}</div>
        </section>
      </aside>
    </div>
    <footer className="flex flex-col gap-3 border-t border-border pt-4 md:flex-row md:items-center md:justify-between">
      <p className="min-w-0 break-words text-sm text-text-secondary">{summary}</p>
      {!editing && <button type="button" onClick={onSave} disabled={!value.titulo.trim() || saving || uploading}
        className="flex min-h-12 shrink-0 items-center justify-center gap-3 rounded-xl bg-steel-700 px-6 py-3 text-sm font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-steel-400 disabled:opacity-40">
        {saving ? "Salvando..." : "Criar tarefa"}<ArrowRight size={17} />
      </button>}
    </footer>
    {editing && (dirty || saving) && <FloatingSaveButton onSave={onSave} disabled={!value.titulo.trim() || uploading} saving={saving} />}
  </div>;
}
