import { beforeAll, describe, expect, it } from "vitest";
import { carregarKatex } from "@/lib/matematica";

// KaTeX chega sob demanda; aqui ele já vem carregado para a leitura renderizar na hora.
beforeAll(() => carregarKatex());
import { render } from "@testing-library/react";
import { MarkdownPreview } from "@/lib/markdown-mini";

const html = (corpo: string) => render(<MarkdownPreview corpo={corpo} />).container;

describe("MarkdownPreview (leitura)", () => {
  it("lista numerada usa números, não bolinhas; checklist continua sem marcador", () => {
    const c = html("1. a\n2. b\n3. c\n\n- x\n\nfim\n\n- [ ] t");
    const ol = c.querySelector("ol")!;
    expect(ol.className).toContain("list-decimal");
    expect(ol.querySelectorAll("li")).toHaveLength(3);
    ol.querySelectorAll("li").forEach((li) => expect(li.className).not.toContain("list-disc"));
    const uls = c.querySelectorAll("ul");
    expect(uls[0].className).toContain("list-disc");
    expect(uls[1].className).not.toContain("list-disc");
    expect(uls[1].querySelector("input[type=checkbox]")).not.toBeNull();
  });

  it("rodapé em português", () => {
    const c = html("Texto[^1]\n\n[^1]: nota");
    expect(c.querySelector("section.footnotes h2")?.textContent).toBe("Notas");
    expect(c.innerHTML).not.toContain("Footnotes");
    expect(c.querySelector("[data-footnote-backref]")?.getAttribute("aria-label")).toMatch(/^Voltar/);
  });

  it("til simples é subscrito, não tachado; ^sup^ e ==realce==", () => {
    const c = html("H~2~O x^2^ ==x== ~~risco~~");
    expect(c.querySelector("sub")?.textContent).toBe("2");
    expect(c.querySelector("sup")?.textContent).toBe("2");
    expect(c.querySelector("mark")?.textContent).toBe("x");
    expect(c.querySelectorAll("del")).toHaveLength(1);
    expect(c.querySelector("del")?.textContent).toBe("risco");
  });

  it("h4–h6, matemática e HTML só por lista branca", () => {
    const c = html("#### Q\n\n##### C\n\n###### S\n\n$$\\int_0^1 x^2 dx$$\n\n<kbd>Ctrl</kbd> a<br>b <script>alert(1)</script><img src=x onerror=alert(1)>");
    expect(c.querySelector("h4")?.className).toContain("font-semibold");
    expect(c.querySelector("h6")).not.toBeNull();
    expect(c.querySelector(".katex annotation")?.textContent).toBe("\\int_0^1 x^2 dx");
    expect(c.querySelector("kbd")?.textContent).toBe("Ctrl");
    expect(c.querySelector("br")).not.toBeNull();
    expect(c.querySelector("script")).toBeNull();
    expect(c.innerHTML).not.toContain("onerror");
  });

  it("bloco de código com realce, rótulo da linguagem e Copiar", () => {
    const c = html("```js\nconst a = 1;\n```");
    expect(c.querySelector("[data-bloco-codigo]")?.textContent).toContain("js");
    expect(c.querySelector("pre code.hljs")).not.toBeNull();
    expect(c.querySelector(".hljs-keyword")?.textContent).toBe("const");
    expect([...c.querySelectorAll("button")].some((b) => b.textContent === "Copiar")).toBe(true);
  });
});
