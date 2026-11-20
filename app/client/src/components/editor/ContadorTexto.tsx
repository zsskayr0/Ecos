import { useEffect, useState } from "react";
import { EditorView, ViewPlugin } from "@codemirror/view";

export interface Contagem { palavras: number; caracteres: number; minutosLeitura: number }

const PPM = 200;

/** Conta palavras (ignorando marcação Markdown), caracteres e minutos de leitura (~200 palavras/min). */
export function contarTexto(texto: string): Contagem {
  const limpo = texto
    .replace(/```[\s\S]*?```/g, (b) => b.replace(/```\w*/g, ""))
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[\[([^\]|]*)(\|([^\]]*))?\]\]/g, (_, a, __, b) => b ?? a)
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+(\[[ xX]\]\s+)?/gm, "")
    .replace(/[*_~`|]/g, " ");
  const palavras = (limpo.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? []).length;
  const caracteres = Array.from(texto).length;
  return { palavras, caracteres, minutosLeitura: palavras === 0 ? 0 : Math.max(1, Math.round(palavras / PPM)) };
}

function lerView(view: EditorView): { texto: string; selecao: string } {
  const s = view.state.selection.main;
  return { texto: view.state.doc.toString(), selecao: s.empty ? "" : view.state.sliceDoc(s.from, s.to) };
}

type Ouvinte = (v: EditorView) => void;
const ouvintes = new WeakMap<EditorView, Set<Ouvinte>>();

/** Extensão que avisa o ContadorTexto quando o documento ou a seleção mudam. Adicione ao EditorView. */
export const contadorTexto = ViewPlugin.define(() => ({
  update(u) { if (u.docChanged || u.selectionSet) ouvintes.get(u.view)?.forEach((f) => f(u.view)); },
}));

const fmt = new Intl.NumberFormat("pt-BR");

type Props = { view: EditorView | null; texto?: never; selecao?: never; className?: string }
  | { view?: never; texto: string; selecao?: string; className?: string };

/** Rodapé discreto: palavras · caracteres · tempo de leitura. Com seleção, mostra os números da seleção. */
export function ContadorTexto(props: Props) {
  const [lido, setLido] = useState(() => (props.view ? lerView(props.view) : null));
  const view = props.view ?? null;
  useEffect(() => {
    if (!view) return;
    setLido(lerView(view));
    const f: Ouvinte = (v) => setLido(lerView(v));
    const set = ouvintes.get(view) ?? new Set();
    set.add(f);
    ouvintes.set(view, set);
    return () => { set.delete(f); };
  }, [view]);
  const texto = view ? lido?.texto ?? "" : props.texto ?? "";
  const selecao = view ? lido?.selecao ?? "" : props.selecao ?? "";
  const c = contarTexto(selecao || texto);
  const leitura = c.minutosLeitura === 0 ? "" : ` · ${c.minutosLeitura} min de leitura`;
  return (
    <div className={`text-xs text-text-muted tabular-nums ${props.className ?? ""}`} aria-live="polite">
      {selecao ? "Seleção: " : ""}
      {fmt.format(c.palavras)} {c.palavras === 1 ? "palavra" : "palavras"} · {fmt.format(c.caracteres)} {c.caracteres === 1 ? "caractere" : "caracteres"}{leitura}
    </div>
  );
}
