/**
 * Real HTTP client against `ecos-app` (and, via its proxy, `ecos-vault-db`).
 * Contract matches the code in `app/server/src/routes/*` and
 * `app/vault/src/routes/*` (not just the paper architecture — read
 * straight from the real backend this session). Base path is dynamic
 * (`server-config.ts`): a relative `/api/v1` in the browser (Vite's dev
 * proxy, or same-origin production serving) — but the compiled Tauri
 * shell has no origin to be "the same" as, so it reads a real address the
 * user configured in Configurações instead.
 */
import { apiBase, obterAccessToken, definirAccessToken } from "./server-config";
import { estaNoTauri, obterServidorBaseUrl } from "./server-config";
import { invoke } from "@tauri-apps/api/core";

const BASE = apiBase;

function mensagemHttp(status: number): string {
  switch (status) {
    case 400: case 422: return "Confira os dados informados e tente novamente.";
    case 401: return "Sua sessão expirou. Entre novamente para continuar.";
    case 403: return "Você não tem permissão para realizar esta ação.";
    case 404: return "O item ou serviço solicitado não foi encontrado no servidor.";
    case 405: return "O servidor não aceita esta operação. Atualize o servidor Ecos e tente novamente.";
    case 409: return "O item foi alterado. Atualize a tela e tente novamente.";
    case 413: return "O arquivo excede o limite de envio. Escolha um arquivo de até 120 MB.";
    case 429: return "Você fez muitas solicitações. Aguarde um momento e tente novamente.";
    case 502: case 503: case 504: return "O servidor está indisponível. Aguarde um momento e tente novamente.";
    default: return "O servidor não conseguiu concluir a operação. Tente novamente.";
  }
}

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
    public campos?: { campo: string; motivo: string }[],
    /** Só em 429 (`RateLimited`) — segundos até poder tentar de novo. */
    public retryAfterSegundos?: number,
  ) {
    const detalhes = campos?.map((c) => `${c.campo}: ${c.motivo}`).join("; ");
    super(detalhes || (!message || /^Erro \d+$/.test(message) || status === 401 || (status >= 500 && /^Erro interno/i.test(message)) ? mensagemHttp(status) : message));
  }
}

async function comandoAuthNativo<T>(command: string, args: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    if (error && typeof error === "object" && "message" in error) {
      const native = error as { code?: string; message: unknown; status?: number; retry_after_segundos?: number };
      const status = typeof native.status === "number" ? native.status : 0;
      // ApiError's generic 401 text is appropriate for API requests, but login
      // needs the native authentication message (rather than "session expired").
      const wrapped = new ApiError(native.code ?? "AUTH_NATIVA", String(native.message), status, undefined, native.retry_after_segundos);
      wrapped.message = String(native.message);
      throw wrapped;
    }
    throw new ApiError("AUTH_NATIVA", "Não foi possível executar a autenticação nativa. Atualize o aplicativo Ecos.", 0);
  }
}

let renovacaoNativa: Promise<boolean> | null = null;

async function renovarSessaoNativa(): Promise<boolean> {
  if (renovacaoNativa) return renovacaoNativa;
  renovacaoNativa = executarRenovacaoNativa();
  try { return await renovacaoNativa; }
  finally { renovacaoNativa = null; }
}

const ESPERA_RETRY_RENOVACAO_MS = [300, 1000];

/** Uma falha isolada de rede/timeout na renovação nativa não pode deslogar quem
 * ainda tem um refresh token válido guardado — por isso tenta mais duas vezes
 * (com um pequeno intervalo) antes de desistir e limpar o access token. */
async function executarRenovacaoNativa(): Promise<boolean> {
  if (!estaNoTauri()) return false;
  const servidor = obterServidorBaseUrl();
  if (!servidor) return false;
  for (let tentativa = 0; ; tentativa++) {
    try {
      const accessToken = await comandoAuthNativo<string>("renovar_sessao_desktop", { servidor });
      definirAccessToken(accessToken);
      return true;
    } catch (erro) {
      // Refresh token inválido/expirado (401 do servidor) é definitivo: tentar de novo não muda o resultado.
      const status = erro instanceof ApiError ? erro.status : undefined;
      if (status === 401 || tentativa >= ESPERA_RETRY_RENOVACAO_MS.length) {
        definirAccessToken(null);
        return false;
      }
      await new Promise((r) => setTimeout(r, ESPERA_RETRY_RENOVACAO_MS[tentativa]));
    }
  }
}

let renovacaoWeb: Promise<boolean> | null = null;

/** No navegador o access token vive num cookie de 15 min; o refresh (30 dias, uso único) também é cookie, então basta chamar `/auth/refresh`.
 * Sem isso a sessão "caía do nada" a cada 15 minutos. */
async function renovarSessaoWeb(): Promise<boolean> {
  if (renovacaoWeb) return renovacaoWeb;
  renovacaoWeb = executarRenovacaoWeb().finally(() => { renovacaoWeb = null; });
  return renovacaoWeb;
}

async function executarRenovacaoWeb(): Promise<boolean> {
  const renovar = async (): Promise<boolean> => {
    try {
      // Outra aba pode ter renovado agora há pouco (cookies são compartilhados e o refresh só vale uma vez):
      // se a sessão já vale, não gasta o refresh.
      const atual = await fetch(`${BASE()}/me`, { credentials: "include" });
      if (atual.ok) return true;
      const resp = await fetch(`${BASE()}/auth/refresh`, { method: "POST", credentials: "include" });
      return resp.ok;
    } catch {
      return false;
    }
  };
  // Uma renovação por vez entre abas/janelas do mesmo navegador.
  return navigator.locks ? navigator.locks.request("ecos-renovar-sessao", renovar) : renovar();
}

/** Rotas que criam ou encerram a sessão: um 401 delas é resposta, não sessão vencida. */
const ROTAS_SEM_RENOVACAO = ["/auth/login", "/auth/registrar", "/auth/refresh", "/auth/logout", "/auth/recuperar-senha", "/auth/status"];

async function req<T>(path: string, init?: RequestInit, tentouRenovar = false): Promise<T> {
  const accessToken = obterAccessToken();
  let resp: Response;
  try {
    resp = await fetch(`${BASE()}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      ...(init?.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
      // Fallback pro cliente Tauri (cookie cross-origin não sobrevive —
      // ver server-config.ts). No navegador não existe token guardado,
      // então isto não muda nada ali; o cookie same-origin já resolve.
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...init?.headers,
    },
    });
  } catch {
    throw new ApiError("CONEXAO_INDISPONIVEL", "Não foi possível conectar ao servidor Ecos. Verifique sua conexão e o endereço do servidor.", 0);
  }

  if (resp.status === 204) return undefined as T;

  const contentType = resp.headers.get("content-type") ?? "";
  const ehJson = contentType.includes("application/json");
  const body = ehJson ? await resp.json().catch(() => null) : null;

  if (resp.status === 401 && !tentouRenovar && !ROTAS_SEM_RENOVACAO.some((r) => path.startsWith(r))) {
    const renovou = estaNoTauri() ? await renovarSessaoNativa() : await renovarSessaoWeb();
    if (renovou) return req<T>(path, init, true);
  }

  if (!resp.ok) {
    const code = body?.error ?? "UNKNOWN";
    const message = body?.message ?? mensagemHttp(resp.status);
    throw new ApiError(code, message, resp.status, body?.campos, body?.retry_after_segundos);
  }
  // Real bug found on Android: a misconfigured server address (missing
  // `http://`, see `server-config.ts`) made `fetch()` land back on the
  // Tauri shell's own `index.html` — a real `200`, just never from
  // `ecos-app`. Silently returning `null` there let every caller treat
  // "wrong server" as "empty success" (e.g. `equipes.find` on a `null`
  // array), crashing far from the actual cause with no visible error.
  // A `2xx` response that isn't JSON is never a valid Ecos API reply.
  if (!ehJson) {
    throw new ApiError("RESPOSTA_INESPERADA", "O servidor respondeu, mas não como a API do Ecos esperava — confira o endereço em Configurações → Servidor.", resp.status);
  }
  return body as T;
}

/** Variante autenticada para conteúdo binário, usada pela foto de perfil. */
async function reqBlob(path: string, tentouRenovar = false): Promise<Blob | null> {
  const accessToken = obterAccessToken();
  let resp: Response;
  try {
    resp = await fetch(`${BASE()}${path}`, {
      credentials: "include",
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
    });
  } catch {
    throw new ApiError("CONEXAO_INDISPONIVEL", "Não foi possível conectar ao servidor Ecos. Verifique sua conexão e o endereço do servidor.", 0);
  }
  if (resp.status === 401 && !tentouRenovar) {
    const renovou = estaNoTauri() ? await renovarSessaoNativa() : await renovarSessaoWeb();
    if (renovou) return reqBlob(path, true);
  }
  if (resp.status === 404) return null;
  if (!resp.ok) {
    const body = await resp.json().catch(() => null);
    throw new ApiError(body?.error ?? "UNKNOWN", body?.message ?? mensagemHttp(resp.status), resp.status, body?.campos, body?.retry_after_segundos);
  }
  return resp.blob();
}

const get = <T>(path: string) => req<T>(path);
const post = <T>(path: string, data?: unknown) => req<T>(path, { method: "POST", body: data !== undefined ? JSON.stringify(data) : undefined });
const put = <T>(path: string, data?: unknown) => req<T>(path, { method: "PUT", body: data !== undefined ? JSON.stringify(data) : undefined });
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
  status: () => get<{ instancia_vazia: boolean; versao: string; idade_minima: number; termos_versao: string }>("/auth/status"),
  registrar: (nome_usuario: string, senha: string, nome: string | undefined, declara_idade_minima: boolean, aceita_termos: boolean) =>
    post<{ usuario_id: string; recovery_key: string }>("/auth/registrar", { nome_usuario, senha, nome, declara_idade_minima, aceita_termos }),
  login: async (usuario: string, senha: string) => {
    if (estaNoTauri()) {
      const servidor = obterServidorBaseUrl();
      if (!servidor) throw new ApiError("SERVIDOR_NAO_CONFIGURADO", "Configure o endereço do servidor antes de entrar.", 400);
      // Legacy command name; Rust selects Windows Credential Manager or
      // Android's native-memory session using target-specific implementations.
      const access_token = await comandoAuthNativo<string>("login_desktop", { servidor, usuario, senha });
      definirAccessToken(access_token);
      return { usuario_id: "", access_token };
    }
    const resposta = await post<{ usuario_id: string; access_token: string }>("/auth/login", { usuario, senha });
    definirAccessToken(resposta.access_token);
    return resposta;
  },
  logout: async () => {
    definirAccessToken(null);
    if (estaNoTauri()) {
      const servidor = obterServidorBaseUrl();
      if (servidor) await comandoAuthNativo("logout_desktop", { servidor });
      return;
    }
    await post<void>("/auth/logout");
  },
  perfil: () =>
    get<{ id: string; nome_usuario: string; nome: string | null; cofre_ativado: boolean; avatar_atualizado_em: number | null; equipes: { id: string; nome: string; cargo: string }[]; papel: "admin" | "usuario"; deve_trocar_senha: boolean; termos_pendente: boolean; termos_versao: string }>("/me"),
  aceitarTermos: (versao: string) => post<{ ok: true; versao: string }>("/me/aceites/termos", { versao }),
  atualizarPerfil: (dados: { nome_usuario?: string; nome?: string }) => patch<{ ok: true }>("/me", dados),
  /** Troca a própria senha. Com senha temporária (conta criada pela administração) devolve uma recovery key nova, que só aparece uma vez. */
  trocarSenha: (senha_atual: string, nova_senha: string) => post<{ ok: true; recovery_key: string | null }>("/me/senha", { senha_atual, nova_senha }),
};

/** Administração da instância (só quem administra; para as demais pessoas as rotas respondem 404). */
export interface UsuarioAdmin { id: string; nome_usuario: string; nome: string | null; papel: "admin" | "usuario"; criado_em: string; deve_trocar_senha: boolean }
export interface EquipeAdmin { id: string; nome: string; membros: { usuario_id: string; nome_usuario: string; nome: string | null; cargo: string }[] }
export const admin = {
  listarUsuarios: () => get<UsuarioAdmin[]>("/admin/usuarios"),
  criarUsuario: (nome_usuario: string, nome: string | undefined, papel: "admin" | "usuario") =>
    post<{ id: string; nome_usuario: string; papel: string; senha_temporaria: string }>("/admin/usuarios", { nome_usuario, nome, papel }),
  redefinirSenha: (id: string) => post<{ id: string; senha_temporaria: string }>(`/admin/usuarios/${id}/redefinir-senha`),
  listarEquipes: () => get<EquipeAdmin[]>("/admin/equipes"),
  adicionarMembro: (equipeId: string, usuarioId: string, cargo: "membro" | "admin" = "membro") =>
    post<{ ok: true }>(`/admin/equipes/${equipeId}/membros`, { usuario_id: usuarioId, cargo }),
  removerMembro: (equipeId: string, usuarioId: string) => del<{ ok: true }>(`/admin/equipes/${equipeId}/membros/${usuarioId}`),
};

/** Conta e dados (LGPD): exportar o `.zip` com tudo e excluir a conta. `EXCLUIR CONTA` é a frase que o servidor exige. */
export const FRASE_EXCLUIR_CONTA = "EXCLUIR CONTA";
export const conta = {
  exportar: async () => {
    const zip = await reqBlob("/me/export");
    if (!zip) throw new ApiError("NOT_FOUND", "O servidor não tem a exportação de dados. Atualize o servidor Ecos e tente novamente.", 404);
    return zip;
  },
  excluir: () => del<{ ok: true; avisos: string[] }>("/me", { confirm: FRASE_EXCLUIR_CONTA }),
};

export const avatarPerfil = {
  obter: () => reqBlob("/me/avatar"),
  enviar: (arquivo: File) => {
    const dados = new FormData();
    dados.append("arquivo", arquivo);
    return req<{ ok: true; avatar_atualizado_em: number | null }>("/me/avatar", { method: "PUT", body: dados });
  },
  remover: () => del<{ ok: true }>("/me/avatar"),
};

// --- Universal capture (section 11.3) -------------------------------------

export const captura = {
  /**
   * Note/task only. GAP-13 (found testing against the real backend, not
   * assumed up front): `POST /captura` can't be used to create a
   * Transaction — the outer discriminator `tipo` ("nota"|"tarefa"|
   * "transacao") and `TransacaoPayload`'s own `tipo` (entrada/saida,
   * `app/vault/src/routes/transacoes.rs`) are the same field name; since
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
  corpo: string;
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
  /** `.md` de fora: o servidor completa o front-matter que faltar e não mexe no corpo. */
  importar: (payload: { nome: string; conteudo: string; pasta?: string }) =>
    post<{ id: string; titulo: string; pasta: string | null }>("/notas/importar", payload),
  atualizar: (id: string, payload: { titulo?: string; pasta?: string; espaco?: string; tags?: string[]; corpo?: string; marcar_revisado?: boolean }) =>
    patch<{ id: string }>(`/notas/${id}`, payload),
  excluir: (id: string) => del<{ ok: true }>(`/notas/${id}`),
  links: (id: string) => get<{ entrada: { id: string; titulo: string }[]; saida: { id: string; titulo: string }[] }>(`/notas/${id}/links`),
  /** Mirror de `tarefas.anexos` (mesmo padrão de backend, `notas.rs::enviar_anexo`)
   * — real multipart upload, então usa `fetch` direto em vez de `req()`
   * (que sempre manda `Content-Type: application/json`, incompatível com
   * `FormData`). Ao contrário da versão de Tarefa, esta já manda
   * `Authorization: Bearer` quando existe token guardado — sem isso o
   * upload dentro do app Tauri falharia com 401 mesmo logado, pelo mesmo
   * motivo do cookie cross-origin corrigido no login. */
  anexos: {
    enviar: async (id: string, arquivo: File) => {
      const formData = new FormData();
      formData.append("arquivo", arquivo);
      return req<{ nome_arquivo: string; url_relativa: string; tamanho_bytes: number; corpo: string }>(`/notas/${id}/anexos`, { method: "POST", body: formData });
    },
    urlDownload: (id: string, nomeArquivo: string) => `${BASE()}/notas/${id}/anexos/${encodeURIComponent(nomeArquivo)}`,
  },
};

// --- Folders (section 11.5) -------------------------------------------------

export const pastas = {
  listar: (params: { tipo?: "nota" | "tarefa"; pasta_pai?: string; espaco?: string } = {}) =>
    get<{ subpastas: { caminho: string; nome: string; contagem_itens: number }[]; itens: Record<string, unknown>[] }>(`/pastas${qs(params)}`),
  criar: (payload: { tipo?: "nota" | "tarefa"; pasta_pai?: string; nome: string; espaco?: string }) => post<{ ok: true; caminho: string }>("/pastas", payload),
  renomear: (payload: { tipo?: "nota" | "tarefa"; caminho_atual: string; novo_caminho: string; espaco?: string }) => patch<{ ok: true }>("/pastas", payload),
  excluir: (payload: { tipo?: "nota" | "tarefa"; caminho: string; espaco?: string }) => del<{ ok: true }>("/pastas", payload),
};

// --- Media ---------------------------------------------------------------

export interface Midia { caminho: string; nome: string; tamanho_bytes: number; mime: string; enviado_em: string; /** Biblioteca de mídia a que pertence (`pessoal` ou `equipe:<id>`). O caminho no Markdown não muda. */ espaco?: string }
export interface ItemLixeira { id: string; tipo: "media" | "nota" | "tarefa" | "evento"; nome: string; caminho_original: string; tamanho_bytes: number; mime: string; excluido_em: string }
export const lixeira = {
  listar: () => get<ItemLixeira[]>("/lixeira"),
  restaurar: (id: string) => post<{ ok: true }>(`/lixeira/${encodeURIComponent(id)}/restaurar`),
};

/** Biblioteca global: o mesmo caminho Markdown pode ser usado por qualquer
 * Nota ou Tarefa, sem criar uma nova cópia do arquivo. */
export const media = {
  listar: (espaco?: string) => get<Midia[]>(`/media${qs({ espaco })}`),
  excluir: (caminho: string) => req<{ ok: true }>(media.urlArquivo(caminho).slice(BASE().length), { method: "DELETE" }),
  /** `espaco`: biblioteca de destino (a do item que vai usar o arquivo); sem ele o servidor usa o Pessoal. */
  enviar: async (arquivo: File, espaco?: string) => {
    if (arquivo.size > 120 * 1024 * 1024) throw new ApiError("ARQUIVO_GRANDE", "O arquivo excede 120 MB. Escolha um arquivo menor.", 413);
    if (!arquivo.size) throw new ApiError("ARQUIVO_VAZIO", "O arquivo está vazio. Escolha outro arquivo.", 422);
    const formData = new FormData();
    formData.append("arquivo", arquivo);
    const item = await req<Midia>(`/media${qs({ espaco })}`, { method: "POST", body: formData });
    if (!item?.caminho || !item?.mime) throw new ApiError("RESPOSTA_INESPERADA", "O servidor não confirmou o envio do arquivo. Atualize o servidor Ecos e tente novamente.", 502);
    return item;
  },
  /** Bytes do arquivo, para leitores próprios (PDF) — `<iframe>`/`<embed>` são bloqueados pelo CSP do servidor e do Tauri. */
  baixar: async (caminho: string): Promise<ArrayBuffer> => {
    const accessToken = obterAccessToken();
    let resp: Response;
    try {
      resp = await fetch(media.urlArquivo(caminho), { credentials: "include", headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {} });
    } catch {
      throw new ApiError("CONEXAO_INDISPONIVEL", "Não foi possível conectar ao servidor Ecos.", 0);
    }
    if (!resp.ok) throw new ApiError("ARQUIVO_INDISPONIVEL", "Não foi possível baixar o arquivo.", resp.status);
    return resp.arrayBuffer();
  },
  referencia: (item: Midia) => `${item.mime.startsWith("image/") ? "!" : ""}[${item.nome.replace(/[\\\[\]]/g, "_")}](${item.caminho.split("/").map((p) => encodeURIComponent(p).replace(/[()]/g, (c) => `%${c.charCodeAt(0).toString(16)}`)).join("/")})`,
  urlArquivo: (caminho: string) => `${BASE()}/media/arquivo/${caminho.replace(/^src\/Media\//, "").split("/").map((p) => { try { return encodeURIComponent(decodeURIComponent(p)); } catch { return encodeURIComponent(p); } }).join("/")}`,
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
  /** Última edição; servidores anteriores ao campo não enviam. */
  atualizado_em?: string;
  /** Quando foi concluída (ISO); `null` se pendente. Servidores anteriores ao campo não enviam. */
  concluida_em?: string | null;
  /** Só a listagem traz; servidores anteriores não enviam. */
  pasta?: string | null;
  tags?: string[];
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
  atualizado_em?: string;
  concluida_em?: string | null;
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
  espaco?: string;
  scheduled_at?: string | null;
  duration_min?: number;
  due_date?: string | null;
  corpo?: string;
  tags?: string[];
  prioridade?: PrioridadeTarefa;
  subtarefas?: SubtarefaInput[];
}

export const tarefas = {
  listar: (params: { pasta?: string; data_de?: string; data_ate?: string; concluida_de?: string; concluida_ate?: string; tz?: number; status?: string; espaco?: string; cursor?: string; limit?: number } = {}) => {
    // `pasta=` vazio é o filtro "só as sem pasta" (`COALESCE(pasta_id, '') = ''` no servidor); `qs` descarta vazios, então ele vai à parte.
    const { pasta, ...resto } = params;
    const base = qs(resto);
    const filtroPasta = pasta === undefined ? "" : `${base ? "&" : "?"}pasta=${encodeURIComponent(pasta)}`;
    return get<Pagina<TarefaResumo>>(`/tarefas${base}${filtroPasta}`);
  },
  obter: (id: string) => get<TarefaDetalhe>(`/tarefas/${id}`),
  criar: (payload: CriarTarefaPayload) => post<{ id: string }>("/tarefas", payload),
  atualizar: (id: string, payload: AtualizarTarefaPayload) => patch<{ id: string }>(`/tarefas/${id}`, payload),
  atualizarStatus: (id: string, status: "pendente" | "concluida") => patch<{ id: string; status: string }>(`/tarefas/${id}/status`, { status }),
  timeEntries: {
    listar: (id: string) => get<{ id: string; tipo: "planejado" | "real"; inicio_em: string; fim_em: string | null; duracao_min: number; foco: string; criado_em: string }[]>(`/tarefas/${id}/time-entries`),
    criar: (id: string, payload: { tipo: "planejado" | "real"; inicio_em: string; duracao_min: number; foco?: string }) => post<{ id: string }>(`/tarefas/${id}/time-entries`, payload),
    /** Move/redimensiona um bloco de tempo. Só mexe no bloco: a data da Tarefa nunca muda. */
    atualizar: (id: string, entradaId: string, payload: { inicio_em?: string; duracao_min?: number; foco?: string }) => patch<{ id: string }>(`/tarefas/${id}/time-entries/${entradaId}`, payload),
    excluir: (id: string, entradaId: string) => del<{ ok: true }>(`/tarefas/${id}/time-entries/${entradaId}`),
  },
  excluir: (id: string) => del<{ ok: true }>(`/tarefas/${id}`),
  capacidade: (data: string, tz?: number) =>
    get<{
      data: string;
      total_dia_min: number;
      consumido_rotina_min: number;
      consumido_eventos_externos_min: number;
      consumido_tarefas_min: number;
      disponivel_producao_min: number;
      /** Só servidores novos enviam; antes só havia o restante (zerado quando estourado). */
      disponivel_producao_total_min?: number;
      tempo_livre_min: number;
      estourado: boolean;
    }>(`/agenda/capacidade${qs({ data, tz })}`),
  /** Real multipart upload — `fetch` sets its own `Content-Type` with the
   * boundary when given a `FormData` body, so this bypasses the shared
   * `req()`'s JSON header instead of fighting it. */
  anexos: {
    enviar: async (id: string, arquivo: File) => {
      const formData = new FormData();
      formData.append("arquivo", arquivo);
      return req<{ nome_arquivo: string; url_relativa: string; tamanho_bytes: number; corpo: string }>(`/tarefas/${id}/anexos`, { method: "POST", body: formData });
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

export interface BlocoRotina { id: string; tipo: string; hora_inicio: string; hora_fim: string; dias_semana: string; classificacao: string }
export type BlocoRotinaPayload = Omit<BlocoRotina, "id">;

/** Perfil de Rotina: os blocos (sono, trabalho, refeição…) que a Agenda usa para calcular a capacidade do dia. */
/** Tempo alocado a uma Tarefa num dia/horário do calendário (um "bloco"), com o resumo da Tarefa dona. */
export interface BlocoPlanejado {
  id: string;
  tarefa_id: string;
  tipo: "planejado" | "real";
  /** Instante de início (ISO/UTC). */
  inicio_em: string;
  duracao_min: number;
  foco: string;
  titulo: string;
  status: "pendente" | "concluida";
  prioridade: PrioridadeTarefa;
  tarefa_duration_min: number | null;
}

export const agenda = {
  /** Blocos cujo início cai entre os dois dias (`YYYY-MM-DD`), contados no fuso `tz` (minutos a leste de UTC). */
  blocos: (params: { data_de: string; data_ate: string; tz?: number; tipo?: "planejado" | "real" }) => get<BlocoPlanejado[]>(`/agenda/blocos${qs(params)}`),
};

// --- Eventos & categorias (Ecos <-> Google Calendar) ----------------------

export type EventoVisibilidade = "privado" | "google";
export interface EventoVinculo { id: string; titulo: string }
export interface EventoCategoriaResumo { id: string; nome: string; cor: string; icone: string | null }
/** Uma ocorrência de série que difere do padrão. Só os campos que mudaram vêm preenchidos (o resto é herdado da série). */
export interface ExcecaoEvento {
  /** Início ORIGINAL da ocorrência (a chave). */
  original: string;
  cancelada: boolean;
  titulo: string | null;
  inicio: string | null;
  fim: string | null;
  /** `""` = local apagado só nesta ocorrência. */
  local: string | null;
  descricao: string | null;
  sync_pendente: boolean;
}

export interface Evento {
  id: string;
  titulo: string;
  /** Instantes em UTC (ISO 8601). */
  inicio: string;
  fim: string;
  dia_inteiro: boolean;
  fuso: string | null;
  local: string | null;
  categoria_id: string | null;
  categoria: EventoCategoriaResumo | null;
  /** Cor própria (#RRGGBB), só do Ecos; sem ela vale a da categoria. */
  cor?: string | null;
  visibilidade: EventoVisibilidade;
  /** RRULE da série (`RRULE:FREQ=...`); a lista devolve só o evento mestre. */
  rrule: string | null;
  espaco: string;
  /** Já tem vínculo com um evento do Google. */
  origem_google: boolean;
  /** Mudança local ainda não enviada ao Google. */
  sync_pendente: boolean;
  criado_em: string;
  atualizado_em: string;
  tarefas: EventoVinculo[];
  notas: EventoVinculo[];
  /** Ocorrências alteradas/canceladas da série (vazio em evento simples). */
  excecoes?: ExcecaoEvento[];
  /** EXDATE/RDATE da série. */
  recorrencia_extra?: string[];
  /** Só no detalhe (`obter`, `criar`, `atualizar`). */
  descricao?: string;
}
export interface CategoriaEvento { id: string; espaco: string; nome: string; cor: string; icone: string | null; eventos?: number }
export interface CriarEventoPayload {
  titulo: string;
  inicio: string;
  fim: string;
  dia_inteiro?: boolean;
  fuso?: string | null;
  local?: string | null;
  descricao?: string;
  categoria_id?: string | null;
  /** Cor própria (#RRGGBB); `null` a tira. */
  cor?: string | null;
  visibilidade?: EventoVisibilidade;
  rrule?: string | null;
  /** Ids (o servidor devolve resumos). */
  tarefas?: string[];
  notas?: string[];
  espaco?: string;
}
export type AtualizarEventoPayload = Partial<Omit<CriarEventoPayload, "espaco">>;
/** Muda só uma ocorrência de uma série. `original` é o início que a série previa (a chave). */
export interface AtualizarOcorrenciaPayload {
  original: string;
  titulo?: string;
  inicio?: string;
  fim?: string;
  local?: string | null;
  descricao?: string;
}
export interface TempoPorCategoria {
  total_min: number;
  itens: { categoria_id: string | null; nome: string; cor: string | null; quantidade: number; minutos: number }[];
  /** Séries (RRULE) ainda não expandidas: ficam fora da soma. */
  recorrentes_ignorados: number;
}

export const eventos = {
  listar: (params: { de?: string; ate?: string; categoria?: string; espaco?: string; tarefa?: string; nota?: string; limit?: number } = {}) => get<Evento[]>(`/eventos${qs(params)}`),
  obter: (id: string) => get<Evento>(`/eventos/${id}`),
  criar: (payload: CriarEventoPayload) => post<Evento>("/eventos", payload),
  atualizar: (id: string, payload: AtualizarEventoPayload) => patch<Evento>(`/eventos/${id}`, payload),
  excluir: (id: string) => del<{ ok: true }>(`/eventos/${id}`),
  /** Muda só uma ocorrência da série (no Google vira a exceção daquela instância). A série em si só se muda no Google. */
  atualizarOcorrencia: (id: string, payload: AtualizarOcorrenciaPayload) => patch<Evento>(`/eventos/${id}/ocorrencias`, payload),
  /** Cancela só uma ocorrência da série. */
  cancelarOcorrencia: (id: string, original: string) => del<Evento>(`/eventos/${id}/ocorrencias${qs({ original })}`),
  /** Substitui os vínculos com Tarefas e Notas (só do Ecos: nunca vão ao Google). */
  definirVinculos: (id: string, vinculos: { tarefas: string[]; notas: string[] }) => put<Evento>(`/eventos/${id}/vinculos`, vinculos),
  daTarefa: (id: string) => get<Evento[]>(`/tarefas/${id}/eventos`),
  daNota: (id: string) => get<Evento[]>(`/notas/${id}/eventos`),
  tempo: (params: { de: string; ate: string; espaco?: string; tarefa?: string }) => get<TempoPorCategoria>(`/eventos/tempo${qs(params)}`),
  categorias: {
    listar: (params: { espaco?: string } = {}) => get<CategoriaEvento[]>(`/eventos/categorias${qs(params)}`),
    criar: (payload: { nome: string; cor: string; icone?: string | null; espaco?: string }) => post<CategoriaEvento>("/eventos/categorias", payload),
    atualizar: (id: string, payload: { nome?: string; cor?: string; icone?: string | null }) => patch<CategoriaEvento>(`/eventos/categorias/${id}`, payload),
    excluir: (id: string) => del<{ ok: true; eventos_afetados: number }>(`/eventos/categorias/${id}`),
  },
};

// --- Calendário externo (Google Calendar) ----------------------------------

export interface CalendarioConectado {
  provider: string;
  conectado_em: string;
  email: string | null;
  ultima_sync_em: string | null;
  ultimo_erro: string | null;
  /** O Google revogou ou expirou o acesso: só reconectando. */
  precisa_reconectar: boolean;
}
export interface ResumoSyncCalendario {
  criados: number;
  atualizados: number;
  removidos: number;
  inalterados: number;
  /** Edição local pendente e mais nova que a do Google: foi mantida. */
  conflitos_mantidos_locais: number;
  excecoes_ignoradas: number;
  completa: boolean;
  /** Ecos → Google (opcionais: servidores anteriores ao envio não mandam). */
  enviados_criados?: number;
  enviados_atualizados?: number;
  /** Apagados no Google (excluídos ou tornados privados no Ecos). */
  removidos_no_google?: number;
  /** Mudaram no Google desde a última leitura: o próximo ciclo decide pelo mais recente. */
  envios_adiados?: number;
  /** Recusados pelo Google: continuam pendentes. */
  envios_com_erro?: number;
}

export const calendario = {
  config: () => get<{ conectados: CalendarioConectado[]; google_configurado: boolean }>("/calendario/config"),
  /** URL de autorização do Google (abrir no navegador). Exige abrir o Ecos por localhost/127.0.0.1. */
  conectar: (provider: "google") => get<{ url: string }>(`/calendario/conectar/${provider}`),
  sincronizar: () => post<ResumoSyncCalendario>("/calendario/sincronizar"),
  /** Os eventos ficam no Ecos, privados e sem vínculo; só a conexão some. */
  desconectar: (provider: "google") => del<{ ok: true }>(`/calendario/${provider}`),
};

export const rotina = {
  listar: () => get<BlocoRotina[]>("/rotina/blocos"),
  criar: (payload: BlocoRotinaPayload) => post<{ id: string }>("/rotina/blocos", payload),
  atualizar: (id: string, payload: BlocoRotinaPayload) => patch<{ id: string }>(`/rotina/blocos/${id}`, payload),
  excluir: (id: string) => del<{ ok: true }>(`/rotina/blocos/${id}`),
};

export const equipes = {
  listarMinhas: () => get<{ id: string; nome: string; cargo: string }[]>("/equipes"),
  criar: (nome: string) => post<{ id: string }>("/equipes", { nome }),
  obter: (id: string) => get<{ id: string; nome: string; estatisticas: { notas: number; tarefas: number } }>(`/equipes/${id}`),
  atualizar: (id: string, nome: string) => patch<{ ok: true }>(`/equipes/${id}`, { nome }),
  // A frase que o servidor exige (seção 5.4) é fixa; quem confirma digitando o nome da equipe faz isso na interface.
  excluir: (id: string) => del<{ ok: true }>(`/equipes/${id}`, { confirm: "EXCLUIR EQUIPE" }),
  listarMembros: (id: string) => get<{ usuario_id: string; cargo: string; nome?: string }[]>(`/equipes/${id}/membros`),
  trocarCargo: (id: string, usuarioId: string, cargo: "dono" | "admin" | "membro") =>
    patch<{ ok: true }>(`/equipes/${id}/membros/${usuarioId}`, { cargo }),
  removerMembro: (id: string, usuarioId: string) => del<{ ok: true }>(`/equipes/${id}/membros/${usuarioId}`),
  sair: (id: string) => post<{ ok: true }>(`/equipes/${id}/sair`),
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

/** Matches `FORMAS_PAGAMENTO` in `app/vault/src/routes/transacoes.rs` — a closed enum, not free text. */
export const FORMAS_PAGAMENTO = ["pix", "pix_automatico", "ted", "cartao", "dinheiro", "boleto", "outro"] as const;
export type FormaPagamento = (typeof FORMAS_PAGAMENTO)[number];

export const vault = {
  /** Apaga todas as transações, categorias e contas. O servidor tira um backup de segurança antes. */
  resetar: () => post<{ ok: true; backup_de_seguranca: string | null }>("/vault/reset", { confirm: "APAGAR TUDO" }),
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
