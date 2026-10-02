/** Tipo da equipe (`equipe.tipo` no servidor). Hoje só rotula; as regras de cada tipo vão divergir depois. */
export type TipoEquipe = "pessoal" | "corporativo";

export const TIPOS_DE_EQUIPE: { valor: TipoEquipe; rotulo: string; descricao: string }[] = [
  { valor: "pessoal", rotulo: "Pessoal/Familiar", descricao: "Casa, família, casal, amigos." },
  { valor: "corporativo", rotulo: "Corporativo", descricao: "Empresa, time ou projeto de trabalho." },
];

export function rotuloDoTipoDeEquipe(tipo?: string | null): string {
  return TIPOS_DE_EQUIPE.find((t) => t.valor === tipo)?.rotulo ?? "Pessoal/Familiar";
}
