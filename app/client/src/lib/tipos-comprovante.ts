/** Mesmo limite do Cofre (`ANEXO_TAMANHO_MAXIMO_BYTES`); conferido no cliente só para avisar antes de enviar. */
export const ANEXO_TAMANHO_MAXIMO_BYTES = 8 * 1024 * 1024;

const TIPOS = ["image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf"];
const EXTENSOES = /\.(jpe?g|png|webp|heic|pdf)$/i;

/** O Cofre só guarda PDF e imagem. O tipo vem do sistema; quando ele não informa (comum com HEIC no Windows), vale a extensão. */
export function ehArquivoDoCofre(arquivo: File): boolean {
  return TIPOS.includes(arquivo.type) || (!arquivo.type && EXTENSOES.test(arquivo.name));
}

/** Tipos de item (durante um arrasto só o tipo é conhecido) que o Cofre aceita. */
export const TIPOS_DO_COFRE = TIPOS;
