import { CircleDashed, FileSpreadsheet, Github, HelpCircle, ShieldCheck, type LucideIcon } from "lucide-react";

/**
 * Abas das configurações do Cofre. Ficam fora de `CofreConfigScreen` para que o menu de Configurações e a tabela de rotas
 * conheçam as abas sem puxar a tela inteira (e o Cofre) para o pacote inicial.
 */
export type Aba = "seguranca" | "valores" | "csv" | "github" | "ajuda";

export const ABAS_COFRE: { id: Aba; rotulo: string; Icone: LucideIcon }[] = [
  { id: "seguranca", rotulo: "Segurança", Icone: ShieldCheck },
  { id: "valores", rotulo: "Exibição e valores", Icone: CircleDashed },
  { id: "csv", rotulo: "Backup & CSV", Icone: FileSpreadsheet },
  { id: "github", rotulo: "GitHub", Icone: Github },
  { id: "ajuda", rotulo: "Ajuda & Suporte", Icone: HelpCircle },
];
