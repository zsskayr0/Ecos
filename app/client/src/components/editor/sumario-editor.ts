import { EditorState, RangeSetBuilder, StateEffect, StateField, type Extension } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { extrairTitulos, numerarTitulos, type TituloNota } from "@/lib/sumario";
import { lerPreferenciasAplicativo } from "@/lib/preferencias-aplicativo";

/**
 * Numeração dos títulos no editor vivo: só marca a linha com `data-num`; o número
 * aparece por CSS (`html[data-numerar-titulos] .cm-line[data-num]::before`), então
 * ligar/desligar a preferência não precisa recriar o editor.
 */
function numerar(view: EditorView): DecorationSet {
  const doc = view.state.doc;
  const titulos = extrairTitulos(doc.toString());
  if (!titulos.length) return Decoration.none;
  const numeros = numerarTitulos(titulos);
  return Decoration.set(titulos.map((t, i) => Decoration.line({ attributes: { "data-num": numeros[i] } }).range(doc.line(t.linha).from)));
}

const numeracaoTitulos = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  constructor(view: EditorView) { this.decorations = numerar(view); }
  update(u: ViewUpdate) { if (u.docChanged) this.decorations = numerar(u.view); }
}, { decorations: (p) => p.decorations });

/** Primeiro ancestral que rola (janela da nota, página do Focus); senão a própria página. */
export function areaDeRolagem(el: HTMLElement | null): HTMLElement {
  for (let p = el?.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if ((o === "auto" || o === "scroll") && p.scrollHeight > p.clientHeight) return p;
  }
  return document.scrollingElement as HTMLElement ?? document.documentElement;
}

/** Rola a área da nota até a linha `linha` (1, 2, 3…), deixando `margem` px acima dela. */
export function rolarAteLinha(view: EditorView, linha: number, margem = 90) {
  if (linha > view.state.doc.lines) return;
  const pos = view.state.doc.line(linha).from;
  const area = areaDeRolagem(view.dom);
  const ajustar = (suave: boolean) => {
    const y = view.lineBlockAt(pos).top + view.documentTop;
    const topoArea = area === document.scrollingElement ? 0 : area.getBoundingClientRect().top;
    area.scrollTo({ top: area.scrollTop + y - topoArea - margem, behavior: suave ? "smooth" : "auto" });
  };
  ajustar(false);
  // As alturas fora da tela são estimadas: confere de novo depois que o CodeMirror mede.
  requestAnimationFrame(() => requestAnimationFrame(() => ajustar(false)));
}

/** Linha que é só `[TOC]`: vira o sumário com os títulos da nota (e volta a texto com o cursor nela). */
const LINHA_TOC = /^\s*\[TOC\]\s*$/i;

class SumarioWidget extends WidgetType {
  constructor(readonly titulos: TituloNota[], readonly numeros: string[] | null) { super(); }
  eq(o: SumarioWidget) { return JSON.stringify([o.titulos, o.numeros]) === JSON.stringify([this.titulos, this.numeros]); }
  toDOM(view: EditorView) {
    const caixa = document.createElement("nav");
    caixa.className = "cm-sumario";
    caixa.setAttribute("aria-label", "Sumário");
    if (!this.titulos.length) { caixa.textContent = "Sumário: a nota ainda não tem títulos."; return caixa; }
    const base = Math.min(...this.titulos.map((t) => t.nivel));
    this.titulos.forEach((t, i) => {
      const a = document.createElement("a");
      a.href = "#";
      a.className = "cm-sumario-item";
      a.style.paddingLeft = `${(t.nivel - base) * 16}px`;
      a.textContent = `${this.numeros ? `${this.numeros[i]} ` : ""}${t.texto || "Sem título"}`;
      a.addEventListener("mousedown", (e) => e.preventDefault());
      a.addEventListener("click", (e) => {
        e.preventDefault(); e.stopPropagation();
        rolarAteLinha(view, t.linha);
      });
      caixa.appendChild(a);
    });
    return caixa;
  }
  ignoreEvent() { return true; }
}

const efeitoFoco = StateEffect.define<boolean>();
const campoFoco = StateField.define<boolean>({
  create: () => false,
  update: (v, tr) => { for (const e of tr.effects) if (e.is(efeitoFoco)) return e.value; return v; },
});
const ouvirFoco = EditorView.focusChangeEffect.of((_s, foco) => efeitoFoco.of(foco));

function sumarios(state: EditorState): DecorationSet {
  const doc = state.doc;
  const texto = doc.toString();
  if (!/\[TOC\]/i.test(texto)) return Decoration.none;
  const titulos = extrairTitulos(texto);
  const numeros = lerPreferenciasAplicativo().numerarTitulos && titulos.length ? numerarTitulos(titulos) : null;
  const cursor = state.selection.main.head;
  const b = new RangeSetBuilder<Decoration>();
  for (let n = 1; n <= doc.lines; n++) {
    const l = doc.line(n);
    if (!LINHA_TOC.test(l.text)) continue;
    if (!state.readOnly && state.field(campoFoco, false) && cursor >= l.from && cursor <= l.to) continue;
    b.add(l.from, l.to, Decoration.replace({ widget: new SumarioWidget(titulos, numeros), block: true }));
  }
  return b.finish();
}

const campoSumario = StateField.define<DecorationSet>({
  create: sumarios,
  update: (v, tr) => (tr.docChanged || tr.selection || tr.reconfigured || tr.effects.some((e) => e.is(efeitoFoco)) ? sumarios(tr.state) : v),
  provide: (f) => EditorView.decorations.from(f),
});

const temaSumario = EditorView.baseTheme({
  ".cm-sumario": { display: "flex", flexDirection: "column", gap: "2px", margin: "4px 0", padding: "10px 14px", borderRadius: "12px", border: "1px solid rgb(var(--ecos-border-rgb, 60 60 66) / 0.6)", background: "rgb(var(--ecos-surface-2-rgb, 30 30 34))", fontSize: "0.93em" },
  ".cm-sumario-item": { color: "inherit", textDecoration: "none", opacity: "0.85", cursor: "pointer" },
  ".cm-sumario-item:hover": { textDecoration: "underline", opacity: "1" },
});

export const sumarioEditor: Extension = [numeracaoTitulos, campoFoco, ouvirFoco, campoSumario, temaSumario];
