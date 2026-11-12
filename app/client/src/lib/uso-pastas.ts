/**
 * Quantas vezes cada pasta foi aberta neste aparelho, para a ordem "Mais usadas" (Configurações › Aparência).
 * Só local: não sincroniza e não sobe ao servidor.
 */
const CHAVE = "ecos:pastas-uso:v1";

interface Uso { n: number; ultimo: number }

function ler(): Record<string, Uso> {
  try {
    const bruto = JSON.parse(localStorage.getItem(CHAVE) ?? "null");
    return bruto && typeof bruto === "object" ? bruto : {};
  } catch { return {}; }
}

export function registrarUsoPasta(caminho: string): void {
  try {
    const todos = ler();
    const atual = todos[caminho] ?? { n: 0, ultimo: 0 };
    todos[caminho] = { n: atual.n + 1, ultimo: Date.now() };
    localStorage.setItem(CHAVE, JSON.stringify(todos));
  } catch { /* sem armazenamento: a ordem por uso só não aprende */ }
}

/** Mais aberta primeiro; empate: a aberta mais recentemente. */
export function compararPorUso(a: string, b: string, todos: Record<string, Uso> = ler()): number {
  const ua = todos[a] ?? { n: 0, ultimo: 0 };
  const ub = todos[b] ?? { n: 0, ultimo: 0 };
  return ub.n - ua.n || ub.ultimo - ua.ultimo;
}

export function lerUsoPastas(): Record<string, Uso> { return ler(); }
