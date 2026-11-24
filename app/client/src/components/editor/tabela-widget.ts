import { acharTabelas, linhasDaTabela } from "@/lib/tabela-colada";
import { StateEffect, StateField, type EditorState, type Range, type Text } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import "./tabela-widget.css";

type Alinhamento = "left" | "center" | "right" | null;

export interface TabelaMd {
  cabecalho: string[];
  alinhamentos: Alinhamento[];
  linhas: string[][];
  /**
   * Largura das colunas em px. O GFM não tem larguras; elas vão nos traços da linha de delimitadores
   * (cada traço = 8px: `|----------|---|`). Se todas as colunas têm os 3 traços de sempre, não há larguras (coluna automática).
   */
  larguras?: (number | null)[];
}

/** Largura, em px, de cada traço da linha de delimitadores. */
export const PX_POR_TRACO = 8;

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
  const tracos = cabecalho.map((_, i) => (delim[i] ?? "---").replace(/:/g, "").length);
  const larguras = tracos.some((n) => n !== 3) ? tracos.map((n) => n * PX_POR_TRACO) : undefined;
  return larguras ? { cabecalho, alinhamentos, linhas: corpo, larguras } : { cabecalho, alinhamentos, linhas: corpo };
}

/** Serializa de volta para Markdown GFM, escapando `|` dentro das células. */
export function escreverTabela(t: TabelaMd): string {
  const esc = (s: string) => s.replace(/\n/g, " ").replace(/\|/g, "\\|");
  const linha = (cs: string[]) => `| ${cs.map(esc).join(" | ")} |`;
  const delim = t.alinhamentos.map((a, i) => {
    const w = t.larguras?.some((x) => x != null) ? (t.larguras[i] ?? 15 * PX_POR_TRACO) : null;
    const tr = "-".repeat(w == null ? 3 : Math.max(3, Math.round(w / PX_POR_TRACO)));
    return a === "center" ? `:${tr}:` : a === "right" ? `${tr}:` : a === "left" ? `:${tr}` : tr;
  });
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
      larguras: this.tabela.larguras ? [...this.tabela.larguras] : undefined,
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

    // ── Larguras das colunas (gravadas nos traços da linha de delimitadores) ──
    const grupo = document.createElement("colgroup");
    for (let i = 0; i < nCols; i++) grupo.appendChild(document.createElement("col"));
    t.insertBefore(grupo, t.firstChild);
    const aplicarLarguras = () => {
      const ls = dados.larguras;
      if (!ls?.some((x) => x != null)) return;
      const w = ls.map((x) => x ?? 15 * PX_POR_TRACO);
      t.style.tableLayout = "fixed";
      t.style.maxWidth = "none";
      t.style.width = `${w.reduce((a, b) => a + b, 0)}px`;
      w.forEach((x, i) => { (grupo.children[i] as HTMLElement).style.width = `${x}px`; });
    };
    aplicarLarguras();

    // ── Camada de comandos sobre a tabela: alças de largura e botões "+" que aparecem ao passar o mouse ──
    const sobre = document.createElement("div");
    sobre.className = "cm-tabela-sobre";
    const mais = (rotulo: string, titulo: string, acao: () => Pos | null, simbolo = "+") => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = simbolo === "+" ? "cm-tabela-mais" : "cm-tabela-mais cm-tabela-menos";
      b.textContent = simbolo;
      b.title = titulo;
      b.setAttribute("aria-label", rotulo);
      b.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        aplicarAberta?.();
        aplicarAberta = null;
        gravar(acao());
      });
      sobre.appendChild(b);
      return b;
    };
    const inserirColuna = (k: number): Pos => {
      dados.cabecalho.splice(k, 0, "");
      dados.alinhamentos.splice(k, 0, null);
      dados.linhas.forEach((l) => l.splice(k, 0, ""));
      if (dados.larguras) dados.larguras.splice(k, 0, 12 * PX_POR_TRACO);
      return { l: -1, c: k };
    };
    const inserirLinha = (k: number): Pos => { dados.linhas.splice(k, 0, Array(nCols).fill("")); return { l: k, c: 0 }; };
    let colunaAlvo = 0;
    let linhaAlvo = 0;
    const maisCol = mais("Adicionar coluna aqui", "Adicionar coluna aqui", () => inserirColuna(colunaAlvo));
    const maisLinha = mais("Adicionar linha aqui", "Adicionar linha aqui", () => inserirLinha(linhaAlvo));
    let linhaApagar = -1;
    let colunaApagar = 0;
    const menosLinha = mais("Excluir esta linha", "Excluir esta linha", () => { if (linhaApagar >= 0) dados.linhas.splice(linhaApagar, 1); return null; }, "×");
    const menosCol = mais("Excluir esta coluna", "Excluir esta coluna", () => {
      if (nCols <= 1) return null;
      dados.cabecalho.splice(colunaApagar, 1);
      dados.alinhamentos.splice(colunaApagar, 1);
      dados.linhas.forEach((l) => l.splice(colunaApagar, 1));
      dados.larguras?.splice(colunaApagar, 1);
      return null;
    }, "×");
    const maisFim = document.createElement("button");
    maisFim.type = "button";
    maisFim.className = "cm-tabela-mais-fim";
    maisFim.textContent = "+ Linha";
    maisFim.title = "Adicionar linha no fim da tabela";
    maisFim.setAttribute("aria-label", "Adicionar linha no fim da tabela");
    maisFim.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      aplicarAberta?.();
      aplicarAberta = null;
      gravar(inserirLinha(dados.linhas.length));
    });
    sobre.appendChild(maisFim);

    const alcas: HTMLElement[] = [];
    const rel = (el: Element) => { const r = el.getBoundingClientRect(); const b = bloco.getBoundingClientRect(); return { x: r.left - b.left, y: r.top - b.top, w: r.width, h: r.height }; };
    /** Põe as alças nas bordas atuais das colunas. */
    const posicionarAlcas = () => {
      const tab = rel(t);
      alcas.forEach((a, i) => { const c = celulas[0]?.[i]; if (!c) return; const r = rel(c); a.style.left = `${r.x + r.w - 4}px`; a.style.top = `${tab.y}px`; a.style.height = `${tab.h}px`; });
    };
    /** Intensidade (0 a 1) de um comando conforme a distância do mouse: cheio de perto, some de longe. */
    const prox = (d: number, perto = 16, longe = 72) => Math.max(0, Math.min(1, 1 - (d - perto) / (longe - perto)));
    const brilho = (el: HTMLElement, o: number) => { el.style.setProperty("--o", String(o)); el.style.pointerEvents = o > 0.35 ? "auto" : "none"; };
    const apagar = () => { brilho(maisCol, 0); brilho(maisLinha, 0); brilho(maisFim, 0); brilho(menosCol, 0); brilho(menosLinha, 0); bloco.style.setProperty("--o-barra", "0"); delete bloco.dataset.barra; };
    /** Os comandos aparecem conforme o mouse se aproxima do lugar de cada um, não todos de uma vez. */
    const aoMover = (e: MouseEvent) => {
      if ((e.target as Element).closest(".cm-tabela-mais, .cm-tabela-mais-fim, .cm-tabela-alca, .cm-tabela-barra")) return;
      const b = bloco.getBoundingClientRect();
      const px = e.clientX - b.left;
      const py = e.clientY - b.top;
      const tab = rel(t);
      posicionarAlcas();
      // Coluna nova: na borda mais próxima, junto ao topo da tabela.
      const ths = celulas[0] ?? [];
      const xs = [rel(ths[0]!).x, ...ths.map((c) => { const r = rel(c); return r.x + r.w; })];
      let k = 0;
      xs.forEach((x, i) => { if (Math.abs(px - x) < Math.abs(px - xs[k]!)) k = i; });
      colunaAlvo = k;
      maisCol.style.left = `${xs[k]! - 9}px`; maisCol.style.top = `${tab.y - 9}px`;
      brilho(maisCol, prox(Math.hypot(px - xs[k]!, py - tab.y)));
      // Linha nova: na borda mais próxima, junto à lateral esquerda.
      const ys = celulas.map((l) => { const r = rel(l[0]!); return r.y + r.h; });
      let j = 0;
      ys.forEach((y, i) => { if (Math.abs(py - y) < Math.abs(py - ys[j]!)) j = i; });
      linhaAlvo = j;
      maisLinha.style.left = `${tab.x - 9}px`; maisLinha.style.top = `${ys[j]! - 9}px`;
      brilho(maisLinha, prox(Math.hypot(px - tab.x, py - ys[j]!)));
      // Excluir coluna: × no topo da coluna sob o mouse. Excluir linha: × na lateral esquerda da linha sob o mouse (o cabeçalho não sai).
      const cc = ths.findIndex((c) => { const r = rel(c); return px >= r.x && px <= r.x + r.w; });
      if (cc >= 0 && nCols > 1) {
        const r = rel(ths[cc]!);
        colunaApagar = cc;
        menosCol.style.left = `${r.x + r.w / 2 - 9}px`; menosCol.style.top = `${tab.y - 9}px`;
        brilho(menosCol, prox(Math.hypot(px - (r.x + r.w / 2), py - tab.y)));
      } else brilho(menosCol, 0);
      const ll = celulas.slice(1).findIndex((l) => { const r = rel(l[0]!); return py >= r.y && py <= r.y + r.h; });
      if (ll >= 0) {
        const r = rel(celulas[ll + 1]![0]!);
        linhaApagar = ll;
        menosLinha.style.left = `${tab.x - 21}px`; menosLinha.style.top = `${r.y + r.h / 2 - 9}px`;
        brilho(menosLinha, prox(Math.hypot(px - (tab.x - 11), py - (r.y + r.h / 2))));
      } else brilho(menosLinha, 0);
      // Linha no fim: embaixo da tabela.
      maisFim.style.left = `${tab.x}px`; maisFim.style.width = `${tab.w}px`; maisFim.style.top = `${tab.y + tab.h + 2}px`;
      brilho(maisFim, prox(Math.abs(py - (tab.y + tab.h)), 24, 80));
      // Menu de cima: perto do topo.
      const ob = prox(Math.max(0, py - tab.y), 40, 130);
      bloco.style.setProperty("--o-barra", String(ob));
      if (ob > 0.35) bloco.dataset.barra = "1"; else delete bloco.dataset.barra;
    };
    /** Duplo clique na alça: ajusta a coluna ao conteúdo (a largura da maior célula). */
    const ajustarAoConteudo = (i: number) => {
      const guardado = { layout: t.style.tableLayout, largura: t.style.width, max: t.style.maxWidth };
      const cols = Array.from(grupo.children) as HTMLElement[];
      const larguras = cols.map((c) => c.style.width);
      t.style.tableLayout = "auto"; t.style.width = "auto"; t.style.maxWidth = "none";
      cols.forEach((c) => { c.style.width = ""; });
      const todas = celulas.flat();
      todas.forEach((c) => { c.style.whiteSpace = "nowrap"; });
      const natural = celulas[0]![i]!.offsetWidth;
      todas.forEach((c) => { c.style.whiteSpace = ""; });
      t.style.tableLayout = guardado.layout; t.style.width = guardado.largura; t.style.maxWidth = guardado.max;
      cols.forEach((c, n) => { c.style.width = larguras[n]!; });
      const alvo = Math.min(640, Math.max(3 * PX_POR_TRACO, Math.round((natural + 2) / PX_POR_TRACO) * PX_POR_TRACO));
      if (!dados.larguras?.some((x) => x != null)) dados.larguras = celulas[0]!.map((c) => Math.max(3 * PX_POR_TRACO, Math.round(c.offsetWidth / PX_POR_TRACO) * PX_POR_TRACO));
      dados.larguras![i] = alvo;
      gravar(null);
    };
    for (let i = 0; i < nCols; i++) {
      const alca = document.createElement("span");
      alca.className = "cm-tabela-alca";
      alca.title = "Arraste para mudar a largura. Duplo clique ajusta ao conteúdo.";
      alca.addEventListener("dblclick", (e) => { e.preventDefault(); e.stopPropagation(); aplicarAberta?.(); aplicarAberta = null; ajustarAoConteudo(i); });
      alca.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const x0 = e.clientX;
        let iniciou = false;
        let w0 = 0;
        const mover = (m: MouseEvent) => {
          // Só começa de verdade depois de mexer o mouse: um clique parado (ou o duplo clique) não grava nada.
          if (!iniciou) {
            if (Math.abs(m.clientX - x0) < 3) return;
            iniciou = true;
            aplicarAberta?.();
            aplicarAberta = null;
            // A primeira vez, fixa todas as colunas na largura que têm agora.
            if (!dados.larguras?.some((x) => x != null)) dados.larguras = (celulas[0] ?? []).map((c) => Math.max(3 * PX_POR_TRACO, Math.round(c.offsetWidth / PX_POR_TRACO) * PX_POR_TRACO));
            aplicarLarguras();
            w0 = dados.larguras![i] ?? 15 * PX_POR_TRACO;
            document.body.style.cursor = "col-resize";
          }
          dados.larguras![i] = Math.max(40, w0 + m.clientX - x0);
          aplicarLarguras();
          posicionarAlcas();
        };
        const soltar = () => {
          document.removeEventListener("mousemove", mover);
          document.removeEventListener("mouseup", soltar);
          document.body.style.cursor = "";
          if (!iniciou) return;
          dados.larguras = dados.larguras!.map((w) => Math.max(3, Math.round((w ?? 0) / PX_POR_TRACO)) * PX_POR_TRACO);
          gravar(null);
        };
        document.addEventListener("mousemove", mover);
        document.addEventListener("mouseup", soltar);
      });
      sobre.appendChild(alca);
      alcas.push(alca);
    }
    bloco.addEventListener("mousemove", aoMover);
    bloco.addEventListener("mouseleave", apagar);

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

    bloco.append(barra, rolagem, sobre);
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

/** Tabelas achadas pelo texto, em posições do documento. Guardado por documento: mexer só na seleção não refaz a busca. */
const porDocumento = new WeakMap<Text, [number, number][]>();
function tabelasPeloTexto(doc: Text): [number, number][] {
  const guardado = porDocumento.get(doc);
  if (guardado) return guardado;
  const achadas = acharTabelas(doc.toJSON());
  const posicoes = achadas.map((t): [number, number] => [doc.line(t.de + 1).from, doc.line(t.ate + 1).to]);
  porDocumento.set(doc, posicoes);
  return posicoes;
}

function montar(state: EditorState, focado: boolean): DecorationSet {
  const decos: Range<Decoration>[] = [];
  const cobertos: [number, number][] = [];
  const pronta = (de: number, ate: number) => {
    // Editando (cursor dentro) a tabela fica como texto cru.
    const editando = focado && !celulaEmEdicao && state.selection.ranges.some((r) => r.from <= ate && r.to >= de);
    cobertos.push([de, ate]);
    if (editando) return;
    // A tabela termina na primeira linha sem `|`: o texto colado embaixo continua sendo texto (ver lib/tabela-colada.ts).
    const linhas = state.sliceDoc(de, ate).split("\n");
    const fonte = linhas.slice(0, linhasDaTabela(linhas)).join("\n");
    const tabela = lerTabela(fonte);
    if (tabela) decos.push(Decoration.replace({ widget: new TabelaWidget(fonte, tabela, de), block: true }).range(de, de + fonte.length));
  };
  // O Lezer analisa o documento aos poucos (começando pelo trecho visível); sem completar a árvore,
  // tabelas mais abaixo ficavam como texto cru, pois este campo só recalcula ao editar ou mudar a seleção.
  (ensureSyntaxTree(state, state.doc.length, 250) ?? syntaxTree(state)).iterate({
    enter: (no) => {
      if (no.name !== "Table") return;
      pronta(no.from, no.to);
      return false;
    },
  });
  // O Lezer desiste da tabela quando há texto sem `|` logo abaixo; aqui achamos essas pelo texto.
  for (const [de, ate] of tabelasPeloTexto(state.doc)) {
    if (cobertos.some(([x, y]) => de <= y && ate >= x)) continue;
    pronta(de, ate);
  }
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
