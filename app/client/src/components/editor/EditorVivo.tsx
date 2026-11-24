import { dimensoesLembradas, encaixarImagemEmLinhas } from "@/lib/imagem-linha";
import { useEffect, useRef, type MutableRefObject } from "react";
import { Annotation, Compartment, EditorState, Facet, Prec, type Range } from "@codemirror/state";
import { sumarioEditor } from "./sumario-editor";
import { Decoration, EditorView, ViewPlugin, WidgetType, keymap, placeholder as placeholderExt, type DecorationSet } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { deleteMarkupBackward, insertNewlineContinueMarkup, markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { openSearchPanel, search, searchKeymap } from "@codemirror/search";
import { HighlightStyle, syntaxHighlighting, syntaxTree } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { tags as t } from "@lezer/highlight";
import { GFM } from "@lezer/markdown";
import { autocompletarWikilink, type OpcoesWikilink } from "./wikilink-autocompletar";
import { tabelas } from "./tabela-widget";
import { rolagemSuave } from "./rolagem-suave";
import { matematica, temaMatematica } from "./matematica-widget";
import { blocosEscrita, temaEscrita } from "./escrita-widget";
import { colarMarkdown, atalhoColarTextoSimples } from "./colarMarkdown";
import { contadorTexto } from "./ContadorTexto";
import { QUEBRA_PAGINA } from "@/lib/tipografia-nota";
import { autocompletarEmoji } from "./SeletorEmoji";
import { bibliotecaDoCorpo, citacaoCurta, extrairNotas, irParaNota } from "@/lib/notas-rodape";

/** O que a barra de formatação precisa de um campo de texto (a mesma interface de um `<textarea>`). */
export interface AreaLike {
  selectionStart: number;
  selectionEnd: number;
  focus(): void;
  setSelectionRange(inicio: number, fim: number): void;
  /** Editor vivo: o texto atual do documento (pode estar à frente da prop `corpo`). */
  texto?(): string;
  /** Editor vivo: troca um trecho com uma transação pequena (desfazer funciona, o resto do documento não é reescrito). */
  substituir?(inicio: number, fim: number, texto: string, selecao?: [number, number]): void;
}

/** Atalhos que o editor pai pode tratar (`atalhos`). Fora daqui a tecla não chega ao pai. */
export const TECLAS_EDITOR = ["Mod-b", "Mod-i", "Mod-k", "Mod-e", "Mod-Shift-x", "Mod-Alt-1", "Mod-Alt-2", "Mod-Alt-3", "Mod-Alt-0", "Mod-Shift-7", "Mod-Shift-8", "Mod-Shift-9", "Mod-/"] as const;

/** Textos do painel de busca em pt-BR. */
const FRASES_BUSCA = {
  "Find": "Buscar", "Replace": "Substituir", "next": "próximo", "previous": "anterior", "all": "todos",
  "match case": "maiúsculas", "by word": "palavra inteira", "regexp": "regex", "replace": "substituir",
  "replace all": "substituir todos", "close": "fechar", "current match": "ocorrência atual",
  "replaced $ matches": "$ ocorrências substituídas", "replaced match on line $": "ocorrência substituída na linha $",
  "on line": "na linha", "Go to line": "Ir para a linha", "go": "ir",
}

interface Props {
  corpo: string;
  onCorpoChange: (corpo: string) => void;
  /** Recebe o "textarea virtual" para a barra de formatação operar sobre a seleção. */
  areaRef: MutableRefObject<AreaLike | null>;
  /** Recebe a EditorView criada (null ao destruir), para o contador de palavras. */
  aoCriarView?: (v: EditorView | null) => void;
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
  /** Leitura de Nota com tinta (e Modo de escrita): o mesmo CodeMirror, sem edição, para o texto não mudar de lugar. */
  somenteLeitura?: boolean;
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
    // Notas medidas em linhas (`.ecos-grade`): a imagem ocupa sempre linhas inteiras e nunca cresce (lib/imagem-linha.ts).
    // Imagem já vista: reserva o lugar com o tamanho lembrado antes de ela carregar, para a tela não pular ao rolar.
    const encaixar = () => { if (encaixarImagemEmLinhas(img, img.parentElement ?? view.contentDOM, dimensoesLembradas(this.url), view.contentDOM)) view.requestMeasure(); };
    img.addEventListener("load", encaixar);
    queueMicrotask(encaixar);
    const obs = typeof ResizeObserver === "function" ? new ResizeObserver(encaixar) : null;
    obs?.observe(view.contentDOM);
    (img as HTMLImageElement & { __obs?: ResizeObserver | null }).__obs = obs;
    return img;
  }
  destroy(dom: HTMLElement) { (dom as HTMLElement & { __obs?: ResizeObserver | null }).__obs?.disconnect(); }
  ignoreEvent() { return true; }
}

class Marcador extends WidgetType {
  constructor(private readonly texto: string, private readonly classe: string) { super(); }
  eq(o: Marcador) { return o.texto === this.texto && o.classe === this.classe; }
  toDOM() { const s = document.createElement("span"); s.className = this.classe; s.textContent = this.texto; return s; }
}

/** Cabeçalho do bloco de código fora de edição: rótulo da linguagem e botão "Copiar". */
class CabecalhoCodigo extends WidgetType {
  constructor(private readonly lingua: string, private readonly codigo: string) { super(); }
  eq(o: CabecalhoCodigo) { return o.lingua === this.lingua && o.codigo === this.codigo; }
  toDOM() {
    const caixa = document.createElement("span");
    caixa.className = "cm-cod-cabecalho";
    const rotulo = document.createElement("span");
    rotulo.className = "cm-cod-lingua";
    rotulo.textContent = this.lingua || "texto";
    const botao = document.createElement("button");
    botao.type = "button";
    botao.className = "cm-cod-copiar";
    botao.textContent = "Copiar";
    botao.addEventListener("mousedown", (e) => e.preventDefault());
    botao.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      void navigator.clipboard?.writeText(this.codigo).then(() => {
        botao.textContent = "Copiado";
        setTimeout(() => { botao.textContent = "Copiar"; }, 1500);
      });
    });
    caixa.append(rotulo, botao);
    return caixa;
  }
  ignoreEvent() { return true; }
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

class Citacao extends WidgetType {
  constructor(readonly texto: string, readonly titulo: string, readonly chave: string) { super(); }
  eq(o: Citacao) { return o.texto === this.texto && o.titulo === this.titulo; }
  toDOM() {
    const s = document.createElement("span");
    s.className = "cm-cita";
    s.textContent = this.texto;
    s.title = this.titulo;
    s.dataset.cita = this.chave;
    return s;
  }
  ignoreEvent() { return false; }
}

let cacheNotas: { doc: unknown; notas: Map<string, { texto: string }>; bib: Map<string, ReturnType<typeof bibliotecaDoCorpo>[number]> } | null = null;
function dadosNotas(state: EditorState) {
  if (cacheNotas?.doc !== state.doc) {
    const texto = state.doc.toString();
    cacheNotas = { doc: state.doc, notas: new Map(extrairNotas(texto).map((n) => [n.rotulo, n])), bib: new Map(bibliotecaDoCorpo(texto).map((r) => [r.chave, r])) };
  }
  return cacheNotas;
}
const ESTILO_TITULO = ["", "cm-h1", "cm-h2", "cm-h3", "cm-h4", "cm-h5", "cm-h6"];
const REALCE = /==(?=\S)([^=\n]*?\S)==/g;
const NOTA_DEF = /^\[\^[^\]\s]+\]:\s?/;
/** Só cores de código: os nós do próprio Markdown (títulos, ênfase, links) já têm o estilo das decorações. */
const realceCodigo = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword, t.definitionKeyword], color: "rgb(var(--ecos-steel-300-rgb))", fontWeight: "600" },
  { tag: [t.string, t.special(t.string), t.regexp], color: "#9ccc8a" },
  { tag: [t.comment, t.lineComment, t.blockComment], color: "rgb(var(--ecos-text-secondary-rgb))", fontStyle: "italic" },
  { tag: [t.number, t.bool, t.null, t.atom], color: "#e0a96d" },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "rgb(var(--ecos-cyan-rgb))" },
  { tag: [t.typeName, t.className, t.tagName], color: "#d7a3e0" },
  { tag: [t.attributeName, t.propertyName], color: "#8fb8e8" },
]);
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
  // Marcas inline (`**`, `[..](..)`, `==`, `[[..]]`) só aparecem no trecho que o cursor toca, não na linha toda:
  // assim o texto não alarga e a linha não quebra em duas ao entrar nela.
  const tocaCursor = (de: number, ate: number) => view.hasFocus && state.selection.ranges.some((r) => r.from <= ate && r.to >= de);
  const decos: Range<Decoration>[] = [];
  const esconder = (de: number, ate: number) => {
    if (ate > de && !state.sliceDoc(de, ate).includes("\n")) decos.push(ocultar.range(de, ate));
  };
  const marcar = (de: number, ate: number, classe: string) => {
    if (ate > de) decos.push(Decoration.mark({ class: classe }).range(de, ate));
  };
  const linha = (pos: number, classe: string) => decos.push(Decoration.line({ class: classe }).range(state.doc.lineAt(pos).from));

  // Notas `[^n]` e referências BibTeX: só relidas quando o texto muda.
  const { notas, bib } = dadosNotas(state);

  // Rótulos de `[ref]: url` do documento, para saber se `[x]` é link de referência.
  const referencias = new Set<string>();
  syntaxTree(state).iterate({
    enter: (no) => {
      if (no.name !== "LinkReference") return;
      const l = no.node.getChild("LinkLabel");
      if (l) referencias.add(state.sliceDoc(l.from + 1, l.to - 1).trim().toLowerCase());
      return false;
    },
  });

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
          // Em bloco de código o `CodeMark` são as cercas ```: tratadas no `FencedCode`.
          { const pai = no.node.parent; if (pai && pai.name !== "FencedCode" && !tocaCursor(pai.from, pai.to)) esconder(no.from, no.to); }
          return;
        case "FencedCode": {
          const a = state.doc.lineAt(no.from).number;
          const b = state.doc.lineAt(no.to).number;
          let ativo = false;
          for (let n = a; n <= b; n++) if (ativas.has(n)) ativo = true;
          for (let n = a; n <= b; n++) decos.push(Decoration.line({ class: "cm-bloco-cod" }).range(state.doc.line(n).from));
          if (ativo) return;
          // Fora de edição: a cerca de abertura vira rótulo + "Copiar"; a de fechamento some.
          const info = no.node.getChild("CodeInfo");
          const texto = no.node.getChild("CodeText");
          const lingua = info ? state.sliceDoc(info.from, info.to).trim() : "";
          const codigo = texto ? state.sliceDoc(texto.from, texto.to) : "";
          const topo = state.doc.line(a);
          decos.push(Decoration.line({ class: "cm-bloco-topo" }).range(topo.from));
          decos.push(Decoration.replace({ widget: new CabecalhoCodigo(lingua, codigo) }).range(topo.from, topo.to));
          const fim = state.doc.line(b);
          if (b > a && /^\s*(`{3,}|~{3,})\s*$/.test(fim.text)) {
            decos.push(Decoration.line({ class: "cm-bloco-fim" }).range(fim.from));
            esconder(fim.from, fim.to);
          }
          return;
        }
        case "Blockquote": {
          const a = state.doc.lineAt(no.from).number;
          const b = state.doc.lineAt(no.to).number;
          for (let n = a; n <= b; n++) decos.push(Decoration.line({ class: `cm-citacao${n === a ? " cm-citacao-topo" : ""}${n === b ? " cm-citacao-fim" : ""}` }).range(state.doc.line(n).from));
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
          const editando = tocaCursor(no.from, no.to);
          const resolver = state.facet(resolverFacet);
          const url = no.node.getChild("URL");
          const bruto = url ? state.sliceDoc(url.from, url.to) : "";
          const src = resolver?.(bruto);
          if (!src || state.sliceDoc(no.from, no.to).includes("\n")) return false;
          const marcas = no.node.getChildren("LinkMark");
          const alt = marcas.length >= 2 ? state.sliceDoc(marcas[0].to, marcas[1].from) : "";
          // Editando: o Markdown aparece e a imagem continua logo abaixo, para a tela não pular.
          if (editando) decos.push(Decoration.widget({ widget: new ImagemWidget(src, alt, no.from), side: 1 }).range(no.to));
          else decos.push(Decoration.replace({ widget: new ImagemWidget(src, alt, no.from) }).range(no.from, no.to));
          return false;
        }
        case "Link": {
          const marcas: { from: number; to: number }[] = [];
          for (let f = no.node.firstChild; f; f = f.nextSibling) if (f.name === "LinkMark") marcas.push({ from: f.from, to: f.to });
          if (marcas.length < 2) return false;
          const rotulo = state.sliceDoc(marcas[0].to, marcas[1].from);
          // Nota de rodapé `[^n]`: sobrescrito; na definição `[^n]: texto` a marca fica visível (a linha ganha estilo próprio).
          if (rotulo.startsWith("^") && marcas[1].to === no.to) {
            const def = no.from === state.doc.lineAt(no.from).from && state.sliceDoc(no.to, no.to + 1) === ":";
            if (def) { marcar(no.from, no.to, "cm-nota-marca"); return false; }
            const n = notas.get(rotulo.slice(1));
            decos.push(Decoration.mark({ class: "cm-nota-ref", attributes: { title: n?.texto || "Nota sem texto", "data-nota": rotulo.slice(1) } }).range(marcas[0].to + 1, marcas[1].from));
            if (!tocaCursor(no.from, no.to)) { esconder(marcas[0].from, marcas[0].to + 1); esconder(marcas[1].from, marcas[1].to); }
            return false;
          }
          // Citação `[@chave]`: vira (Autor, ano) fora do cursor; passar o mouse mostra a referência completa.
          if (/^@[\w:.\-/]+$/.test(rotulo) && marcas[1].to === no.to) {
            const r = bib.get(rotulo.slice(1));
            const titulo = r ? [r.campos.author, r.campos.title, r.campos.year].filter(Boolean).join(" — ") : "Referência não encontrada nos blocos bibtex";
            if (tocaCursor(no.from, no.to)) decos.push(Decoration.mark({ class: "cm-cita", attributes: { title: titulo } }).range(no.from, no.to));
            else decos.push(Decoration.replace({ widget: new Citacao(`(${citacaoCurta(r, rotulo.slice(1))})`, titulo, rotulo.slice(1)) }).range(no.from, no.to));
            return false;
          }
          // Só é link com endereço (`[x](url)`) ou com referência definida (`[x][ref]`, `[x]`); `[1]`, `[TOC]` ficam como texto.
          const temUrl = !!no.node.getChild("URL");
          const label = no.node.getChild("LinkLabel");
          const chave = (label ? state.sliceDoc(label.from + 1, label.to - 1) || rotulo : rotulo).trim().toLowerCase();
          if (!temUrl && !referencias.has(chave)) return false;
          {
            marcar(marcas[0].to, marcas[1].from, "cm-link");
            if (!tocaCursor(no.from, no.to)) { esconder(marcas[0].from, marcas[0].to); esconder(marcas[1].from, no.to); }
          }
          return false;
        }
        case "URL": {
          // Endereço solto (autolink GFM ou <https://…>); o das formas `[x](url)` e imagens nunca chega aqui.
          const t = state.sliceDoc(no.from, no.to);
          if (/^https?:\/\//i.test(t)) decos.push(Decoration.mark({ class: "cm-link", attributes: { title: "Clique para abrir" } }).range(no.from, no.to));
          return;
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
    // Só encolhe a partir da 2ª linha vazia seguida: uma linha em branco mantém a altura e dá espaço visível.
    if (!l.length && n > 1 && !state.doc.line(n - 1).length && !ativas.has(n) && !emCodigo.has(n) && n < state.doc.lines) decos.push(Decoration.line({ class: "cm-vazia" }).range(l.from));
    if (emCodigo.has(n)) continue;
    if (NOTA_DEF.test(l.text)) linha(l.from, "cm-nota-def");
    if (QUEBRA_PAGINA.test(l.text)) linha(l.from, ativas.has(n) ? "cm-quebra-pagina cm-quebra-ativa" : "cm-quebra-pagina");
    if (l.text.includes("==")) {
      REALCE.lastIndex = 0;
      let r: RegExpExecArray | null;
      while ((r = REALCE.exec(l.text))) {
        const de = l.from + r.index;
        const ate = de + r[0].length;
        if (syntaxTree(state).resolveInner(de + 1, 1).name === "InlineCode") continue;
        marcar(de + 2, ate - 2, "cm-realce");
        if (!tocaCursor(de, ate)) { esconder(de, de + 2); esconder(ate - 2, ate); }
      }
    }
    if (!l.text.includes("[[")) continue;
    WIKILINK.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = WIKILINK.exec(l.text))) {
      const de = l.from + m.index;
      const ate = de + m[0].length;
      const rotuloIni = de + 2 + (m[2] !== undefined ? m[1].length + 1 : 0);
      const rotuloFim = ate - 2;
      if (rotuloFim > rotuloIni) decos.push(Decoration.mark({ class: "cm-wikilink", attributes: { title: "Ctrl+clique para abrir" } }).range(rotuloIni, rotuloFim));
      if (!tocaCursor(de, ate)) { esconder(de, rotuloIni); esconder(rotuloFim, ate); }
    }
  }
  return Decoration.set(decos, true);
}

const plugin = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  constructor(view: EditorView) { this.decorations = montarDecoracoes(view); }
  update(u: { docChanged: boolean; selectionSet: boolean; focusChanged: boolean; viewportChanged: boolean; view: EditorView; state: EditorState; startState: EditorState }) {
    // A árvore do Markdown pode terminar de ser analisada depois do primeiro desenho (sem mudar o texto): refaz as marcas.
    const arvore = syntaxTree(u.state) !== syntaxTree(u.startState);
    if (u.docChanged || u.selectionSet || u.focusChanged || u.viewportChanged || arvore) this.decorations = montarDecoracoes(u.view);
  }
}, { decorations: (p) => p.decorations });

const tema = EditorView.theme({
  "&": { backgroundColor: "transparent", color: "rgb(var(--ecos-text-primary-rgb))", fontSize: "var(--ecos-fonte-nota, 14px)" },
  "&, &.cm-focused, .cm-content, .cm-content:focus-visible, .cm-scroller": { outline: "none !important" },
  ".cm-scroller": { fontFamily: "inherit", lineHeight: "var(--ecos-linha-nota, 20px)", overflow: "visible" },
  ".cm-content": { padding: "0", caretColor: "rgb(var(--ecos-cyan-rgb))" },
  ".cm-line": { padding: "0" },
  ".cm-quebra-pagina": { position: "relative", color: "transparent", borderTop: "1px dashed rgb(var(--ecos-text-muted-rgb))", marginTop: "10px", paddingTop: "2px" },
  ".cm-quebra-pagina::after": { content: '"Quebra de página"', position: "absolute", left: "50%", top: "-0.75em", transform: "translateX(-50%)", padding: "0 8px", fontSize: "11px", lineHeight: "1.5", color: "rgb(var(--ecos-text-muted-rgb))", background: "var(--ecos-folha, rgb(var(--ecos-surface-1-rgb)))" },
  ".cm-quebra-ativa": { color: "rgb(var(--ecos-text-muted-rgb))" },
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
  ".cm-h4, .cm-h5, .cm-h6": { fontWeight: "600", lineHeight: "22px" },
  ".cm-h4": { fontSize: "1.0714em", fontFamily: "\"Space Grotesk\", sans-serif" },
  ".cm-h5": { fontSize: "1em", letterSpacing: "0.01em" },
  ".cm-h6": { fontSize: "0.9286em", color: "rgb(var(--ecos-text-secondary-rgb))", textTransform: "uppercase", letterSpacing: "0.04em" },
  ".cm-realce": { background: "rgb(250 204 21 / 0.3)", borderRadius: "3px", padding: "0 2px" },
  ".cm-nota-ref": { verticalAlign: "super", fontSize: "0.75em", lineHeight: "0", color: "rgb(var(--ecos-steel-300-rgb))" },
  ".cm-nota-ref[data-nota]": { cursor: "pointer" },
  ".cm-cita": { color: "rgb(var(--ecos-steel-300-rgb))", cursor: "help" },
  ".cm-nota-def": { fontSize: "0.93em", color: "rgb(var(--ecos-text-secondary-rgb))" },
  ".cm-nota-marca": { color: "rgb(var(--ecos-steel-300-rgb))" },
  ".cm-bloco-topo": { lineHeight: "24px" },
  ".cm-bloco-fim": { height: "8px", lineHeight: "8px", overflow: "hidden" },
  ".cm-cod-cabecalho": { display: "inline-flex", width: "100%", justifyContent: "space-between", alignItems: "center", fontFamily: "inherit", fontSize: "12px", color: "rgb(var(--ecos-text-secondary-rgb))" },
  ".cm-cod-lingua": { textTransform: "lowercase" },
  ".cm-cod-copiar": { background: "rgb(var(--ecos-surface-3-rgb))", color: "inherit", border: "0", borderRadius: "6px", padding: "0 8px", fontSize: "12px", lineHeight: "20px", cursor: "pointer" },
  ".cm-cod-copiar:hover": { color: "rgb(var(--ecos-text-primary-rgb))" },
  ".cm-neg": { fontWeight: "700" },
  ".cm-ita": { fontStyle: "italic" },
  ".cm-tach": { textDecoration: "line-through", opacity: "0.7" },
  ".cm-cod": { fontFamily: "\"IBM Plex Mono\", monospace", fontSize: "13.5px", lineHeight: "1", background: "rgb(var(--ecos-surface-3-rgb))", borderRadius: "4px", padding: "1px 4px" },
  ".cm-bloco-cod": { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", fontSize: "0.9em", background: "rgb(var(--ecos-surface-2-rgb))" },
  ".cm-citacao": { borderLeft: "3px solid rgb(var(--ecos-steel-500-rgb))", paddingLeft: "12px", color: "rgb(var(--ecos-text-secondary-rgb))" },
  ".cm-link, .cm-wikilink": { color: "rgb(var(--ecos-steel-300-rgb))", textDecoration: "underline", textUnderlineOffset: "3px", cursor: "pointer" },
  ".cm-wikilink": { textDecoration: "none", fontWeight: "500" },
  ".cm-marcador": { display: "inline-block", width: "1.1em", color: "rgb(var(--ecos-steel-300-rgb))" },
  ".cm-caixa": { margin: "0 6px 0 0", width: "15px", height: "15px", verticalAlign: "-2px", accentColor: "rgb(var(--ecos-steel-500-rgb))", cursor: "pointer" },
  ".cm-feita": { color: "rgb(var(--ecos-text-secondary-rgb))", textDecoration: "line-through" },
  ".cm-imagem": { display: "block", maxWidth: "100%", maxHeight: "70vh", borderRadius: "12px", margin: "6px 0", cursor: "text" },
  ".cm-imagem-falha": { color: "rgb(var(--ecos-text-secondary-rgb))", fontStyle: "italic" },
  // Painel de busca (Ctrl+F / Ctrl+H) com as cores do Ecos.
  ".cm-panels": { backgroundColor: "rgb(var(--ecos-surface-2-rgb))", color: "rgb(var(--ecos-text-primary-rgb))", borderRadius: "12px", zIndex: "30" },
  ".cm-panels.cm-panels-top": { borderBottom: "1px solid rgb(var(--ecos-border-rgb))", marginBottom: "8px" },
  ".cm-panel.cm-search": { padding: "8px 32px 8px 10px", fontFamily: "inherit", fontSize: "13px", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 6px" },
  ".cm-panel.cm-search br": { flexBasis: "100%", height: "0" },
  ".cm-panel.cm-search input.cm-textfield": { background: "rgb(var(--ecos-surface-1-rgb))", color: "inherit", border: "1px solid rgb(var(--ecos-border-rgb))", borderRadius: "8px", padding: "4px 8px", fontSize: "13px", outline: "none" },
  ".cm-panel.cm-search input.cm-textfield:focus": { borderColor: "rgb(var(--ecos-steel-400-rgb))" },
  ".cm-panel.cm-search .cm-button": { backgroundImage: "none", background: "rgb(var(--ecos-surface-3-rgb))", color: "inherit", border: "0", borderRadius: "8px", padding: "4px 10px", fontSize: "12px", cursor: "pointer" },
  ".cm-panel.cm-search .cm-button:hover": { background: "rgb(var(--ecos-steel-500-rgb) / 0.4)" },
  ".cm-panel.cm-search label": { display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "12px", color: "rgb(var(--ecos-text-secondary-rgb))" },
  ".cm-panel.cm-search input[type=checkbox]": { accentColor: "rgb(var(--ecos-steel-500-rgb))" },
  ".cm-panel.cm-search button[name=close]": { position: "absolute", top: "6px", right: "8px", background: "none", border: "0", color: "rgb(var(--ecos-text-secondary-rgb))", fontSize: "18px", cursor: "pointer" },
  ".cm-searchMatch": { backgroundColor: "rgb(var(--ecos-steel-500-rgb) / 0.35)", borderRadius: "2px" },
  ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "rgb(var(--ecos-cyan-rgb) / 0.35)" },
  ".cm-linha-regua": { height: "1px", lineHeight: "1px", overflow: "hidden", background: "rgb(var(--ecos-border-rgb))" },
});

const edicao = (somenteLeitura: boolean) => [EditorState.readOnly.of(somenteLeitura), EditorView.editable.of(!somenteLeitura)];

export function EditorVivo({ corpo, onCorpoChange, areaRef, ariaLabel, placeholder, alturaMinima, resolverImagem, atalhos, className, wikilinks, aoAbrirWikilink, somenteLeitura = false, aoCriarView }: Props) {
  const raiz = useRef<HTMLDivElement>(null);
  const leitura = useRef(new Compartment());
  const somenteLeituraInicial = useRef(somenteLeitura);
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
        markdown({ base: markdownLanguage, extensions: [GFM], codeLanguages: languages }),
        syntaxHighlighting(realceCodigo),
        Prec.highest(keymap.of(TECLAS_EDITOR.map((tecla) => ({ key: tecla, preventDefault: true, run: () => { const f = atalhosRef.current?.[tecla]; if (!f) return false; f(); return true; } })))),
        // Enter continua a lista/citação (e encerra numa linha vazia); Backspace tira a marca; listas numeradas são renumeradas.
        Prec.high(keymap.of([
          { key: "Enter", run: insertNewlineContinueMarkup },
          { key: "Backspace", run: deleteMarkupBackward },
          { key: "Mod-h", run: openSearchPanel, preventDefault: true },
        ])),
        search({ top: true }),
        EditorState.phrases.of(FRASES_BUSCA),
        // Fecha só parênteses, colchetes e crase: aspas e apóstrofos atrapalhariam o português.
        closeBrackets(),
        markdownLanguage.data.of({ closeBrackets: { brackets: ["(", "[", "`"] } }),
        // Tab/Shift+Tab indentam (listas aninhadas). Esc e depois Tab sai do editor (modo de foco do CodeMirror).
        keymap.of([...closeBracketsKeymap, ...searchKeymap, ...historyKeymap, ...defaultKeymap.filter((k) => k.key !== "Mod-i"), indentWithTab]),
        EditorView.lineWrapping,
        leitura.current.of(edicao(somenteLeituraInicial.current)),
        tema,
        EditorView.contentAttributes.of({ "aria-label": ariaLabel, spellcheck: "true" }),
        placeholder ? placeholderExt(placeholder) : [],
        EditorView.theme({ ".cm-content": { minHeight: alturaMinima } }),
        plugin,
        sumarioEditor,
        tabelas,
        rolagemSuave,
        matematica,
        temaMatematica,
        blocosEscrita,
        temaEscrita,
        wikilinksRef.current ? autocompletarWikilink(() => wikilinksRef.current) : autocompletarEmoji(),
        colarMarkdown(),
        Prec.highest(keymap.of([atalhoColarTextoSimples])),
        contadorTexto,
        EditorView.domEventHandlers({
          keydown(e) {
            // Atalhos do editor não sobem para os globais da janela (Ctrl+K = link aqui, busca global fora; Ctrl+B = negrito, não a barra lateral).
            const mod = e.ctrlKey || e.metaKey;
            if (mod && !e.shiftKey && !e.altKey && ["k", "b", "i", "e"].includes(e.key.toLowerCase())) e.stopPropagation();
            return false;
          },
          click(e, v) {
            // Chamada de nota `[^n]` ou citação: leva ao item no menu lateral.
            const alvo = (e.target as HTMLElement | null)?.closest?.("[data-nota], [data-cita]") as HTMLElement | null;
            if (alvo && e.button === 0 && !e.ctrlKey && !e.metaKey) { irParaNota(alvo.dataset.nota ? alvo.dataset.nota : `@${alvo.dataset.cita}`); return false; }
            // Link web: `[texto](url)` ou endereço solto. Clique simples abre em outra aba (sem seleção em andamento).
            if (e.button !== 0 || !v.state.selection.main.empty) return false;
            const pos = v.posAtCoords({ x: e.clientX, y: e.clientY }, false);
            for (const lado of [1, -1] as const) {
              for (let n: ReturnType<ReturnType<typeof syntaxTree>["resolveInner"]> | null = syntaxTree(v.state).resolveInner(pos, lado); n; n = n.parent) {
                if (n.name !== "Link" && n.name !== "URL") continue;
                const alvo = n.name === "Link" ? n.getChild("URL") : n;
                const href = alvo ? v.state.sliceDoc(alvo.from, alvo.to).trim() : "";
                if (!/^https?:\/\//i.test(href)) break;
                // Só conta se o clique caiu de fato sobre o texto do link (não no espaço vazio depois dele).
                const fim = v.coordsAtPos(n.to, -1);
                const ini = v.coordsAtPos(n.from, 1);
                const dentro = !!fim && !!ini && e.clientY >= Math.min(ini.top, fim.top) - 2 && e.clientY <= Math.max(ini.bottom, fim.bottom) + 2
                  && (ini.top !== fim.top || (e.clientX >= ini.left - 2 && e.clientX <= fim.right + 2));
                if (!dentro) break;
                e.preventDefault();
                window.open(href, "_blank", "noopener,noreferrer");
                return true;
              }
            }
            return false;
          },
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
    aoCriarView?.(v);
    areaRef.current = {
      get selectionStart() { return v.state.selection.main.from; },
      set selectionStart(n: number) { const p = Math.min(Math.max(n, 0), v.state.doc.length); v.dispatch({ selection: { anchor: p, head: Math.max(p, v.state.selection.main.to) } }); },
      get selectionEnd() { return v.state.selection.main.to; },
      set selectionEnd(n: number) { const p = Math.min(Math.max(n, 0), v.state.doc.length); v.dispatch({ selection: { anchor: Math.min(v.state.selection.main.from, p), head: p } }); },
      focus() { v.focus(); },
      setSelectionRange(a: number, b: number) { const t = v.state.doc.length; v.dispatch({ selection: { anchor: Math.min(a, t), head: Math.min(b, t) } }); },
      texto() { return v.state.doc.toString(); },
      substituir(de: number, ate: number, texto: string, selecao?: [number, number]) {
        const fim = de + texto.length;
        const [i, f] = selecao ?? [fim, fim];
        v.dispatch({ changes: { from: de, to: ate, insert: texto }, selection: { anchor: i, head: f }, scrollIntoView: true, userEvent: "input.format" });
        v.focus();
      },
    };
    return () => { v.destroy(); view.current = null; areaRef.current = null; aoCriarView?.(null); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    view.current?.dispatch({ effects: leitura.current.reconfigure(edicao(somenteLeitura)) });
  }, [somenteLeitura]);

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
