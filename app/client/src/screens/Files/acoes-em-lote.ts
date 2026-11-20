import { useState } from "react";
import { arquivos, notas, tarefas, type ArquivoExplorador } from "@/lib/api";
import { baixarArquivo } from "@/lib/baixar-arquivo";
import { mensagemDeErro } from "@/lib/erros";
import { canonicaTag } from "@/lib/tags";
import { avisar } from "@/lib/toast";
import { exportarDocumentosEmPdf } from "@/lib/exportar-pdf";
import { criarZip } from "@/lib/zip-simples";

export type Prioridade = "baixa" | "media" | "alta";

interface Opcoes {
  /** Os itens marcados que são arquivos (pastas ficam de fora). */
  arquivosMarcados: ArquivoExplorador[];
  espaco: string;
  /** Depois de uma ação que mexeu em dados: recarrega a lista (e limpa a seleção quando o item some do lugar). */
  aoAplicar: (limparSelecao: boolean) => void;
  /** Roda ao fim de qualquer ação (por exemplo, fechar o painel da barra). */
  aoTerminar?: () => void;
  /** Mostra o resultado da ação na lista na hora: altera os itens (`alterar`) ou os tira da lista (`null`). */
  aoOtimista?: (caminhos: Set<string>, alterar: ((a: ArquivoExplorador) => ArquivoExplorador) | null) => void;
}

/** As ações em lote da seleção de Arquivos. A barra flutuante e o menu de botão direito usam a mesma lógica. */
export function useAcoesEmLote({ arquivosMarcados, espaco, aoAplicar, aoTerminar, aoOtimista }: Opcoes) {
  const [ocupado, setOcupado] = useState(false);
  const tarefasSel = arquivosMarcados.filter((a) => a.tipo === "tarefa" && a.id);
  const notasSel = arquivosMarcados.filter((a) => a.tipo === "nota" && a.id);
  const documentos = [...tarefasSel, ...notasSel];
  const todasConcluidas = tarefasSel.length > 0 && tarefasSel.every((t) => t.status === "concluida");
  const todasArquivadas = documentos.length > 0 && documentos.every((d) => d.status === "arquivada");
  const tagsDaSelecao = new Map<string, number>();
  for (const d of documentos) for (const t of d.tags ?? []) tagsDaSelecao.set(t, (tagsDaSelecao.get(t) ?? 0) + 1);

  /** Otimista: `local` já altera (ou remove, com `null`) os itens na lista antes do servidor responder; se ele falhar, `aoAplicar` recarrega. */
  async function executar(fazer: () => Promise<void>, sucesso: string, limpar = false, local?: { itens: ArquivoExplorador[]; alterar: ((a: ArquivoExplorador) => ArquivoExplorador) | null }) {
    if (ocupado) return;
    if (local && aoOtimista) aoOtimista(new Set(local.itens.map((a) => a.caminho)), local.alterar);
    setOcupado(true);
    try { await fazer(); avisar(sucesso, "sucesso"); aoAplicar(limpar); }
    catch (e) { avisar(mensagemDeErro(e, "Não foi possível aplicar a ação."), "erro"); aoAplicar(false); }
    finally { setOcupado(false); aoTerminar?.(); }
  }

  const atualizarDoc = (a: ArquivoExplorador, campos: { tags?: string[]; espaco?: string }) =>
    a.tipo === "nota" ? notas.atualizar(a.id!, campos) : tarefas.atualizar(a.id!, campos);
  const mudarTags = (nova: (atuais: string[]) => string[], sucesso: string) =>
    executar(async () => { for (const d of documentos) await atualizarDoc(d, { tags: nova(d.tags ?? []) }); }, sucesso, false, { itens: documentos, alterar: (a) => ({ ...a, tags: nova(a.tags ?? []) }) });

  return {
    ocupado, tarefasSel, notasSel, documentos, todasConcluidas, todasArquivadas, tagsDaSelecao,
    desarquivar: () => executar(async () => { for (const d of documentos) await (d.tipo === "nota" ? notas.arquivar(d.id!, false) : tarefas.atualizarStatus(d.id!, "pendente")); }, documentos.length === 1 ? "Item desarquivado." : "Itens desarquivados.", true, { itens: documentos, alterar: (a) => ({ ...a, status: a.tipo === "nota" ? undefined : "pendente" }) }),
    concluirOuReabrir: () => executar(async () => { for (const t of tarefasSel) await tarefas.atualizarStatus(t.id!, todasConcluidas ? "pendente" : "concluida"); }, todasConcluidas ? "Tarefas reabertas." : "Tarefas concluídas.", false, { itens: tarefasSel, alterar: (a) => ({ ...a, status: todasConcluidas ? "pendente" : "concluida" }) }),
    arquivar: () => executar(async () => { for (const d of documentos) await (d.tipo === "nota" ? notas.arquivar(d.id!, true) : tarefas.atualizarStatus(d.id!, "arquivada")); }, documentos.length === 1 ? "Item arquivado." : "Itens arquivados.", true, { itens: documentos, alterar: null }),
    prioridade: (p: Prioridade) => executar(async () => { for (const t of tarefasSel) await tarefas.atualizar(t.id!, { prioridade: p }); }, "Prioridade alterada.", false, { itens: tarefasSel, alterar: (a) => ({ ...a, prioridade: p }) }),
    prazo: (iso: string | null) => executar(async () => { for (const t of tarefasSel) await tarefas.atualizar(t.id!, { due_date: iso }); }, iso ? "Prazo definido." : "Prazo removido.", false, { itens: tarefasSel, alterar: (a) => ({ ...a, due_date: iso }) }),
    revisar: () => executar(async () => { for (const n of notasSel) await notas.atualizar(n.id!, { marcar_revisado: true }); }, "Marcadas como revisadas."),
    adicionarTag: (bruta: string) => {
      const tag = canonicaTag(bruta);
      if (!tag) { avisar("Essa tag não é válida.", "erro"); return Promise.resolve(); }
      return mudarTags((atuais) => (atuais.includes(tag) ? atuais : [...atuais, tag]), `Tag #${tag} aplicada.`);
    },
    removerTag: (tag: string) => mudarTags((atuais) => atuais.filter((x) => x !== tag), `Tag #${tag} removida.`),
    mudarEquipe: (id: string) => executar(async () => { for (const d of documentos) await atualizarDoc(d, { espaco: id }); }, "Equipe alterada.", true, { itens: documentos, alterar: null }),
    exportarPdf: () => executar(() => exportarDocumentosEmPdf(documentos), "PDF baixado."),
    baixar: () => executar(async () => {
      if (arquivosMarcados.length === 1) {
        const a = arquivosMarcados[0];
        baixarArquivo(new Blob([await arquivos.baixar(espaco, a.caminho)]), a.nome);
        return;
      }
      const usados = new Map<string, number>();
      const itens = [];
      for (const a of arquivosMarcados) {
        const n = usados.get(a.nome) ?? 0;
        usados.set(a.nome, n + 1);
        const nome = n ? a.nome.replace(/(\.[^.]+)?$/, ` (${n + 1})$1`) : a.nome;
        itens.push({ nome, dados: new Uint8Array(await arquivos.baixar(espaco, a.caminho)) });
      }
      baixarArquivo(criarZip(itens), "ecos-selecao.zip");
    }, arquivosMarcados.length === 1 ? "Download iniciado." : `${arquivosMarcados.length} arquivos no .zip.`),
  };
}

export type AcoesEmLote = ReturnType<typeof useAcoesEmLote>;
