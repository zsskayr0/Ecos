import { useEffect, useRef, type MutableRefObject } from "react";
import { Annotation, EditorState, Facet, Prec, type Range } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, keymap, placeholder as placeholderExt, type DecorationSet } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { syntaxTree } from "@codemirror/language";
import { GFM } from "@lezer/markdown";
import { autocompletarWikilink, type OpcoesWikilink } from "./wikilink-autocompletar";
import { tabelas } from "./tabela-widget";

/** O que a barra de formatação precisa de um campo de texto (a mesma interface de um `<textarea>`). */
export interface AreaLike {
  selectionStart: number;
  selectionEnd: number;
  focus(): void;
  setSelectionRange(inicio: number, fim: number): void;
}

interface Props {
  corpo: string;
  onCorpoChange: (corpo: string) => void;
  /** Recebe o "textarea virtual" para a barra de formatação operar sobre a seleção. */
  areaRef: MutableRefObject<AreaLike | null>;
  ariaLabel: string;
  placeholder?: string;
  alturaMinima: string;
  /** Traduz o caminho gravado no Markdown (`src/Media/…`, `_anexos/…`) na URL da imagem. */
  resolverImagem?: (src: string) => string | undefined;
  /** Atalhos (ex.: "Mod-b") tratados pelo editor pai. */
  atalhos?: Record<string, () => void>;
  className?: string;
  /** Liga o autocomplete de `[[wikilink]]` (só Notas). */
  wikilinks?: OpcoesWikilink;
  /** Ctrl/Cmd+clique num `[[...]]`: recebe o texto de dentro (sem apelido). */
  aoAbrirWikilink?: (interno: string, clique: MouseEvent) => void;
}

const externa = Annotation.define<boolean>();
const resolverFacet = Facet.define<(src: string) => string | undefined, ((src: string) => string | undefined) | undefined>({ combine: (v) => v[0] });

/** Imagem `![alt](src)` mostrada como imagem; clicar nela abre a linha em Markdown para editar. */
class ImagemWidget extends WidgetType {
  constructor(private readonly url: string, private readonly alt: string, private readonly de: number) { super(); }
  eq(o: ImagemWidget) { return o.url === this.url && o.alt === this.alt && o.de === this.de; }
  toDOM(view: EditorView) {
    const img = document.createElement("img");
    img.src = this.url;
    img.alt = this.alt;
    img.loading = "lazy";
    img.className = "cm-imagem";
    img.addEventListener("error", () => {
      const falha = document.createElement("span");
      falha.className = "cm-imagem-falha";
      falha.textContent = this.alt || "Imagem indisponível";
      img.replaceWith(falha);
    });
    img.addEventListener("mousedown", (e) => { e.preventDefault(); view.dispatch({ selection: { anchor: this.de } }); view.focus(); });
    return img;
  }
  ignoreEvent() { return true; }
}

class Marcador extends WidgetType {
  constructor(private readonly texto: string, private readonly classe: string) { super(); }
  eq(o: Marcador) { return o.texto === this.texto && o.classe === this.classe; }
  toDOM() { const s = document.createElement("span"); s.className = this.classe; s.textContent = this.texto; return s; }
}

class Caixa extends WidgetType {
  constructor(private readonly marcada: boolean, private readonly de: number) { super(); }
  eq(o: Caixa) { return o.marcada === this.marcada && o.de === this.de; }
  toDOM(view: EditorView) {
    const c = document.createElement("input");
    c.type = "checkbox";
    c.checked = this.marcada;
    c.className = "cm-caixa";
    c.setAttribute("aria-label", this.marcada ? "Item concluído" : "Item pendente");
    c.addEventListener("mousedown", (e) => e.preventDefault());
    c.addEventListener("click", (e) => {
      e.preventDefault();
      view.dispatch({ changes: { from: this.de + 1, to: this.de + 2, insert: this.marcada ? " " : "x" } });
    });
    return c;
  }
  ignoreEvent() { return true; }
}

const ocultar = Decoration.replace({});
const ESTILO_TITULO = ["", "cm-h1", "cm-h2", "cm-h3", "cm-h4", "cm-h5", "cm-h6"];
const WIKILINK = /\[\[([^\]|\n]+)(?:\|([^\]\n]*))?\]\]/g;

/**
 * "Live preview" à la Obsidian: o texto é sempre Markdown puro, mas as linhas que o cursor não toca
 * aparecem formatadas (marcas escondidas). A linha com o cursor mostra o Markdown cru para editar.
 */
function montarDecoracoes(view: EditorView): DecorationSet {
  const { state } = view;
  const ativas = new Set<number>();
  if (view.hasFocus) {
    for (const r of state.selection.ranges) {
      const a = state.doc.lineAt(r.from).number;
      const b = state.doc.lineAt(r.to).number;
      for (let n = a; n <= b; n++) ativas.add(n);
    }
  }
  const linhaAtiva = (pos: number) => ativas.has(state.doc.lineAt(pos).number);
  const decos: Range<Decoration>[] = [];
  const esconder = (de: number, ate: number) => {
    if (ate > de && !state.sliceDoc(de, ate).includes("\n")) decos.push(ocultar.range(de, ate));
  };
  const marcar = (de: number, ate: number, classe: string) => {
    if (ate > de) decos.push(Decoration.mark({ class: classe }).range(de, ate));
  };
  const linha = (pos: number, classe: string) => decos.push(Decoration.line({ class: classe }).range(state.doc.lineAt(pos).from));

  syntaxTree(state).iterate({
    enter: (no) => {
      const nome = no.name;
      const titulo = /^ATXHeading([1-6])$/.exec(nome);
      if (titulo) { linha(no.from, ESTILO_TITULO[Number(titulo[1])]); return; }
      switch (nome) {
        case "HeaderMark":
          if (!linhaAtiva(no.from)) esconder(no.from, Math.min(no.to + 1, state.doc.lineAt(no.from).to));
          return;
        case "StrongEmphasis": marcar(no.from, no.to, "cm-neg"); return;
        case "Emphasis": marcar(no.from, no.to, "cm-ita"); return;
        case "Strikethrough": marcar(no.from, no.to, "cm-tach"); return;
        case "InlineCode": marcar(no.from, no.to, "cm-cod"); return;
        case "EmphasisMark": case "StrikethroughMark": case "CodeMark":
          // Em bloco de código o `CodeMark` são as cercas ```: continuam visíveis.
          if (no.node.parent?.name !== "FencedCode" && !linhaAtiva(no.from)) esconder(no.from, no.to);
          return;
        case "FencedCode": {
          const a = state.doc.lineAt(no.from).number;
          const b = state.doc.lineAt(no.to).number;
          for (let n = a; n <= b; n++) decos.push(Decoration.line({ class: "cm-bloco-cod" }).range(state.doc.line(n).from));
          return;
        }
        case "Blockquote": {
          const a = state.doc.lineAt(no.from).number;
          const b = state.doc.lineAt(no.to).number;
          for (let n = a; n <= b; n++) decos.push(Decoration.line({ class: "cm-citacao" }).range(state.doc.line(n).from));
          return;
        }
        case "QuoteMark":
          if (!linhaAtiva(no.from)) esconder(no.from, Math.min(no.to + 1, state.doc.lineAt(no.from).to));
          return;
        case "ListMark": {
          const texto = state.sliceDoc(no.from, no.to);
          if (!/^[-*+]$/.test(texto) || linhaAtiva(no.from)) return;
          // Item de checklist: a caixa já faz o papel do marcador.
          if (/^\s*\[[ xX]\]/.test(state.sliceDoc(no.to, no.to + 5))) decos.push(ocultar.range(no.from, no.to + 1));
          else decos.push(Decoration.replace({ widget: new Marcador("•", "cm-marcador") }).range(no.from, no.to));
          return;
        }
        case "TaskMarker": {
          const marcada = /x/i.test(state.sliceDoc(no.from, no.to));
          decos.push(Decoration.replace({ widget: new Caixa(marcada, no.from) }).range(no.from, no.to));
          if (marcada) linha(no.from, "cm-feita");
          return;
        }
        case "HorizontalRule":
          if (!linhaAtiva(no.from)) {
            // A própria linha vira a régua (1px, com fundo): um widget dentro de uma linha de 1px era cortado e sumia.
            linha(no.from, "cm-linha-regua");
            decos.push(ocultar.range(no.from, no.to));
          }
          return;
        case "Image": {
          if (linhaAtiva(no.from)) return false;
          const resolver = state.facet(resolverFacet);
          const url = no.node.getChild("URL");
          const bruto = url ? state.sliceDoc(url.from, url.to) : "";
          const src = resolver?.(bruto);
          if (!src || state.sliceDoc(no.from, no.to).includes("\n")) return false;
          const marcas = no.node.getChildren("LinkMark");
          const alt = marcas.length >= 2 ? state.sliceDoc(marcas[0].to, marcas[1].from) : "";
          decos.push(Decoration.replace({ widget: new ImagemWidget(src, alt, no.from) }).range(no.from, no.to));
          return false;
        }
        case "Link": {
          const marcas: { from: number; to: number }[] = [];
          for (let f = no.node.firstChild; f; f = f.nextSibling) if (f.name === "LinkMark") marcas.push({ from: f.from, to: f.to });
          if (marcas.length >= 2) {
            marcar(marcas[0].to, marcas[1].from, "cm-link");
            if (!linhaAtiva(no.from)) { esconder(marcas[0].from, marcas[0].to); esconder(marcas[1].from, no.to); }
          }
          return false;
        }
        default:
      }
    },
  });

  // Linhas em branco entre blocos ocupam o mesmo respiro do preview (8px), não uma linha inteira.
  // A linha com o cursor (editor focado) mantém a altura normal para o cursor não encolher; dentro de código nada muda.
  const emCodigo = new Set<number>();
  syntaxTree(state).iterate({
    enter: (no) => {
      if (no.name !== "FencedCode") return;
      for (let n = state.doc.lineAt(no.from).number; n <= state.doc.lineAt(no.to).number; n++) emCodigo.add(n);
      return false;
    },
  });

  // Wikilinks `[[Nota]]` / `[[Nota|apelido]]`: sintaxe própria do Ecos, fora do Markdown padrão.
  for (let n = 1; n <= state.doc.lines; n++) {
    const l = state.doc.line(n);
    if (!l.length && !ativas.has(n) && !emCodigo.has(n) && n < state.doc.lines) decos.push(Decoration.line({ class: "cm-vazia" }).range(l.from));
    if (!l.text.includes("[[")) continue;
    WIKILINK.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = WIKILINK.exec(l.text))) {
      const de = l.from + m.index;
      const ate = de + m[0].length;
      const rotuloIni = de + 2 + (m[2] !== undefined ? m[1].length + 1 : 0);
      const rotuloFim = ate - 2;
      if (rotuloFim > rotuloIni) decos.push(Decoration.mark({ class: "cm-wikilink", attributes: { title: "Ctrl+clique para abrir" } }).range(rotuloIni, rotuloFim));
      if (!ativas.has(n)) { esconder(de, rotuloIni); esconder(rotuloFim, ate); }
    }
  }
  return Decoration.set(decos, true);
}

const plugin = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  constructor(view: EditorView) { this.decorations = montarDecoracoes(view); }
  update(u: { docChanged: boolean; selectionSet: boolean; focusChanged: boolean; viewportChanged: boolean; view: EditorView }) {
    if (u.docChanged || u.selectionSet || u.focusChanged || u.viewportChanged) this.decorations = montarDecoracoes(u.view);
  }
}, { decorations: (p) => p.decorations });

const tema = EditorView.theme({
  "&": { backgroundColor: "transparent", color: "rgb(var(--ecos-text-primary-rgb))", fontSize: "14px" },
  "&, &.cm-focused, .cm-content, .cm-content:focus-visible, .cm-scroller": { outline: "none !important" },
  ".cm-scroller": { fontFamily: "inherit", lineHeight: "20px", overflow: "visible" },
  ".cm-content": { padding: "0", caretColor: "rgb(var(--ecos-cyan-rgb))" },
  ".cm-line": { padding: "0" },
  ".cm-vazia": { height: "8px", lineHeight: "8px", overflow: "hidden" },
  ".cm-cursor": { borderLeftColor: "rgb(var(--ecos-cyan-rgb))" },
  ".cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": { background: "rgb(var(--ecos-steel-500-rgb) / 0.4)" },
  ".cm-placeholder": { color: "rgb(var(--ecos-text-secondary-rgb))" },
  // Mesmos tamanhos e fonte dos títulos do preview (`h1`/`h2`/`h3` em markdown-mini.tsx: 20/18/16px sobre 14px).
  // Alturas de linha iguais às do Tailwind no preview (text-xl/text-lg: 28px; text-base: 24px; texto: 20px).
  ".cm-h1, .cm-h2, .cm-h3": { fontFamily: "\"Space Grotesk\", sans-serif" },
  ".cm-h1": { fontSize: "1.4286em", lineHeight: "28px" },
  ".cm-h2": { fontSize: "1.2857em", lineHeight: "28px" },
  ".cm-h3": { fontSize: "1.1429em", fontWeight: "600", lineHeight: "24px" },
  ".cm-h4, .cm-h5, .cm-h6": { fontWeight: "600" },
  ".cm-neg": { fontWeight: "700" },
  ".cm-ita": { fontStyle: "italic" },
  ".cm-tach": { textDecoration: "line-through", opacity: "0.7" },
  ".cm-cod": { fontFamily: "\"IBM Plex Mono\", monospace", fontSize: "13.5px", background: "rgb(var(--ecos-surface-3-rgb))", borderRadius: "4px", padding: "1px 4px" },
  ".cm-bloco-cod": { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", fontSize: "0.9em", background: "rgb(var(--ecos-surface-2-rgb))" },
  ".cm-citacao": { borderLeft: "3px solid rgb(var(--ecos-steel-500-rgb))", paddingLeft: "12px", color: "rgb(var(--ecos-text-secondary-rgb))" },
  ".cm-link, .cm-wikilink": { color: "rgb(var(--ecos-steel-300-rgb))", textDecoration: "underline", textUnderlineOffset: "3px" },
  ".cm-wikilink": { textDecoration: "none", fontWeight: "500" },
  ".cm-marcador": { display: "inline-block", width: "1.1em", color: "rgb(var(--ecos-steel-300-rgb))" },
  ".cm-caixa": { margin: "0 6px 0 0", width: "15px", height: "15px", verticalAlign: "-2px", accentColor: "rgb(var(--ecos-steel-500-rgb))", cursor: "pointer" },
  ".cm-feita": { color: "rgb(var(--ecos-text-secondary-rgb))", textDecoration: "line-through" },
  ".cm-imagem": { display: "block", maxWidth: "100%", maxHeight: "70vh", borderRadius: "12px", margin: "6px 0", cursor: "text" },
  ".cm-imagem-falha": { color: "rgb(var(--ecos-text-secondary-rgb))", fontStyle: "italic" },
  ".cm-tabela-rolagem": { overflowX: "auto", margin: "0", cursor: "text" },
  ".cm-tabela": { width: "100%", borderCollapse: "collapse", fontSize: "0.93em", lineHeight: "1.5" },
  ".cm-tabela th, .cm-tabela td": { padding: "10px 14px", textAlign: "left", verticalAlign: "top", borderBottom: "1px solid rgb(var(--ecos-border-rgb))" },
  ".cm-tabela th": { fontWeight: "700", color: "rgb(var(--ecos-text-primary-rgb))", borderBottomColor: "rgb(var(--ecos-steel-500-rgb) / 0.6)", whiteSpace: "nowrap" },
  ".cm-tabela td": { color: "rgb(var(--ecos-text-secondary-rgb))" },
  ".cm-tabela tbody tr:last-child td": { borderBottom: "0" },
  ".cm-linha-regua": { height: "1px", lineHeight: "1px", overflow: "hidden", background: "rgb(var(--ecos-border-rgb))" },
});

export function EditorVivo({ corpo, onCorpoChange, areaRef, ariaLabel, placeholder, alturaMinima, resolverImagem, atalhos, className, wikilinks, aoAbrirWikilink }: Props) {
  const raiz = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const aoMudar = useRef(onCorpoChange);
  aoMudar.current = onCorpoChange;
  const atalhosRef = useRef(atalhos);
  atalhosRef.current = atalhos;
  const abrirWikilinkRef = useRef(aoAbrirWikilink);
  abrirWikilinkRef.current = aoAbrirWikilink;
  const wikilinksRef = useRef(wikilinks);
  wikilinksRef.current = wikilinks;
  const resolverRef = useRef(resolverImagem);
  resolverRef.current = resolverImagem;

  useEffect(() => {
    if (!raiz.current) return;
    const estado = EditorState.create({
      doc: corpo,
      extensions: [
        history(),
        markdown({ base: markdownLanguage, extensions: [GFM] }),
        Prec.highest(keymap.of(["Mod-b", "Mod-i"].map((tecla) => ({ key: tecla, run: () => { const f = atalhosRef.current?.[tecla]; if (!f) return false; f(); return true; } })))),
        keymap.of([...historyKeymap, ...defaultKeymap.filter((k) => k.key !== "Mod-i")]),
        EditorView.lineWrapping,
        tema,
        EditorView.contentAttributes.of({ "aria-label": ariaLabel, spellcheck: "true" }),
        placeholder ? placeholderExt(placeholder) : [],
        EditorView.theme({ ".cm-content": { minHeight: alturaMinima } }),
        plugin,
        tabelas,
        wikilinksRef.current ? autocompletarWikilink(() => wikilinksRef.current) : [],
        EditorView.domEventHandlers({
          mousedown(e, v) {
            if (!(e.ctrlKey || e.metaKey) || e.button !== 0 || !abrirWikilinkRef.current) return false;
            const pos = v.posAtCoords({ x: e.clientX, y: e.clientY });
            if (pos == null) return false;
            const linha = v.state.doc.lineAt(pos);
            const re = new RegExp(WIKILINK.source, "g");
            let m: RegExpExecArray | null;
            while ((m = re.exec(linha.text))) {
              if (pos >= linha.from + m.index && pos <= linha.from + m.index + m[0].length) {
                e.preventDefault();
                abrirWikilinkRef.current(m[1].trim(), e);
                return true;
              }
            }
            return false;
          },
        }),
        resolverFacet.of((src) => resolverRef.current?.(src)),
        EditorView.updateListener.of((u) => {
          if (u.docChanged && !u.transactions.some((t) => t.annotation(externa))) aoMudar.current(u.state.doc.toString());
        }),
      ],
    });
    const v = new EditorView({ state: estado, parent: raiz.current });
    view.current = v;
    areaRef.current = {
      get selectionStart() { return v.state.selection.main.from; },
      set selectionStart(n: number) { const p = Math.min(Math.max(n, 0), v.state.doc.length); v.dispatch({ selection: { anchor: p, head: Math.max(p, v.state.selection.main.to) } }); },
      get selectionEnd() { return v.state.selection.main.to; },
      set selectionEnd(n: number) { const p = Math.min(Math.max(n, 0), v.state.doc.length); v.dispatch({ selection: { anchor: Math.min(v.state.selection.main.from, p), head: p } }); },
      focus() { v.focus(); },
      setSelectionRange(a: number, b: number) { const t = v.state.doc.length; v.dispatch({ selection: { anchor: Math.min(a, t), head: Math.min(b, t) } }); },
    };
    return () => { v.destroy(); view.current = null; areaRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Corpo vindo de fora (sincronização, troca de item, ação da barra): reflete no documento sem devolver como edição.
  useEffect(() => {
    const v = view.current;
    if (!v || v.state.doc.toString() === corpo) return;
    const { anchor, head } = v.state.selection.main;
    const t = corpo.length;
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: corpo }, selection: { anchor: Math.min(anchor, t), head: Math.min(head, t) }, annotations: externa.of(true) });
  }, [corpo]);

  return <div ref={raiz} className={className} data-editor-vivo />;
}
