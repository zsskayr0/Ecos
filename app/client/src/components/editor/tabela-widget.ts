import { StateEffect, StateField, type EditorState, type Range } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";

type Alinhamento = "left" | "center" | "right" | null;

export interface TabelaMd {
  cabecalho: string[];
  alinhamentos: Alinhamento[];
  linhas: string[][];
}

/** Divide uma linha de tabela GFM em células, respeitando `\|` e as barras das pontas. */
export function dividirLinha(linha: string): string[] {
  let t = linha.trim();
  if (t.startsWith("|")) t = t.slice(1);
  if (t.endsWith("|") && !t.endsWith("\\|")) t = t.slice(0, -1);
  const celulas: string[] = [];
  let atual = "";
  for (let i = 0; i < t.length; i++) {
    if (t[i] === "\\" && t[i + 1] === "|") { atual += "|"; i++; }
    else if (t[i] === "|") { celulas.push(atual.trim()); atual = ""; }
    else atual += t[i];
  }
  celulas.push(atual.trim());
  return celulas;
}

export function lerTabela(texto: string): TabelaMd | null {
  const linhas = texto.split("\n");
  if (linhas.length < 2) return null;
  const cabecalho = dividirLinha(linhas[0]);
  const delim = dividirLinha(linhas[1]);
  if (!delim.length || !delim.every((c) => /^:?-+:?$/.test(c))) return null;
  const alinhamentos = cabecalho.map((_, i): Alinhamento => {
    const d = delim[i] ?? "";
    const e = d.startsWith(":");
    const dir = d.endsWith(":");
    return e && dir ? "center" : dir ? "right" : e ? "left" : null;
  });
  const corpo = linhas.slice(2).filter((l) => l.trim()).map((l) => {
    const c = dividirLinha(l);
    return cabecalho.map((_, i) => c[i] ?? "");
  });
  return { cabecalho, alinhamentos, linhas: corpo };
}

const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(~~[^~\n]+~~)|(\*[^*\n]+\*)|\[\[([^\]|\n]+)(?:\|([^\]\n]*))?\]\]/g;

/** Formatação inline mínima dentro da célula (código, negrito, itálico, riscado, wikilink), sempre via textContent. */
function preencherCelula(el: HTMLElement, texto: string) {
  INLINE.lastIndex = 0;
  let ultimo = 0;
  let m: RegExpExecArray | null;
  const add = (tag: string, conteudo: string, classe?: string) => {
    const n = document.createElement(tag);
    if (classe) n.className = classe;
    n.textContent = conteudo;
    el.appendChild(n);
  };
  while ((m = INLINE.exec(texto))) {
    if (m.index > ultimo) el.appendChild(document.createTextNode(texto.slice(ultimo, m.index)));
    if (m[1]) add("code", m[1].slice(1, -1), "cm-cod");
    else if (m[2]) add("strong", m[2].slice(2, -2));
    else if (m[3]) add("s", m[3].slice(2, -2));
    else if (m[4]) add("em", m[4].slice(1, -1));
    else add("span", (m[6] ?? m[5]).trim(), "cm-wikilink");
    ultimo = m.index + m[0].length;
  }
  if (ultimo < texto.length) el.appendChild(document.createTextNode(texto.slice(ultimo)));
}

/** Tabela GFM mostrada como tabela; clicar nela abre o Markdown cru para editar. */
class TabelaWidget extends WidgetType {
  constructor(private readonly fonte: string, private readonly tabela: TabelaMd, private readonly de: number) { super(); }
  eq(o: TabelaWidget) { return o.fonte === this.fonte && o.de === this.de; }
  toDOM(view: EditorView) {
    const rolagem = document.createElement("div");
    rolagem.className = "cm-tabela-rolagem";
    const t = document.createElement("table");
    t.className = "cm-tabela";
    const celula = (tag: "th" | "td", texto: string, i: number) => {
      const c = document.createElement(tag);
      const a = this.tabela.alinhamentos[i];
      if (a) c.style.textAlign = a;
      preencherCelula(c, texto);
      return c;
    };
    const cab = t.createTHead().insertRow();
    this.tabela.cabecalho.forEach((h, i) => cab.appendChild(celula("th", h, i)));
    const corpo = t.createTBody();
    for (const l of this.tabela.linhas) {
      const tr = corpo.insertRow();
      l.forEach((c, i) => tr.appendChild(celula("td", c, i)));
    }
    rolagem.appendChild(t);
    rolagem.addEventListener("mousedown", (e) => {
      e.preventDefault();
      view.dispatch({ selection: { anchor: this.de } });
      view.focus();
    });
    return rolagem;
  }
  ignoreEvent() { return true; }
}

const focoEfeito = StateEffect.define<boolean>();

function montar(state: EditorState, focado: boolean): DecorationSet {
  const decos: Range<Decoration>[] = [];
  syntaxTree(state).iterate({
    enter: (no) => {
      if (no.name !== "Table") return;
      const editando = focado && state.selection.ranges.some((r) => r.from <= no.to && r.to >= no.from);
      if (!editando) {
        const fonte = state.sliceDoc(no.from, no.to);
        const tabela = lerTabela(fonte);
        if (tabela) decos.push(Decoration.replace({ widget: new TabelaWidget(fonte, tabela, no.from), block: true }).range(no.from, no.to));
      }
      return false;
    },
  });
  return Decoration.set(decos, true);
}

/** Decoração de bloco precisa vir de um StateField (um ViewPlugin não pode substituir linhas inteiras). */
export const tabelas = StateField.define<{ focado: boolean; decos: DecorationSet }>({
  create: (state) => ({ focado: false, decos: montar(state, false) }),
  update(v, tr) {
    let focado = v.focado;
    for (const e of tr.effects) if (e.is(focoEfeito)) focado = e.value;
    if (!tr.docChanged && !tr.selection && focado === v.focado) return v;
    return { focado, decos: montar(tr.state, focado) };
  },
  provide: (f) => [
    EditorView.decorations.from(f, (v) => v.decos),
    EditorView.focusChangeEffect.of((_, focando) => focoEfeito.of(focando)),
  ],
});
