/** Shared formatters — always integer cents, never a float (section 1.3-A). */

/** Today as `YYYY-MM-DD`, matching the wire format of `TransacaoApi.data` — used to default date pickers and to infer "efetivada" vs "pendente" from a future date. */
export function hojeISO(): string {
  return new Date().toISOString().slice(0, 10);
}

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

/** Último segmento de um caminho de mídia, já decodificado (`src/Media/relat%C3%B3rio.pdf` → `relatório.pdf`). */
export function nomeDoArquivo(caminho: string): string {
  const ultimo = caminho.split("/").pop() ?? "";
  try {
    return decodeURIComponent(ultimo);
  } catch {
    return ultimo;
  }
}

const doisDigitos = (n: number) => String(n).padStart(2, "0");
const contar = (n: number, singular: string, plural: string) => `${n} ${n === 1 ? singular : plural}`;

/**
 * Última edição, como num feed: relativo enquanto recente ("agora", "há 30 minutos",
 * "há 3 horas", "há 2 dias" — até 3 dias), depois a data e a hora ("15/09 - 12:46") e,
 * quando não é o ano corrente, a data completa ("12/04/2024 - 12:30").
 */
export function formatUltimaEdicao(iso: string, agora: Date = new Date()): string {
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return "";
  const MINUTO = 60_000;
  const HORA = 60 * MINUTO;
  const DIA = 24 * HORA;
  const diff = Math.max(0, agora.getTime() - data.getTime());

  if (diff < MINUTO) return "agora";
  if (diff < HORA) return `há ${contar(Math.floor(diff / MINUTO), "minuto", "minutos")}`;
  if (diff < DIA) return `há ${contar(Math.floor(diff / HORA), "hora", "horas")}`;
  if (diff <= 3 * DIA) return `há ${contar(Math.floor(diff / DIA), "dia", "dias")}`;

  const hora = `${doisDigitos(data.getHours())}:${doisDigitos(data.getMinutes())}`;
  const diaMes = `${doisDigitos(data.getDate())}/${doisDigitos(data.getMonth() + 1)}`;
  return data.getFullYear() === agora.getFullYear() ? `${diaMes} - ${hora}` : `${diaMes}/${data.getFullYear()} - ${hora}`;
}

/** "15/09/2026 às 12:46" — para o tooltip do horário relativo. */
export function formatDataHoraCompleta(iso: string): string {
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return "";
  return `${doisDigitos(data.getDate())}/${doisDigitos(data.getMonth() + 1)}/${data.getFullYear()} às ${doisDigitos(data.getHours())}:${doisDigitos(data.getMinutes())}`;
}
