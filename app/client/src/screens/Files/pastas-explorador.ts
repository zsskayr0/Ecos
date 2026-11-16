import { arquivos, type ArquivoExplorador, type PastaExplorador } from "@/lib/api";

export interface ConteudoPasta {
  pastas: PastaExplorador[];
  arquivos: ArquivoExplorador[];
}

/** Reúne o conteúdo direto das pastas selecionadas ou todos os arquivos sob a raiz da visão indexada. */
export async function reunirPastas(
  espaco: string,
  caminhos: string[],
  recursivo: boolean,
  ativo: () => boolean,
): Promise<ConteudoPasta> {
  const visitadas = new Set(caminhos);
  const fila = [...visitadas];
  const pastas = new Map<string, PastaExplorador>();
  const encontrados = new Map<string, ArquivoExplorador>();

  // Limita o número de requisições simultâneas ao percorrer uma árvore grande.
  for (let i = 0; i < fila.length && ativo();) {
    const proximas = fila.slice(i, i + 6);
    i += proximas.length;
    const lote = await Promise.all(proximas.map((pasta) => arquivos.listar({ espaco, pasta })));
    for (const conteudo of lote) {
      for (const arquivo of conteudo.arquivos) encontrados.set(arquivo.caminho, arquivo);
      for (const pasta of conteudo.pastas) {
        if (!recursivo) {
          if (!visitadas.has(pasta.caminho)) pastas.set(pasta.caminho, pasta);
        } else if (!visitadas.has(pasta.caminho)) {
          visitadas.add(pasta.caminho);
          fila.push(pasta.caminho);
        }
      }
    }
  }

  return { pastas: [...pastas.values()], arquivos: [...encontrados.values()] };
}
