import { notificacoes } from "@/lib/api";

/**
 * Push no app Android pelo UnifiedPush (`window.EcosPush`, ver android-overrides/PushBridge.kt). Fora do app
 * Android a ponte não existe e tudo aqui vira no-op.
 *
 * O distribuidor (ntfy etc.) entrega o endereço ao aparelho a qualquer hora, mesmo com o app fechado; só o front
 * tem a sessão para mandá-lo ao servidor, então `sincronizarEndereco` compara com o último enviado e envia quando
 * muda (na abertura, ao voltar para a frente e no evento `ecos:push-endpoint`).
 */
interface PonteBruta {
  estado(): string;
  distribuidores(): string;
  registrar(pacote: string): void;
  desligar(): void;
  avisoPendente(): string;
}

export interface EstadoPush { distribuidor: string | null; endpoint: string | null; instalacao: string; permissao: boolean }
export interface Distribuidor { pacote: string; nome: string }

const CHAVE_ENVIADO = "ecos.push.enviado.v1";

function ponte(): PonteBruta | null {
  return (window as unknown as { EcosPush?: PonteBruta }).EcosPush ?? null;
}

export const temPushNoCelular = () => ponte() !== null;

export function estadoPush(): EstadoPush | null {
  const p = ponte();
  if (!p) return null;
  try { return JSON.parse(p.estado()) as EstadoPush; } catch { return null; }
}

export function distribuidores(): Distribuidor[] {
  const p = ponte();
  if (!p) return [];
  try { return JSON.parse(p.distribuidores()) as Distribuidor[]; } catch { return []; }
}

export function ligarPush(pacote: string) { ponte()?.registrar(pacote); }
export function desligarPush() { ponte()?.desligar(); }

/** Pedido de abrir um aviso tocado na barra do Android (uma vez). */
export function avisoTocado(): { id: string; url: string | null } | null {
  const p = ponte();
  if (!p) return null;
  try { const bruto = p.avisoPendente(); return bruto ? JSON.parse(bruto) : null; } catch { return null; }
}

function nomeDoAparelho(): string {
  const m = /Android[^;)]*;\s*([^;)]+?)(?:\s+Build|\))/.exec(navigator.userAgent);
  return (m?.[1] ?? "Celular").trim().slice(0, 60);
}

let enviando: Promise<void> | null = null;

/** Manda ao servidor o endereço atual do aparelho, se mudou desde o último envio. Falha fica para a próxima vez. */
export function sincronizarEndereco(): Promise<void> {
  const estado = estadoPush();
  if (!estado) return Promise.resolve();
  const atual = estado.endpoint ?? "";
  let enviado: string | null = null;
  try { enviado = localStorage.getItem(CHAVE_ENVIADO); } catch { /* sem armazenamento: envia sempre */ }
  // Nunca ligado neste aparelho: não há o que avisar ao servidor.
  if (enviado === atual || (enviado === null && !atual)) return Promise.resolve();
  if (enviando) return enviando;
  enviando = notificacoes
    .registrarAparelho({ instalacao: estado.instalacao, nome: nomeDoAparelho(), push_endpoint: atual || null })
    .then(() => { try { localStorage.setItem(CHAVE_ENVIADO, atual); } catch { /* tenta de novo depois */ } })
    .catch(() => { /* sem conexão ou sessão: tenta na próxima abertura */ })
    .finally(() => { enviando = null; });
  return enviando;
}
