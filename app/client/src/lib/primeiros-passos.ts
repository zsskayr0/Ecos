import { notas, tarefas } from "./api";

/** Sinal de uma só leitura: depois do cadastro, o Feed já abre com o foco na captura rápida. */
const CHAVE_FOCO = "ecos:foco-captura";

export function pedirFocoNaCaptura(): void {
  try { sessionStorage.setItem(CHAVE_FOCO, "1"); } catch { /* armazenamento indisponível: só não foca sozinho */ }
}

export function consumirFocoNaCaptura(): boolean {
  try {
    const pedido = sessionStorage.getItem(CHAVE_FOCO) === "1";
    if (pedido) sessionStorage.removeItem(CHAVE_FOCO);
    return pedido;
  } catch {
    return false;
  }
}

/**
 * Cria uma nota e uma tarefa de exemplo para o Feed não nascer vazio. Chamado uma única vez, ao concluir o cadastro
 * da conta; falhas são engolidas (o app funciona igual sem os exemplos).
 */
export async function criarExemplosIniciais(): Promise<void> {
  try {
    await notas.criar({
      titulo: "Bem-vindo ao Ecos",
      corpo: "Esta é uma nota de exemplo. Escreva na caixa **Captura rápida** do Feed para guardar uma ideia em segundos.\n\nVocê pode apagar esta nota quando quiser: ela vai para a Lixeira.",
      espaco: "pessoal",
    });
    await tarefas.criar({ titulo: "Criar minha primeira tarefa", corpo: "Conclua esta tarefa de exemplo tocando no círculo ao lado do título.", espaco: "pessoal" });
  } catch {
    /* sem exemplos, sem problema */
  }
}
