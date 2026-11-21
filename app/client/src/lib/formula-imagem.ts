import { carregarKatex, renderizarFormula } from "@/lib/matematica";

/**
 * Fórmula → JPEG para o PDF. O PDF do Ecos só escreve texto simples, então a fórmula é desenhada pelo
 * KaTeX no navegador e fotografada: o HTML vai num SVG (foreignObject) com o CSS e as fontes do KaTeX embutidos.
 */

let cssEmbutido: Promise<string> | null = null;

const paraDataUrl = (blob: Blob) => new Promise<string>((ok, erro) => {
  const r = new FileReader();
  r.onload = () => ok(String(r.result));
  r.onerror = () => erro(r.error);
  r.readAsDataURL(blob);
});

/** CSS do KaTeX já carregado na página, com as fontes trocadas por data: URLs (a imagem do SVG não busca nada fora). */
function cssDoKatex(): Promise<string> {
  cssEmbutido ??= (async () => {
    let css = "";
    for (const folha of Array.from(document.styleSheets)) {
      let regras: CSSRuleList;
      try { regras = folha.cssRules; } catch { continue; }
      const texto = Array.from(regras).map((r) => r.cssText).join("\n");
      if (!texto.includes(".katex")) continue;
      const base = folha.href ?? location.href;
      const urls = new Map<string, string>();
      for (const m of texto.matchAll(/url\(["']?([^"')]+\.(?:woff2|woff|ttf))["']?\)/g)) urls.set(m[1], m[1]);
      let saida = texto;
      await Promise.all(Array.from(urls.keys()).map(async (u) => {
        try {
          const resp = await fetch(new URL(u, base));
          if (resp.ok) urls.set(u, await paraDataUrl(await resp.blob()));
        } catch { /* sem a fonte, sai com a fonte reserva */ }
      }));
      for (const [u, dado] of urls) saida = saida.split(u).join(dado);
      css += saida + "\n";
    }
    return css;
  })();
  return cssEmbutido;
}

export async function imagemDaFormula(tex: string, bloco: boolean, tamanhoPx = 20): Promise<{ bytes: Uint8Array; largura: number; altura: number } | null> {
  try {
    const katex = await carregarKatex();
    const css = await cssDoKatex();
    const caixa = document.createElement("div");
    caixa.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
    caixa.style.cssText = `position:fixed;left:-10000px;top:0;display:inline-block;padding:2px 3px;color:#0f1729;background:#fff;font-size:${tamanhoPx}px;line-height:1.2;white-space:nowrap`;
    caixa.innerHTML = renderizarFormula(katex, tex, bloco);
    caixa.querySelectorAll(".katex-display").forEach((d) => ((d as HTMLElement).style.margin = "0"));
    document.body.appendChild(caixa);
    await document.fonts?.ready;
    const r = caixa.getBoundingClientRect();
    const w = Math.ceil(r.width), h = Math.ceil(r.height);
    caixa.style.position = ""; caixa.style.left = ""; caixa.style.top = "";
    const xhtml = new XMLSerializer().serializeToString(caixa);
    caixa.remove();
    if (!w || !h) return null;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><foreignObject width="100%" height="100%"><style><![CDATA[${css.replace(/]]>/g, "")}]]></style>${xhtml}</foreignObject></svg>`;
    const img = new Image();
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    await img.decode();
    const escala = 3;
    const canvas = document.createElement("canvas");
    canvas.width = w * escala; canvas.height = h * escala;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(escala, escala);
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/jpeg", 0.92));
    return blob ? { bytes: new Uint8Array(await blob.arrayBuffer()), largura: canvas.width, altura: canvas.height } : null;
  } catch { return null; }
}
