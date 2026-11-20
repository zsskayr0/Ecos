import { useEffect, useState } from "react";
import { lerPreferenciasAplicativo, type ColunaArquivos } from "@/lib/preferencias-aplicativo";

/** Catálogo das colunas da lista de Arquivos: rótulo, largura na grade e alinhamento. A ordem aqui é a ordem das opções nas Configurações. */
export const COLUNAS_ARQUIVOS: readonly { id: ColunaArquivos; rotulo: string; largura: string; direita?: boolean }[] = [
  { id: "tipo", rotulo: "Tipo", largura: "110px" },
  { id: "tamanho", rotulo: "Tamanho", largura: "90px", direita: true },
  { id: "modificado", rotulo: "Modificado", largura: "110px" },
  { id: "status", rotulo: "Status", largura: "100px" },
  { id: "prioridade", rotulo: "Prioridade", largura: "100px" },
  { id: "prazo", rotulo: "Prazo", largura: "100px" },
  { id: "tags", rotulo: "Tags", largura: "160px" },
  { id: "proprietario", rotulo: "Proprietário", largura: "130px" },
];

const IDS = new Set<string>(COLUNAS_ARQUIVOS.map((c) => c.id));

/** Só colunas que existem, sem repetir (uma preferência antiga ou editada à mão não quebra a lista). */
export function colunasValidas(valor: unknown): ColunaArquivos[] {
  if (!Array.isArray(valor)) return [];
  return [...new Set(valor.filter((v): v is ColunaArquivos => typeof v === "string" && IDS.has(v)))];
}

function ler() {
  const p = lerPreferenciasAplicativo();
  return { colunas: colunasValidas(p.exploradorColunas), checkboxTarefa: p.exploradorCheckboxTarefa !== false };
}

/** Colunas e checkbox da lista de Arquivos (Configurações › Aparência › Pastas), sempre em dia com a preferência. */
export function useColunasArquivos() {
  const [estado, setEstado] = useState(ler);
  useEffect(() => {
    const atualizar = () => setEstado(ler());
    window.addEventListener("ecos:preferencias-aplicativo", atualizar);
    return () => window.removeEventListener("ecos:preferencias-aplicativo", atualizar);
  }, []);
  return estado;
}
