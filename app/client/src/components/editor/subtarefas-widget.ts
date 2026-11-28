import { Facet, StateField, type EditorState, type Range } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import { blocoDoMarcador } from "@/lib/subtarefas-bloco";

/**
 * Bloco de subtarefas no editor: a linha `::: subtarefas [nome]` vira uma caixa. O conteúdo da caixa é React
 * (`BlocoSubtarefas`), montado por portal a partir do EditorVivo, para herdar o contexto da tarefa aberta.
 * Com o cursor na linha, ela volta a ser texto (para renomear ou apagar o marcador).
 */

export interface PortalSubtarefas { el: HTMLElement; bloco: string | null; id: number }
export interface RegistroPortais { adicionar(p: PortalSubtarefas): void; remover(el: HTMLElement): void }

/** Liga os blocos (só tarefas usam) e diz onde registrar os portais. */
export const registroSubtarefas = Facet.define<RegistroPortais, RegistroPortais | null>({ combine: (v) => v[0] ?? null });

let proximoId = 1;

class SubtarefasWidget extends WidgetType {
  private registro: RegistroPortais | null = null;
  constructor(readonly bloco: string | null) { super(); }
  eq(o: SubtarefasWidget) { return o.bloco === this.bloco; }
  get estimatedHeight() { return 120; }

  toDOM(view: EditorView) {
    const el = document.createElement("div");
    el.className = "cm-subtarefas";
    el.setAttribute("contenteditable", "false");
    const registro = view.state.facet(registroSubtarefas);
    this.registro = registro;
    const p = { el, bloco: this.bloco, id: proximoId++ };
    // Fora do ciclo de atualização do CodeMirror: o registro mexe em estado React.
    queueMicrotask(() => registro?.adicionar(p));
    return el;
  }

  destroy(el: HTMLElement) {
    const registro = this.registro;
    queueMicrotask(() => registro?.remover(el));
  }

  // Cliques, teclas e foco dentro da caixa são do React (marcar, adicionar), não do editor.
  ignoreEvent() { return true; }
}

function montar(state: EditorState): DecorationSet {
  if (!state.facet(registroSubtarefas) || !/subtarefas/i.test(state.doc.toString())) return Decoration.none;
  const cursor = state.selection.main;
  const decos: Range<Decoration>[] = [];
  let cerca = false;
  for (let n = 1; n <= state.doc.lines; n++) {
    const linha = state.doc.line(n);
    if (/^\s*(```|~~~)/.test(linha.text)) { cerca = !cerca; continue; }
    if (cerca) continue;
    const bloco = blocoDoMarcador(linha.text);
    if (bloco === undefined) continue;
    // Cursor ou seleção tocando a linha: mostra o texto do marcador.
    if (cursor.from <= linha.to && cursor.to >= linha.from) continue;
    decos.push(Decoration.replace({ widget: new SubtarefasWidget(bloco), block: true }).range(linha.from, linha.to));
  }
  return Decoration.set(decos, true);
}

/** Decoração de bloco precisa vir de um StateField. A faixa é atômica: as setas passam por cima da caixa. */
export const blocosSubtarefas = StateField.define<DecorationSet>({
  create: montar,
  update(v, tr) { return tr.docChanged || tr.selection ? montar(tr.state) : v; },
  provide: (f) => [EditorView.decorations.from(f), EditorView.atomicRanges.of((view) => view.state.field(f))],
});

export const temaSubtarefas = EditorView.theme({
  ".cm-subtarefas": { padding: "4px 0", cursor: "default", whiteSpace: "normal" },
});
