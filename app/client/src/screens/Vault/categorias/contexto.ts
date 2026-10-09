import type { CategoriaApi } from "@/lib/api";
import type { Familia, Uso } from "./dados";

export type NomeVista = "grade" | "lista" | "tabela" | "kanban" | "mapa" | "nuvem";
export const VISTAS: { id: NomeVista; rotulo: string }[] = [
  { id: "grade", rotulo: "Grade" },
  { id: "lista", rotulo: "Lista" },
  { id: "tabela", rotulo: "Tabela" },
  { id: "kanban", rotulo: "Kanban" },
  { id: "mapa", rotulo: "Mapa de blocos" },
  { id: "nuvem", rotulo: "Nuvem" },
];

export type CamposEditaveis = Partial<{ nome: string; tipo: CategoriaApi["tipo"]; pai_id: string | null }>;

/** Tudo que uma vista precisa para mostrar e mexer nas categorias. */
export interface ContextoVista {
  familias: Familia[];
  usos: Map<string, Uso>;
  porId: Map<string, CategoriaApi>;
  /** Todas as categorias cadastradas (sem filtro), para listar mães possíveis. */
  todas: CategoriaApi[];
  volumeTotal: number;
  mostrarSubs: boolean;
  /** Abre o painel de detalhe da categoria. */
  abrir: (c: CategoriaApi) => void;
  /** Abre o modal de edição. */
  editar: (c: CategoriaApi) => void;
  selecao: { marcadas: Set<string>; alternar: (id: string) => void; definir: (ids: string[]) => void; ativa: boolean };
  /** Volume mensal (últimos meses) por categoria; `null` enquanto carrega. */
  tendencia: Map<string, number[]> | null;
  meses: string[];
  novaSub: (mae: CategoriaApi) => void;
  /** Reordenar por arrasto está liberado (ordem manual e sem filtro). */
  ordenavel: boolean;
  ordem: {
    /** Props do alvo de soltura; só aceita irmãos do mesmo nível (principal com principal, filha com filha). */
    linha: (id: string, eixo?: "x" | "y") => Record<string, unknown>;
    alca: (id: string) => Record<string, unknown>;
  };
  /** Grava campos da categoria e recarrega; mostra o erro do servidor num aviso. */
  salvar: (c: CategoriaApi, campos: CamposEditaveis) => Promise<boolean>;
}
