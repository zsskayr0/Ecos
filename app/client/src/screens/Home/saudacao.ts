export type PeriodoDoDia = "manha" | "tarde" | "noite";

/** 5h–11h59 manhã, 12h–17h59 tarde, o resto (inclusive a madrugada) noite. */
export function periodoDoDia(hora: number): PeriodoDoDia {
  if (hora >= 5 && hora < 12) return "manha";
  if (hora >= 12 && hora < 18) return "tarde";
  return "noite";
}

const SAUDACAO: Record<PeriodoDoDia, string> = { manha: "Bom dia", tarde: "Boa tarde", noite: "Boa noite" };
const FRASES: Record<PeriodoDoDia, string[]> = {
  manha: ["Vamos trabalhar?", "Um passo de cada vez hoje.", "O dia está só começando."],
  tarde: ["Vamos continuar?", "Ainda dá tempo de avançar bastante.", "Foco no que importa agora."],
  noite: ["Hora de fechar o dia com calma.", "Anote o que ficou na cabeça.", "Amanhã você agradece o que organizar agora."],
};

/** `agora` é injetado (testável); a frase varia por dia para não repetir sempre a mesma. */
export function saudacaoDoDia(agora: Date, nome: string): { saudacao: string; frase: string } {
  const periodo = periodoDoDia(agora.getHours());
  const frases = FRASES[periodo];
  const primeiro = nome.trim().split(/\s+/)[0] ?? "";
  return { saudacao: primeiro ? `${SAUDACAO[periodo]}, ${primeiro}` : SAUDACAO[periodo], frase: frases[agora.getDate() % frases.length] };
}
