/**
 * O `localStorage` guarda preferências de interface (tema, filtros, larguras…), mas também um pouco de conteúdo do
 * usuário: rascunhos de notas e tarefas, buscas recentes e o layout do desktop (com os títulos das abas abertas).
 * Isso não deve ficar no aparelho depois que a pessoa sai da conta; as preferências ficam.
 */
/**
 * Rascunhos e listas que podem conter dados financeiros: nomes de sacados, rascunho de lançamento de versões
 * antigas e buscas recentes (a busca global também consulta os lançamentos do Cofre).
 */
const CHAVES_FINANCEIRAS = ["ecos.capture-draft.v1", "ecos:cofre:sacados-ignorados", "ecos-buscas-recentes"];
const CHAVES_COM_CONTEUDO = ["ecos.desktop.workspace.v1", "ecos.rascunhos.vistos.v1", "ecos.capture-draft-falha.v1", ...CHAVES_FINANCEIRAS];
const PREFIXOS_COM_CONTEUDO = ["ecos.task-draft.", "ecos.note-draft."];
const CHAVE_COFRE_ROTA = "ecos.desktop.cofre-rota.v1";
const CHAVE_VISTOS = "ecos.rascunhos.vistos.v1";
/** Rascunho de nota/tarefa sem salvar some depois destes dias. */
export const DIAS_VALIDADE_RASCUNHO = 30;

const eRascunho = (k: string) => PREFIXOS_COM_CONTEUDO.some((p) => k.startsWith(p));

/** Quantos rascunhos de nota/tarefa ainda não foram salvos neste aparelho (somem ao sair da conta). */
export function contarRascunhosLocais(): number {
  try { return Object.keys(localStorage).filter(eRascunho).length; } catch { return 0; }
}

/**
 * Remove o que veio de dados financeiros. Roda quando o Cofre é bloqueado e ao sair da conta: depois disso
 * nenhum nome de sacado nem valor de lançamento fica no `localStorage`. (O rascunho de lançamento só vive em memória.)
 */
export function limparRastrosFinanceirosLocais(): void {
  try { CHAVES_FINANCEIRAS.forEach((k) => localStorage.removeItem(k)); } catch { /* armazenamento indisponível */ }
}
if (typeof window !== "undefined") window.addEventListener("ecos:cofre-bloqueado", limparRastrosFinanceirosLocais);

/**
 * Apaga rascunhos de nota/tarefa esquecidos. Os rascunhos não guardam data, então a primeira vez que um é visto
 * fica registrada e a validade conta daí.
 */
export function expirarRascunhosAntigos(dias = DIAS_VALIDADE_RASCUNHO, agora = Date.now()): void {
  try {
    let vistos: Record<string, number> = {};
    try { vistos = JSON.parse(localStorage.getItem(CHAVE_VISTOS) ?? "{}") as Record<string, number>; } catch { /* registro corrompido: recomeça */ }
    const limite = dias * 86_400_000;
    const atuais = Object.keys(localStorage).filter(eRascunho);
    const novo: Record<string, number> = {};
    for (const k of atuais) {
      const visto = typeof vistos[k] === "number" ? vistos[k] : agora;
      if (agora - visto >= limite) localStorage.removeItem(k); else novo[k] = visto;
    }
    if (Object.keys(novo).length > 0) localStorage.setItem(CHAVE_VISTOS, JSON.stringify(novo)); else localStorage.removeItem(CHAVE_VISTOS);
  } catch { /* armazenamento indisponível */ }
}

export function limparConteudoLocal(): void {
  try {
    const remover = Object.keys(localStorage).filter((k) => CHAVES_COM_CONTEUDO.includes(k) || eRascunho(k));
    remover.forEach((k) => localStorage.removeItem(k));
  } catch { /* armazenamento indisponível: não há o que limpar */ }
  try { sessionStorage.removeItem(CHAVE_COFRE_ROTA); } catch { /* idem */ }
}
