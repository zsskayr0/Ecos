import type { Plugin } from "unified";
import type { Paragraph, Root, RootContent } from "mdast";

/**
 * Marcador de bloco de subtarefas no corpo da tarefa: uma linha sozinha `::: subtarefas [nome]`.
 * Sem nome = bloco padrão. Os itens moram no frontmatter (`subtarefas[].bloco`); a linha só diz onde o bloco aparece.
 * Só tarefas usam; em notas a linha é texto comum.
 */
export const MARCADOR_SUBTAREFAS = /^[ \t]*:::[ \t]*subtarefas(?:[ \t]+(.+?))?[ \t]*$/i;

/** Nome do bloco de uma linha de marcador (`null` = bloco padrão), ou `undefined` se a linha não é marcador. */
export function blocoDoMarcador(linha: string): string | null | undefined {
  const m = MARCADOR_SUBTAREFAS.exec(linha);
  if (!m) return undefined;
  return m[1]?.trim() || null;
}

/** Blocos com marcador no corpo, na ordem, ignorando blocos de código. */
export function blocosNoCorpo(corpo: string): (string | null)[] {
  const achados: (string | null)[] = [];
  let cerca = false;
  for (const linha of corpo.split("\n")) {
    if (/^\s*(```|~~~)/.test(linha)) { cerca = !cerca; continue; }
    if (cerca) continue;
    const b = blocoDoMarcador(linha);
    if (b !== undefined) achados.push(b);
  }
  return achados;
}

/** Linha de marcador para um bloco. */
export const linhaMarcador = (bloco: string | null) => (bloco ? `::: subtarefas ${bloco}` : "::: subtarefas");

/** Acrescenta o marcador do bloco no fim do corpo, separado por linha em branco. */
export function anexarMarcador(corpo: string, bloco: string | null): string {
  const base = corpo.replace(/\s+$/, "");
  return `${base}${base ? "\n\n" : ""}${linhaMarcador(bloco)}\n`;
}

interface NoSubtarefas { type: "ecosSubtarefas"; data: { hName: "ecos-subtarefas"; hProperties: { dataBloco: string } } }

function noMarcador(bloco: string | null): NoSubtarefas {
  return { type: "ecosSubtarefas", data: { hName: "ecos-subtarefas", hProperties: { dataBloco: bloco ?? "" } } };
}

/**
 * Troca o parágrafo que é só o marcador por um elemento `ecos-subtarefas`. Se o marcador vier colado a outras linhas
 * do mesmo parágrafo, o parágrafo é partido em volta dele.
 */
export const remarkSubtarefas: Plugin<[], Root> = () => (arvore) => {
  const visitar = (pai: { children: RootContent[] }) => {
    for (let i = 0; i < pai.children.length; i++) {
      const no = pai.children[i];
      if (no.type === "paragraph") {
        const novos = partirParagrafo(no);
        if (novos) { pai.children.splice(i, 1, ...(novos as RootContent[])); i += novos.length - 1; }
      } else if ("children" in no && (no.type === "blockquote" || no.type === "listItem" || no.type === "list")) {
        visitar(no as { children: RootContent[] });
      }
    }
  };
  visitar(arvore);
};

function partirParagrafo(p: Paragraph): (Paragraph | NoSubtarefas)[] | null {
  // Só parágrafos de texto puro (e quebras): marcador não convive com links ou ênfase na mesma linha.
  if (!p.children.every((c) => c.type === "text" || c.type === "break")) return null;
  const texto = p.children.map((c) => (c.type === "text" ? c.value : "\n")).join("");
  const linhas = texto.split("\n");
  if (!linhas.some((l) => blocoDoMarcador(l) !== undefined)) return null;
  const saida: (Paragraph | NoSubtarefas)[] = [];
  let acumulado: string[] = [];
  const fechar = () => {
    const t = acumulado.join("\n").trim();
    if (t) saida.push({ type: "paragraph", children: [{ type: "text", value: t }] });
    acumulado = [];
  };
  for (const linha of linhas) {
    const b = blocoDoMarcador(linha);
    if (b === undefined) { acumulado.push(linha); continue; }
    fechar();
    saida.push(noMarcador(b));
  }
  fechar();
  return saida;
}

interface ItemSubtarefa { titulo: string; concluida: boolean; bloco?: string | null }
const linhaItem = (s: ItemSubtarefa) => `- [${s.concluida ? "x" : " "}] ${s.titulo}`;

/**
 * Para exportar (PDF): cada marcador vira a lista dos itens do seu bloco, no lugar dele. Os itens de blocos sem
 * marcador no texto vão para o fim, como antes dos blocos existirem.
 */
export function expandirMarcadores(corpo: string, subtarefas: ItemSubtarefa[]): string {
  const doBloco = (b: string | null) => subtarefas.filter((s) => (s.bloco?.trim() || null) === b);
  const usados = new Set<string | null>();
  let cerca = false;
  const linhas = corpo.split("\n").map((linha) => {
    if (/^\s*(```|~~~)/.test(linha)) { cerca = !cerca; return linha; }
    if (cerca) return linha;
    const b = blocoDoMarcador(linha);
    if (b === undefined) return linha;
    usados.add(b);
    const itens = doBloco(b);
    return itens.length ? `\n${itens.map(linhaItem).join("\n")}\n` : "";
  });
  const restantes = subtarefas.filter((s) => !usados.has(s.bloco?.trim() || null));
  const texto = linhas.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return [texto, restantes.map(linhaItem).join("\n")].filter(Boolean).join("\n\n");
}
