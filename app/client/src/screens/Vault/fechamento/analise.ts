import type { CategoriaApi, ChavePendenciaFechamento, FechamentoApi, FechamentoCategoriaApi, FechamentoContaApi } from "@/lib/api";

export interface FilhaFechamento { id: string | null; nome: string; valor: number; lancamentos: number }
export interface GrupoFechamento extends FilhaFechamento { filhas: FilhaFechamento[] }

const SEM_CATEGORIA = "Sem categoria";
const SEM_SUBCATEGORIA = "Sem subcategoria";

/**
 * Categorias de um tipo, do maior valor para o menor. Uma subcategoria soma na categoria-mãe e aparece embaixo dela;
 * o que foi lançado direto na mãe, quando ela também tem filhas, vira "Sem subcategoria".
 */
export function agruparCategorias(linhas: FechamentoCategoriaApi[], tipo: "entrada" | "saida", categorias: Pick<CategoriaApi, "id" | "nome">[]): GrupoFechamento[] {
  const nomeDe = (id: string) => categorias.find((c) => c.id === id)?.nome;
  const grupos = new Map<string | null, { nome: string; direto: FilhaFechamento | null; filhas: FilhaFechamento[] }>();
  const grupo = (id: string | null, nome: string) => {
    let g = grupos.get(id);
    if (!g) grupos.set(id, (g = { nome, direto: null, filhas: [] }));
    return g;
  };
  for (const l of linhas) {
    if (l.tipo !== tipo) continue;
    if (l.pai_id) {
      grupo(l.pai_id, nomeDe(l.pai_id) ?? "Categoria").filhas.push({ id: l.categoria_id, nome: l.nome ?? "Categoria", valor: l.valor, lancamentos: l.lancamentos });
    } else {
      const g = grupo(l.categoria_id, l.categoria_id ? (l.nome ?? nomeDe(l.categoria_id) ?? "Categoria") : SEM_CATEGORIA);
      g.direto = { id: l.categoria_id, nome: l.categoria_id ? SEM_SUBCATEGORIA : SEM_CATEGORIA, valor: l.valor, lancamentos: l.lancamentos };
    }
  }
  const maior = (a: FilhaFechamento, b: FilhaFechamento) => b.valor - a.valor || a.nome.localeCompare(b.nome, "pt-BR");
  return [...grupos.entries()]
    .map(([id, g]) => {
      const filhas = [...g.filhas].sort(maior);
      if (g.direto && filhas.length > 0) filhas.push(g.direto);
      const todas = g.direto ? [g.direto, ...g.filhas] : g.filhas;
      return { id, nome: g.nome, valor: todas.reduce((s, f) => s + f.valor, 0), lancamentos: todas.reduce((s, f) => s + f.lancamentos, 0), filhas };
    })
    .sort(maior);
}

const semAcento = (t: string) => t.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Categorias cujo nome já diz "transferência" (e que ainda não foram marcadas), para oferecer num clique. */
export function categoriasSugeridasParaTransferencia(categorias: Pick<CategoriaApi, "id" | "nome" | "pai_id" | "arquivada">[], jaEscolhidas: string[], idLucros: string | null) {
  return categorias.filter((c) => !c.pai_id && !c.arquivada && c.id !== idLucros && !jaEscolhidas.includes(c.id) && semAcento(c.nome.trim()).startsWith("transfer"));
}

export type Gravidade = "bloqueia" | "atencao";

/** O que cada pendência quer dizer e se impede de dar o período por pronto ou só pede atenção. */
export const PENDENCIAS: { chave: ChavePendenciaFechamento; titulo: string; dica: string; gravidade: Gravidade }[] = [
  { chave: "pendentes", titulo: "Pendentes de efetivação", dica: "Ainda não aconteceram de fato, então ficam fora dos números. Efetive ou apague.", gravidade: "bloqueia" },
  { chave: "sem_categoria", titulo: "Sem categoria", dica: "A contabilidade precisa saber de onde veio e para onde foi cada valor.", gravidade: "bloqueia" },
  { chave: "sem_conta", titulo: "Sem conta", dica: "Não aparecem no extrato de nenhum banco. Escolha a conta de cada um.", gravidade: "bloqueia" },
  { chave: "sem_comprovante", titulo: "Sem comprovante", dica: "Efetivados sem nenhum comprovante ou nota fiscal anexados.", gravidade: "atencao" },
  { chave: "nao_conciliadas", titulo: "Não conciliados", dica: "Marque como conciliado o que você já conferiu no extrato do banco.", gravidade: "atencao" },
];

export interface Situacao {
  /** Tipos de pendência que impedem o fechamento e quantos lançamentos há neles. */
  bloqueios: number;
  /** Distribuições de lucros efetivadas ainda sem recibo anexado. */
  recibosFaltando: number;
  /** Contas com movimento no mês cujo saldo do banco ainda não foi informado (só em mês inteiro). */
  aConferir: number;
  /** Contas em que o saldo do banco não bate com o do Cofre. */
  divergentes: number;
  /** Transferências entre contas que não se compensam: falta lançar o outro lado. */
  transferenciasSemPar: boolean;
  atencao: number;
  pronto: boolean;
}

/** Contas do Cofre que se conferem com um extrato: as de verdade (não a linha "Sem conta") e que tiveram movimento no mês. */
export const precisaConferir = (c: FechamentoContaApi) => c.conta_id !== null && (c.lancamentos > 0 || c.saldo_inicial !== 0 || c.saldo_final !== 0);

export function situacaoDoFechamento(f: FechamentoApi): Situacao {
  const quantos = (g: Gravidade) => PENDENCIAS.filter((p) => p.gravidade === g && f.pendencias[p.chave].quantidade > 0).length;
  const bloqueios = quantos("bloqueia");
  const recibosFaltando = f.lucros.configurada ? f.lucros.sem_recibo : 0;
  const transferenciasSemPar = f.transferencias.configurada && !f.transferencias.equilibrada;
  const atencao = quantos("atencao") + (f.pendencias.rascunhos > 0 ? 1 : 0) + (transferenciasSemPar ? 1 : 0);
  const conferiveis = f.mes ? f.contas.filter(precisaConferir) : [];
  const aConferir = conferiveis.filter((c) => c.saldo_banco === null).length;
  const divergentes = conferiveis.filter((c) => c.diferenca !== null && c.diferenca !== 0).length;
  return { bloqueios, recibosFaltando, aConferir, divergentes, transferenciasSemPar, atencao, pronto: bloqueios === 0 && recibosFaltando === 0 && aConferir === 0 && divergentes === 0 };
}
