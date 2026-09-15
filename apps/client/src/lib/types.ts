/**
 * Tipos do domínio Ecos, no formato que a UI consome.
 *
 * Espelham o modelo de dados real (`ecos-arquitetura-tecnica.md`, seção 1),
 * mas simplificados pro contrato de tela — a integração real (ver seção 5
 * do prompt de execução) troca `src/lib/mock-data.ts` por chamadas HTTP
 * reais a `ecos-app`/`ecos-vault-db`, mantendo estes tipos como o shape
 * esperado pela UI.
 */

export type Espaco = "pessoal" | `equipe:${string}`;

export type MotivoRanking = "frescor" | "orfa" | "interacao" | "esquecimento";

export interface Equipe {
  id: string;
  nome: string;
  cor: string; // hex — cor de identidade da Equipe (avatar, borda de pasta, tag)
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

export interface Nota {
  tipo: "nota";
  id: string;
  titulo: string;
  preview: string;
  modo: "texto" | "pagina";
  tags: string[];
  pastaId: string | null;
  espaco: Espaco;
  origemEquipe?: { nome: string; cor: string; avatarUrl?: string };
  criadoEm: string;
  atualizadoEm: string;
  ultimaRevisaoEm: string | null;
  contagemLinksEntrada: number;
  motivoRanking: MotivoRanking;
  diasOrfa?: number;
}

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
  encaixadaNaAgenda: boolean;
}

export type FeedItem = Nota | Tarefa;

export type CategoriaTransacaoTipo = "entrada" | "saida" | "ambos";

export interface CategoriaTransacao {
  id: string;
  nome: string;
  tipo: CategoriaTransacaoTipo;
  icone: string; // nome do ícone lucide-react
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
