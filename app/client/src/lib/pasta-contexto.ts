/** A pasta em que a pessoa está navegando — usada como pasta padrão ao criar Tarefa ou Nota. */
export interface PastaContexto {
  tipo: "nota" | "tarefa";
  pasta: string;
}

/** `/tarefas/pasta/<caminho>` e `/notas/pasta/<caminho>` (caminho codificado); `/pasta/nova` e qualquer outra rota não contam. */
export function pastaDoCaminho(caminho: string): PastaContexto | null {
  const m = /^\/(notas|tarefas)\/pasta\/([^/?#]+)/.exec(caminho);
  if (!m || m[2] === "nova") return null;
  try {
    return { tipo: m[1] === "notas" ? "nota" : "tarefa", pasta: decodeURIComponent(m[2]) };
  } catch {
    return null;
  }
}
