/** Notas `[^n]` e citações `[@chave]` do corpo — lidas para o menu lateral, o editor e o PDF. */

export interface NotaRodape { rotulo: string; texto: string; numero: number }
export interface Referencia { chave: string; tipo: string; campos: Record<string, string> }

const DEF = /^\[\^([^\]\s]+)\]:[ \t]?(.*)$/;
const REF = /\[\^([^\]\s]+)\](?!:)/g;
const CITA = /\[@([\w:.\-/]+)\]/g;
const BLOCO_BIB = /^(`{3,}|~{3,})\s*(bibtex|bib)\s*\n([\s\S]*?)\n\1\s*$/gim;

/** Definições, com continuações indentadas, numeradas na ordem da primeira chamada no texto. */
export function extrairNotas(corpo: string): NotaRodape[] {
  const defs = new Map<string, string>();
  const linhas = corpo.split("\n");
  let atual: string | null = null;
  for (const l of linhas) {
    const m = DEF.exec(l);
    if (m) { atual = m[1]; defs.set(atual, m[2].trim()); continue; }
    if (atual && /^( {2,}|\t)\S/.test(l)) { defs.set(atual, `${defs.get(atual)} ${l.trim()}`.trim()); continue; }
    atual = null;
  }
  const ordem: string[] = [];
  for (const l of linhas) {
    if (DEF.test(l)) continue;
    for (const m of l.matchAll(REF)) if (!ordem.includes(m[1])) ordem.push(m[1]);
  }
  for (const r of defs.keys()) if (!ordem.includes(r)) ordem.push(r);
  return ordem.map((rotulo, i) => ({ rotulo, numero: i + 1, texto: defs.get(rotulo) ?? "" }));
}

/** Lê entradas BibTeX (`@tipo{chave, campo = {valor}, ...}`). Tolerante: ignora o que não entende. */
export function lerBibtex(fonte: string): Referencia[] {
  const out: Referencia[] = [];
  const re = /@(\w+)\s*\{\s*([^,\s]+)\s*,/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fonte))) {
    let i = re.lastIndex, prof = 1;
    while (i < fonte.length && prof > 0) { if (fonte[i] === "{") prof++; else if (fonte[i] === "}") prof--; i++; }
    const miolo = fonte.slice(re.lastIndex, i - 1);
    const campos: Record<string, string> = {};
    const cre = /(\w+)\s*=\s*/g;
    let c: RegExpExecArray | null;
    while ((c = cre.exec(miolo))) {
      let j = cre.lastIndex, valor = "";
      if (miolo[j] === "{") {
        let p = 1; j++;
        const ini = j;
        while (j < miolo.length && p > 0) { if (miolo[j] === "{") p++; else if (miolo[j] === "}") p--; j++; }
        valor = miolo.slice(ini, j - 1);
      } else if (miolo[j] === "\"") {
        const fim = miolo.indexOf("\"", j + 1);
        valor = miolo.slice(j + 1, fim < 0 ? miolo.length : fim);
        j = fim < 0 ? miolo.length : fim + 1;
      } else {
        const fim = miolo.slice(j).search(/[,\n]/);
        valor = miolo.slice(j, fim < 0 ? miolo.length : j + fim);
        j = fim < 0 ? miolo.length : j + fim;
      }
      campos[c[1].toLowerCase()] = valor.replace(/[{}]/g, "").replace(/\s+/g, " ").trim();
      cre.lastIndex = j;
    }
    out.push({ tipo: m[1].toLowerCase(), chave: m[2], campos });
    re.lastIndex = i;
  }
  return out;
}

/** Referências dos blocos ```bibtex da própria nota. */
export function bibliotecaDoCorpo(corpo: string): Referencia[] {
  const out: Referencia[] = [];
  for (const m of corpo.matchAll(BLOCO_BIB)) out.push(...lerBibtex(m[3]));
  return out;
}

/** Chaves citadas com `[@chave]`, na ordem da primeira citação (fora dos blocos bibtex). */
export function chavesCitadas(corpo: string): string[] {
  const semBib = corpo.replace(BLOCO_BIB, "");
  const out: string[] = [];
  for (const m of semBib.matchAll(CITA)) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

const sobrenome = (autor: string) => {
  const primeiro = autor.split(/\s+and\s+/i)[0].trim();
  return primeiro.includes(",") ? primeiro.split(",")[0].trim() : primeiro.split(/\s+/).pop() ?? primeiro;
};

/** Forma curta usada no texto: (Silva, 2020). */
export function citacaoCurta(r: Referencia | undefined, chave: string): string {
  if (!r) return `@${chave}`;
  const autores = r.campos.author ?? r.campos.editor;
  const quem = autores ? (autores.split(/\s+and\s+/i).length > 2 ? `${sobrenome(autores)} et al.` : autores.split(/\s+and\s+/i).map(sobrenome).join(" e ")) : r.campos.title ?? chave;
  return `${quem}${r.campos.year ? `, ${r.campos.year}` : ""}`;
}

/** Linha da bibliografia: AUTOR. Título. Local: Editora, ano. */
export function bibliografiaFormatada(r: Referencia): string {
  const c = r.campos;
  const autores = c.author ? c.author.split(/\s+and\s+/i).map((a) => a.trim()).join("; ") : "";
  const onde = c.journal ?? c.booktitle ?? c.publisher ?? c.howpublished ?? "";
  return [autores, c.title, onde, c.year].filter(Boolean).join(". ") + (c.url ? ` Disponível em: ${c.url}` : "");
}

/** Evento que o editor dispara ao clicar numa chamada: o menu lateral rola até a nota. */
export const EVENTO_IR_NOTA = "ecos:ir-nota";
/** Último pedido: se o painel ainda estava fechado, a lista o atende ao montar. */
export let pedidoNota: { rotulo: string; em: number } | null = null;
export const irParaNota = (rotulo: string) => {
  pedidoNota = { rotulo, em: Date.now() };
  window.dispatchEvent(new CustomEvent(EVENTO_IR_NOTA, { detail: { rotulo } }));
};

/** Para o PDF: citações viram (Autor, ano), os blocos bibtex saem e a bibliografia vai para o fim. */
export function comBibliografia(corpo: string): string {
  const bib = new Map(bibliotecaDoCorpo(corpo).map((r) => [r.chave, r]));
  const chaves = chavesCitadas(corpo);
  if (!chaves.length && !bib.size) return corpo;
  const texto = corpo.replace(BLOCO_BIB, "").replace(CITA, (_, k: string) => `(${citacaoCurta(bib.get(k), k)})`).trimEnd();
  if (!chaves.length) return texto;
  const linhas = chaves.map((k) => bib.get(k)).filter((r): r is Referencia => !!r).map((r) => `- ${bibliografiaFormatada(r)}`);
  return linhas.length ? `${texto}\n\n## Referências\n\n${linhas.join("\n")}\n` : texto;
}
