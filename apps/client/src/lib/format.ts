/** Formatadores compartilhados — sempre centavos inteiros, nunca float (seção 1.3-A). */

export function formatMoeda(valorCentavos: number): string {
  const sinal = valorCentavos < 0 ? "-" : "";
  const abs = Math.abs(valorCentavos);
  const reais = Math.floor(abs / 100);
  const centavos = String(abs % 100).padStart(2, "0");
  const reaisFormatado = reais.toLocaleString("pt-BR");
  return `${sinal}R$ ${reaisFormatado},${centavos}`;
}

export function formatTempoRelativo(isoDate: string): string {
  const data = new Date(isoDate);
  const agora = new Date();
  const diffMs = agora.getTime() - data.getTime();
  const diffMin = Math.round(diffMs / 60000);
  const diffHoras = Math.round(diffMin / 60);
  const diffDias = Math.round(diffHoras / 24);

  if (diffMin < 1) return "agora";
  if (diffMin < 60) return `há ${diffMin} min`;
  if (diffHoras < 24) return `há ${diffHoras}h`;
  if (diffDias === 1) return "ontem";
  if (diffDias < 7) return `há ${diffDias} dias`;
  if (diffDias < 30) {
    const semanas = Math.round(diffDias / 7);
    return semanas === 1 ? "há 1 sem" : `há ${semanas} sem`;
  }
  const meses = Math.round(diffDias / 30);
  return meses === 1 ? "há 1 mês" : `há ${meses} meses`;
}

export function formatHora(hhmm: string): string {
  return hhmm;
}

export function formatDuracao(min: number): string {
  if (min < 60) return `${min}min`;
  const h = Math.floor(min / 60);
  const resto = min % 60;
  return resto === 0 ? `${h}h` : `${h}h${resto}`;
}

export const MOTIVO_LABEL: Record<string, string> = {
  frescor: "Frescor",
  orfa: "Órfã",
  interacao: "Interação",
  esquecimento: "Esquecimento",
};

export const MOTIVO_CLASSES: Record<string, { border: string; text: string; bg: string }> = {
  frescor: { border: "border-frescor", text: "text-frescor", bg: "bg-frescor/10" },
  orfa: { border: "border-orfa", text: "text-orfa", bg: "bg-orfa/10" },
  interacao: { border: "border-interacao", text: "text-interacao", bg: "bg-interacao/10" },
  esquecimento: { border: "border-esquecimento", text: "text-esquecimento", bg: "bg-esquecimento/10" },
};
