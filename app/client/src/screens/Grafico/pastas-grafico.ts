import { pastas, type GraficoDados } from "@/lib/api";

/**
 * Servidores anteriores aos metadados do gráfico não enviam o caminho do nó.
 * O índice de pastas já expõe a árvore e os IDs diretos de cada pasta: usamos
 * esses dados para recuperar a posição sem alterar o servidor em execução.
 */
export async function completarPastasDoGrafico(dados: GraficoDados, listar = pastas.listar): Promise<GraficoDados> {
  const faltantes = dados.nos.filter((n) => (n.tipo === "nota" || n.tipo === "tarefa") && !n.caminho);
  if (!faltantes.length) return dados;
  const ids = new Set(faltantes.map((n) => n.id));
  const espacos = [...new Set(faltantes.map((n) => n.espaco).filter((e): e is string => !!e))];
  const destinos = new Map<string, string>();
  const trabalhos: { tipo: "nota" | "tarefa"; espaco: string; pasta: string }[] = [];

  for (const espaco of espacos) for (const tipo of ["nota", "tarefa"] as const) {
    const arvore = await listar({ tipo, espaco, recursivo: true });
    for (const pasta of arvore.subpastas) trabalhos.push({ tipo, espaco, pasta: pasta.caminho });
  }

  // Consulta cada pasta uma vez e limita a simultaneidade para não sobrecarregar a API.
  for (let i = 0; i < trabalhos.length; i += 8) {
    await Promise.all(trabalhos.slice(i, i + 8).map(async ({ tipo, espaco, pasta }) => {
      const resposta = await listar({ tipo, espaco, pasta_pai: pasta });
      for (const item of resposta.itens) if (typeof item.id === "string" && ids.has(item.id)) destinos.set(item.id, pasta);
    }));
  }

  return { ...dados, nos: dados.nos.map((n) => ids.has(n.id) ? { ...n, pasta: destinos.get(n.id) ?? null } : n) };
}
