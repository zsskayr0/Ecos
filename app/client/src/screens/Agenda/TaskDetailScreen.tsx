import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ChevronLeft,
  Trash2,
  CheckCircle2,
  Circle,
  AlertTriangle,
  ListX,
  Bold,
  List,
  Link2,
  Code,
  Plus,
  X,
  Paperclip,
  Image as ImageIcon,
  FileText,
} from "lucide-react";
import { tarefas, pastas, ApiError, type TarefaDetalhe, type PrioridadeTarefa, type Subtarefa } from "@/lib/api";
import { Chip } from "@/components/common/Chip";
import { DatePicker } from "@/components/common/DatePicker";
import { EmptyState } from "@/components/common/EmptyState";
import { formatDuracao, hojeISO } from "@/lib/format";
import { renderMarkdownMini } from "@/lib/markdown-mini";
import { useRefreshBus } from "@/lib/refresh-bus";

const DURACOES = [15, 30, 45, 60, 120];
const PRIORIDADE_LABEL: Record<PrioridadeTarefa, string> = { baixa: "Baixa", media: "Média", alta: "Alta" };
const PRIORIDADE_CLASSES: Record<PrioridadeTarefa, string> = {
  baixa: "bg-cyan/20 text-cyan",
  media: "bg-warning/20 text-warning",
  alta: "bg-error/20 text-error",
};

/** Matches an anexo reference this same screen writes into `corpo`
 * (`![nome](_anexos/<id>/nome)` or `[nome](_anexos/<id>/nome)`, see
 * `tarefas::enviar_anexo`) — used only to render a friendlier "Anexos"
 * list on top of the raw Markdown, never to store anything separately;
 * the reference in `corpo` stays the single source of truth. */
const REGEX_ANEXO = /(!?)\[([^\]]*)\]\((_anexos\/[^)]+)\)/g;

function extrairAnexos(corpo: string) {
  return [...corpo.matchAll(REGEX_ANEXO)].map((m) => ({ linhaCompleta: m[0], imagem: m[1] === "!", nome: m[2], caminho: m[3] }));
}

/**
 * Tarefa detail/edit — was título + duração-chips + horário only (user
 * feedback: "tarefas tá MUITOOO simples"). Now the same surface area as
 * the create form plus what only makes sense once the Tarefa already
 * exists on disk: anexos (`_anexos/<id>/`, real upload) and toggling
 * individual subtarefas in place.
 */
export function TaskDetailScreen() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { notificar } = useRefreshBus();
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const arquivoRef = useRef<HTMLInputElement>(null);

  const [tarefa, setTarefa] = useState<TarefaDetalhe | null>(null);
  const [naoEncontrada, setNaoEncontrada] = useState(false);
  const [pastasDisponiveis, setPastasDisponiveis] = useState<{ caminho: string; nome: string }[]>([]);

  const [titulo, setTitulo] = useState("");
  const [prioridade, setPrioridade] = useState<PrioridadeTarefa>("media");
  const [data, setData] = useState(hojeISO());
  const [horario, setHorario] = useState("");
  const [duracao, setDuracao] = useState(30);
  const [duracaoCustom, setDuracaoCustom] = useState(false);
  const [corpo, setCorpo] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [novaTag, setNovaTag] = useState("");
  const [pasta, setPasta] = useState<string | null>(null);
  const [subtarefas, setSubtarefas] = useState<Subtarefa[]>([]);
  const [novaSubtarefa, setNovaSubtarefa] = useState("");

  const [confirmandoDelete, setConfirmandoDelete] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [enviandoAnexo, setEnviandoAnexo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    Promise.all([tarefas.obter(id), pastas.listar({ tipo: "tarefa" }).catch(() => ({ subpastas: [] }))])
      .then(([t, p]) => {
        setTarefa(t);
        setPastasDisponiveis(p.subpastas);
        setTitulo(t.titulo);
        setPrioridade(t.prioridade);
        setData(t.scheduled_at ? t.scheduled_at.slice(0, 10) : hojeISO());
        setHorario(t.scheduled_at ? new Date(t.scheduled_at).toTimeString().slice(0, 5) : "");
        setDuracao(t.duration_min ?? 30);
        setDuracaoCustom(!DURACOES.includes(t.duration_min ?? 30));
        setCorpo(t.corpo);
        setTags(t.tags);
        setPasta(t.pasta);
        setSubtarefas(t.subtarefas);
      })
      .catch(() => setNaoEncontrada(true));
  }, [id]);

  function inserir(prefixo: string, sufixo = "") {
    const el = areaRef.current;
    if (!el) return;
    const inicio = el.selectionStart;
    const fim = el.selectionEnd;
    const selecionado = el.value.slice(inicio, fim);
    setCorpo((c) => c.slice(0, inicio) + prefixo + selecionado + sufixo + c.slice(fim));
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = inicio + prefixo.length + selecionado.length;
    });
  }

  function adicionarTag() {
    const tag = novaTag.trim();
    if (!tag || tags.includes(tag)) return setNovaTag("");
    setTags((t) => [...t, tag]);
    setNovaTag("");
  }

  function adicionarSubtarefa() {
    const t = novaSubtarefa.trim();
    if (!t) return;
    setSubtarefas((s) => [...s, { id: `nova-${Date.now()}`, titulo: t, concluida: false }]);
    setNovaSubtarefa("");
  }

  function alternarSubtarefa(idxAlvo: string) {
    setSubtarefas((s) => s.map((sub) => (sub.id === idxAlvo ? { ...sub, concluida: !sub.concluida } : sub)));
  }

  async function enviarArquivo(arquivo: File) {
    if (!id) return;
    setEnviandoAnexo(true);
    setErro(null);
    try {
      const resp = await tarefas.anexos.enviar(id, arquivo);
      setCorpo(resp.corpo);
      notificar();
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível enviar o anexo.");
    } finally {
      setEnviandoAnexo(false);
    }
  }

  function removerAnexoDoTexto(linhaCompleta: string) {
    setCorpo((c) => c.replace(linhaCompleta, "").replace(/\n{3,}/g, "\n\n").trim());
  }

  async function salvar() {
    if (!id) return;
    setSalvando(true);
    setErro(null);
    try {
      const dataHora = horario ? (() => {
        const [h, m] = horario.split(":").map(Number);
        const [ano, mes, dia] = data.split("-").map(Number);
        return new Date(ano, mes - 1, dia, h, m).toISOString();
      })() : undefined;
      await tarefas.atualizar(id, {
        titulo,
        prioridade,
        scheduled_at: dataHora,
        duration_min: duracao,
        corpo,
        tags,
        pasta: pasta ?? "",
        subtarefas: subtarefas.map((s) => ({ id: s.id.startsWith("nova-") ? undefined : s.id, titulo: s.titulo, concluida: s.concluida })),
      });
      notificar();
      navigate(-1);
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível salvar.");
    } finally {
      setSalvando(false);
    }
  }

  async function alternarStatus() {
    if (!id || !tarefa) return;
    const novo = tarefa.status === "concluida" ? "pendente" : "concluida";
    try {
      await tarefas.atualizarStatus(id, novo);
      setTarefa({ ...tarefa, status: novo });
      notificar();
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível atualizar o status.");
    }
  }

  async function excluir() {
    if (!id) return;
    setSalvando(true);
    try {
      await tarefas.excluir(id);
      notificar();
      navigate(-1);
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível apagar.");
      setSalvando(false);
    }
  }

  if (naoEncontrada) {
    return (
      <div className="px-4 pt-1">
        <button onClick={() => navigate(-1)} className="mb-4 text-text-muted">
          <ChevronLeft />
        </button>
        <EmptyState icon={ListX} title="Essa tarefa sumiu." subtitle="Pode ter sido movida ou apagada." />
      </div>
    );
  }

  if (!tarefa) {
    return (
      <div className="px-4 pt-1">
        <button onClick={() => navigate(-1)} className="mb-4 text-text-muted">
          <ChevronLeft />
        </button>
        <p className="py-10 text-center text-sm text-text-muted">Carregando...</p>
      </div>
    );
  }

  const anexos = extrairAnexos(corpo);

  return (
    <div className="px-4 pt-1 pb-nav-safe">
      <div className="mb-4 flex items-center justify-between">
        <button onClick={() => navigate(-1)} className="flex items-center gap-1 text-sm text-text-muted">
          <ChevronLeft size={18} />
          Voltar
        </button>
        <button onClick={() => setConfirmandoDelete(true)} className="flex items-center gap-1.5 text-sm text-error">
          <Trash2 size={14} />
          Apagar
        </button>
      </div>

      {erro && (
        <div className="mb-4 flex items-start gap-2 rounded-2xl border border-error/40 bg-error/10 p-3 text-sm text-error">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" strokeWidth={1.75} />
          {erro}
        </div>
      )}

      {confirmandoDelete && (
        <div className="mb-4 rounded-2xl border border-error/40 bg-error/[0.06] p-4">
          <p className="mb-3 text-sm text-text-primary">Apagar essa tarefa? Ela some da Agenda pra sempre (ou até você criar de novo).</p>
          <div className="flex gap-2">
            <button onClick={() => setConfirmandoDelete(false)} className="flex-1 rounded-2xl bg-surface-2 py-2.5 text-sm font-medium text-text-primary">
              Cancelar
            </button>
            <button onClick={excluir} disabled={salvando} className="flex-1 rounded-2xl bg-error py-2.5 text-sm font-semibold text-white disabled:opacity-40">
              {salvando ? "Apagando..." : "Apagar"}
            </button>
          </div>
        </div>
      )}

      <button onClick={alternarStatus} className="mb-5 flex items-center gap-3">
        {tarefa.status === "concluida" ? (
          <CheckCircle2 size={26} strokeWidth={1.75} className="text-success" />
        ) : (
          <Circle size={26} strokeWidth={1.75} className="text-text-muted" />
        )}
        <input
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          className={`bg-transparent font-display text-2xl focus:outline-none ${tarefa.status === "concluida" ? "text-text-muted line-through" : "text-text-primary"}`}
        />
      </button>

      <div className="mb-5">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Prioridade</p>
        <div className="flex gap-2">
          {(Object.keys(PRIORIDADE_LABEL) as PrioridadeTarefa[]).map((p) => (
            <button
              key={p}
              onClick={() => setPrioridade(p)}
              className={`rounded-pill px-4 py-1.5 text-sm font-medium ${prioridade === p ? PRIORIDADE_CLASSES[p] : "bg-surface-2 text-text-muted"}`}
            >
              {PRIORIDADE_LABEL[p]}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-1 flex gap-3">
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">Data</span>
          <DatePicker accent="cyan" value={data} onChange={setData} />
        </div>
        <label className="flex flex-1 flex-col gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">Horário</span>
          <input type="time" value={horario} onChange={(e) => setHorario(e.target.value)} className="ecos-input font-mono-value" />
        </label>
      </div>
      <p className="mb-5 text-xs text-text-muted">Sem horário, a Tarefa entra na fila e é encaixada por capacidade.</p>

      <div className="mb-5">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Duração</p>
        <div className="flex flex-wrap gap-2">
          {DURACOES.map((min) => (
            <Chip
              key={min}
              selected={!duracaoCustom && duracao === min}
              onClick={() => {
                setDuracaoCustom(false);
                setDuracao(min);
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
            value={duracao}
            onChange={(e) => setDuracao(Math.max(1, Number(e.target.value) || 1))}
            placeholder="Minutos"
            className="ecos-input mt-2 w-32 font-mono-value"
          />
        )}
      </div>

      <div className="mb-5">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Descrição</p>
        <div className="mb-2 flex items-center gap-1 rounded-xl bg-surface-2 p-1">
          <ToolbarBtn Icon={Bold} onClick={() => inserir("**", "**")} label="Negrito" />
          <ToolbarBtn Icon={List} onClick={() => inserir("- [ ] ")} label="Lista" />
          <ToolbarBtn Icon={Link2} onClick={() => inserir("[[", "]]")} label="Wikilink" />
          <ToolbarBtn Icon={Code} onClick={() => inserir("`", "`")} label="Código" />
        </div>
        <textarea
          ref={areaRef}
          value={corpo}
          onChange={(e) => setCorpo(e.target.value)}
          rows={6}
          placeholder="Escreva aqui pra se debruçar sobre a tarefa."
          className="w-full resize-none rounded-2xl bg-surface-2 p-4 font-body text-[15px] text-text-primary placeholder:text-text-muted focus:outline-none"
        />
        {corpo.trim() && <div className="mt-2 rounded-2xl border border-border bg-surface-1 p-4 text-sm">{renderMarkdownMini(corpo)}</div>}
      </div>

      <div className="mb-5">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Anexos</p>
        {anexos.length > 0 && (
          <div className="mb-2 flex flex-col gap-1.5">
            {anexos.map((a) => (
              <div key={a.caminho} className="flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-2">
                {a.imagem ? <ImageIcon size={15} className="text-text-muted" /> : <FileText size={15} className="text-text-muted" />}
                <span className="flex-1 truncate text-sm text-text-primary">{a.nome}</span>
                <button type="button" onClick={() => removerAnexoDoTexto(a.linhaCompleta)} aria-label="Remover anexo">
                  <X size={14} className="text-text-muted" />
                </button>
              </div>
            ))}
          </div>
        )}
        <input
          ref={arquivoRef}
          type="file"
          className="hidden"
          onChange={(e) => {
            const arquivo = e.target.files?.[0];
            if (arquivo) enviarArquivo(arquivo);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          onClick={() => arquivoRef.current?.click()}
          disabled={enviandoAnexo}
          className="flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-2 text-sm font-medium text-text-secondary disabled:opacity-40"
        >
          <Paperclip size={15} />
          {enviandoAnexo ? "Enviando..." : "Anexar arquivo"}
        </button>
      </div>

      <div className="mb-5">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Tags</p>
        <div className="mb-2 flex flex-wrap gap-2">
          {tags.map((tag) => (
            <span key={tag} className="flex items-center gap-1.5 rounded-pill bg-surface-2 px-3 py-1 text-sm text-text-secondary">
              {tag}
              <button onClick={() => setTags((t) => t.filter((x) => x !== tag))} aria-label={`Remover tag ${tag}`}>
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

      <div className="mb-5">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Pasta</p>
        <div className="flex flex-wrap gap-2">
          <Chip selected={pasta === null} onClick={() => setPasta(null)}>
            Raiz
          </Chip>
          {pastasDisponiveis.map((p) => (
            <Chip key={p.caminho} selected={pasta === p.caminho} onClick={() => setPasta(p.caminho)}>
              {p.nome}
            </Chip>
          ))}
        </div>
      </div>

      <div className="mb-6">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Subtarefas</p>
        {subtarefas.length > 0 && (
          <div className="mb-2 flex flex-col gap-1.5">
            {subtarefas.map((s) => (
              <div key={s.id} className="flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-2">
                <button type="button" onClick={() => alternarSubtarefa(s.id)}>
                  {s.concluida ? <CheckCircle2 size={16} className="text-success" /> : <Circle size={16} className="text-text-muted" />}
                </button>
                <span className={`flex-1 text-sm ${s.concluida ? "text-text-muted line-through" : "text-text-primary"}`}>{s.titulo}</span>
                <button type="button" onClick={() => setSubtarefas((arr) => arr.filter((x) => x.id !== s.id))} aria-label="Remover subtarefa">
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

      <button onClick={salvar} disabled={salvando} className="w-full rounded-2xl bg-steel-700 py-3.5 text-center font-body text-[15px] font-semibold text-white disabled:opacity-40">
        {salvando ? "Salvando..." : "Salvar alterações"}
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
