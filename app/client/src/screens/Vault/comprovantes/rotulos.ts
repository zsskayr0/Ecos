import type { TipoAnexo } from "@/lib/api";

/** Como chamar cada tipo de anexo na tela. `artigoPlural` serve para frases como "abrir os comprovantes". */
export const ROTULOS_ANEXO: Record<TipoAnexo, { singular: string; plural: string; titulo: string; artigoPlural: string; vazio: string }> = {
  comprovante: {
    singular: "comprovante",
    plural: "comprovantes",
    titulo: "Comprovantes",
    artigoPlural: "os",
    vazio: "Nenhum comprovante neste lançamento. Anexe um PDF ou uma foto (até 8 MB).",
  },
  nota_fiscal: {
    singular: "nota fiscal",
    plural: "notas fiscais",
    titulo: "Notas fiscais",
    artigoPlural: "as",
    vazio: "Nenhuma nota fiscal neste lançamento. Anexe o PDF ou uma foto da nota (até 8 MB).",
  },
};
