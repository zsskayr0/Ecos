import { StateEffect, StateField, type EditorState, type Range } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { acharMatematica, carregarKatex, katexCarregado, renderizarFormula, temMatematica } from "@/lib/matematica";

/**
 * Fórmulas no editor vivo: fora do cursor, `$...$` e `$$...$$` aparecem desenhadas pelo KaTeX;
 * com o cursor dentro (ou na linha do bloco), volta o código para editar. Erro de sintaxe aparece no lugar, em vermelho.
 */
class FormulaWidget extends WidgetType {
  readonly pronto = !!katexCarregado();
  constructor(readonly tex: string, readonly bloco: boolean, readonly de: number) { super(); }
  eq(o: FormulaWidget) { return o.tex === this.tex && o.bloco === this.bloco && o.de === this.de && o.pronto === this.pronto; }
  toDOM(view: EditorView) {
    const el = document.createElement(this.bloco ? "div" : "span");
    el.className = this.bloco ? "cm-mat-bloco" : "cm-mat";
    el.title = "Clique para editar a fórmula";
    const katex = katexCarregado();
    if (katex) {
      try { el.innerHTML = renderizarFormula(katex, this.tex, this.bloco); }
      catch (e) { el.textContent = this.tex; el.classList.add("cm-mat-erro"); el.title = String((e as Error).message ?? e); }
    } else {
      // KaTeX ainda chegando: mostra o código e redesenha quando carregar.
      el.textContent = this.tex;
      void carregarKatex().then(() => { if (view.dom.isConnected) view.dispatch({ effects: katexChegou.of(null) }); }).catch(() => {});
    }
    el.addEventListener("mousedown", (e) => {
      e.preventDefault();
      view.dispatch({ selection: { anchor: this.de + (/^\s*(\$\$|\\)/.test(view.state.sliceDoc(this.de, this.de + 4)) ? 2 : 1) } });
      view.focus();
    });
    return el;
  }
  ignoreEvent() { return true; }
}

const focoEfeito = StateEffect.define<boolean>();
const katexChegou = StateEffect.define<null>();

function emCodigo(state: EditorState, de: number, ate: number) {
  let achou = false;
  syntaxTree(state).iterate({ from: de, to: ate, enter: (no) => {
    if (no.name === "FencedCode" || no.name === "InlineCode" || no.name === "CodeBlock") { achou = true; return false; }
  } });
  return achou;
}

type Trechos = ReturnType<typeof acharMatematica>;

/** Varre o texto atrás de fórmulas. Caro: só roda quando o texto muda. */
function achar(state: EditorState): Trechos {
  const texto = state.doc.toString();
  if (!temMatematica(texto)) return [];
  ensureSyntaxTree(state, state.doc.length, 50);
  return acharMatematica(texto, (de, ate) => emCodigo(state, de, ate));
}

function montar(state: EditorState, focado: boolean, trechos: Trechos): DecorationSet {
  if (!trechos.length) return Decoration.none;
  const decos: Range<Decoration>[] = [];
  for (const m of trechos) {
    // Bloco: qualquer linha dele com o cursor mostra o código. Na linha: só se o cursor toca a fórmula.
    const [a, b] = m.bloco ? [state.doc.lineAt(m.de).from, state.doc.lineAt(m.ate).to] : [m.de, m.ate];
    const editando = focado && state.selection.ranges.some((r) => r.from <= b && r.to >= a);
    if (editando) {
      if (m.bloco) for (let n = state.doc.lineAt(m.de).number; n <= state.doc.lineAt(m.ate).number; n++) decos.push(Decoration.line({ class: "cm-mat-fonte" }).range(state.doc.line(n).from));
      else decos.push(Decoration.mark({ class: "cm-mat-fonte" }).range(m.de, m.ate));
      continue;
    }
    decos.push(Decoration.replace({ widget: new FormulaWidget(m.tex, m.bloco || !!m.exibicao, m.de), block: m.bloco }).range(m.de, m.ate));
  }
  return Decoration.set(decos, true);
}

/** Decoração de bloco precisa vir de um StateField (um ViewPlugin não pode substituir linhas inteiras). */
export const matematica = StateField.define<{ focado: boolean; trechos: Trechos; decos: DecorationSet }>({
  create: (state) => { const trechos = achar(state); return { focado: false, trechos, decos: montar(state, false, trechos) }; },
  update(v, tr) {
    let focado = v.focado, chegou = false;
    for (const e of tr.effects) { if (e.is(focoEfeito)) focado = e.value; if (e.is(katexChegou)) chegou = true; }
    if (!tr.docChanged && !tr.selection && focado === v.focado && !chegou) return v;
    const trechos = tr.docChanged || chegou ? achar(tr.state) : v.trechos;
    // Sem fórmula na nota, mexer o cursor não custa nada.
    if (!tr.docChanged && !chegou && !trechos.length && focado === v.focado) return v;
    return { focado, trechos, decos: montar(tr.state, focado, trechos) };
  },
  provide: (f) => [
    EditorView.decorations.from(f, (v) => v.decos),
    EditorView.focusChangeEffect.of((_, focando) => focoEfeito.of(focando)),
  ],
});

export const temaMatematica = EditorView.theme({
  ".cm-mat": { cursor: "pointer", padding: "0 1px" },
  ".cm-mat-bloco": { cursor: "pointer", textAlign: "center", padding: "6px 0", overflowX: "auto", overflowY: "hidden" },
  ".cm-mat .katex, .cm-mat-bloco .katex": { fontSize: "1.1em" },
  ".cm-mat-bloco .katex-display": { margin: "0" },
  ".cm-mat-fonte": { fontFamily: "var(--ecos-font-mono, ui-monospace, monospace)", color: "rgb(var(--ecos-steel-300-rgb))" },
  ".cm-mat-erro": { color: "#e5484d", fontFamily: "ui-monospace, monospace" },
});
