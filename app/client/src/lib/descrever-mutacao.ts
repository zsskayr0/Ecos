import type { MutacaoPendente } from "@/lib/offline-store";

export interface DescricaoMutacao {
  /** "Nova tarefa", "Edição de nota", "Exclusão de evento"… */
  acao: string;
  /** Título do item, quando a alteração o traz; senão vazio. */
  titulo: string;
  /** Texto escrito na alteração (corpo da nota/tarefa), para a pessoa copiar antes de descartar. */
  texto: string | null;
  /** Rota para abrir o item, quando ele já existe no servidor. */
  rota: string | null;
}

const RECURSOS: Record<string, { nome: string; genero: "a" | "o"; rota?: (id: string) => string }> = {
  notas: { nome: "nota", genero: "a", rota: (id) => `/notas/nota/${id}` },
  tarefas: { nome: "tarefa", genero: "a", rota: (id) => `/tarefa/${id}` },
  eventos: { nome: "evento", genero: "o" },
  pastas: { nome: "pasta", genero: "a" },
  tags: { nome: "tag", genero: "a" },
  arquivos: { nome: "arquivo", genero: "o" },
};

const SUB: Record<string, string> = {
  status: "Mudança de status", arquivada: "Arquivamento", renomear: "Renomeação", mover: "Mudança de pasta",
  tinta: "Escrita à mão", anexos: "Anexo", serie: "Repetição",
};

function lerCorpo(corpo: string | null): Record<string, unknown> {
  if (!corpo) return {};
  try { const v = JSON.parse(corpo); return v && typeof v === "object" ? v as Record<string, unknown> : {}; } catch { return {}; }
}

/** Descreve uma alteração guardada offline em português, a partir do método, do caminho e do corpo. */
export function descreverMutacao(m: Pick<MutacaoPendente, "metodo" | "caminho" | "corpo" | "tempId">): DescricaoMutacao {
  const [semQuery] = m.caminho.split("?");
  const partes = semQuery.replace(/^\/+/, "").split("/").filter(Boolean);
  const recurso = RECURSOS[partes[0] ?? ""];
  const id = partes[1];
  const sub = partes[2];
  const corpo = lerCorpo(m.corpo);
  const titulo = typeof corpo.titulo === "string" ? corpo.titulo : typeof corpo.nome === "string" ? corpo.nome : "";
  const texto = typeof corpo.corpo === "string" && corpo.corpo.trim() ? corpo.corpo : null;
  if (!recurso) {
    const verbo = { POST: "Criação", PUT: "Alteração", PATCH: "Alteração", DELETE: "Exclusão" }[m.metodo];
    return { acao: `${verbo} em ${partes[0] ?? "item"}`, titulo, texto, rota: null };
  }
  const de = `${recurso.genero === "a" ? "da" : "do"} ${recurso.nome}`;
  const criacao = m.metodo === "POST" && !id;
  const acao = criacao
    ? `${recurso.genero === "a" ? "Nova" : "Novo"} ${recurso.nome}`
    : m.metodo === "DELETE" && !sub ? `Exclusão ${de}`
    : sub && SUB[sub] ? `${SUB[sub]} ${de}`
    : `Edição ${de}`;
  // Id temporário (item criado offline) ainda não existe no servidor: não há o que abrir.
  const temporario = !!id && (id.startsWith("offline-") || id === m.tempId);
  const rota = !criacao && id && recurso.rota && !temporario && m.metodo !== "DELETE" ? recurso.rota(id) : null;
  return { acao, titulo, texto, rota };
}
