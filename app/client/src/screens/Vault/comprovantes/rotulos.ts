import { FileSignature, Paperclip, Receipt, type LucideIcon } from "lucide-react";
import type { TipoAnexo } from "@/lib/api";

/** Ícone de cada tipo de anexo. */
export const ICONE_ANEXO: Record<TipoAnexo, LucideIcon> = { comprovante: Paperclip, nota_fiscal: Receipt, recibo_lucros: FileSignature };

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
  recibo_lucros: {
    singular: "recibo de lucros",
    plural: "recibos de lucros",
    titulo: "Recibos de lucros",
    artigoPlural: "os",
    vazio: "Nenhum recibo de distribuição de lucros neste lançamento. Anexe o PDF ou uma foto do recibo assinado (até 8 MB).",
  },
};
