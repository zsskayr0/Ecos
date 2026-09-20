export type IdiomaAplicativo = "pt-BR" | "en-US" | "es-ES";
export type FormatoLink = "curto" | "relativo" | "absoluto";
export type ExcluirAnexos = "perguntar" | "automatico" | "manter";
export type DestinoExclusao = "sistema" | "ecos" | "permanente";

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
}

export function salvarPreferenciasAplicativo(preferencias: PreferenciasAplicativo) {
  try { localStorage.setItem(CHAVE_PREFERENCIAS_APLICATIVO, JSON.stringify(preferencias)); } catch { /* dispositivo sem armazenamento persistente */ }
  aplicarPreferenciasAplicativo(preferencias);
  window.dispatchEvent(new CustomEvent("ecos:preferencias-aplicativo", { detail: preferencias }));
}
