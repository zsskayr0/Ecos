import { lerPreferenciasAplicativo } from "@/lib/preferencias-aplicativo";

/** Um título do Markdown (`# ...`), com a linha (1, 2, 3…) onde está no corpo. */
export interface TituloNota { nivel: number; texto: string; linha: number }

const CERCA = /^\s{0,3}(`{3,}|~{3,})/;
const TITULO = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;

/** Limpa a marcação inline mais comum para mostrar o título como texto. */
export function textoDoTitulo(bruto: string): string {
  return bruto
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2").replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__|==|~~|`)/g, "").replace(/(^|\W)[*_](\S)/g, "$1$2").replace(/(\S)[*_](\W|$)/g, "$1$2")
    .trim();
}

/** Títulos ATX do corpo, ignorando o que está dentro de blocos de código. */
export function extrairTitulos(corpo: string): TituloNota[] {
  const saida: TituloNota[] = [];
  let cerca: string | null = null;
  corpo.split("\n").forEach((l, i) => {
    const c = CERCA.exec(l);
    if (c) { if (!cerca) cerca = c[1][0]; else if (c[1][0] === cerca) cerca = null; return; }
    if (cerca) return;
    const t = TITULO.exec(l);
    if (t && t[2]) saida.push({ nivel: t[1].length, texto: textoDoTitulo(t[2]), linha: i + 1 });
  });
  return saida;
}

const NEGRITO = /^\s{0,3}(\*\*|__)(?!\s)(.+?)\1\s*:?\s*$/;

/**
 * Estrutura para navegar (trilho e painel do sumário): os títulos e também as linhas que são
 * só negrito (`**Seção**`), que entram como o nível mais baixo (7). A numeração usa só títulos.
 */
export function extrairEstrutura(corpo: string): TituloNota[] {
  const saida: TituloNota[] = [];
  let cerca: string | null = null;
  corpo.split("\n").forEach((l, i) => {
    const c = CERCA.exec(l);
    if (c) { if (!cerca) cerca = c[1][0]; else if (c[1][0] === cerca) cerca = null; return; }
    if (cerca) return;
    const t = TITULO.exec(l);
    if (t && t[2]) { saida.push({ nivel: t[1].length, texto: textoDoTitulo(t[2]), linha: i + 1 }); return; }
    const n = NEGRITO.exec(l);
    if (n) saida.push({ nivel: 7, texto: textoDoTitulo(n[2]), linha: i + 1 });
  });
  // Rótulos em negrito que se repetem (ex.: "Evidência.", "Como corrigir." em cada item) não
  // ajudam a navegar: com 3 ou mais iguais, saem da estrutura.
  const chave = (t: string) => t.toLowerCase().replace(/[.:;!?\s]+$/, "").trim();
  const contagem = new Map<string, number>();
  for (const t of saida) if (t.nivel === 7) contagem.set(chave(t.texto), (contagem.get(chave(t.texto)) ?? 0) + 1);
  return saida.filter((t) => t.nivel !== 7 || (contagem.get(chave(t.texto)) ?? 0) < 3);
}

/** Numeração hierárquica (1, 1.1, 1.1.1) relativa ao menor nível presente na nota. */
export function numerarTitulos(titulos: { nivel: number }[]): string[] {
  const base = Math.min(...titulos.map((t) => t.nivel));
  const cont: number[] = [];
  return titulos.map(({ nivel }) => {
    const p = nivel - base;
    cont.length = p + 1;
    for (let i = 0; i < p; i++) cont[i] = cont[i] || 1;
    cont[p] = (cont[p] ?? 0) + 1;
    return cont.join(".");
  });
}

export function numerarTitulosLigado(): boolean { return lerPreferenciasAplicativo().numerarTitulos; }

// ── remark: [TOC] e numeração, para a leitura e o PDF ──────────────────────

interface NoMd { type: string; value?: string; depth?: number; url?: string; children?: NoMd[]; position?: { start: { line: number } }; data?: Record<string, unknown> }

function textoMd(no: NoMd): string {
  if (no.type === "text" || no.type === "inlineCode") return no.value ?? "";
  return (no.children ?? []).map(textoMd).join("");
}

/** Id da âncora de um título (o sanitize prefixa `user-content-` nos ids). */
export const idTitulo = (linha: number) => `ecos-titulo-${linha}`;

/**
 * Plugin remark: numera os títulos (se `numerar`) e, se `sumario`, põe no início uma lista
 * com os títulos da nota (usado no PDF; nada é escrito no .md).
 */
export function remarkSumario(opcoes: { numerar?: boolean; sumario?: boolean; ancoraPrefixo?: string } = {}) {
  return () => (arvore: NoMd) => {
    const filhos = arvore.children ?? [];
    const titulos = filhos.filter((n) => n.type === "heading");
    const numeros = titulos.length ? numerarTitulos(titulos.map((t) => ({ nivel: t.depth ?? 1 }))) : [];
    const itens = titulos.map((t, i) => ({ nivel: t.depth ?? 1, texto: textoMd(t), linha: t.position?.start.line ?? i, numero: numeros[i] }));
    titulos.forEach((t, i) => {
      const linha = itens[i].linha;
      t.data = { ...t.data, hProperties: { ...((t.data?.hProperties as object) ?? {}), id: idTitulo(linha) } };
      if (opcoes.numerar) t.children = [{ type: "text", value: `${numeros[i]} ` }, ...(t.children ?? [])];
    });
    if (!opcoes.sumario || itens.length < 2) return;
    const base = Math.min(...itens.map((i) => i.nivel));
    // Monta listas aninhadas a partir dos níveis.
    const raiz: NoMd = { type: "list", children: [], data: { hProperties: { className: ["ecos-sumario"] } } };
    const pilha: { nivel: number; lista: NoMd }[] = [{ nivel: base, lista: raiz }];
    for (const it of itens) {
      while (pilha.length > 1 && it.nivel < pilha[pilha.length - 1].nivel) pilha.pop();
      let topo = pilha[pilha.length - 1];
      if (it.nivel > topo.nivel) {
        const pai = topo.lista.children!.at(-1);
        if (pai) { const sub: NoMd = { type: "list", children: [] }; pai.children!.push(sub); topo = { nivel: it.nivel, lista: sub }; pilha.push(topo); }
      }
      const rotulo = `${opcoes.numerar ? `${it.numero} ` : ""}${it.texto}`;
      topo.lista.children!.push({ type: "listItem", children: [{ type: "paragraph", children: [{ type: "link", url: `#${opcoes.ancoraPrefixo ?? "user-content-"}${idTitulo(it.linha)}`, children: [{ type: "text", value: rotulo }] }] }] });
    }
    arvore.children = [raiz, ...filhos];
  };
}
