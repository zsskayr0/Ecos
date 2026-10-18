import { autocompletion, acceptCompletion, startCompletion, type Completion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { EditorView, keymap } from "@codemirror/view";
import { Prec, type Extension } from "@codemirror/state";
import { links, notas } from "@/lib/api";
import { normalizarTexto } from "@/lib/texto-busca";
import { carregarNotas, invalidarSugestoesDeNotas, sugerir, tituloExiste, type NotaSugestao } from "./wikilink-sugestoes";
import "@/styles/wikilink-menu.css";

const ATRASO_DIGITACAO_MS = 90;
const LIMITE = 20;
let servidorTemSugestoes = true;

/** Busca no servidor (notas e tarefas, só o que a pessoa enxerga, no espaço dela); sem a rota, cai na lista local de notas. */
async function buscarSugestoes(consulta: string, excluirId: string | undefined, sinal: AbortSignal): Promise<{ itens: NotaSugestao[]; todas: NotaSugestao[] }> {
  if (servidorTemSugestoes) {
    try {
      const r = await links.sugestoes({ q: consulta.replace(/^(nota|tarefa):/i, "").trim() || undefined, limite: LIMITE, excluir_id: excluirId }, sinal);
      const itens = r.map((s): NotaSugestao => ({ id: s.id, titulo: s.titulo, pasta: null, tags: [], atualizado_em: s.atualizado_em, tipo: s.tipo }));
      return { itens, todas: itens };
    } catch (e) {
      if (sinal.aborted) throw e;
      if ((e as { status?: number }).status === 404) servidorTemSugestoes = false;
    }
  }
  const todas = await carregarNotas();
  return { itens: sugerir(consulta, todas, excluirId, LIMITE), todas };
}

/** Texto depois do `[[`, parando em `|` (apelido), `]` ou quebra de linha. */
const ABERTURA = /\[\[[^\]|\n]*/;

export interface OpcoesWikilink {
  /** A Nota que está sendo editada não se sugere a si mesma. */
  notaAtualId?: string;
  /** Espaço em que "Criar nota" cria; sem isso, a opção de criar some. */
  espaco?: string;
}

function inserirTitulo(view: EditorView, de: number, ate: number, texto: string) {
  // Se o `]]` já está logo à frente (fechado automaticamente), o cursor passa por cima dele.
  const ja = view.state.sliceDoc(ate, ate + 2) === "]]";
  view.dispatch({ changes: { from: de, to: ja ? ate + 2 : ate, insert: `${texto}]]` }, selection: { anchor: de + texto.length + 2 }, userEvent: "input.complete" });
}

/** Tarefa com título igual ao de uma Nota perde no desempate; o prefixo `tarefa:` diz qual é. */
function textoDoLink(item: NotaSugestao, todas: NotaSugestao[]): string {
  if (item.tipo !== "tarefa") return item.titulo;
  const alvo = normalizarTexto(item.titulo);
  const colide = todas.some((o) => o.tipo !== "tarefa" && normalizarTexto(o.titulo) === alvo);
  return colide ? `tarefa:${item.titulo}` : item.titulo;
}

const SVG_NOTA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/></svg>';
const SVG_TAREFA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m8.5 12.5 2.5 2.5 4.5-5"/></svg>';
const SVG_CRIAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';

/** Faixa do título que casa com o que foi digitado (sem acento/caixa), para destacar; `null` se não há trecho contíguo. */
export function trechoCasado(titulo: string, consulta: string): [number, number] | null {
  const base = (c: string) => c.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const q = [...consulta.trim()].map(base).join("");
  if (!q) return null;
  const chars = [...titulo];
  const plano = chars.map(base).join("");
  if (plano.length !== chars.length) return null; // letra que muda de tamanho ao normalizar: sem destaque
  const i = plano.indexOf(q);
  return i === -1 ? null : [i, i + q.length];
}

function desenharLinha(c: Completion, consulta: string): Node {
  const tipo = c.type === "tarefa" ? "tarefa" : c.type === "criar" ? "criar" : "nota";
  const raiz = document.createElement("div");
  raiz.className = `ecos-wl-linha ecos-wl-${tipo}`;
  const icone = document.createElement("span");
  icone.className = "ecos-wl-icone";
  icone.innerHTML = tipo === "tarefa" ? SVG_TAREFA : tipo === "criar" ? SVG_CRIAR : SVG_NOTA;
  const texto = document.createElement("span");
  texto.className = "ecos-wl-texto";
  const titulo = document.createElement("span");
  titulo.className = "ecos-wl-titulo";
  const nome = tipo === "criar" ? `Criar “${c.label}”` : c.label;
  const faixa = tipo === "criar" ? null : trechoCasado(c.label, consulta);
  if (faixa) {
    const chars = [...nome];
    titulo.append(chars.slice(0, faixa[0]).join(""));
    const m = document.createElement("mark");
    m.textContent = chars.slice(faixa[0], faixa[1]).join("");
    titulo.append(m, chars.slice(faixa[1]).join(""));
  } else titulo.textContent = nome;
  texto.append(titulo);
  if (c.detail) {
    const ctx = document.createElement("span");
    ctx.className = "ecos-wl-contexto";
    ctx.textContent = c.detail;
    texto.append(ctx);
  }
  const rotulo = document.createElement("span");
  rotulo.className = "ecos-wl-tipo";
  rotulo.textContent = tipo === "tarefa" ? "Tarefa" : tipo === "criar" ? "Nova nota" : "Nota";
  raiz.append(icone, texto, rotulo);
  return raiz;
}

const esperar = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function fonte(opcoes: () => OpcoesWikilink | undefined) {
  return async (ctx: CompletionContext): Promise<CompletionResult | null> => {
    const m = ctx.matchBefore(ABERTURA);
    if (!m) return null;
    const { notaAtualId, espaco } = opcoes() ?? {};
    const consulta = m.text.slice(2);
    // Pequena espera: quem digita rápido só dispara a última busca.
    if (consulta) { await esperar(ATRASO_DIGITACAO_MS); if (ctx.aborted) return null; }
    const controle = new AbortController();
    ctx.addEventListener("abort", () => controle.abort());
    let resultado: { itens: NotaSugestao[]; todas: NotaSugestao[] };
    try { resultado = await buscarSugestoes(consulta, notaAtualId, controle.signal); } catch { return null; }
    if (ctx.aborted) return null;
    const { itens, todas } = resultado;
    const lista: Completion[] = itens.map((n, i) => ({
      label: n.titulo,
      detail: [n.pasta, ...n.tags.slice(0, 2).map((t) => `#${t}`)].filter(Boolean).join("  "),
      type: n.tipo === "tarefa" ? "tarefa" : "nota",
      boost: -i,
      apply: (view, _c, de, ate) => inserirTitulo(view, de, ate, textoDoLink(n, todas)),
    }));
    const titulo = consulta.trim();
    if (espaco && titulo && !tituloExiste(titulo, todas) && !titulo.includes(":")) {
      lista.push({
        label: titulo,
        type: "criar",
        boost: -1000,
        apply: (view, _c, de, ate) => {
          inserirTitulo(view, de, ate, titulo);
          // O link entra já; a nota nasce vazia em seguida (se falhar, o link fica sem destino até alguém criar).
          void notas.criar({ titulo, espaco }).then(invalidarSugestoesDeNotas).catch(() => undefined);
        },
      });
    }
    if (!lista.length) return null;
    return { from: m.from + 2, options: lista, filter: false };
  };
}

/** Digitar o segundo `[` fecha o par (`[[|]]`) e já abre a lista, como no Obsidian. */
const fecharPar = EditorView.inputHandler.of((view, de, ate, texto) => {
  if (texto !== "[" || de !== ate || view.state.sliceDoc(de - 1, de) !== "[") return false;
  if (view.state.sliceDoc(de, de + 2) === "]]") return false;
  view.dispatch({ changes: { from: de, insert: "[]]" }, selection: { anchor: de + 1 }, userEvent: "input.type" });
  startCompletion(view);
  return true;
});

/**
 * Autocomplete de `[[wikilink]]` para Notas e Tarefas: o menu sobe junto ao cursor sem tirar o foco do texto,
 * ↑↓ navegam, Tab ou Enter inserem (como no chat de comandos do Minecraft), Esc fecha. Cada linha diz se é Nota ou Tarefa.
 */
export function autocompletarWikilink(opcoes: () => OpcoesWikilink | undefined): Extension {
  let consultaAtual = "";
  return [
    autocompletion({
      override: [(ctx) => { consultaAtual = ctx.matchBefore(ABERTURA)?.text.slice(2) ?? ""; return fonte(opcoes)(ctx); }],
      icons: false,
      activateOnTyping: true,
      closeOnBlur: true,
      maxRenderedOptions: LIMITE + 1,
      addToOptions: [{ render: (c) => desenharLinha(c, consultaAtual) as HTMLElement, position: 10 }],
    }),
    Prec.highest(keymap.of([{ key: "Tab", run: acceptCompletion }])),
    fecharPar,
  ];
}
