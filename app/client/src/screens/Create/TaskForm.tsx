import { useEffect, useRef, useState } from "react";
import { Bold, List, Link2, Code, Plus, X, Circle, CheckCircle2, Trash2 } from "lucide-react";
import { Chip } from "@/components/common/Chip";
import { DatePicker } from "@/components/common/DatePicker";
import { pastas, type PrioridadeTarefa } from "@/lib/api";
import { renderMarkdownMini } from "@/lib/markdown-mini";
import type { CapturaDraft, SetDraft } from "./CreateFlow";

const DURACOES = [15, 30, 45, 60, 120];
const PRIORIDADE_LABEL: Record<PrioridadeTarefa, string> = { baixa: "Baixa", media: "Média", alta: "Alta" };
const PRIORIDADE_CLASSES: Record<PrioridadeTarefa, string> = {
  baixa: "bg-cyan/20 text-cyan",
  media: "bg-warning/20 text-warning",
  alta: "bg-error/20 text-error",
};

interface Props {
  draft: CapturaDraft;
  setDraft: SetDraft;
  onSalvar: () => void;
  salvando?: boolean;
}

/**
 * Tarefa form — was reduced to título/duração/horário; user feedback
 * ("tarefas tá MUITOOO simples") asked for prioridade (which also boosts
 * the Feed, `ecos_core::ranking::boost_tarefa_prioridade`), tags, pasta,
 * subtarefas and a real description field, all in one continuous scroll
 * (same "no collapsed extras" lesson from the Transaction form). Anexos
 * stay edit-only (`TaskDetailScreen`) since a Tarefa needs to exist on
 * disk first for `_anexos/<id>/` to have somewhere to live.
 */
export function TaskForm({ draft, setDraft, onSalvar, salvando }: Props) {
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const [pastasDisponiveis, setPastasDisponiveis] = useState<{ caminho: string; nome: string }[]>([]);
  const [duracaoCustom, setDuracaoCustom] = useState(!DURACOES.includes(draft.duracaoMin));
  const [novaTag, setNovaTag] = useState("");
  const [novaSubtarefa, setNovaSubtarefa] = useState("");

  useEffect(() => {
    pastas
      .listar({ tipo: "tarefa" })
      .then((r) => setPastasDisponiveis(r.subpastas))
      .catch(() => setPastasDisponiveis([]));
  }, []);

  function inserir(prefixo: string, sufixo = "") {
    const el = areaRef.current;
    if (!el) return;
    const inicio = el.selectionStart;
    const fim = el.selectionEnd;
    const selecionado = el.value.slice(inicio, fim);
    setDraft((prev) => ({ ...prev, corpo: prev.corpo.slice(0, inicio) + prefixo + selecionado + sufixo + prev.corpo.slice(fim) }));
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = inicio + prefixo.length + selecionado.length;
    });
  }

  function adicionarTag() {
    const tag = novaTag.trim();
    if (!tag || draft.tagsTarefa.includes(tag)) return setNovaTag("");
    setDraft((d) => ({ ...d, tagsTarefa: [...d.tagsTarefa, tag] }));
    setNovaTag("");
  }

  function adicionarSubtarefa() {
    const titulo = novaSubtarefa.trim();
    if (!titulo) return;
    setDraft((d) => ({ ...d, subtarefasTarefa: [...d.subtarefasTarefa, { titulo, concluida: false }] }));
    setNovaSubtarefa("");
  }

  return (
    <div className="flex flex-col gap-5">
      <input
        value={draft.texto}
        onChange={(e) => setDraft((d) => ({ ...d, texto: e.target.value }))}
        placeholder="O que precisa ser feito?"
        className="w-full bg-transparent font-display text-2xl text-text-primary placeholder:text-text-muted focus:outline-none"
        autoFocus
      />

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Prioridade</p>
        <div className="flex gap-2">
          {(Object.keys(PRIORIDADE_LABEL) as PrioridadeTarefa[]).map((p) => (
            <button
              key={p}
              onClick={() => setDraft((d) => ({ ...d, prioridadeTarefa: p }))}
              className={`rounded-pill px-4 py-1.5 text-sm font-medium ${draft.prioridadeTarefa === p ? PRIORIDADE_CLASSES[p] : "bg-surface-2 text-text-muted"}`}
            >
              {PRIORIDADE_LABEL[p]}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-3">
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">Data</span>
          <DatePicker accent="cyan" value={draft.dataTarefa} onChange={(v) => setDraft((d) => ({ ...d, dataTarefa: v }))} />
        </div>
        <label className="flex flex-1 flex-col gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">Horário (opcional)</span>
          <input
            type="time"
            value={draft.scheduledAt ? new Date(draft.scheduledAt).toTimeString().slice(0, 5) : ""}
            onChange={(e) => {
              if (!e.target.value) return setDraft((d) => ({ ...d, scheduledAt: null }));
              const [h, m] = e.target.value.split(":").map(Number);
              const data = new Date();
              data.setHours(h, m, 0, 0);
              setDraft((d) => ({ ...d, scheduledAt: data.toISOString() }));
            }}
            className="ecos-input font-mono-value"
          />
        </label>
      </div>
      <p className="-mt-3 text-xs text-text-muted">Sem horário, a Tarefa entra na fila e é encaixada por capacidade.</p>

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Duração</p>
        <div className="flex flex-wrap gap-2">
          {DURACOES.map((min) => (
            <Chip
              key={min}
              selected={!duracaoCustom && draft.duracaoMin === min}
              onClick={() => {
                setDuracaoCustom(false);
                setDraft((d) => ({ ...d, duracaoMin: min }));
              }}
            >
              {min < 60 ? `${min}min` : min === 60 ? "1h" : "2h+"}
            </Chip>
          ))}
          <Chip selected={duracaoCustom} onClick={() => setDuracaoCustom(true)}>
            Personalizado
          </Chip>
        </div>
        {duracaoCustom && (
          <input
            type="number"
            min={1}
            value={draft.duracaoMin}
            onChange={(e) => setDraft((d) => ({ ...d, duracaoMin: Math.max(1, Number(e.target.value) || 1) }))}
            placeholder="Minutos"
            className="ecos-input mt-2 w-32 font-mono-value"
          />
        )}
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Descrição</p>
        <div className="mb-2 flex items-center gap-1 rounded-xl bg-surface-2 p-1">
          <ToolbarBtn Icon={Bold} onClick={() => inserir("**", "**")} label="Negrito" />
          <ToolbarBtn Icon={List} onClick={() => inserir("- [ ] ")} label="Lista" />
          <ToolbarBtn Icon={Link2} onClick={() => inserir("[[", "]]")} label="Wikilink" />
          <ToolbarBtn Icon={Code} onClick={() => inserir("`", "`")} label="Código" />
        </div>
        <textarea
          ref={areaRef}
          value={draft.corpo}
          onChange={(e) => setDraft((d) => ({ ...d, corpo: e.target.value }))}
          placeholder="Escreva aqui pra se debruçar sobre a tarefa — contexto, links, o que for preciso."
          rows={5}
          className="w-full resize-none rounded-2xl bg-surface-2 p-4 font-body text-[15px] text-text-primary placeholder:text-text-muted focus:outline-none"
        />
        {draft.corpo.trim() && (
          <div className="mt-2 rounded-2xl border border-border bg-surface-1 p-4 text-sm">{renderMarkdownMini(draft.corpo)}</div>
        )}
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Tags</p>
        <div className="mb-2 flex flex-wrap gap-2">
          {draft.tagsTarefa.map((tag) => (
            <span key={tag} className="flex items-center gap-1.5 rounded-pill bg-surface-2 px-3 py-1 text-sm text-text-secondary">
              {tag}
              <button onClick={() => setDraft((d) => ({ ...d, tagsTarefa: d.tagsTarefa.filter((t) => t !== tag) }))} aria-label={`Remover tag ${tag}`}>
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            value={novaTag}
            onChange={(e) => setNovaTag(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), adicionarTag())}
            placeholder="Adicionar tag e Enter"
            className="ecos-input flex-1"
          />
          <button type="button" onClick={adicionarTag} className="rounded-xl bg-surface-2 px-3 text-text-secondary">
            <Plus size={16} />
          </button>
        </div>
      </div>

      {pastasDisponiveis.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Pasta</p>
          <div className="flex flex-wrap gap-2">
            {pastasDisponiveis.map((p) => (
              <Chip key={p.caminho} selected={draft.pastaTarefa === p.caminho} onClick={() => setDraft((d) => ({ ...d, pastaTarefa: d.pastaTarefa === p.caminho ? null : p.caminho }))}>
                {p.nome}
              </Chip>
            ))}
          </div>
        </div>
      )}

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Subtarefas</p>
        {draft.subtarefasTarefa.length > 0 && (
          <div className="mb-2 flex flex-col gap-1.5">
            {draft.subtarefasTarefa.map((s, i) => (
              <div key={i} className="flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-2">
                <button
                  type="button"
                  onClick={() => setDraft((d) => ({ ...d, subtarefasTarefa: d.subtarefasTarefa.map((x, j) => (j === i ? { ...x, concluida: !x.concluida } : x)) }))}
                >
                  {s.concluida ? <CheckCircle2 size={16} className="text-success" /> : <Circle size={16} className="text-text-muted" />}
                </button>
                <span className={`flex-1 text-sm ${s.concluida ? "text-text-muted line-through" : "text-text-primary"}`}>{s.titulo}</span>
                <button type="button" onClick={() => setDraft((d) => ({ ...d, subtarefasTarefa: d.subtarefasTarefa.filter((_, j) => j !== i) }))} aria-label="Remover subtarefa">
                  <Trash2 size={14} className="text-text-muted" />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <input
            value={novaSubtarefa}
            onChange={(e) => setNovaSubtarefa(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), adicionarSubtarefa())}
            placeholder="Adicionar subtarefa e Enter"
            className="ecos-input flex-1"
          />
          <button type="button" onClick={adicionarSubtarefa} className="rounded-xl bg-surface-2 px-3 text-text-secondary">
            <Plus size={16} />
          </button>
        </div>
      </div>

      <button
        onClick={onSalvar}
        disabled={!draft.texto.trim() || salvando}
        className="mt-2 rounded-2xl bg-steel-700 py-3.5 text-center font-body text-[15px] font-semibold text-white disabled:opacity-40"
      >
        {salvando ? "Salvando..." : "Salvar Tarefa"}
      </button>
    </div>
  );
}

function ToolbarBtn({ Icon, onClick, label }: { Icon: typeof Bold; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex h-9 w-9 items-center justify-center rounded-lg text-text-secondary hover:bg-surface-3 hover:text-text-primary"
    >
      <Icon size={17} strokeWidth={1.75} />
    </button>
  );
}
