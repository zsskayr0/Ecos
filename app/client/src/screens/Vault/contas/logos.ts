/**
 * Logos em SVG dos bancos, pintados com a cor do texto do selo (herdam `currentColor`).
 *
 * Duas origens, nesta ordem:
 *  1. `./logos/<codigo-do-banco>.svg` — SVGs que a pessoa/projeto soltar na pasta (ex.: `341.svg` para o Itaú).
 *  2. O pacote `simple-icons` (CC0), que traz só alguns bancos brasileiros.
 * Banco sem logo cai no selo com a sigla (ver `SeloConta`).
 */

/** Marcas do `simple-icons` que correspondem a bancos do catálogo (arquivo → código COMPE). */
const SIMPLE_ICONS: Record<string, string> = { nubank: "260", cora: "403", mercadopago: "323", neon: "536", pagseguro: "290", picpay: "380" };

const doPacote = import.meta.glob<string>("/node_modules/simple-icons/icons/{nubank,cora,mercadopago,neon,pagseguro,picpay}.svg", { query: "?raw", import: "default", eager: true });
const daPasta = import.meta.glob<string>("./logos/*.svg", { query: "?raw", import: "default", eager: true });

/** Deixa o SVG decorativo e sem título (o selo tem o próprio rótulo) para poder ser inserido na página. */
function prepararSvg(bruto: string): string {
  return bruto.replace(/<title>[\s\S]*?<\/title>/gi, "").replace(/\srole="img"/i, ' aria-hidden="true" focusable="false"');
}

const LOGOS = new Map<string, string>();
for (const [caminho, svg] of Object.entries(doPacote)) {
  const arquivo = caminho.split("/").pop()!.replace(/\.svg$/, "");
  const codigo = SIMPLE_ICONS[arquivo];
  if (codigo) LOGOS.set(codigo, prepararSvg(svg));
}
for (const [caminho, svg] of Object.entries(daPasta)) {
  const codigo = caminho.split("/").pop()!.replace(/\.svg$/, "");
  LOGOS.set(codigo.padStart(3, "0"), prepararSvg(svg));
}

/** SVG (como texto) do banco de código COMPE `codigo`, ou `undefined` se não houver. */
export function logoDoBanco(codigo: string | null | undefined): string | undefined {
  return codigo ? LOGOS.get(codigo.padStart(3, "0")) : undefined;
}
