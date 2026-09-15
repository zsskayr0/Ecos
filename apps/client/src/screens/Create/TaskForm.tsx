import { Chip } from "@/components/common/Chip";
import type { CapturaDraft, SetDraft } from "./CreateFlow";

const DURACOES = [15, 30, 45, 60, 120];

interface Props {
  draft: CapturaDraft;
  setDraft: SetDraft;
  onSalvar: () => void;
  salvando?: boolean;
}

/** Formulário de Tarefa — chips de duração em vez de campo numérico livre (seção 3.6). */
export function TaskForm({ draft, setDraft, onSalvar, salvando }: Props) {
  return (
    <div className="flex flex-col gap-5">
      <input
        value={draft.texto}
        onChange={(e) => setDraft({ ...draft, texto: e.target.value })}
        placeholder="O que precisa ser feito?"
        className="w-full bg-transparent font-display text-2xl text-text-primary placeholder:text-text-muted focus:outline-none"
        autoFocus
      />

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Duração</p>
        <div className="flex flex-wrap gap-2">
          {DURACOES.map((min) => (
            <Chip key={min} selected={draft.duracaoMin === min} onClick={() => setDraft({ ...draft, duracaoMin: min })}>
              {min < 60 ? `${min}min` : min === 60 ? "1h" : "2h+"}
            </Chip>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Horário (opcional)</p>
        <input
          type="time"
          value={draft.scheduledAt ? new Date(draft.scheduledAt).toTimeString().slice(0, 5) : ""}
          onChange={(e) => {
            if (!e.target.value) return setDraft({ ...draft, scheduledAt: null });
            const [h, m] = e.target.value.split(":").map(Number);
            const data = new Date();
            data.setHours(h, m, 0, 0);
            setDraft({ ...draft, scheduledAt: data.toISOString() });
          }}
          className="w-full rounded-2xl bg-surface-2 px-4 py-3 font-mono-value text-text-primary focus:outline-none"
        />
        <p className="mt-1.5 text-xs text-text-muted">Sem horário, a Tarefa entra na fila e é encaixada por capacidade.</p>
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
