import { describe, expect, it } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkBreaks from "remark-breaks";
import { acharMatematica, remarkMatematicaBloco } from "@/lib/matematica";
import { MarkdownPreview } from "@/lib/markdown-mini";

const PRECOS = ["custa $5 e $10", "R$ 20 a R$ 30", "$5,00", "de $5 até $10,00", "US$ 5 ou US$10", "paguei $ 3 e $4 ontem", "entre $5 e $6."];
const FORMULAS: [string, string][] = [["energia $E = mc^2$ aqui", "E = mc^2"], ["$x$", "x"], ["custo $a_1 + b$, ok", "a_1 + b"]];

/** Mesmo pipeline do PDF (exportar-pdf.ts). */
const htmlPdf = (md: string) => renderToStaticMarkup(createElement(ReactMarkdown, { remarkPlugins: [remarkGfm, remarkMath, remarkMatematicaBloco, remarkBreaks] }, md));

describe("regra estrita do $: preço nunca vira fórmula", () => {
  it.each(PRECOS)("editor: %s", (md) => expect(acharMatematica(md)).toEqual([]));
  it.each(PRECOS)("PDF: %s", (md) => {
    const html = htmlPdf(md);
    expect(html).not.toContain("math-inline");
    expect(html).toContain("$");
  });
  it.each(PRECOS)("leitura: %s", async (md) => {
    const { container } = render(<MarkdownPreview corpo={md} />);
    await new Promise((r) => setTimeout(r, 50));
    expect(container.querySelector(".katex")).toBeNull();
    expect(container.textContent).toContain(md.replace(/\s+/g, " ").trim());
  });
});

describe("fórmulas de verdade continuam", () => {
  it.each(FORMULAS)("editor: %s", (md, tex) => expect(acharMatematica(md).map((m) => m.tex)).toEqual([tex]));
  it.each(FORMULAS)("PDF: %s", (md) => expect(htmlPdf(md)).toContain("math-inline"));
  it.each(FORMULAS)("leitura: %s", async (md) => {
    const { container } = render(<MarkdownPreview corpo={md} />);
    await waitFor(() => expect(container.querySelector(".katex")).not.toBeNull());
  });
  it("$$ sozinho na linha é bloco nos três", async () => {
    expect(acharMatematica("$$x^2$$")[0].bloco).toBe(true);
    expect(htmlPdf("$$x^2$$")).toContain("math-display");
    const { container } = render(<MarkdownPreview corpo={"$$x^2$$"} />);
    await waitFor(() => expect(container.querySelector(".katex-display")).not.toBeNull());
  });
  it("preço e fórmula na mesma linha, nos três", async () => {
    const md = "custa $5 e a área é $x^2$ fim";
    expect(acharMatematica(md).map((m) => m.tex)).toEqual(["x^2"]);
    expect(htmlPdf(md)).toContain('<code class="language-math math-inline">x^2</code>');
    expect(htmlPdf(md)).toContain("custa $5 e a área é ");
    const { container } = render(<MarkdownPreview corpo={md} />);
    await waitFor(() => expect(container.querySelectorAll(".katex")).toHaveLength(1));
    expect(container.textContent).toContain("custa $5 e a área é");
  });
});
