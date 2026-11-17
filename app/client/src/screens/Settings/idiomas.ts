import { Globe2 } from "lucide-react";
import { TOM } from "@/components/common/MenuSuspenso";

/** Idiomas oferecidos para a interface e para o corretor ortográfico. */
export const IDIOMAS = [
  { valor: "pt-BR", rotulo: "Português do Brasil", icone: Globe2, cor: TOM.aco },
  { valor: "en-US", rotulo: "English (US)", icone: Globe2, cor: TOM.ciano },
  { valor: "es-ES", rotulo: "Español", icone: Globe2, cor: TOM.violeta },
] as const;
