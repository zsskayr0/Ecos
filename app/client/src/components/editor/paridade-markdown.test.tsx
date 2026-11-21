/**
 * Paridade entre os dois motores de Markdown (C3):
 *  - editor ao vivo (`EditorVivo`, CodeMirror + Lezer, decorações próprias);
 *  - leitura (`MarkdownPreview`, react-markdown + remark/rehype).
 *
 * Cada caso é o mesmo Markdown renderizado nos dois lados, com o "sinal" que prova
 * o recurso em cada um. `estado` registra o combinado:
 *  - "ok": os dois lados têm que mostrar o recurso;
 *  - "falta-editor" / "falta-leitura": lacuna conhecida. O teste confirma que ela
 *    ainda existe; quando alguém implementar o lado que falta, ele falha e pede
 *    para trocar o caso para "ok" (assim a tabela nunca fica desatualizada).
 *
 * Recurso novo de Markdown = um caso novo aqui.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { carregarKatex } from "@/lib/matematica";

// KaTeX chega sob demanda; aqui ele já vem carregado para a leitura renderizar na hora.
beforeAll(() => carregarKatex());
import { render } from "@testing-library/react";
import { createRef } from "react";
import { EditorVivo, type AreaLike } from "./EditorVivo";
import { MarkdownPreview } from "@/lib/markdown-mini";

type Sinal = (raiz: HTMLElement) => boolean;
type Estado = "ok" | "falta-editor" | "falta-leitura";
interface Caso { nome: string; md: string; editor: Sinal; leitura: Sinal; estado: Estado }

const tem = (sel: string, texto?: string): Sinal => (r) =>
  [...r.querySelectorAll(sel)].some((e) => texto === undefined || e.textContent?.trim() === texto);
const textoContem = (s: string): Sinal => (r) => (r.textContent ?? "").includes(s);
const naoTem = (sel: string): Sinal => (r) => !r.querySelector(sel);

const CASOS: Caso[] = [
  { nome: "negrito", md: "**forte**", editor: tem(".cm-neg"), leitura: tem("strong", "forte"), estado: "ok" },
  { nome: "itálico com _", md: "_ita_", editor: tem(".cm-ita"), leitura: tem("em", "ita"), estado: "ok" },
  { nome: "tachado ~~", md: "~~risco~~", editor: tem(".cm-tach"), leitura: tem("del", "risco"), estado: "ok" },
  { nome: "código inline", md: "use `x`", editor: tem(".cm-cod"), leitura: tem("code", "x"), estado: "ok" },
  { nome: "link com URL", md: "[site](https://ecos.test)", editor: tem(".cm-link", "site"), leitura: tem("a[href='https://ecos.test']", "site"), estado: "ok" },
  { nome: "[1] não é link", md: "ver [1]", editor: (r) => naoTem(".cm-link")(r) && textoContem("[1]")(r), leitura: (r) => naoTem("a")(r) && textoContem("[1]")(r), estado: "ok" },
  { nome: "[TOC] vira sumário", md: "[TOC]\n\n# Um\n\n## Dois", editor: tem(".cm-sumario-item", "Dois"), leitura: tem("ul.ecos-sumario a", "Dois"), estado: "ok" },
  { nome: "nota de rodapé", md: "Texto[^1]\n\n[^1]: nota", editor: (r) => tem(".cm-nota-ref")(r) && tem(".cm-nota-def")(r), leitura: tem("sup a[data-footnote-ref]"), estado: "ok" },
  { nome: "lista numerada mantém números", md: "1. a\n2. b\n3. c", editor: textoContem("2."), leitura: tem("ol.list-decimal"), estado: "ok" },
  { nome: "título nível 4", md: "#### Quarto", editor: tem(".cm-h4"), leitura: tem("h4", "Quarto"), estado: "ok" },
  { nome: "título nível 6", md: "###### Sexto", editor: tem(".cm-h6"), leitura: tem("h6", "Sexto"), estado: "ok" },
  { nome: "==realce==", md: "um ==dois== três", editor: tem(".cm-realce", "dois"), leitura: tem("mark", "dois"), estado: "ok" },
  { nome: "bloco de código com linguagem", md: "```js\nconst a = 1;\n```", editor: tem(".cm-cod-lingua"), leitura: tem("code.language-js"), estado: "ok" },
  { nome: "tabela: _itálico_ na célula", md: "| A | B |\n|---|---|\n| _ita_ | 2 |", editor: tem(".cm-tabela em", "ita"), leitura: tem("td em", "ita"), estado: "ok" },
  { nome: "tabela: link na célula", md: "| A | B |\n|---|---|\n| [l](https://ecos.test) | 2 |", editor: tem(".cm-tabela a", "l"), leitura: tem("td a", "l"), estado: "ok" },
  // Lacunas conhecidas do editor ao vivo (a leitura já suporta).
  { nome: "H~2~O subscrito", md: "H~2~O", editor: tem("sub, .cm-sub"), leitura: tem("sub", "2"), estado: "falta-editor" },
  { nome: "x^2^ sobrescrito", md: "x^2^", editor: tem("sup, .cm-sup"), leitura: tem("sup", "2"), estado: "falta-editor" },
  { nome: "matemática $$", md: "$$\\int_0^1 x^2 dx$$", editor: tem(".katex, .cm-mat-bloco"), leitura: tem(".katex"), estado: "ok" },
  { nome: "<kbd> inline", md: "<kbd>Ctrl</kbd>", editor: tem("kbd, .cm-kbd"), leitura: tem("kbd", "Ctrl"), estado: "falta-editor" },
];

function editor(md: string): HTMLElement {
  const areaRef = createRef<AreaLike | null>() as React.MutableRefObject<AreaLike | null>;
  // Sem foco não há linha ativa: tudo aparece decorado, como fora do cursor.
  return render(<EditorVivo corpo={md} onCorpoChange={() => {}} areaRef={areaRef} ariaLabel="t" alturaMinima="0" />).container;
}
const leitura = (md: string) => render(<MarkdownPreview corpo={md} />).container;

describe("paridade editor ao vivo × leitura", () => {
  for (const c of CASOS) {
    it(`${c.nome} (${c.estado})`, () => {
      const e = c.editor(editor(c.md));
      const l = c.leitura(leitura(c.md));
      const esperado = { editor: c.estado !== "falta-editor", leitura: c.estado !== "falta-leitura" };
      expect({ editor: e, leitura: l }, c.estado === "ok"
        ? "os dois motores divergem neste caso"
        : "a lacuna foi resolvida: troque o caso para \"ok\"").toEqual(esperado);
    });
  }
});
