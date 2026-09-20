/**
 * Registro de erro inesperado. Em desenvolvimento mostra tudo (erro e stack); em produção só o tipo do erro:
 * mensagens e stack podem trazer endereços, ids e trechos de dados, e o console do navegador é visível a quem usa o app.
 */
export function registrarErro(contexto: string, erro: unknown, detalhe?: string | null): void {
  if (import.meta.env.DEV) {
    console.error(`[ecos] ${contexto}`, erro, detalhe ?? "");
    return;
  }
  console.error(`[ecos] ${contexto}: ${erro instanceof Error ? erro.name : "erro desconhecido"}`);
}
