/** Extrai o código de convite de um QR code: o link `<servidor>/entrar/<código>` (ver `QrConvite`) ou o código solto. */
export function codigoDoQrConvite(texto: string): string | null {
  const t = texto.trim();
  const noLink = /\/entrar\/([A-Za-z0-9]{4,32})\/?(?:[?#].*)?$/.exec(t);
  if (noLink) return noLink[1]!.toUpperCase();
  return /^[A-Za-z0-9]{6,32}$/.test(t) ? t.toUpperCase() : null;
}
