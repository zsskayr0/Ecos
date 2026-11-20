import { StateEffect, StateField, type EditorState, type Range } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import "./tabela-widget.css";

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

/** Serializa de volta para Markdown GFM, escapando `|` dentro das células. */
export function escreverTabela(t: TabelaMd): string {
  const esc = (s: string) => s.replace(/\n/g, " ").replace(/\|/g, "\\|");
  const linha = (cs: string[]) => `| ${cs.map(esc).join(" | ")} |`;
  const delim = t.alinhamentos.map((a) => (a === "center" ? ":---:" : a === "right" ? "---:" : a === "left" ? ":---" : "---"));
  return [linha(t.cabecalho), `| ${delim.join(" | ")} |`, ...t.linhas.map(linha)].join("\n");
}

// Código, imagem, link, wikilink, negrito (** ou __), riscado, itálico (* ou _).
const INLINE = /(`[^`\n]+`)|!\[([^\]\n]*)\]\(([^)\s]+)[^)]*\)|\[([^\]\n]+)\]\(([^)\s]+)[^)]*\)|\[\[([^\]|\n]+)(?:\|([^\]\n]*))?\]\]|\*\*([^*\n]+)\*\*|__([^_\n]+)__|~~([^~\n]+)~~|\*([^*\n]+)\*|(?<!\w)_([^_\n]+)_(?!\w)/g;

/** Aceita http(s), mailto, caminhos relativos e âncoras; recusa javascript: e afins. */
const urlSegura = (u: string) => /^(https?:|mailto:)/i.test(u) || !/^[a-z][\w+.-]*:/i.test(u);

/** Formatação inline dentro da célula, sempre via textContent (sem innerHTML). */
export function preencherCelula(el: HTMLElement, texto: string) {
  INLINE.lastIndex = 0;
  let ultimo = 0;
  let m: RegExpExecArray | null;
  const add = (tag: string, conteudo: string, classe?: string) => {
    const n = document.createElement(tag);
    if (classe) n.className = classe;
    n.textContent = conteudo;
    el.appendChild(n);
    return n;
  };
  while ((m = INLINE.exec(texto))) {
    if (m.index > ultimo) el.appendChild(document.createTextNode(texto.slice(ultimo, m.index)));
    if (m[1]) add("code", m[1].slice(1, -1), "cm-cod");
    else if (m[3] !== undefined) {
      if (urlSegura(m[3])) {
        const img = document.createElement("img");
        img.className = "cm-tabela-img";
        img.src = m[3];
        img.alt = m[2] ?? "";
        el.appendChild(img);
      } else add("span", m[2] ?? "");
    } else if (m[5] !== undefined) {
      const a = add("a", m[4], "cm-link") as HTMLAnchorElement;
      if (urlSegura(m[5])) { a.href = m[5]; a.target = "_blank"; a.rel = "noopener noreferrer"; }
    } else if (m[6] !== undefined) add("span", (m[7] ?? m[6]).trim(), "cm-wikilink");
    else if (m[8] !== undefined || m[9] !== undefined) add("strong", m[8] ?? m[9]);
    else if (m[10] !== undefined) add("s", m[10]);
    else add("em", m[11] ?? m[12]);
    ultimo = m.index + m[0].length;
  }
  if (ultimo < texto.length) el.appendChild(document.createTextNode(texto.slice(ultimo)));
}

type Pos = { l: number; c: number };

/** Célula a focar quando o widget for recriado depois de gravar (o DOM antigo some no dispatch). */
let focoPendente: (Pos & { de: number }) | null = null;
/** Enquanto uma célula está em edição, a seleção do editor pode cair dentro da tabela (o foco do
 * campo conta como seleção no widget); sem esta trava a tabela viraria Markdown cru no meio da digitação. */
let celulaEmEdicao = false;

/** Tabela GFM mostrada como tabela; cada célula é editável e grava de volta o Markdown. */
class TabelaWidget extends WidgetType {
  constructor(private readonly fonte: string, private readonly tabela: TabelaMd, private readonly de: number) { super(); }
  eq(o: TabelaWidget) { return o.fonte === this.fonte && o.de === this.de; }

  toDOM(view: EditorView) {
    const bloco = document.createElement("div");
    bloco.className = "cm-tabela-bloco";
    const rolagem = document.createElement("div");
    rolagem.className = "cm-tabela-rolagem";
    const t = document.createElement("table");
    t.className = "cm-tabela";
    const dados: TabelaMd = {
      cabecalho: [...this.tabela.cabecalho],
      alinhamentos: [...this.tabela.alinhamentos],
      linhas: this.tabela.linhas.map((l) => [...l]),
    };
    const nCols = dados.cabecalho.length;
    // l = -1 é o cabeçalho.
    let ativa: Pos = { l: 0, c: 0 };
    /** Passa o valor da célula aberta para `dados` sem gravar (usado antes das ações da barra). */
    let aplicarAberta: (() => void) | null = null;
    const celulas: HTMLTableCellElement[][] = [];
    const texto = (l: number, c: number) => (l < 0 ? dados.cabecalho[c] : dados.linhas[l][c]);
    const definir = (l: number, c: number, v: string) => { if (l < 0) dados.cabecalho[c] = v; else dados.linhas[l][c] = v; };

    const gravar = (alvo: Pos | null) => {
      const de = view.posAtDOM(bloco);
      const ate = de + this.fonte.length;
      if (view.state.sliceDoc(de, ate) !== this.fonte) return false;
      const novo = escreverTabela(dados);
      if (novo === this.fonte) return false;
      focoPendente = alvo ? { de, ...alvo } : null;
      // Cursor logo depois da tabela, para o foco de volta no editor não reabrir o Markdown cru.
      const fim = Math.min(de + novo.length + 1, view.state.doc.length - (ate - de) + novo.length);
      view.dispatch({ changes: { from: de, to: ate, insert: novo }, selection: { anchor: fim }, userEvent: "input.tabela" });
      return true;
    };
    const sairAbaixo = () => {
      if (!bloco.isConnected) { view.focus(); return; } // já gravou e posicionou o cursor
      const de = view.posAtDOM(bloco);
      view.dispatch({ selection: { anchor: Math.min(de + this.fonte.length + 1, view.state.doc.length) } });
      view.focus();
    };

    const abrir = (l: number, c: number) => {
      const td = celulas[l + 1]?.[c];
      if (!td) return;
      ativa = { l, c };
      celulaEmEdicao = true;
      if (td.querySelector("input")) return;
      td.textContent = "";
      td.classList.add("cm-celula-ativa");
      const inp = document.createElement("input");
      inp.className = "cm-tabela-entrada";
      inp.value = texto(l, c);
      inp.setAttribute("aria-label", l < 0 ? `Cabeçalho, coluna ${c + 1}` : `Linha ${l + 1}, coluna ${c + 1}`);
      let fechado = false;
      aplicarAberta = () => { fechado = true; definir(l, c, inp.value.trim()); };
      const fechar = (alvo: Pos | null) => {
        if (fechado) return;
        fechado = true;
        aplicarAberta = null;
        if (!alvo) celulaEmEdicao = false;
        definir(l, c, inp.value.trim());
        if (gravar(alvo)) return; // o widget será recriado e abrirá o alvo
        td.classList.remove("cm-celula-ativa");
        td.textContent = "";
        preencherCelula(td, texto(l, c));
        if (alvo) abrir(alvo.l, alvo.c);
      };
      inp.addEventListener("keydown", (e) => {
        e.stopPropagation();
        const total = dados.linhas.length;
        if (e.key === "Tab") {
          e.preventDefault();
          let nl = l;
          let nc = c + (e.shiftKey ? -1 : 1);
          if (nc >= nCols) { nc = 0; nl++; }
          if (nc < 0) { nc = nCols - 1; nl--; }
          if (nl < -1) { nl = -1; nc = 0; }
          if (nl >= total) dados.linhas.push(Array(nCols).fill(""));
          fechar({ l: nl, c: nc });
        } else if (e.key === "Enter") {
          e.preventDefault();
          const ultima = l + 1 >= total;
          fechar(ultima ? null : { l: l + 1, c });
          if (ultima) sairAbaixo();
        } else if (e.key === "Escape") {
          e.preventDefault();
          inp.value = texto(l, c);
          fechar(null);
          sairAbaixo();
        }
      });
      inp.addEventListener("blur", () => fechar(null));
      td.appendChild(inp);
      inp.focus();
      inp.select();
    };

    const celula = (tag: "th" | "td", l: number, i: number) => {
      const c = document.createElement(tag);
      const a = dados.alinhamentos[i];
      if (a) c.style.textAlign = a;
      preencherCelula(c, texto(l, i));
      c.addEventListener("mousedown", (e) => {
        if ((e.target as HTMLElement).closest("a, input")) return;
        e.preventDefault();
        abrir(l, i);
      });
      return c;
    };
    const cab = t.createTHead().insertRow();
    celulas.push(dados.cabecalho.map((_, i) => cab.appendChild(celula("th", -1, i))));
    const corpo = t.createTBody();
    dados.linhas.forEach((linha, li) => {
      const tr = corpo.insertRow();
      celulas.push(linha.map((_, i) => tr.appendChild(celula("td", li, i))));
    });
    rolagem.appendChild(t);

    const barra = document.createElement("div");
    barra.className = "cm-tabela-barra";
    const botao = (rotulo: string, titulo: string, acao: () => Pos | null) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = rotulo;
      b.title = titulo;
      b.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        aplicarAberta?.();
        aplicarAberta = null;
        gravar(acao());
      });
      barra.appendChild(b);
    };
    botao("+ Linha", "Adicionar linha abaixo da célula atual", () => {
      const l = ativa.l + 1;
      dados.linhas.splice(l, 0, Array(nCols).fill(""));
      return { l, c: ativa.c };
    });
    botao("− Linha", "Remover a linha da célula atual", () => {
      if (ativa.l < 0 || !dados.linhas.length) return null;
      dados.linhas.splice(ativa.l, 1);
      return null;
    });
    botao("+ Coluna", "Adicionar coluna à direita da célula atual", () => {
      const c = ativa.c + 1;
      dados.cabecalho.splice(c, 0, "");
      dados.alinhamentos.splice(c, 0, null);
      dados.linhas.forEach((l) => l.splice(c, 0, ""));
      return { l: -1, c };
    });
    botao("− Coluna", "Remover a coluna da célula atual", () => {
      if (nCols <= 1) return null;
      const c = ativa.c;
      dados.cabecalho.splice(c, 1);
      dados.alinhamentos.splice(c, 1);
      dados.linhas.forEach((l) => l.splice(c, 1));
      return null;
    });
    botao("Markdown", "Editar o Markdown da tabela", () => {
      celulaEmEdicao = false;
      view.dispatch({ selection: { anchor: view.posAtDOM(bloco) } });
      view.focus();
      return null;
    });

    bloco.append(barra, rolagem);
    // O mesmo dispatch pode recriar o widget mais de uma vez (ex.: o React devolve o corpo ao editor);
    // só a instância que continuar no DOM abre a célula pendente.
    if (focoPendente && focoPendente.de === this.de) {
      setTimeout(() => {
        if (!focoPendente || focoPendente.de !== this.de || !bloco.isConnected) return;
        const { l, c } = focoPendente;
        focoPendente = null;
        abrir(l, c);
      });
    }
    return bloco;
  }
  ignoreEvent() { return true; }
}

const focoEfeito = StateEffect.define<boolean>();

function montar(state: EditorState, focado: boolean): DecorationSet {
  const decos: Range<Decoration>[] = [];
  // O Lezer analisa o documento aos poucos (começando pelo trecho visível); sem completar a árvore,
  // tabelas mais abaixo ficavam como texto cru, pois este campo só recalcula ao editar ou mudar a seleção.
  (ensureSyntaxTree(state, state.doc.length, 250) ?? syntaxTree(state)).iterate({
    enter: (no) => {
      if (no.name !== "Table") return;
      const editando = focado && !celulaEmEdicao && state.selection.ranges.some((r) => r.from <= no.to && r.to >= no.from);
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
