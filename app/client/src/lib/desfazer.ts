import { lixeira } from "@/lib/api";
import { avisar } from "@/lib/toast";

/**
 * Toast com "Desfazer" para ações imediatas (concluir, mover, excluir).
 * `desfazer` executa a operação inversa; `aoDesfazer` roda depois dela (ex.: avisar o refresh-bus).
 * Falha ao desfazer vira aviso de erro — a ação original continua valendo.
 */
export function avisarComDesfazer(mensagem: string, desfazer: () => Promise<unknown>, opcoes?: { aoDesfazer?: () => void; sucesso?: string; falha?: string }): void {
  avisar(mensagem, "neutro", {
    rotulo: "Desfazer",
    aoClicar: () => {
      void desfazer()
        .then(() => {
          opcoes?.aoDesfazer?.();
          avisar(opcoes?.sucesso ?? "Ação desfeita.", "sucesso");
        })
        .catch(() => avisar(opcoes?.falha ?? "Não foi possível desfazer.", "erro"));
    },
  });
}

/**
 * A exclusão de nota/tarefa move o arquivo para a Lixeira com um id próprio (`documento-…`), que a API de exclusão
 * não devolve: o item recém-excluído é o mais recente da Lixeira com o mesmo tipo e título.
 */
export async function restaurarUltimoExcluido(tipo: "nota" | "tarefa", titulo: string): Promise<void> {
  const itens = await lixeira.listar();
  const alvo = itens
    .filter((i) => i.tipo === tipo && i.nome === titulo)
    .sort((a, b) => b.excluido_em.localeCompare(a.excluido_em))[0];
  if (!alvo) throw new Error("Item não encontrado na Lixeira.");
  await lixeira.restaurar(alvo.id);
}

/** Aviso padrão pós-exclusão: diz que foi para a Lixeira e oferece Desfazer. */
export function avisarExcluido(tipo: "nota" | "tarefa", titulo: string, aoDesfazer: () => void): void {
  avisarComDesfazer(
    `${tipo === "nota" ? "Nota" : "Tarefa"} enviada para a Lixeira.`,
    () => restaurarUltimoExcluido(tipo, titulo),
    { aoDesfazer, sucesso: `${tipo === "nota" ? "Nota restaurada" : "Tarefa restaurada"}.`, falha: "Não foi possível desfazer. Restaure pela Lixeira." },
  );
}
