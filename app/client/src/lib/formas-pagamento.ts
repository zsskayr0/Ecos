import type { FormaPagamentoApi } from "./api";

/** Funções puras sobre a lista de formas de pagamento cadastradas (a fonte é `GET /vault/formas-pagamento`). */

/** Sem acento, sem caixa, sem espaços nas pontas — só para comparar texto digitado/importado. */
export function normalizarTexto(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
}

/** Nome para exibir; se o código não estiver no cadastro (ainda carregando, por exemplo) mostra o próprio código. */
export function rotuloForma(lista: FormaPagamentoApi[], codigo: string | null | undefined): string {
  if (!codigo) return "";
  return lista.find((f) => f.codigo === codigo)?.nome ?? codigo;
}

/** Opções de um seletor de lançamento: só as ativas, mais a atual do lançamento mesmo inativa (ou desconhecida). */
export function opcoesDoSeletor(lista: FormaPagamentoApi[], atual: string | null | undefined): { codigo: string; nome: string; inativa: boolean }[] {
  const opcoes = lista.filter((f) => f.ativa).map((f) => ({ codigo: f.codigo, nome: f.nome, inativa: false }));
  if (atual && !opcoes.some((o) => o.codigo === atual)) {
    const f = lista.find((x) => x.codigo === atual);
    opcoes.push({ codigo: atual, nome: f?.nome ?? atual, inativa: true });
  }
  return opcoes;
}

/** Opções de filtro: as ativas e também as inativas que ainda têm lançamentos (senão o filtro não acha os antigos). */
export function opcoesDeFiltro(lista: FormaPagamentoApi[]): FormaPagamentoApi[] {
  return lista.filter((f) => f.ativa || f.usos > 0);
}

/** Já existe outra forma com este nome? Compara só espaços e caixa; o servidor decide a unicidade final (409). */
export function nomeJaExiste(lista: FormaPagamentoApi[], nome: string, ignorarCodigo?: string): boolean {
  const alvo = nome.trim().toLowerCase();
  if (!alvo) return false;
  return lista.some((f) => f.codigo !== ignorarCodigo && f.nome.trim().toLowerCase() === alvo);
}

export type ResultadoFormaCsv = { codigo: string } | { erro: string };

/** Código exato; senão nome sem acento/caixa, só se for uma correspondência única. Nunca escolhe em silêncio. */
export function resolverFormaCsv(lista: FormaPagamentoApi[], texto: string): ResultadoFormaCsv {
  const bruto = texto.trim();
  if (!bruto) return { erro: "Pagamento vazio" };
  const exato = lista.find((f) => f.codigo === bruto.toLowerCase() || f.codigo === bruto);
  if (exato) return { codigo: exato.codigo };
  const alvo = normalizarTexto(bruto);
  const porNome = lista.filter((f) => normalizarTexto(f.nome) === alvo || normalizarTexto(f.codigo) === alvo);
  if (porNome.length === 1) return { codigo: porNome[0].codigo };
  if (porNome.length > 1) return { erro: `Pagamento ambíguo: "${bruto}" corresponde a ${porNome.map((f) => f.nome).join(", ")}` };
  return { erro: `Pagamento inválido: "${bruto}"` };
}

/** Depois de um PATCH sem resposta: o registro no servidor reflete tudo o que foi enviado? */
export function registroReflete(
  forma: FormaPagamentoApi | undefined,
  enviado: { nome?: string; icone?: string | null; cor?: string | null; ativa?: boolean },
): boolean {
  if (!forma) return false;
  if (enviado.nome !== undefined && forma.nome !== enviado.nome) return false;
  if (enviado.icone !== undefined && forma.icone !== enviado.icone) return false;
  if (enviado.cor !== undefined && forma.cor !== enviado.cor) return false;
  if (enviado.ativa !== undefined && forma.ativa !== enviado.ativa) return false;
  return true;
}
