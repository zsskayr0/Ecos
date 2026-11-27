/**
 * Abrir uma rota do app de fora do roteador (o aviso de sincronização, por exemplo, fica acima dele). O desktop abre
 * numa aba (DesktopShell); o celular navega (OuvinteDeRota).
 */
export const EVENTO_ABRIR_ROTA = "ecos:abrir-rota";

export function abrirRota(caminho: string) {
  window.dispatchEvent(new CustomEvent<string>(EVENTO_ABRIR_ROTA, { detail: caminho }));
}
