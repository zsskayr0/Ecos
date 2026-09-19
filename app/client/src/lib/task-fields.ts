import type { PrioridadeTarefa, SubtarefaInput, TarefaDetalhe } from "./api";

export interface TaskFields {
  titulo: string;
  prioridade: PrioridadeTarefa;
  data: string;
  horario: string;
  duracao: number;
  corpo: string;
  tags: string[];
  pasta: string | null;
  espaco: string;
  subtarefas: SubtarefaInput[];
}

export const EMPTY_TASK: TaskFields = {
  titulo: "", prioridade: "baixa", data: "", horario: "", duracao: 5,
  corpo: "", tags: [], pasta: null, espaco: "pessoal", subtarefas: [],
};

export function taskDateLocal(value: string): string {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function taskScheduledAt(data: string, horario: string): string | null {
  if (!data || !horario) return null;
  const [ano, mes, dia] = data.split("-").map(Number);
  const [hora, minuto] = horario.split(":").map(Number);
  return new Date(ano, mes - 1, dia, hora, minuto).toISOString();
}

export function descriptionTags(corpo: string): string[] {
  // Ignore fenced code and URLs; only standalone hashtags count as tags.
  const texto = corpo.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`|https?:\/\/\S+/g, "");
  return [...new Set([...texto.matchAll(/(?:^|\s)#([\p{L}\p{N}_-]+)/gu)].map((m) => m[1].toLowerCase()))];
}

export function taskTags(tags: string[], corpo: string): string[] {
  return [...new Set([...tags, ...descriptionTags(corpo)])];
}

export function taskFromDetail(tarefa: TarefaDetalhe): TaskFields {
  const inlineTags = descriptionTags(tarefa.corpo);
  return {
    titulo: tarefa.titulo, prioridade: tarefa.prioridade,
    data: tarefa.scheduled_at ? taskDateLocal(tarefa.scheduled_at) : tarefa.due_date ?? "",
    horario: tarefa.scheduled_at ? new Date(tarefa.scheduled_at).toTimeString().slice(0, 5) : "",
    duracao: tarefa.duration_min ?? 5, corpo: tarefa.corpo,
    tags: tarefa.tags.filter((tag) => !inlineTags.includes(tag)),
    pasta: tarefa.pasta, espaco: tarefa.espaco, subtarefas: tarefa.subtarefas,
  };
}
