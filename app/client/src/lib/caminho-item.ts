import { avisar } from "./toast";

export type TipoItemCaminho = "nota" | "tarefa" | "evento";

/** Árvore única: nota e tarefa moram direto nas pastas do espaço; só evento tem uma área própria. */
const RAIZ: Record<TipoItemCaminho, string | null> = { nota: null, tarefa: null, evento: "Eventos" };

/**
 * A pasta de uma nota/tarefa a partir do caminho do arquivo (`Espaço/Pasta/Sub/note-X.md`): o trecho entre o espaço e o
 * nome. Caminho do layout antigo (`Espaço/Notas/Pasta/...`) também funciona.
 */
export function pastaDoArquivo(caminhoArquivo: string): string | null {
  const partes = caminhoArquivo.split("\\").join("/").split("/").filter(Boolean);
  const legado = partes[1] === "Notas" || partes[1] === "Tarefas";
  return partes.slice(legado ? 2 : 1, -1).join("/") || null;
}

/** Nome antigo, mantido para quem já importa. */
export const pastaDoArquivoDeNota = pastaDoArquivo;

export interface EntradaCaminho {
  tipo: TipoItemCaminho;
  /** `pessoal` ou `equipe:<id>`. */
  espaco?: string | null;
  equipes?: { id: string; nome: string }[];
  /** Pasta com subpastas separadas por `/`; evento não tem. */
  pasta?: string | null;
  titulo: string;
}

/** Caminho lógico no app: `Pessoal / Pasta / Subpasta / Título` (evento: `Pessoal / Eventos / Título`). */
export function caminhoDoItem({ tipo, espaco, equipes = [], pasta, titulo }: EntradaCaminho): string {
  const nomeEspaco = !espaco || espaco === "pessoal" ? "Pessoal" : equipes.find((e) => `equipe:${e.id}` === espaco)?.nome ?? "Equipe";
  const pastas = tipo === "evento" ? [] : (pasta ?? "").split("/").filter(Boolean);
  return [nomeEspaco, RAIZ[tipo], ...pastas, titulo.trim() || "Sem título"].filter((p): p is string => !!p).join(" / ");
}

export async function copiarCaminho(entrada: EntradaCaminho): Promise<void> {
  try {
    await navigator.clipboard.writeText(caminhoDoItem(entrada));
    avisar("Caminho copiado.", "sucesso");
  } catch {
    avisar("Não foi possível copiar o caminho. Permita o acesso à área de transferência e tente de novo.", "erro");
  }
}
