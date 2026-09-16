/**
 * Mocked data — the real integration already exists (`src/lib/api.ts`,
 * against the real `ecos-app`/`ecos-vault-db`). This file survives only
 * for Onboarding (`src/screens/Onboarding/OnboardingScreen.tsx`), which
 * needs decorative content for its slide mini-visualizations without
 * depending on network/session — no other screen should import from here
 * again.
 */
import type {
  CategoriaTransacao,
  Conta,
  Equipe,
  FeedItem,
  Nota,
  Notificacao,
  Pasta,
  Tarefa,
  TimeBlock,
  Transacao,
  Usuario,
} from "./types";

const horasAtras = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const diasAtras = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();

export const equipeFamilia: Equipe = {
  id: "eq-familia",
  nome: "Família",
  cor: "#5B8FC7",
  contagemMembros: 4,
  contagemNotas: 12,
  contagemTarefas: 5,
  contagemPastas: 3,
};

export const equipeTrabalho: Equipe = {
  id: "eq-trabalho",
  nome: "Squad Orion",
  cor: "#7DD3FC",
  contagemMembros: 6,
  contagemNotas: 34,
  contagemTarefas: 18,
  contagemPastas: 5,
};

export const equipes: Equipe[] = [equipeFamilia, equipeTrabalho];

export const usuarioAtual: Usuario = {
  id: "user-1",
  nome: "Diogo Roque",
  handle: "@diogoroque",
  bio: "Anotando tudo desde que o WhatsApp virou minha segunda memória.",
  equipes: [
    { equipe: equipeFamilia, cargo: "admin" },
    { equipe: equipeTrabalho, cargo: "membro" },
  ],
};

export const membrosEquipeTrabalho = [
  { usuarioId: "user-1", nome: "Diogo Roque", handle: "@diogoroque", cargo: "membro" as const },
  { usuarioId: "user-2", nome: "Carla Nunes", handle: "@carlanunes", cargo: "dono" as const },
  { usuarioId: "user-3", nome: "Bruno Silva", handle: "@brunosilva", cargo: "admin" as const },
  { usuarioId: "user-4", nome: "Ivi Tanaka", handle: "@ivitanaka", cargo: "membro" as const },
  { usuarioId: "user-5", nome: "Rafa Costa", handle: "@rafacosta", cargo: "membro" as const },
  { usuarioId: "user-6", nome: "Sol Andrade", handle: "@solandrade", cargo: "membro" as const },
];

export const notas: Nota[] = [
  {
    tipo: "nota",
    id: "n1",
    titulo: "Ideia: dashboard de capacidade semanal",
    preview:
      "E se a Agenda mostrasse quantas horas sobraram na semana antes de eu me comprometer com mais uma call...",
    modo: "texto",
    tags: ["produto", "ideia"],
    pastaId: "p-ideias",
    espaco: "pessoal",
    dono: { id: usuarioAtual.id, nome: usuarioAtual.nome },
    criadoEm: horasAtras(2),
    atualizadoEm: horasAtras(2),
    ultimaRevisaoEm: null,
    contagemLinksEntrada: 3,
    motivoRanking: "frescor",
  },
  {
    tipo: "nota",
    id: "n2",
    titulo: "Ata — alinhamento de sprint",
    preview: "Decidido: adiar migração do índice pra depois do sync LAN. [[Roadmap Q4]] atualizado.",
    modo: "texto",
    tags: ["squad-orion"],
    pastaId: "p-trabalho",
    espaco: "equipe:eq-trabalho",
    origemEquipe: { nome: "Squad Orion", cor: equipeTrabalho.cor },
    dono: { id: "user-2", nome: "Carla Nunes" },
    criadoEm: horasAtras(5),
    atualizadoEm: horasAtras(1),
    ultimaRevisaoEm: horasAtras(1),
    contagemLinksEntrada: 6,
    motivoRanking: "interacao",
  },
  {
    tipo: "nota",
    id: "n3",
    titulo: "Receita da vó — bolo de fubá",
    preview: "3 ovos, 1 xícara de fubá, 2 de açúcar... (nunca mais lembro da proporção do leite)",
    modo: "texto",
    tags: ["receitas"],
    pastaId: "p-familia",
    espaco: "equipe:eq-familia",
    origemEquipe: { nome: "Família", cor: equipeFamilia.cor },
    dono: { id: usuarioAtual.id, nome: usuarioAtual.nome },
    criadoEm: diasAtras(12),
    atualizadoEm: diasAtras(12),
    ultimaRevisaoEm: null,
    contagemLinksEntrada: 0,
    motivoRanking: "orfa",
    diasOrfa: 12,
  },
  {
    tipo: "nota",
    id: "n4",
    titulo: "Rascunho — carta de demissão (não enviar ainda)",
    preview: "Prezados, escrevo para comunicar... [rascunho parado há semanas]",
    modo: "texto",
    tags: ["pessoal"],
    pastaId: null,
    espaco: "pessoal",
    dono: { id: usuarioAtual.id, nome: usuarioAtual.nome },
    criadoEm: diasAtras(34),
    atualizadoEm: diasAtras(34),
    ultimaRevisaoEm: null,
    contagemLinksEntrada: 0,
    motivoRanking: "esquecimento",
  },
  {
    tipo: "nota",
    id: "n5",
    titulo: "Livros pra ler em 2026",
    preview: "- [ ] Duna, Mensageiro\n- [x] Projeto Hail Mary\n- [ ] A Sétima Função da Linguagem",
    modo: "texto",
    tags: ["leitura"],
    pastaId: "p-ideias",
    espaco: "pessoal",
    dono: { id: usuarioAtual.id, nome: usuarioAtual.nome },
    criadoEm: diasAtras(1),
    atualizadoEm: horasAtras(20),
    ultimaRevisaoEm: diasAtras(1),
    contagemLinksEntrada: 1,
    motivoRanking: "frescor",
  },
  {
    tipo: "nota",
    id: "n6",
    titulo: "Onboarding técnico — novo squad",
    preview: "Passo a passo pra configurar o ambiente local, ver [[Setup do repositório]] antes de tudo.",
    modo: "texto",
    tags: ["docs"],
    pastaId: "p-trabalho",
    espaco: "equipe:eq-trabalho",
    origemEquipe: { nome: "Squad Orion", cor: equipeTrabalho.cor },
    dono: { id: "user-3", nome: "Bruno Silva" },
    criadoEm: diasAtras(3),
    atualizadoEm: diasAtras(3),
    ultimaRevisaoEm: null,
    contagemLinksEntrada: 9,
    motivoRanking: "interacao",
  },
  {
    tipo: "nota",
    id: "n7",
    titulo: "Lista de compras do mês",
    preview: "Arroz, feijão, café, filtro de café (de novo), leite...",
    modo: "texto",
    tags: [],
    pastaId: "p-familia",
    espaco: "equipe:eq-familia",
    origemEquipe: { nome: "Família", cor: equipeFamilia.cor },
    dono: { id: usuarioAtual.id, nome: usuarioAtual.nome },
    criadoEm: horasAtras(30),
    atualizadoEm: horasAtras(30),
    ultimaRevisaoEm: null,
    contagemLinksEntrada: 0,
    motivoRanking: "frescor",
  },
];

export const tarefas: Tarefa[] = [
  {
    tipo: "tarefa",
    id: "t1",
    titulo: "Revisar contrato do apartamento",
    status: "pendente",
    scheduledAt: new Date(new Date().setHours(14, 0, 0, 0)).toISOString(),
    durationMin: 45,
    dueDate: null,
    espaco: "pessoal",
    dono: { id: usuarioAtual.id, nome: usuarioAtual.nome },
    encaixadaNaAgenda: true,
    prioridade: "alta",
  },
  {
    tipo: "tarefa",
    id: "t2",
    titulo: "Preparar demo pra sexta",
    status: "pendente",
    scheduledAt: new Date(new Date().setHours(16, 30, 0, 0)).toISOString(),
    durationMin: 120,
    dueDate: null,
    espaco: "equipe:eq-trabalho",
    origemEquipe: { nome: "Squad Orion", cor: equipeTrabalho.cor },
    dono: { id: "user-4", nome: "Ivi Tanaka" },
    encaixadaNaAgenda: true,
    prioridade: "media",
  },
  {
    tipo: "tarefa",
    id: "t3",
    titulo: "Marcar dentista",
    status: "pendente",
    scheduledAt: null,
    durationMin: 15,
    dueDate: null,
    espaco: "pessoal",
    dono: { id: usuarioAtual.id, nome: usuarioAtual.nome },
    encaixadaNaAgenda: false,
    prioridade: "baixa",
  },
];

/** Feed: interleaved, ~1 task for every 4-5 notes (section 3.1). */
export const feedItens: FeedItem[] = [
  notas[0],
  notas[1],
  tarefas[0],
  notas[2],
  notas[3],
  notas[4],
  tarefas[1],
  notas[5],
  notas[6],
];

export const pastas: Pasta[] = [
  { id: "p-ideias", caminho: "Notas/Ideias", nome: "Ideias", tipo: "nota", espaco: "pessoal", contagemItens: 8, cor: "#5B8FC7" },
  { id: "p-trabalho", caminho: "Notas/Trabalho", nome: "Trabalho", tipo: "nota", espaco: "pessoal", contagemItens: 4, cor: "#5B8FC7" },
  {
    id: "p-familia",
    caminho: "Notas/Equipe - Família",
    nome: "Família",
    tipo: "nota",
    espaco: "equipe:eq-familia",
    contagemItens: 12,
    cor: equipeFamilia.cor,
  },
  {
    id: "p-squad-orion",
    caminho: "Notas/Equipe - Squad Orion",
    nome: "Squad Orion",
    tipo: "nota",
    espaco: "equipe:eq-trabalho",
    contagemItens: 34,
    cor: equipeTrabalho.cor,
  },
];

export const categorias: CategoriaTransacao[] = [
  { id: "c1", nome: "Alimentação", tipo: "saida", icone: "UtensilsCrossed", cor: "#F59E0B" },
  { id: "c2", nome: "Transporte", tipo: "saida", icone: "Car", cor: "#7DD3FC" },
  { id: "c3", nome: "Moradia", tipo: "saida", icone: "Home", cor: "#A78BFA" },
  { id: "c4", nome: "Salário", tipo: "entrada", icone: "Wallet", cor: "#22C55E" },
  { id: "c5", nome: "Lazer", tipo: "saida", icone: "PartyPopper", cor: "#C084FC" },
  { id: "c6", nome: "Saúde", tipo: "ambos", icone: "HeartPulse", cor: "#EF4444" },
];

export const contas: Conta[] = [
  { id: "conta-1", nome: "Nubank", banco: "Nubank", cor: "#8f04d4" },
  { id: "conta-2", nome: "Carteira", banco: null, cor: "#8f8f96" },
  { id: "conta-3", nome: "Inter", banco: "Inter", cor: "#f97316" },
];

export const saldoAtualCentavos = 482_930;

export const transacoes: Transacao[] = [
  {
    id: "tx1",
    tipo: "saida",
    valorCentavos: 4590,
    moeda: "BRL",
    data: new Date().toISOString().slice(0, 10),
    descricao: "Almoço — restaurante japonês",
    categoria: categorias[0],
    conta: contas[0],
    status: "efetivada",
    espaco: "pessoal",
  },
  {
    id: "tx2",
    tipo: "entrada",
    valorCentavos: 850_000,
    moeda: "BRL",
    data: new Date(Date.now() - 86_400_000).toISOString().slice(0, 10),
    descricao: "Salário — setembro",
    categoria: categorias[3],
    conta: contas[0],
    status: "efetivada",
    espaco: "pessoal",
  },
  {
    id: "tx3",
    tipo: "saida",
    valorCentavos: 189_00,
    moeda: "BRL",
    data: new Date(Date.now() - 86_400_000).toISOString().slice(0, 10),
    descricao: "Aluguel",
    categoria: categorias[2],
    conta: contas[0],
    status: "efetivada",
    espaco: "pessoal",
  },
  {
    id: "tx4",
    tipo: "saida",
    valorCentavos: 3200,
    moeda: "BRL",
    data: new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10),
    descricao: "Uber pro aeroporto",
    categoria: categorias[1],
    conta: contas[1],
    status: "efetivada",
    espaco: "pessoal",
  },
  {
    id: "tx5",
    tipo: "saida",
    valorCentavos: 12_000,
    moeda: "BRL",
    data: new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10),
    descricao: "Fatura do cartão — previsão",
    categoria: categorias[4],
    conta: contas[2],
    status: "pendente",
    espaco: "pessoal",
  },
];

export const blocosHoje: TimeBlock[] = [
  { id: "b1", tipo: "tarefa", titulo: "Revisar contrato do apartamento", horaInicio: "14:00", durationMin: 45, espaco: "pessoal" },
  { id: "b2", tipo: "tarefa", titulo: "Preparar demo pra sexta", horaInicio: "16:30", durationMin: 120, espaco: "equipe:eq-trabalho" },
  { id: "b3", tipo: "pagamento_previsto", titulo: "Fatura do cartão — previsão", horaInicio: "09:00", durationMin: 15, espaco: "pessoal" },
  { id: "b4", tipo: "nota_com_prazo", titulo: "Enviar feedback do design", horaInicio: "11:00", durationMin: 30, espaco: "equipe:eq-trabalho" },
];

export const notificacoes: Notificacao[] = [
  { id: "not1", categoria: "cofre", titulo: "Transação pendente vence amanhã", corpo: "Fatura do cartão — R$ 120,00", lida: false, criadoEm: horasAtras(1) },
  { id: "not2", categoria: "agenda", titulo: "Capacidade do dia estourada", corpo: "Terça tem 3 tarefas e só 4h livres.", lida: false, criadoEm: horasAtras(3) },
  { id: "not3", categoria: "equipes", titulo: "Carla Nunes comentou numa Nota", corpo: "\"Ata — alinhamento de sprint\"", lida: true, criadoEm: horasAtras(20) },
  { id: "not4", categoria: "agenda", titulo: "Bloco concluído", corpo: "Revisar contrato do apartamento", lida: true, criadoEm: diasAtras(1) },
  { id: "not5", categoria: "equipes", titulo: "Bruno Silva entrou na Squad Orion", corpo: "Dê as boas-vindas.", lida: true, criadoEm: diasAtras(6) },
];

export const buscasRecentes = ["notas órfãs", "contrato apartamento", "squad orion"];
export const atalhosBusca = ["Notas órfãs", "Transações desse mês", "Tarefas de hoje", "Notas sem pasta"];
