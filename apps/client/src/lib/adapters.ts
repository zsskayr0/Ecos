/**
 * Converte as respostas reais de `ecos-app` (JSON solto, ver
 * `apps/server/src/routes/*`) pro shape de view (`src/lib/types.ts`) que os
 * cards/telas já esperavam quando a UI ainda consumia mock. Mantém os
 * componentes de tela estáveis mesmo com o formato de API sendo bem mais
 * enxuto que o mock (sem `contagemLinksEntrada` pronta, sem `diasOrfa`
 * calculado, etc. — o que falta fica com valor neutro, nunca inventado).
 */
import type { MotivoRanking, Nota, Tarefa, Espaco } from "./types";
import type { MinhaEquipe } from "./use-minhas-equipes";
import { corDaEquipe } from "./team-color";

function origemEquipe(espaco: string, equipes: MinhaEquipe[]) {
  if (!espaco.startsWith("equipe:")) return undefined;
  const id = espaco.slice("equipe:".length);
  const equipe = equipes.find((e) => e.id === id);
  return { nome: equipe?.nome ?? "Equipe", cor: corDaEquipe(id) };
}

function motivoValido(m: unknown): MotivoRanking {
  return m === "frescor" || m === "orfa" || m === "interacao" || m === "esquecimento" ? m : "frescor";
}

/** Item de Nota vindo de `GET /feed` (já tem `motivo`/`preview` calculados pelo job de ranking, seção 4). */
export function notaDoFeed(item: Record<string, unknown>, equipes: MinhaEquipe[]): Nota {
  const espaco = String(item.espaco ?? "pessoal");
  return {
    tipo: "nota",
    id: String(item.id),
    titulo: String(item.titulo ?? "(sem título)"),
    preview: String(item.preview ?? ""),
    modo: "texto",
    tags: [],
    pastaId: null,
    espaco: espaco as Espaco,
    origemEquipe: origemEquipe(espaco, equipes),
    criadoEm: String(item.atualizado_em ?? new Date().toISOString()),
    atualizadoEm: String(item.atualizado_em ?? new Date().toISOString()),
    ultimaRevisaoEm: null,
    contagemLinksEntrada: 0,
    motivoRanking: motivoValido(item.motivo),
  };
}

/** `GET /notas` (listagem por pasta) — sem motivo de ranking calculado por item; ver GAP-09. */
export function notaResumoParaView(
  n: { id: string; titulo: string; pasta: string | null; espaco: string; criado_em: string; atualizado_em: string; ultima_revisao_em: string | null; tags: string[] },
  equipes: MinhaEquipe[],
): Nota {
  return {
    tipo: "nota",
    id: n.id,
    titulo: n.titulo,
    preview: "",
    modo: "texto",
    tags: n.tags,
    pastaId: n.pasta,
    espaco: n.espaco as Espaco,
    origemEquipe: origemEquipe(n.espaco, equipes),
    criadoEm: n.criado_em,
    atualizadoEm: n.atualizado_em,
    ultimaRevisaoEm: n.ultima_revisao_em,
    contagemLinksEntrada: 0,
    // GAP-09: `motivo` de ranking só existe hoje na tabela `feed_item`
    // (seção 4), sem endpoint pra consultar por Nota avulsa fora do Feed —
    // listagem de pasta mostra "Frescor" como neutro, não é ranking real.
    motivoRanking: "frescor",
  };
}

/**
 * Item `tarefa_encaixada` de `GET /feed` — o job de ranking só grava
 * `titulo`/`scheduled_at` nesse tipo de linha (ver `routes/feed.rs`,
 * `montar_card`), sem `duration_min`/`espaco`; o card mostra o que existe,
 * sem inventar duração.
 */
export function tarefaDoFeed(item: Record<string, unknown>): Tarefa {
  return {
    tipo: "tarefa",
    id: String(item.id),
    titulo: String(item.titulo ?? "(sem título)"),
    status: "pendente",
    scheduledAt: (item.scheduled_at as string | null) ?? null,
    durationMin: 0,
    dueDate: null,
    espaco: "pessoal",
    encaixadaNaAgenda: true,
  };
}

export function tarefaResumoParaView(
  t: { id: string; titulo: string; status: string; scheduled_at: string | null; duration_min: number | null; due_date: string | null; espaco: string },
  equipes: MinhaEquipe[],
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
    encaixadaNaAgenda: !!t.scheduled_at,
  };
}
