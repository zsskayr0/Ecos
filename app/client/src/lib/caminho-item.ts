import { avisar } from "./toast";

export type TipoItemCaminho = "nota" | "tarefa" | "evento";

const RAIZ: Record<TipoItemCaminho, string> = { nota: "Notas", tarefa: "Tarefas", evento: "Eventos" };

/** O caminho de uma Nota às vezes vem do arquivo: a pasta é o trecho entre `Notas/` e o nome do arquivo. */
export function pastaDoArquivoDeNota(caminhoArquivo: string): string | null {
  const partes = caminhoArquivo.split("/");
  const i = partes.indexOf("Notas");
  if (i === -1) return null;
  return partes.slice(i + 1, -1).join("/") || null;
}

export interface EntradaCaminho {
  tipo: TipoItemCaminho;
  /** `pessoal` ou `equipe:<id>`. */
  espaco?: string | null;
  equipes?: { id: string; nome: string }[];
  /** Pasta com subpastas separadas por `/`; evento não tem. */
  pasta?: string | null;
  titulo: string;
}

/** Caminho lógico no app: `Pessoal / Notas / Pasta / Subpasta / Título`. */
export function caminhoDoItem({ tipo, espaco, equipes = [], pasta, titulo }: EntradaCaminho): string {
  const nomeEspaco = !espaco || espaco === "pessoal" ? "Pessoal" : equipes.find((e) => `equipe:${e.id}` === espaco)?.nome ?? "Equipe";
  const pastas = tipo === "evento" ? [] : (pasta ?? "").split("/").filter(Boolean);
  return [nomeEspaco, RAIZ[tipo], ...pastas, titulo.trim() || "Sem título"].join(" / ");
}

export async function copiarCaminho(entrada: EntradaCaminho): Promise<void> {
  try {
    await navigator.clipboard.writeText(caminhoDoItem(entrada));
    avisar("Caminho copiado.", "sucesso");
  } catch {
    avisar("Não foi possível copiar o caminho. Permita o acesso à área de transferência e tente de novo.", "erro");
  }
}
