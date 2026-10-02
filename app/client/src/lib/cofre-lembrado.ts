import { invoke } from "@tauri-apps/api/core";
import { estaNoTauri, obterServidorBaseUrl } from "./server-config";

/**
 * "Lembrar a senha do Cofre neste computador" (só Windows, pelo Gerenciador de Credenciais — ver `cofre_senha_*` em
 * `src-tauri/src/lib.rs`). O servidor nunca guarda a chave do Cofre; sem isto, cada reinício dele (toda atualização)
 * tranca o Cofre e a pessoa precisa digitar a senha de novo. É opt-in, por Cofre (pessoal ou equipe) e por conta.
 *
 * Fora do app nativo, ou em sistemas sem armazenamento seguro, tudo aqui vira "não lembrado" e nada é gravado.
 */

/** Identifica servidor + conta + espaço; contas e Cofres diferentes no mesmo computador nunca se misturam. */
export function chaveDoCofre(usuarioId: string, espaco: string): string | null {
  const servidor = obterServidorBaseUrl();
  if (!servidor || !usuarioId) return null;
  return `${servidor.replace(/\/+$/, "")}|${usuarioId}|${espaco}`;
}

async function comando<T>(nome: string, args?: Record<string, unknown>): Promise<T | null> {
  if (!estaNoTauri()) return null;
  try {
    return await invoke<T>(nome, args);
  } catch {
    return null;
  }
}

let suportada: Promise<boolean> | null = null;

/** O sistema tem onde guardar a senha com segurança? (Windows, no app nativo.) */
export function lembrarSenhaSuportado(): Promise<boolean> {
  suportada ??= comando<boolean>("cofre_senha_suportada").then((v) => v === true);
  return suportada;
}

/** `true` se a senha foi guardada. Nunca lança: se não deu, a pessoa só continua digitando a senha. */
export async function lembrarSenha(chave: string, senha: string): Promise<boolean> {
  if (!(await lembrarSenhaSuportado())) return false;
  const r = await comando<null>("cofre_senha_salvar", { chave, senha });
  return r === null && (await temSenhaLembrada(chave));
}

export async function temSenhaLembrada(chave: string): Promise<boolean> {
  return (await comando<boolean>("cofre_senha_tem", { chave })) === true;
}

/** A senha vai do Gerenciador de Credenciais direto para o desbloqueio; quem chama não deve guardá-la. */
export async function lerSenhaLembrada(chave: string): Promise<string | null> {
  return (await comando<string | null>("cofre_senha_ler", { chave })) ?? null;
}

export async function esquecerSenha(chave: string): Promise<void> {
  await comando("cofre_senha_esquecer", { chave });
}

// ---- Bloqueio manual -------------------------------------------------------------------------------------------
// "Bloquear" tem de bloquear de verdade: depois dele o Cofre só abre com a senha digitada, mesmo com a senha lembrada.
// O marcador fica no armazenamento local (sobrevive a fechar o app) e some quando a pessoa desbloqueia à mão.

const PREFIXO_MANUAL = "ecos.cofre.bloqueio-manual:";

export function bloqueioManual(chave: string): boolean {
  try { return window.localStorage.getItem(PREFIXO_MANUAL + chave) === "1"; } catch { return false; }
}

export function marcarBloqueioManual(chave: string) {
  try { window.localStorage.setItem(PREFIXO_MANUAL + chave, "1"); } catch { /* sem armazenamento: o app pergunta a senha de novo de qualquer forma */ }
}

export function limparBloqueioManual(chave: string) {
  try { window.localStorage.removeItem(PREFIXO_MANUAL + chave); } catch { /* idem */ }
}

/** Ao sair da conta do Ecos, nenhuma senha de Cofre dela fica neste computador. */
export async function esquecerSenhasDaConta(usuarioId: string, espacos: string[]): Promise<void> {
  for (const espaco of espacos) {
    const chave = chaveDoCofre(usuarioId, espaco);
    if (!chave) continue;
    limparBloqueioManual(chave);
    await esquecerSenha(chave);
  }
}
