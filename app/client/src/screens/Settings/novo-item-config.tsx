import { useEffect, useState } from "react";
import { Folder, FolderOpen, Tags } from "lucide-react";
import { TOM } from "@/components/common/MenuSuspenso";
import { EditorTagsPadrao } from "@/components/common/EditorTagsPadrao";
import { pastas } from "@/lib/api";
import type { ModoTagsPadrao } from "@/lib/tags-pasta";
import type { PastaNovoItem } from "@/lib/preferencias-aplicativo";
import { Linha, Segmentado, Seletor } from "./campos-config";

/** Pasta e tags com que um item novo nasce: as mesmas linhas nas telas Tarefas e Notas. */

const MODOS_PASTA = [
  { valor: "contexto", rotulo: "A pasta atual", icone: FolderOpen, cor: TOM.ciano },
  { valor: "fixa", rotulo: "Uma pasta fixa", icone: Folder, cor: TOM.violeta },
  { valor: "nenhuma", rotulo: "Nenhuma", icone: Folder, cor: TOM.aco },
] as const satisfies readonly { valor: PastaNovoItem; rotulo: string; icone: typeof Folder; cor: string }[];

const MODOS_TAGS = [
  { id: "hierarquia", rotulo: "Hierarquia" },
  { id: "pasta", rotulo: "Só a pasta" },
  { id: "manual", rotulo: "Manual" },
] as const satisfies readonly { id: ModoTagsPadrao; rotulo: string }[];

const DESCRICAO_TAGS = "Hierarquia: o item novo recebe as tags padrão da pasta e de todas as pastas de cima. Só a pasta: apenas as da própria pasta. Manual: ignora as pastas e usa a lista abaixo. Defina as das pastas em Editar pasta.";

/** Escolha da pasta fixa: lista as pastas existentes do tipo (e mantém a salva, mesmo que já não apareça). */
function PastaFixa({ tipo, valor, onChange, label }: { tipo: "nota" | "tarefa"; valor: string; onChange: (v: string) => void; label: string }) {
  const [lista, setLista] = useState<string[]>([]);
  useEffect(() => {
    let vivo = true;
    pastas.listar({ tipo, recursivo: true }).then((r) => { if (vivo) setLista(r.subpastas.map((p) => p.caminho).sort((a, b) => a.localeCompare(b))); }).catch(() => undefined);
    return () => { vivo = false; };
  }, [tipo]);
  const caminhos = valor && !lista.includes(valor) ? [valor, ...lista] : lista;
  const opcoes = [{ valor: "", rotulo: "Escolher…", icone: Folder, cor: TOM.aco }, ...caminhos.map((c) => ({ valor: c, rotulo: c, icone: Folder, cor: TOM.ciano }))];
  return <Seletor valor={valor} opcoes={opcoes} onChange={onChange} label={label} />;
}

interface Props {
  tipo: "nota" | "tarefa";
  pasta: PastaNovoItem; aoMudarPasta: (v: PastaNovoItem) => void;
  pastaFixa: string; aoMudarPastaFixa: (v: string) => void;
  tagsModo: ModoTagsPadrao; aoMudarTagsModo: (v: ModoTagsPadrao) => void;
  tags: string[]; aoMudarTags: (v: string[]) => void;
}

export function LinhasPastaETags({ tipo, pasta, aoMudarPasta, pastaFixa, aoMudarPastaFixa, tagsModo, aoMudarTagsModo, tags, aoMudarTags }: Props) {
  const [a, as, nova] = tipo === "tarefa" ? ["a tarefa", "tarefas", "tarefa nova"] : ["a nota", "notas", "nota nova"];
  return (
    <>
      <Linha Icone={FolderOpen} titulo="Pasta" descricao={`Onde ${a} nova é guardada: na pasta em que você está, sempre em uma pasta específica ou sem pasta.`}>
        <Seletor valor={pasta} opcoes={MODOS_PASTA} onChange={aoMudarPasta} label={`Pasta da ${nova}`} />
      </Linha>
      {pasta === "fixa" && (
        <Linha Icone={Folder} titulo="Pasta fixa" descricao={`Pasta de ${as} usada sempre que você cria um${tipo === "tarefa" ? "a tarefa" : "a nota"}.`}>
          <PastaFixa tipo={tipo} valor={pastaFixa} onChange={aoMudarPastaFixa} label={`Pasta fixa das ${as} novas`} />
        </Linha>
      )}
      <Linha Icone={Tags} titulo="Tags padrão" descricao={DESCRICAO_TAGS}>
        <Segmentado valor={tagsModo} opcoes={MODOS_TAGS} onChange={aoMudarTagsModo} label="Origem das tags padrão" />
      </Linha>
      {tagsModo === "manual" && (
        <div className="border-b border-border/60 px-4 py-3 last:border-0">
          <EditorTagsPadrao valor={tags} onChange={aoMudarTags} label={`Tags padrão das ${as} novas`} />
        </div>
      )}
    </>
  );
}
