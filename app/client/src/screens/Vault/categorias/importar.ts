import type { CategoriaApi } from "@/lib/api";
import { normalizarTexto } from "@/lib/texto-busca";

/** Uma categoria a criar, vinda de arquivo ou de modelo. `mae` é o NOME da categoria-mãe (principal), se houver. */
export interface LinhaCategoria {
  nome: string;
  tipo: CategoriaApi["tipo"];
  mae?: string;
  icone?: string | null;
  cor?: string | null;
}

export interface PlanoImportacao {
  criar: LinhaCategoria[];
  /** Já existem (mesmo nome sob a mesma mãe) ou não puderam ser lidas. */
  ignoradas: { nome: string; motivo: string }[];
}

const TIPOS: Record<string, CategoriaApi["tipo"]> = { saida: "saida", despesa: "saida", despesas: "saida", entrada: "entrada", receita: "entrada", receitas: "entrada", ambos: "ambos", ambas: "ambos", ambos_os_tipos: "ambos" };
const chave = (s: string) => normalizarTexto(s);

function campoCsv(c: string | number | boolean | null | undefined): string {
  const s = c === null || c === undefined ? "" : String(c);
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Estrutura das categorias em CSV (com BOM para abrir certo no Excel): nome, tipo, mãe, ícone, cor, arquivada. */
export function exportarCsv(categorias: CategoriaApi[]): string {
  const porId = new Map(categorias.map((c) => [c.id, c]));
  const ordenadas = [...categorias.filter((c) => !c.pai_id), ...categorias.filter((c) => c.pai_id)];
  const linhas = [["nome", "tipo", "categoria_mae", "icone", "cor", "arquivada"].join(","),
    ...ordenadas.map((c) => [c.nome, c.tipo, c.pai_id ? porId.get(c.pai_id)?.nome ?? "" : "", c.icone ?? "", c.cor, c.arquivada ? "sim" : "nao"].map(campoCsv).join(","))];
  return "﻿" + linhas.join("\n");
}

/** CSV simples com aspas; aceita vírgula ou ponto e vírgula. */
export function lerCsv(texto: string): string[][] {
  const limpo = texto.replace(/^﻿/, "");
  const primeira = limpo.split(/\r?\n/, 1)[0] ?? "";
  const sep = (primeira.match(/;/g)?.length ?? 0) > (primeira.match(/,/g)?.length ?? 0) ? ";" : ",";
  const linhas: string[][] = [];
  let campo = "", linha: string[] = [], aspas = false;
  for (let i = 0; i < limpo.length; i++) {
    const c = limpo[i]!;
    if (aspas) {
      if (c === '"') { if (limpo[i + 1] === '"') { campo += '"'; i++; } else aspas = false; } else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === sep) { linha.push(campo); campo = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && limpo[i + 1] === "\n") i++; linha.push(campo); campo = ""; if (linha.some((x) => x.trim() !== "")) linhas.push(linha); linha = []; }
    else campo += c;
  }
  linha.push(campo);
  if (linha.some((x) => x.trim() !== "")) linhas.push(linha);
  return linhas;
}

const COLUNAS: Record<string, "nome" | "tipo" | "mae" | "icone" | "cor" | "arquivada"> = { nome: "nome", categoria: "nome", tipo: "tipo", categoria_mae: "mae", mae: "mae", pai: "mae", icone: "icone", cor: "cor", arquivada: "arquivada" };

/** Linhas do CSV → categorias. Sem cabeçalho reconhecido, assume a ordem nome, tipo, mãe, ícone, cor. */
export function linhasDoCsv(texto: string): { linhas: LinhaCategoria[]; erros: { nome: string; motivo: string }[] } {
  const grade = lerCsv(texto);
  const erros: { nome: string; motivo: string }[] = [];
  if (grade.length === 0) return { linhas: [], erros: [{ nome: "(arquivo)", motivo: "O arquivo está vazio." }] };
  const cab = grade[0]!.map((c) => COLUNAS[normalizarTexto(c).replace(/ /g, "_")]);
  const temCabecalho = cab.includes("nome");
  const indice = temCabecalho ? cab : (["nome", "tipo", "mae", "icone", "cor"] as const);
  const corpo = temCabecalho ? grade.slice(1) : grade;
  const linhas: LinhaCategoria[] = [];
  for (const celulas of corpo) {
    const pega = (k: string) => (celulas[indice.indexOf(k as never)] ?? "").trim();
    const nome = pega("nome");
    if (!nome) continue;
    const tipoBruto = pega("tipo");
    const tipo = tipoBruto ? TIPOS[normalizarTexto(tipoBruto).replace(/ /g, "_")] : "saida";
    if (!tipo) { erros.push({ nome, motivo: `Tipo “${tipoBruto}” não reconhecido (use despesa, receita ou ambas).` }); continue; }
    const cor = pega("cor");
    linhas.push({ nome, tipo, mae: pega("mae") || undefined, icone: pega("icone") || null, cor: /^#[0-9a-f]{6}$/i.test(cor) ? cor : null });
  }
  return { linhas, erros };
}

/**
 * Decide o que criar. Existe = mesmo nome (sem acento/caixa) sob a mesma mãe. Mãe que falta é criada antes; subcategoria
 * de uma subcategoria é recusada (só há um nível). Devolve mães antes das filhas.
 */
export function planejar(linhas: LinhaCategoria[], existentes: CategoriaApi[], errosPrevios: PlanoImportacao["ignoradas"] = []): PlanoImportacao {
  const porId = new Map(existentes.map((c) => [c.id, c]));
  const chaveDe = (nome: string, mae?: string) => `${mae ? chave(mae) : ""}>${chave(nome)}`;
  const jaTem = new Set(existentes.map((c) => chaveDe(c.nome, c.pai_id ? porId.get(c.pai_id)?.nome : undefined)));
  const subsNoArquivo = new Set(linhas.filter((l) => l.mae).map((l) => chave(l.nome)));
  const mapaMaes = new Map(existentes.filter((c) => !c.pai_id).map((c) => [chave(c.nome), c]));
  const ignoradas = [...errosPrevios];
  const maes: LinhaCategoria[] = [];
  const filhas: LinhaCategoria[] = [];
  const vistos = new Set<string>();

  const garantirMae = (nome: string, tipo: CategoriaApi["tipo"], cor?: string | null) => {
    const k = chave(nome);
    if (mapaMaes.has(k) || maes.some((m) => chave(m.nome) === k)) return;
    maes.push({ nome, tipo, cor: cor ?? null, icone: null });
  };

  for (const l of linhas) {
    const k = chaveDe(l.nome, l.mae);
    if (vistos.has(k)) { ignoradas.push({ nome: l.nome, motivo: "Repetida no arquivo." }); continue; }
    vistos.add(k);
    if (jaTem.has(k)) { ignoradas.push({ nome: l.nome, motivo: l.mae ? `Já existe em “${l.mae}”.` : "Já existe." }); continue; }
    if (l.mae) {
      if (subsNoArquivo.has(chave(l.mae)) || existentes.some((c) => c.pai_id && chave(c.nome) === chave(l.mae!))) {
        ignoradas.push({ nome: l.nome, motivo: `“${l.mae}” já é uma subcategoria; subcategorias não têm subcategorias.` });
        continue;
      }
      garantirMae(l.mae, l.tipo);
      filhas.push(l);
    } else {
      maes.push(l);
    }
  }
  return { criar: [...maes, ...filhas], ignoradas };
}
