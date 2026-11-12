import { useEffect, useState } from "react";
import { File, FileAudio, FileImage, FileText, FileVideo, Folder, FolderOpen, ListChecks, type LucideIcon } from "lucide-react";
import type { ArquivoExplorador, PastaExplorador } from "@/lib/api";
import { IconePorNome } from "@/components/common/IconePorNome";
import { IconeImagem, idDoIconeImagem } from "@/lib/icones-personalizados";
import { lerPreferenciasAplicativo } from "@/lib/preferencias-aplicativo";

/** Peças compartilhadas pela árvore lateral e pela tela de Arquivos: ícones por tipo, por extensão e das pastas. */

export const extensaoDe = (a: ArquivoExplorador) => { const i = a.nome.lastIndexOf("."); return i > 0 ? a.nome.slice(i + 1).toLowerCase() : ""; };

/** Selo com a extensão (PDF, DOCX…): vazio em notas, tarefas e Markdown. */
export function selo(a: ArquivoExplorador): string | null {
  if (a.tipo || a.categoria === "markdown") return null;
  const e = extensaoDe(a);
  return e ? e.toUpperCase() : null;
}

/** Nome para exibir: o título de nota e tarefa, ou o nome sem a extensão. */
export function rotuloArquivo(a: ArquivoExplorador): string {
  if (a.titulo) return a.titulo;
  const i = a.nome.lastIndexOf(".");
  return i > 0 ? a.nome.slice(0, i) : a.nome;
}

/** Ícone padrão pelo tipo: nota e tarefa do Ecos primeiro, depois a categoria do arquivo. */
export function iconePadrao(a: ArquivoExplorador): LucideIcon {
  if (a.tipo === "tarefa") return ListChecks;
  if (a.tipo === "nota") return FileText;
  switch (a.categoria) {
    case "imagem": return FileImage;
    case "audio": return FileAudio;
    case "video": return FileVideo;
    case "markdown": case "pdf": case "texto": return FileText;
    default: return File;
  }
}

function lerMarcas() {
  const p = lerPreferenciasAplicativo();
  return { marca: p.exploradorMarcaArquivo, icones: p.exploradorIconesExtensao };
}

/** Marca dos arquivos e ícones por extensão (Configurações › Aparência › Pastas), sempre em dia com a preferência. */
export function useMarcasArquivo() {
  const [marcas, setMarcas] = useState(lerMarcas);
  useEffect(() => {
    const atualizar = () => setMarcas(lerMarcas());
    window.addEventListener("ecos:preferencias-aplicativo", atualizar);
    return () => window.removeEventListener("ecos:preferencias-aplicativo", atualizar);
  }, []);
  return marcas;
}

/** Ícone do arquivo: o que a pessoa escolheu para a extensão, ou o padrão do tipo. */
export function IconeArquivo({ a, personalizados, size = 14, className = "" }: { a: ArquivoExplorador; personalizados: Record<string, string>; size?: number; className?: string }) {
  const escolhido = a.tipo ? undefined : personalizados[extensaoDe(a)];
  const imagem = idDoIconeImagem(escolhido);
  const caixa = { width: size, height: size };
  if (imagem) return <span aria-hidden className={`flex shrink-0 items-center justify-center ${className}`} style={caixa}><IconeImagem id={imagem} size={size} /></span>;
  if (escolhido) return <span aria-hidden className={`flex shrink-0 items-center justify-center ${className}`} style={caixa}><IconePorNome nome={escolhido} padrao="File" size={size} /></span>;
  const Padrao = iconePadrao(a);
  return <Padrao size={size} strokeWidth={1.7} className={`shrink-0 ${className}`} />;
}

/** Ícone da pasta com a cor e o ícone que a pessoa escolheu ao criá-la; sem escolha, a pasta padrão (aberta ou fechada). */
export function IconePasta({ pasta, aberta = false, size = 14, className = "" }: { pasta: PastaExplorador; aberta?: boolean; size?: number; className?: string }) {
  const imagem = idDoIconeImagem(pasta.icone);
  const caixa = { width: size, height: size };
  if (imagem) return <span aria-hidden className={`flex shrink-0 items-center justify-center ${className}`} style={caixa}><IconeImagem id={imagem} size={size} /></span>;
  const cor = pasta.cor || undefined;
  return (
    <span aria-hidden className={`flex shrink-0 items-center justify-center ${cor ? "" : "text-text-muted"} ${className}`} style={cor ? { ...caixa, color: cor } : caixa}>
      {pasta.icone ? <IconePorNome nome={pasta.icone} padrao="Folder" size={size} /> : aberta ? <FolderOpen size={size} strokeWidth={1.7} /> : <Folder size={size} strokeWidth={1.7} />}
    </span>
  );
}
