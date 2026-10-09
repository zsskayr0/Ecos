export type IdiomaAplicativo = "pt-BR" | "en-US" | "es-ES";
export type FormatoLink = "curto" | "relativo" | "absoluto";
export type ExcluirAnexos = "perguntar" | "automatico" | "manter";
export type DestinoExclusao = "sistema" | "ecos" | "permanente";
export type EstiloPastas = "grade" | "compacta";
export type AltoContraste = "sistema" | "ligado" | "desligado";
export type FormatoData = "completa" | "curta" | "mdy" | "dmy" | "ymd" | "relativo";
export type PrioridadePadrao = "baixa" | "media" | "alta";
export type VisualizacaoTarefasDesktop = "tabela" | "grade" | "kanban" | "matriz";
export type VisualizacaoTarefasMobile = "cards" | "lista" | "agrupada";
/** Escalas da interface, em % do tamanho original. */
export const ESCALAS_INTERFACE = [90, 100, 110, 125] as const;
export type EscalaInterface = (typeof ESCALAS_INTERFACE)[number];
export type ReduzirMovimento = "sistema" | "ligado" | "desligado";

export interface PreferenciasAplicativo {
  idioma: IdiomaAplicativo;
  aceleracaoHardware: boolean;
  corretorOrtografico: boolean;
  idiomaCorretor: IdiomaAplicativo;
  formatoLink: FormatoLink;
  atualizarLinks: boolean;
  usarWikilinks: boolean;
  confirmarExclusao: boolean;
  excluirAnexos: ExcluirAnexos;
  destinoExclusao: DestinoExclusao;
  /** Pastas aparecem abertas ao entrar em Notas e Tarefas (padrão: ocultas). */
  pastasVisiveis: boolean;
  /** `grade`: blocos quadrados; `compacta`: blocos baixos, um nome por linha, como uma lista em grade. */
  estiloPastas: EstiloPastas;
  /** `sistema` segue `prefers-contrast: more` do sistema operacional. */
  altoContraste: AltoContraste;
  /** Calendários (Agenda, seletores de data) começam a semana na segunda em vez do domingo. */
  semanaComecaSegunda: boolean;
  /** Formato padrão das datas mostradas no app. */
  formatoData: FormatoData;

  /* Uso diário */
  /** Prioridade que uma tarefa nova já traz preenchida. */
  tarefaPrioridade: PrioridadePadrao;
  /** Duração estimada (minutos) que uma tarefa nova já traz. */
  tarefaDuracaoMin: number;
  /** As listas de tarefas abrem mostrando também as concluídas. */
  mostrarConcluidas: boolean;
  visualizacaoTarefasDesktop: VisualizacaoTarefasDesktop;
  visualizacaoTarefasMobile: VisualizacaoTarefasMobile;
  /** Na captura rápida do Feed, o que a tecla Enter cria (Ctrl+Enter cria o outro). */
  capturaEnter: "nota" | "tarefa";
  /** Encaixe (passo de arrastar e redimensionar) inicial da Agenda, em minutos. */
  agendaEncaixe: 5 | 10 | 15 | 30 | 60;

  /* Aparência e conforto */
  escalaInterface: EscalaInterface;
  reduzirMovimento: ReduzirMovimento;

  /* Notificações (resumo e silêncio valem para os avisos gerados neste aparelho) */
  resumoDiario: boolean;
  /** `HH:MM`. */
  resumoHora: string;
  silencioAtivo: boolean;
  silencioInicio: string;
  silencioFim: string;
}

export const CHAVE_PREFERENCIAS_APLICATIVO = "ecos:preferencias-aplicativo:v1";
export const PADRAO_PREFERENCIAS_APLICATIVO: PreferenciasAplicativo = {
  idioma: "pt-BR",
  aceleracaoHardware: true,
  corretorOrtografico: true,
  idiomaCorretor: "pt-BR",
  formatoLink: "curto",
  atualizarLinks: true,
  usarWikilinks: true,
  confirmarExclusao: true,
  excluirAnexos: "perguntar",
  destinoExclusao: "sistema",
  pastasVisiveis: false,
  estiloPastas: "grade",
  altoContraste: "sistema",
  semanaComecaSegunda: false,
  formatoData: "dmy",
  tarefaPrioridade: "baixa",
  tarefaDuracaoMin: 5,
  mostrarConcluidas: false,
  visualizacaoTarefasDesktop: "tabela",
  visualizacaoTarefasMobile: "cards",
  capturaEnter: "nota",
  agendaEncaixe: 15,
  escalaInterface: 100,
  reduzirMovimento: "sistema",
  resumoDiario: false,
  resumoHora: "08:00",
  silencioAtivo: false,
  silencioInicio: "22:00",
  silencioFim: "07:00",
};

export function lerPreferenciasAplicativo(): PreferenciasAplicativo {
  try {
    const salvo = JSON.parse(localStorage.getItem(CHAVE_PREFERENCIAS_APLICATIVO) ?? "null");
    return salvo && typeof salvo === "object" ? { ...PADRAO_PREFERENCIAS_APLICATIVO, ...salvo } : { ...PADRAO_PREFERENCIAS_APLICATIVO };
  } catch { return { ...PADRAO_PREFERENCIAS_APLICATIVO }; }
}

export function aplicarPreferenciasAplicativo(preferencias = lerPreferenciasAplicativo()) {
  document.documentElement.lang = preferencias.idioma;
  if (document.body) {
    document.body.lang = preferencias.idiomaCorretor;
    document.body.spellcheck = preferencias.corretorOrtografico;
  }
  const raiz = document.documentElement;
  const alto = preferencias.altoContraste === "ligado" || (preferencias.altoContraste === "sistema" && !!window.matchMedia?.("(prefers-contrast: more)").matches);
  if (alto) raiz.setAttribute("data-contraste", "alto"); else raiz.removeAttribute("data-contraste");
  // Tamanho da interface: o Tailwind mede em rem, então escalar a raiz escala texto, espaços e alvos de toque juntos.
  raiz.style.fontSize = preferencias.escalaInterface === 100 ? "" : `${preferencias.escalaInterface}%`;
  const movimento = preferencias.reduzirMovimento === "ligado" || (preferencias.reduzirMovimento === "sistema" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
  if (movimento) raiz.setAttribute("data-reduzir-movimento", "true"); else raiz.removeAttribute("data-reduzir-movimento");
}

export function salvarPreferenciasAplicativo(preferencias: PreferenciasAplicativo) {
  try { localStorage.setItem(CHAVE_PREFERENCIAS_APLICATIVO, JSON.stringify(preferencias)); } catch { /* dispositivo sem armazenamento persistente */ }
  aplicarPreferenciasAplicativo(preferencias);
  window.dispatchEvent(new CustomEvent("ecos:preferencias-aplicativo", { detail: preferencias }));
}
