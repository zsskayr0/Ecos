/**
 * Converts `ecos-app`'s real responses (loose JSON, see
 * `app/server/src/routes/*`) into the view shape (`src/lib/types.ts`)
 * that cards/screens already expected back when the UI still consumed
 * mock data. Keeps screen components stable even though the API's shape
 * is much leaner than the mock (no ready-made `contagemLinksEntrada`, no
 * computed `diasOrfa`, etc. — whatever's missing gets a neutral value,
 * never an invented one).
 */
import type { MotivoRanking, Nota, Tarefa, Espaco, PrioridadeTarefa, Dono } from "./types";
import type { MinhaEquipe } from "./use-minhas-equipes";
import { corDaEquipe } from "./team-color";

/** The current local user — passed by every screen via `useAuth()`. */
export interface PerfilBasico {
  id: string;
  nome_usuario: string;
  nome?: string | null;
}

function origemEquipe(espaco: string, equipes: MinhaEquipe[]) {
  if (!espaco.startsWith("equipe:")) return undefined;
  const id = espaco.slice("equipe:".length);
  const equipe = equipes.find((e) => e.id === id);
  return { nome: equipe?.nome ?? "Equipe", cor: corDaEquipe(id) };
}

/** User feedback: "no feed, deve ter a foto de perfil e o nome do dono
 * daquele item" — `criado_por_nome` (real, resolved server-side) wins
 * whenever it exists; only items created before that column existed
 * (`criado_por IS NULL`) fall back, and only for `espaco: pessoal` is the
 * fallback certain (this instance has exactly one local user). A legacy
 * Equipe item with no recorded author has no reliable name to show —
 * "Equipe" is honest instead of invented. */
function resolverDono(espaco: string, criadoPor: unknown, criadoPorNome: unknown, perfil: PerfilBasico | null): Dono {
  if (typeof criadoPorNome === "string" && criadoPorNome) {
    return { id: typeof criadoPor === "string" ? criadoPor : null, nome: criadoPorNome };
  }
  if (espaco === "pessoal" && perfil) {
    return { id: perfil.id, nome: perfil.nome?.trim() || perfil.nome_usuario };
  }
  return { id: null, nome: "Equipe" };
}

function motivoValido(m: unknown): MotivoRanking {
  return m === "frescor" || m === "orfa" || m === "interacao" || m === "esquecimento" ? m : "frescor";
}

function prioridadeValida(p: unknown): PrioridadeTarefa {
  return p === "baixa" || p === "alta" ? p : "media";
}

/** A Nota item from `GET /feed` (already has `motivo`/`preview` computed by the ranking job, section 4). */
export function notaDoFeed(item: Record<string, unknown>, equipes: MinhaEquipe[], perfil: PerfilBasico | null): Nota {
  const espaco = String(item.espaco ?? "pessoal");
  return {
    tipo: "nota",
    id: String(item.id),
    titulo: String(item.titulo ?? "(sem título)"),
    preview: String(item.preview ?? ""),
    corpo: String(item.corpo ?? ""),
    modo: "texto",
    tags: [],
    pastaId: null,
    espaco: espaco as Espaco,
    origemEquipe: origemEquipe(espaco, equipes),
    dono: resolverDono(espaco, item.criado_por, item.criado_por_nome, perfil),
    criadoEm: String(item.atualizado_em ?? new Date().toISOString()),
    atualizadoEm: String(item.atualizado_em ?? new Date().toISOString()),
    ultimaRevisaoEm: null,
    contagemLinksEntrada: 0,
    motivoRanking: motivoValido(item.motivo),
  };
}

/** `GET /notas` (folder listing) — no per-item ranking motive; see GAP-09. */
export function notaResumoParaView(
  n: {
    id: string;
    titulo: string;
    pasta: string | null;
    corpo?: string;
    espaco: string;
    criado_em: string;
    atualizado_em: string;
    ultima_revisao_em: string | null;
    tags: string[];
    criado_por?: string | null;
    criado_por_nome?: string | null;
  },
  equipes: MinhaEquipe[],
  perfil: PerfilBasico | null,
): Nota {
  return {
    tipo: "nota",
    id: n.id,
    titulo: n.titulo,
    preview: "",
    corpo: n.corpo ?? "",
    modo: "texto",
    tags: n.tags,
    pastaId: n.pasta,
    espaco: n.espaco as Espaco,
    origemEquipe: origemEquipe(n.espaco, equipes),
    dono: resolverDono(n.espaco, n.criado_por, n.criado_por_nome, perfil),
    criadoEm: n.criado_em,
    atualizadoEm: n.atualizado_em,
    ultimaRevisaoEm: n.ultima_revisao_em,
    contagemLinksEntrada: 0,
    // GAP-09: the ranking `motivo` only exists today in the `feed_item`
    // table (section 4) — no endpoint to look it up for a standalone Nota
    // outside the Feed. Folder listing shows "Frescor" as a neutral
    // placeholder, not a real ranking.
    motivoRanking: "frescor",
  };
}

/**
 * A `tarefa_encaixada` item from `GET /feed` (`routes/feed.rs::montar_card`).
 */
export function tarefaDoFeed(item: Record<string, unknown>, perfil: PerfilBasico | null): Tarefa {
  const espaco = String(item.espaco ?? "pessoal");
  return {
    tipo: "tarefa",
    id: String(item.id),
    titulo: String(item.titulo ?? "(sem título)"),
    status: "pendente",
    scheduledAt: (item.scheduled_at as string | null) ?? null,
    durationMin: Number(item.duration_min ?? 0),
    dueDate: null,
    espaco: espaco as Espaco,
    dono: resolverDono(espaco, item.criado_por, item.criado_por_nome, perfil),
    encaixadaNaAgenda: true,
    prioridade: prioridadeValida(item.prioridade),
  };
}

export function tarefaResumoParaView(
  t: {
    id: string;
    titulo: string;
    status: string;
    scheduled_at: string | null;
    duration_min: number | null;
    due_date: string | null;
    espaco: string;
    prioridade?: string;
    criado_por?: string | null;
    criado_por_nome?: string | null;
  },
  equipes: MinhaEquipe[],
  perfil: PerfilBasico | null,
): Tarefa {
  return {
    tipo: "tarefa",
    id: t.id,
    titulo: t.titulo,
    status: t.status === "concluida" ? "concluida" : "pendente",
    scheduledAt: t.scheduled_at,
    durationMin: t.duration_min ?? 30,
    dueDate: t.due_date,
    espaco: t.espaco as Espaco,
    origemEquipe: origemEquipe(t.espaco, equipes),
    dono: resolverDono(t.espaco, t.criado_por, t.criado_por_nome, perfil),
    encaixadaNaAgenda: !!t.scheduled_at,
    prioridade: prioridadeValida(t.prioridade),
  };
}
