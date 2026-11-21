import { useEffect, useState } from "react";

/** O Mermaid é pesado: só é baixado quando a nota tem um bloco ```mermaid. */
type Mermaid = typeof import("mermaid").default;
let carregando: Promise<Mermaid> | null = null;
let temaAtual = "";
let contador = 0;

async function mermaid(escuro: boolean, rotulosHtml = true): Promise<Mermaid> {
  carregando ??= import("mermaid").then((m) => m.default);
  const m = await carregando;
  const tema = `${escuro ? "dark" : "neutral"}|${rotulosHtml}`;
  if (tema !== temaAtual) {
    m.initialize({ startOnLoad: false, securityLevel: "strict", theme: escuro ? "dark" : "neutral", fontFamily: "inherit", htmlLabels: rotulosHtml, flowchart: { htmlLabels: rotulosHtml } });
    temaAtual = tema;
  }
  return m;
}

const temaEscuro = () => document.documentElement.classList.contains("dark") || (!document.documentElement.classList.contains("light") && matchMedia("(prefers-color-scheme: dark)").matches);

/** SVG do diagrama (lança erro se a sintaxe estiver errada). */
export async function renderizarMermaid(texto: string, opcoes: { escuro?: boolean; rotulosHtml?: boolean } = {}): Promise<string> {
  const m = await mermaid(opcoes.escuro ?? temaEscuro(), opcoes.rotulosHtml ?? true);
  const { svg } = await m.render(`ecos-mermaid-${++contador}`, texto);
  return svg;
}

/** Diagrama em PNG (data URL), para o PDF. Sem rótulos HTML, para o canvas não ficar "sujo". */
export async function mermaidEmImagem(texto: string): Promise<{ url: string; largura: number } | null> {
  try {
    const svg = await renderizarMermaid(texto, { escuro: false, rotulosHtml: false });
    const doc = new DOMParser().parseFromString(svg, "image/svg+xml").documentElement;
    const vb = doc.getAttribute("viewBox")?.split(/\s+/).map(Number);
    const largura = vb?.[2] || 800;
    const altura = vb?.[3] || 600;
    doc.setAttribute("width", String(largura));
    doc.setAttribute("height", String(altura));
    const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(doc))}`;
    const img = new Image();
    await new Promise<void>((ok, erro) => { img.onload = () => ok(); img.onerror = () => erro(new Error("svg")); img.src = url; });
    const escala = 2;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(largura * escala); canvas.height = Math.round(altura * escala);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return { url: canvas.toDataURL("image/png"), largura };
  } catch { return null; }
}

export function DiagramaMermaid({ texto, linha }: { texto: string; linha?: number }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true;
    setErro(null);
    renderizarMermaid(texto)
      .then((s) => { if (vivo) setSvg(s); })
      .catch((e: unknown) => { if (vivo) { setSvg(null); setErro(e instanceof Error ? e.message : String(e)); } });
    return () => { vivo = false; };
  }, [texto]);
  if (erro) {
    return (
      <div data-linha={linha} className="rounded-xl border border-border bg-surface-2 px-3 py-2 text-[13px] text-text-secondary">
        <div className="mb-1 font-semibold">Diagrama com erro</div>
        <pre className="whitespace-pre-wrap font-['IBM_Plex_Mono',monospace] text-[12px]">{texto}</pre>
      </div>
    );
  }
  return (
    <div data-linha={linha} data-mermaid="" className="ecos-mermaid flex justify-center overflow-x-auto rounded-xl border border-border bg-surface-2 p-3">
      {svg ? <div className="max-w-full" dangerouslySetInnerHTML={{ __html: svg }} /> : <span className="text-[13px] text-text-secondary">Carregando diagrama…</span>}
    </div>
  );
}
