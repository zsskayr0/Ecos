/**
 * Ecos domain types, in the shape the UI consumes.
 *
 * Mirror the real data model (`ecos-arquitetura-tecnica.md`, section 1),
 * but simplified for the screen contract — the real integration (see
 * section 5 of the execution prompt) swaps `src/lib/mock-data.ts` for real
 * HTTP calls to `ecos-app`/`ecos-vault-db`, keeping these types as the
 * shape the UI expects.
 */

export type Espaco = "pessoal" | `equipe:${string}`;

export type MotivoRanking = "frescor" | "orfa" | "interacao" | "esquecimento";

export interface Equipe {
  id: string;
  nome: string;
  cor: string; // hex — Team identity color (avatar, folder border, tag)
  contagemMembros: number;
  contagemNotas: number;
  contagemTarefas: number;
  contagemPastas: number;
}

export type Cargo = "dono" | "admin" | "membro";

export interface Membro {
  usuarioId: string;
  nome: string;
  handle: string;
  avatarUrl?: string;
  cargo: Cargo;
}

export interface Usuario {
  id: string;
  nome: string;
  handle: string;
  bio?: string;
  avatarUrl?: string;
  equipes: { equipe: Equipe; cargo: Cargo }[];
}

/** Who created the item — always the sole local user for `espaco: pessoal`;
 * a real per-item author for `espaco: equipe:*` (user feedback: "no feed,
 * deve ter a foto de perfil e o nome do dono daquele item"). */
export interface Dono {
  id: string | null;
  nome: string;
}

export interface Nota {
  tipo: "nota";
  corpo?: string;
  id: string;
  titulo: string;
  preview: string;
  modo: "texto" | "pagina";
  tags: string[];
  pastaId: string | null;
  espaco: Espaco;
  origemEquipe?: { nome: string; cor: string; avatarUrl?: string };
  dono: Dono;
  criadoEm: string;
  atualizadoEm: string;
  ultimaRevisaoEm: string | null;
  contagemLinksEntrada: number;
  motivoRanking: MotivoRanking;
  diasOrfa?: number;
}

export type PrioridadeTarefa = "baixa" | "media" | "alta";

export interface Tarefa {
  tipo: "tarefa";
  id: string;
  titulo: string;
  status: "pendente" | "concluida";
  scheduledAt: string | null;
  durationMin: number;
  dueDate: string | null;
  espaco: Espaco;
  origemEquipe?: { nome: string; cor: string; avatarUrl?: string };
  dono: Dono;
  encaixadaNaAgenda: boolean;
  prioridade: PrioridadeTarefa;
  /** Última edição (o servidor cai pra data de criação em tarefas nunca editadas). */
  atualizadoEm?: string;
  criadoEm?: string;
  /** Pasta e tags só vêm da listagem de tarefas (o feed não as traz). */
  pasta?: string | null;
  tags?: string[];
}

export type FeedItem = Nota | Tarefa;

export type CategoriaTransacaoTipo = "entrada" | "saida" | "ambos";

export interface CategoriaTransacao {
  id: string;
  nome: string;
  tipo: CategoriaTransacaoTipo;
  icone: string; // lucide-react icon name
  cor: string;
}

export interface Conta {
  id: string;
  nome: string;
  banco: string | null;
  cor: string;
}

export interface Transacao {
  id: string;
  tipo: "entrada" | "saida";
  valorCentavos: number;
  moeda: "BRL";
  data: string;
  descricao: string;
  categoria: CategoriaTransacao;
  conta: Conta;
  status: "efetivada" | "pendente";
  espaco: Espaco;
}

export type TipoBlocoAgenda = "tarefa" | "pagamento_previsto" | "nota_com_prazo";

export interface TimeBlock {
  id: string;
  tipo: TipoBlocoAgenda;
  titulo: string;
  horaInicio: string; // 'HH:MM'
  durationMin: number;
  espaco: Espaco;
}

export type CategoriaNotificacao = "cofre" | "agenda" | "equipes";

export interface Notificacao {
  id: string;
  categoria: CategoriaNotificacao;
  titulo: string;
  corpo: string;
  lida: boolean;
  criadoEm: string;
}

export interface Pasta {
  id: string;
  caminho: string;
  nome: string;
  tipo: "nota" | "tarefa";
  espaco: Espaco;
  contagemItens: number;
  cor: string;
}
