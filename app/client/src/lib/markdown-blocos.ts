import type { Plugin } from "unified";
import type { Root } from "mdast";

/**
 * Blocos extras do Markdown do Ecos, compartilhados entre leitura e PDF:
 * - callout: `> [!nota] Título` (com `-`/`+` depois do tipo vira dobrável);
 * - imagem: `![alt|300|centro](src "legenda")` — largura e alinhamento no alt.
 */

export const TIPOS_CALLOUT: Record<string, { rotulo: string; icone: string }> = {
  nota: { rotulo: "Nota", icone: "📝" },
  info: { rotulo: "Info", icone: "ℹ️" },
  dica: { rotulo: "Dica", icone: "💡" },
  aviso: { rotulo: "Aviso", icone: "⚠️" },
  perigo: { rotulo: "Perigo", icone: "⛔" },
  sucesso: { rotulo: "Sucesso", icone: "✅" },
  pergunta: { rotulo: "Pergunta", icone: "❓" },
  citacao: { rotulo: "Citação", icone: "💬" },
};

/** Sinônimos (inclusive em inglês) apontam para um dos tipos acima. */
const SINONIMOS: Record<string, string> = {
  note: "nota", tip: "dica", hint: "dica", important: "info", abstract: "info", resumo: "info",
  warning: "aviso", caution: "aviso", atencao: "aviso", danger: "perigo", error: "perigo", erro: "perigo",
  success: "sucesso", check: "sucesso", done: "sucesso", question: "pergunta", faq: "pergunta",
  quote: "citacao", cite: "citacao", todo: "nota", example: "info", exemplo: "info",
};

export function tipoCallout(bruto: string): string {
  const t = bruto.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  return TIPOS_CALLOUT[t] ? t : SINONIMOS[t] ?? "nota";
}

const CABECA_RE = /^\[!([\p{L}\w-]+)\]([+-]?)[ \t]*([^\n]*)\n?/u;

interface No { type: string; value?: string; children?: No[]; data?: Record<string, unknown> }

function percorrerCallouts(no: No) {
  if (!no.children) return;
  for (const filho of no.children) {
    percorrerCallouts(filho);
    if (filho.type !== "blockquote") continue;
    const primeiro = filho.children?.[0];
    const texto = primeiro?.type === "paragraph" ? primeiro.children?.[0] : undefined;
    if (!texto || texto.type !== "text" || !texto.value) continue;
    const m = CABECA_RE.exec(texto.value);
    if (!m) continue;
    const tipo = tipoCallout(m[1]);
    const dobra = m[2];
    const titulo = m[3].trim() || TIPOS_CALLOUT[tipo].rotulo;
    texto.value = texto.value.slice(m[0].length);
    // Remove a quebra que sobra entre o cabeçalho e o resto do parágrafo.
    if (!texto.value && primeiro!.children![1]?.type === "break") primeiro!.children!.splice(1, 1);
    if (!texto.value) primeiro!.children!.shift();
    if (!primeiro!.children!.length) filho.children!.shift();
    const cabeca: No = {
      type: "calloutTitulo",
      data: { hName: dobra ? "summary" : "div", hProperties: { className: ["ecos-callout-titulo"] } },
      children: [
        { type: "calloutIcone", data: { hName: "span", hProperties: { className: ["ecos-callout-icone"], ariaHidden: "true" } }, children: [{ type: "text", value: TIPOS_CALLOUT[tipo].icone }] },
        { type: "text", value: titulo },
      ],
    };
    const corpo: No = { type: "calloutCorpo", data: { hName: "div", hProperties: { className: ["ecos-callout-corpo"] } }, children: filho.children ?? [] };
    filho.children = [cabeca, ...(corpo.children!.length ? [corpo] : [])];
    filho.data = {
      hName: dobra ? "details" : "div",
      hProperties: { className: ["ecos-callout", `ecos-callout-${tipo}`], dataCallout: tipo, ...(dobra === "+" ? { open: true } : {}) },
    };
  }
}

export const remarkCallouts: Plugin<[], Root> = () => (tree) => { percorrerCallouts(tree as unknown as No); };

export type Alinhamento = "esquerda" | "centro" | "direita";

/** `alt|300|centro` → texto, largura em px (ou %), alinhamento. */
export function lerAltImagem(alt: string | undefined): { alt: string; largura?: string; alinhar?: Alinhamento } {
  const partes = (alt ?? "").split("|");
  const res: { alt: string; largura?: string; alinhar?: Alinhamento } = { alt: partes[0].trim() };
  for (const p of partes.slice(1).map((x) => x.trim().toLowerCase())) {
    if (/^\d{1,4}(px)?$/.test(p)) res.largura = `${parseInt(p, 10)}px`;
    else if (/^\d{1,3}%$/.test(p)) res.largura = p;
    else if (/^(centro|centralizado|center)$/.test(p)) res.alinhar = "centro";
    else if (/^(esquerda|left)$/.test(p)) res.alinhar = "esquerda";
    else if (/^(direita|right)$/.test(p)) res.alinhar = "direita";
  }
  return res;
}
