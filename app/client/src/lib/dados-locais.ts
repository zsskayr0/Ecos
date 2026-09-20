/**
 * O `localStorage` guarda preferências de interface (tema, filtros, larguras…), mas também um pouco de conteúdo do
 * usuário: rascunhos de notas e tarefas, buscas recentes e o layout do desktop (com os títulos das abas abertas).
 * Isso não deve ficar no aparelho depois que a pessoa sai da conta; as preferências ficam.
 */
const CHAVES_COM_CONTEUDO = ["ecos-buscas-recentes", "ecos.capture-draft.v1", "ecos.desktop.workspace.v1"];
const PREFIXOS_COM_CONTEUDO = ["ecos.task-draft.", "ecos.note-draft."];

export function limparConteudoLocal(): void {
  try {
    const remover = Object.keys(localStorage).filter((k) => CHAVES_COM_CONTEUDO.includes(k) || PREFIXOS_COM_CONTEUDO.some((p) => k.startsWith(p)));
    remover.forEach((k) => localStorage.removeItem(k));
  } catch { /* armazenamento indisponível: não há o que limpar */ }
}
