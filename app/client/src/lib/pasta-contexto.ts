/** A pasta em que a pessoa está navegando — usada como pasta padrão ao criar Tarefa ou Nota. */
export interface PastaContexto {
  tipo: "nota" | "tarefa";
  pasta: string;
}

/** Codifica cada nome sem esconder as barras, para o roteador preservar qualquer profundidade. */
export function caminhoPastaNaRota(caminho: string): string {
  return caminho.split("/").map(encodeURIComponent).join("/");
}

/** `/tarefas/pasta/<caminho>` e `/notas/pasta/<caminho>`; `/pasta/nova` e qualquer outra rota não contam. */
export function pastaDoCaminho(caminho: string): PastaContexto | null {
  const m = /^\/(notas|tarefas)\/pasta\/(.+?)(?:[?#]|$)/.exec(caminho);
  if (!m || m[2] === "nova") return null;
  try {
    return { tipo: m[1] === "notas" ? "nota" : "tarefa", pasta: m[2].split("/").map(decodeURIComponent).join("/") };
  } catch {
    return null;
  }
}
