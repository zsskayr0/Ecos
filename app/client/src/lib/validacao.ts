/**
 * Regras de credenciais espelhando `crates/ecos-core/src/credenciais.rs`, para avisar sob o campo antes de enviar.
 * O servidor continua sendo a autoridade (lista de senhas comuns e nomes reservados ficam só lá, e o erro dele
 * volta mapeado em `lib/erros.ts`). Tamanhos contam caracteres, como no servidor.
 */
export const USUARIO_MIN = 3;
export const USUARIO_MAX = 32;
export const SENHA_MIN = 12;
export const SENHA_MAX = 128;

const tamanho = (s: string) => Array.from(s).length;

export function validarNomeUsuario(nome: string): string | null {
  const n = tamanho(nome);
  if (n < USUARIO_MIN || n > USUARIO_MAX) return `Use de ${USUARIO_MIN} a ${USUARIO_MAX} caracteres.`;
  if (!/^[A-Za-z0-9._-]+$/.test(nome)) return "Use só letras (sem acento), números, ponto, hífen e sublinhado, sem espaços.";
  if (!/^[A-Za-z0-9]/.test(nome) || !/[A-Za-z0-9]$/.test(nome)) return "Comece e termine com letra ou número.";
  if (/[._-]{2}/.test(nome)) return "Não use dois separadores seguidos (.., .-, __).";
  return null;
}

function eSequencia(s: string): boolean {
  const cs = Array.from(s).map((c) => c.codePointAt(0) ?? 0);
  if (cs.length > 1) {
    const pares = cs.slice(1).map((c, i) => [cs[i], c]);
    if (pares.every(([a, b]) => b === a + 1) || pares.every(([a, b]) => a === b + 1)) return true;
  }
  if (/^[0-9]+$/.test(s) && s.length > 1) {
    const d = Array.from(s).map(Number);
    const pares = d.slice(1).map((c, i) => [d[i], c]);
    return pares.every(([a, b]) => b === (a + 1) % 10) || pares.every(([a, b]) => a === (b + 1) % 10);
  }
  return false;
}

export function validarSenhaNova(senha: string, nomeUsuario?: string): string | null {
  const n = tamanho(senha);
  if (n < SENHA_MIN) return `A senha precisa de pelo menos ${SENHA_MIN} caracteres.`;
  if (n > SENHA_MAX) return `A senha pode ter no máximo ${SENHA_MAX} caracteres.`;
  if (/\s/.test(senha)) return "A senha não pode ter espaços.";
  if (new Set(Array.from(senha)).size < 5 || eSequencia(senha)) return "Senha previsível demais (repetição ou sequência). Misture caracteres diferentes.";
  if (/^[0-9]+$/.test(senha) && n < 16) return "Só números é fraco demais. Misture letras e símbolos, ou use 16 dígitos ou mais.";
  const usuario = nomeUsuario?.toLowerCase();
  if (usuario && tamanho(usuario) >= 3 && senha.toLowerCase().includes(usuario)) return "A senha não pode conter o seu nome de usuário.";
  return null;
}
