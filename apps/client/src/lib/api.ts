/**
 * Real HTTP client against `ecos-app` (and, via its proxy, `ecos-vault-db`).
 * Contract matches the code in `apps/server/src/routes/*` and
 * `apps/vault/src/routes/*` (not just the paper architecture — read
 * straight from the real backend this session). Base path is dynamic
 * (`server-config.ts`): a relative `/api/v1` in the browser (Vite's dev
 * proxy, or same-origin production serving) — but the compiled Tauri
 * shell has no origin to be "the same" as, so it reads a real address the
 * user configured in Configurações instead.
 */
import { apiBase } from "./server-config";

const BASE = apiBase;

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
    public campos?: { campo: string; motivo: string }[],
  ) {
    super(message);
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(`${BASE()}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });

  if (resp.status === 204) return undefined as T;

  const contentType = resp.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json") ? await resp.json().catch(() => null) : null;

  if (!resp.ok) {
    const code = body?.error ?? "UNKNOWN";
    const message = body?.message ?? `Erro ${resp.status}`;
    throw new ApiError(code, message, resp.status, body?.campos);
  }
  return body as T;
}

const get = <T>(path: string) => req<T>(path);
const post = <T>(path: string, data?: unknown) => req<T>(path, { method: "POST", body: data !== undefined ? JSON.stringify(data) : undefined });
const patch = <T>(path: string, data?: unknown) => req<T>(path, { method: "PATCH", body: data !== undefined ? JSON.stringify(data) : undefined });
const del = <T>(path: string, data?: unknown) => req<T>(path, { method: "DELETE", body: data !== undefined ? JSON.stringify(data) : undefined });

function qs(params: Record<string, string | number | boolean | undefined | null>) {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") usp.set(k, String(v));
  }
  const s = usp.toString();
  return s ? `?${s}` : "";
}

export interface Pagina<T> {
  items: T[];
  next_cursor: string | null;
}

// --- Auth & Profile (section 11.1/11.2) -----------------------------------

export const auth = {
  registrar: (nome_usuario: string, senha: string) =>
    post<{ usuario_id: string; recovery_key: string }>("/auth/registrar", { nome_usuario, senha }),
  login: (usuario: string, senha: string) => post<{ usuario_id: string }>("/auth/login", { usuario, senha }),
  logout: () => post<void>("/auth/logout"),
  perfil: () =>
    get<{ id: string; nome_usuario: string; cofre_ativado: boolean; equipes: { id: string; nome: string; cargo: string }[] }>("/me"),
  atualizarPerfil: (nome_usuario: string) => patch<{ ok: true }>("/me", { nome_usuario }),
};

// --- Universal capture (section 11.3) -------------------------------------

export const captura = {
  /**
   * Note/task only. GAP-13 (found testing against the real backend, not
   * assumed up front): `POST /captura` can't be used to create a
   * Transaction — the outer discriminator `tipo` ("nota"|"tarefa"|
   * "transacao") and `TransacaoPayload`'s own `tipo` (entrada/saida,
   * `apps/vault/src/routes/transacoes.rs`) are the same field name; since
   * `campos_compativeis()` also never lists "tipo" among transacao's
   * fields, the most consistent reading is that Transactions should
   * always go straight through `vault.transacoes.criar` (see
   * `CreateFlow.tsx`) instead — kept here only for note/task, which don't
   * have this conflict.
   */
  capturar: (tipo: "nota" | "tarefa", campos: Record<string, unknown>) =>
    post<Record<string, unknown>>("/captura", { tipo, ...campos }),
};

// --- Notes (section 11.4) --------------------------------------------------

export interface NotaResumo {
  id: string;
  titulo: string;
  modo: string;
  pasta: string | null;
  espaco: string;
  criado_em: string;
  atualizado_em: string;
  ultima_revisao_em: string | null;
  tags: string[];
  criado_por: string | null;
  criado_por_nome: string | null;
}

export const notas = {
  listar: (params: { pasta?: string; espaco?: string; tag?: string; cursor?: string; limit?: number } = {}) =>
    get<Pagina<NotaResumo>>(`/notas${qs(params)}`),
  obter: (id: string) =>
    get<{ id: string; titulo: string; modo: string; tags: string[]; espaco: string; criado_em: string; atualizado_em: string; ultima_revisao_em: string | null; caminho_arquivo: string; corpo: string }>(
      `/notas/${id}`,
    ),
  criar: (payload: { titulo: string; corpo?: string; pasta?: string; tags?: string[]; espaco?: string; modo?: "texto" | "pagina" }) =>
    post<{ id: string }>("/notas", payload),
  atualizar: (id: string, payload: { titulo?: string; pasta?: string; tags?: string[]; corpo?: string; marcar_revisado?: boolean }) =>
    patch<{ id: string }>(`/notas/${id}`, payload),
  excluir: (id: string) => del<{ ok: true }>(`/notas/${id}`),
  links: (id: string) => get<{ entrada: { id: string; titulo: string }[]; saida: { id: string; titulo: string }[] }>(`/notas/${id}/links`),
};

// --- Folders (section 11.5) -------------------------------------------------

export const pastas = {
  listar: (params: { tipo?: "nota" | "tarefa"; pasta_pai?: string; espaco?: string } = {}) =>
    get<{ subpastas: { caminho: string; nome: string; contagem_itens: number }[]; itens: Record<string, unknown>[] }>(`/pastas${qs(params)}`),
  criar: (payload: { tipo?: "nota" | "tarefa"; pasta_pai?: string; nome: string }) => post<{ ok: true; caminho: string }>("/pastas", payload),
  excluir: (payload: { tipo?: "nota" | "tarefa"; caminho: string }) => del<{ ok: true }>("/pastas", payload),
};

// --- Tasks & Agenda (section 11.6) ------------------------------------------

export const PRIORIDADES_TAREFA = ["baixa", "media", "alta"] as const;
export type PrioridadeTarefa = (typeof PRIORIDADES_TAREFA)[number];

export interface Subtarefa {
  id: string;
  titulo: string;
  concluida: boolean;
}

/** Input shape for a subtask the client is sending — `id` omitted means "new", matching `SubtarefaPayload` in `tarefas.rs`. */
export interface SubtarefaInput {
  id?: string;
  titulo: string;
  concluida: boolean;
}

export interface TarefaResumo {
  id: string;
  caminho_arquivo: string;
  titulo: string;
  status: "pendente" | "concluida";
  scheduled_at: string | null;
  duration_min: number | null;
  due_date: string | null;
  espaco: string;
  criado_em: string;
  prioridade: PrioridadeTarefa;
  criado_por: string | null;
  criado_por_nome: string | null;
}

export interface TarefaDetalhe {
  id: string;
  titulo: string;
  status: "pendente" | "concluida";
  scheduled_at: string | null;
  duration_min: number | null;
  due_date: string | null;
  tags: string[];
  prioridade: PrioridadeTarefa;
  subtarefas: Subtarefa[];
  espaco: string;
  criado_em: string;
  caminho_arquivo: string;
  pasta: string | null;
  corpo: string;
}

export interface CriarTarefaPayload {
  titulo: string;
  corpo?: string;
  pasta?: string;
  scheduled_at?: string | null;
  duration_min?: number;
  due_date?: string | null;
  tags?: string[];
  prioridade?: PrioridadeTarefa;
  subtarefas?: SubtarefaInput[];
  espaco?: string;
}

export interface AtualizarTarefaPayload {
  titulo?: string;
  pasta?: string;
  scheduled_at?: string;
  duration_min?: number;
  due_date?: string;
  corpo?: string;
  tags?: string[];
  prioridade?: PrioridadeTarefa;
  subtarefas?: SubtarefaInput[];
}

export const tarefas = {
  listar: (params: { pasta?: string; data_de?: string; data_ate?: string; status?: string; espaco?: string; cursor?: string; limit?: number } = {}) =>
    get<Pagina<TarefaResumo>>(`/tarefas${qs(params)}`),
  obter: (id: string) => get<TarefaDetalhe>(`/tarefas/${id}`),
  criar: (payload: CriarTarefaPayload) => post<{ id: string }>("/tarefas", payload),
  atualizar: (id: string, payload: AtualizarTarefaPayload) => patch<{ id: string }>(`/tarefas/${id}`, payload),
  atualizarStatus: (id: string, status: "pendente" | "concluida") => patch<{ id: string; status: string }>(`/tarefas/${id}/status`, { status }),
  excluir: (id: string) => del<{ ok: true }>(`/tarefas/${id}`),
  capacidade: (data: string) =>
    get<{
      data: string;
      total_dia_min: number;
      consumido_rotina_min: number;
      consumido_eventos_externos_min: number;
      consumido_tarefas_min: number;
      disponivel_producao_min: number;
      tempo_livre_min: number;
      estourado: boolean;
    }>(`/agenda/capacidade${qs({ data })}`),
  /** Real multipart upload — `fetch` sets its own `Content-Type` with the
   * boundary when given a `FormData` body, so this bypasses the shared
   * `req()`'s JSON header instead of fighting it. */
  anexos: {
    enviar: async (id: string, arquivo: File) => {
      const formData = new FormData();
      formData.append("arquivo", arquivo);
      const resp = await fetch(`${BASE()}/tarefas/${id}/anexos`, { method: "POST", credentials: "include", body: formData });
      const body = await resp.json().catch(() => null);
      if (!resp.ok) throw new ApiError(body?.error ?? "UNKNOWN", body?.message ?? `Erro ${resp.status}`, resp.status);
      return body as { nome_arquivo: string; url_relativa: string; tamanho_bytes: number; corpo: string };
    },
    urlDownload: (id: string, nomeArquivo: string) => `${BASE()}/tarefas/${id}/anexos/${encodeURIComponent(nomeArquivo)}`,
  },
};

// --- Feed (section 11.7) -------------------------------------------------

export const feed = {
  obter: (params: { espaco?: string; cursor?: string; limit?: number } = {}) => get<Pagina<Record<string, unknown>>>(`/feed${qs(params)}`),
};

// --- Search (section 11.8) ------------------------------------------------

export const busca = {
  buscar: (q: string, params: { tipo?: "nota" | "tarefa"; espaco?: string } = {}) =>
    get<{ notas: { id: string; titulo: string; espaco: string; trecho: string }[]; tarefas: { id: string; titulo: string; espaco: string; status: string }[] }>(
      `/busca${qs({ q, ...params })}`,
    ),
};

// --- Teams (section 11.10) ----------------------------------------------

export const equipes = {
  listarMinhas: () => get<{ id: string; nome: string; cargo: string }[]>("/equipes"),
  criar: (nome: string) => post<{ id: string }>("/equipes", { nome }),
  obter: (id: string) => get<{ id: string; nome: string; estatisticas: { notas: number; tarefas: number } }>(`/equipes/${id}`),
  atualizar: (id: string, nome: string) => patch<{ ok: true }>(`/equipes/${id}`, { nome }),
  excluir: (id: string, confirm: string) => del<{ ok: true }>(`/equipes/${id}`, { confirm }),
  listarMembros: (id: string) => get<{ usuario_id: string; cargo: string; entrou_em: string }[]>(`/equipes/${id}/membros`),
  trocarCargo: (id: string, usuarioId: string, cargo: "dono" | "admin" | "membro") =>
    patch<{ ok: true }>(`/equipes/${id}/membros/${usuarioId}`, { cargo }),
  removerMembro: (id: string, usuarioId: string) => del<{ ok: true }>(`/equipes/${id}/membros/${usuarioId}`),
  criarConvite: (id: string) => post<{ id: string; codigo: string; expira_em: string }>(`/equipes/${id}/convites`),
  aceitarConvite: (codigo: string) => post<{ ok: true }>(`/convites/${codigo}/aceitar`),
};

// --- Notifications (section 11.11) -----------------------------------------

export interface NotificacaoApi {
  id: string;
  categoria: "cofre" | "agenda" | "equipes";
  titulo: string;
  corpo: string;
  lida: boolean;
  criado_em: string;
}

export const notificacoes = {
  listar: (params: { categoria?: string; lida?: boolean; cursor?: string; limit?: number } = {}) =>
    get<Pagina<NotificacaoApi>>(`/notificacoes${qs({ ...params, lida: params.lida === undefined ? undefined : String(params.lida) })}`),
  marcarLida: (id: string) => patch<{ ok: true }>(`/notificacoes/${id}/lida`),
  marcarTodasLidas: () => post<{ ok: true }>("/notificacoes/marcar-todas-lidas"),
};

// --- Vault / Cofre (section 11.14, via /vault/* proxy) ---------------------

export interface TransacaoApi {
  id: string;
  tipo: "entrada" | "saida";
  valor_centavos: number;
  moeda: string;
  data: string;
  descricao: string;
  categoria_id: string | null;
  conta_id: string | null;
  beneficiario_id: string | null;
  forma_pagamento: string | null;
  status: "efetivada" | "pendente";
  observacoes: string | null;
  origem: string;
  espaco: string;
  criado_em: string;
  atualizado_em: string;
}

export interface CategoriaApi {
  id: string;
  nome: string;
  tipo: "entrada" | "saida" | "ambos";
  icone: string | null;
  cor: string;
  padrao: boolean;
  espaco: string;
}

export interface ContaApi {
  id: string;
  nome: string;
  banco: string | null;
  agencia: string | null;
  numero_conta: string | null;
  cor: string;
  padrao: boolean;
  espaco: string;
}

export interface BeneficiarioApi {
  id: string;
  nome: string;
  documento: string | null;
  observacoes: string | null;
}

/** Matches `FORMAS_PAGAMENTO` in `apps/vault/src/routes/transacoes.rs` — a closed enum, not free text. */
export const FORMAS_PAGAMENTO = ["pix", "pix_automatico", "ted", "cartao", "dinheiro", "boleto", "outro"] as const;
export type FormaPagamento = (typeof FORMAS_PAGAMENTO)[number];

export const vault = {
  ativar: (senha: string) => post<{ ok: true }>("/vault/ativar", { senha }),
  desbloquear: (senha: string) => post<{ ok: true }>("/vault/desbloquear", { senha }),
  bloquear: () => post<{ ok: true }>("/vault/bloquear"),
  config: () => get<{ cofre_ativado: boolean; destrancado: boolean; saldos_por_conta: { conta_id: string; nome: string; saldo_centavos: number }[] }>("/vault/config"),

  contas: {
    listar: () => get<ContaApi[]>("/vault/contas"),
    criar: (payload: { nome: string; banco?: string; agencia?: string; numero_conta?: string; cor?: string; espaco?: string }) =>
      post<{ id: string }>("/vault/contas", payload),
  },
  categorias: {
    listar: () => get<CategoriaApi[]>("/vault/categorias"),
    criar: (payload: { nome: string; tipo?: string; icone?: string; cor?: string; espaco?: string }) => post<{ id: string }>("/vault/categorias", payload),
  },
  beneficiarios: {
    listar: () => get<BeneficiarioApi[]>("/vault/beneficiarios"),
    /** `POST` is find-or-create by name (see `beneficiarios.rs`). */
    criarOuEncontrar: (payload: { nome: string; documento?: string; observacoes?: string }) =>
      post<{ id: string; nome: string; novo: boolean }>("/vault/beneficiarios", payload),
  },
  transacoes: {
    listar: (params: { conta_id?: string; categoria_id?: string; status?: string; data_de?: string; data_ate?: string; cursor?: string; limit?: number } = {}) =>
      get<{ items: TransacaoApi[]; next_cursor: string | null }>(`/vault/transacoes${qs(params)}`),
    obter: (id: string) => get<TransacaoApi>(`/vault/transacoes/${id}`),
    criar: (payload: {
      tipo: "entrada" | "saida";
      valor_centavos: number;
      data: string;
      descricao: string;
      categoria_id?: string;
      conta_id?: string;
      beneficiario_id?: string;
      forma_pagamento?: string;
      status?: "efetivada" | "pendente";
      observacoes?: string;
      espaco?: string;
    }) => post<TransacaoApi>("/vault/transacoes", payload),
    atualizar: (id: string, payload: Partial<TransacaoApi> & { tipo: string; valor_centavos: number; data: string; descricao: string }) =>
      patch<TransacaoApi>(`/vault/transacoes/${id}`, payload),
    excluir: (id: string) => del<{ ok: true }>(`/vault/transacoes/${id}`),
  },
};
