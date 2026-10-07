// Portado de Nexus/packages/core/src/csv-import.ts: aliases e contrato brasileiro.
// Tokenização estrita e mapeamento explícito impedem importações silenciosamente corrompidas.
import { FORMAS_PAGAMENTO } from "@/lib/api";
import type { LinhaImportacao } from "./types";
export const campos = ["data", "descricao", "tipo", "valor", "categoria", "beneficiario", "conta", "forma_pagamento", "observacoes", "conciliada", "status"] as const;
export type Campo = typeof campos[number];
export type Mapeamento = Partial<Record<Campo, number>>;
const aliases: Record<string, Campo> = { data: "data", descricao: "descricao", tipo: "tipo", valor: "valor", categoria: "categoria", "pagador/recebedor": "beneficiario", pagador: "beneficiario", recebedor: "beneficiario", conta: "conta", "forma de pagamento": "forma_pagamento", observacoes: "observacoes", conciliada: "conciliada", status: "status" };
const normalizar = (s: string) => s.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
export function sugerirMapa(headers: string[]): Mapeamento {
    const result: Mapeamento = {};
    headers.forEach((h, i) => { const c = aliases[normalizar(h)]; if (c)
        result[c] = i; });
    return result;
}
export function tokenizar(text: string, separador = ";"): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let field = "";
    let quoted = false;
    let closed = false;
    const s = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (quoted) {
            if (ch === '"' && s[i + 1] === '"') {
                field += '"';
                i++;
            }
            else if (ch === '"') {
                quoted = false;
                closed = true;
            }
            else
                field += ch;
        }
        else if (ch === separador || ch === '\n') {
            row.push(field);
            field = "";
            closed = false;
            if (ch === '\n') {
                if (row.some(v => v.trim()))
                    rows.push(row);
                row = [];
            }
        }
        else if (ch === '"' && !field && !closed)
            quoted = true;
        else {
            if (closed || ch === '"')
                throw new Error("Aspas inválidas no CSV.");
            field += ch;
        }
    }
    if (quoted)
        throw new Error("CSV com aspas não fechadas.");
    row.push(field);
    if (row.some(v => v.trim()))
        rows.push(row);
    if (rows.length > 10001)
        throw new Error("Limite de 10.000 registros por importação.");
    return rows;
}
export function valorBR(raw: string): number | null {
    const s = raw.trim().replace(/^R\$\s*/, "");
    if (!/^-?(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/.test(s))
        return null;
    const [inteiro, fracao = ""] = s.replace(/\./g, "").replace(/^-/, "").split(",");
    const n = Number(inteiro) * 100 + Number(fracao.padEnd(2, "0"));
    return Number.isSafeInteger(n) && n > 0 && n <= 9000000000000 ? n : null;
}
export function dataBR(raw: string): string | null {
    const s = raw.trim();
    const br = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
    const iso = br ? `${br[3]}-${br[2].padStart(2, "0")}-${br[1].padStart(2, "0")}` : s;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || iso.slice(0, 4) === "0000")
        return null;
    const date = new Date(`${iso}T12:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === iso ? iso : null;
}
export function preparar(rows: string[][], mapa: Mapeamento) {
    const erros: {
        linha: number;
        erro: string;
    }[] = [];
    const linhas: LinhaImportacao[] = [];
    for (const [i, row] of rows.slice(1).entries()) {
        const linha = i + 2;
        const get = (c: Campo) => mapa[c] === undefined ? "" : (row[mapa[c]!] ?? "").trim();
        const tipoRaw = normalizar(get("tipo"));
        const tipo = ["receita", "entrada", "income"].includes(tipoRaw) ? "entrada" : ["despesa", "saida", "expense"].includes(tipoRaw) ? "saida" : null;
        const valor = valorBR(get("valor"));
        const data = dataBR(get("data"));
        const descricao = get("descricao");
        const forma = get("forma_pagamento").toLowerCase();
        const status = get("status") || "efetivada";
        const reconciliada = normalizar(get("conciliada"));
        const problemas = [!tipo && "Tipo inválido", !valor && "Valor brasileiro inválido", !data && "Data inválida", !descricao && "Descrição obrigatória", row.length !== rows[0].length && "Número de colunas divergente", forma && !FORMAS_PAGAMENTO.some(f => f === forma) && "Pagamento inválido", !["efetivada", "pendente"].includes(status) && "Status inválido", !["", "sim", "nao", "true", "false", "1", "0"].includes(reconciliada) && "Conciliação inválida"].filter(Boolean);
        if (problemas.length) {
            erros.push({ linha, erro: problemas.join("; ") });
            continue;
        }
        linhas.push({ linha, tipo: tipo!, valor_centavos: valor!, data: data!, descricao, categoria: get("categoria") || null, beneficiario: get("beneficiario") || null, conta: get("conta") || null, forma_pagamento: forma || null, observacoes: get("observacoes") || null, conciliada: ["sim", "true", "1"].includes(reconciliada), status });
    }
    return { linhas, erros };
}
export const CABECALHO_MODELO = ["Data", "Descrição", "Tipo", "Valor", "Categoria", "Pagador/Recebedor", "Conta", "Forma de pagamento", "Observações", "Conciliada", "Status"];
const EXEMPLOS_MODELO = [
    ["30/09/2026", "Salário de setembro", "Receita", "5.000,00", "Salário", "Empresa Exemplo", "Conta corrente", "ted", "", "sim", "efetivada"],
    ["01/10/2026", "Compras do mês", "Despesa", "412,90", "Mercado", "Supermercado Centro", "Cartão", "cartao", "Compra grande", "não", "efetivada"],
    ["05/10/2026", "Conta de luz", "Despesa", "189,35", "Moradia", "Companhia de Energia", "Conta corrente", "boleto", "", "não", "pendente"],
];
/** CSV de exemplo com o mesmo layout da exportação; as linhas de exemplo passam na validação. */
export function modeloCsv(): string {
    const cel = (v: string) => `"${v.replace(/"/g, '""')}"`;
    return "﻿" + [CABECALHO_MODELO, ...EXEMPLOS_MODELO].map(l => l.map(cel).join(";")).join("\r\n") + "\r\n";
}
export function baixarCsv(csv: string, nome: string) {
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = nome;
    a.click();
    URL.revokeObjectURL(url);
}

// --- Recorrências ---------------------------------------------------------
export interface LinhaRecorrencia {
    linha: number;
    descricao: string;
    tipo: "entrada" | "saida";
    valor_centavos: number;
    dia: number;
    categoria: string | null;
    beneficiario: string | null;
    frequencia: "mensal" | "semanal" | "anual";
    data_inicio: string;
    observacoes: string | null;
}
const aliasesRec: Record<string, string> = { "venc.": "dia", venc: "dia", dia: "dia", vencimento: "dia", "dia do vencimento": "dia", descricao: "descricao", classificacao: "categoria", categoria: "categoria", valor: "valor", tipo: "tipo", frequencia: "frequencia", "pagador/recebedor": "beneficiario", beneficiario: "beneficiario", "data de inicio": "inicio", observacoes: "observacoes" };
export const CABECALHO_MODELO_REC = ["Dia do vencimento", "Descrição", "Categoria", "Valor", "Tipo", "Frequência", "Pagador/Recebedor", "Observações"];
export function modeloRecorrenciasCsv(): string {
    const cel = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const exemplos = [["10", "Aluguel", "Moradia", "2.500,00", "Despesa", "Mensal", "Imobiliária Exemplo", ""], ["5", "Salário", "Salário", "5.000,00", "Receita", "Mensal", "", ""], ["25", "Internet", "Telefonia / Internet", "129,90", "Despesa", "Mensal", "Provedor Exemplo", "Contrato anual"]];
    return "\uFEFF" + [CABECALHO_MODELO_REC, ...exemplos].map(l => l.map(cel).join(";")).join("\r\n") + "\r\n";
}
export function detectarSeparador(text: string): string {
    const linha = text.replace(/^\uFEFF/, "").split(/\r?\n/).find(l => l.trim()) ?? "";
    const n = (c: string) => linha.split(c).length;
    return n(";") >= n(",") && n(";") > 1 ? ";" : n(",") > 1 ? "," : n("\t") > 1 ? "\t" : ";";
}
/** Aceita planilhas com linhas de título antes do cabeçalho e linhas de rodapé soltas. */
export function prepararRecorrencias(rows: string[][], hoje: string) {
    const erros: { linha: number; erro: string }[] = [];
    const linhas: LinhaRecorrencia[] = [];
    let ignoradas = 0;
    const h = rows.findIndex(r => r.some(c => normalizar(c) === "descricao"));
    if (h < 0)
        return { linhas, erros: [{ linha: 1, erro: "Cabeçalho com a coluna Descrição não encontrado" }], ignoradas };
    const idx: Record<string, number> = {};
    rows[h].forEach((c, i) => { const k = aliasesRec[normalizar(c)]; if (k && idx[k] === undefined)
        idx[k] = i; });
    for (const [i, row] of rows.slice(h + 1).entries()) {
        const linha = h + i + 2;
        const get = (k: string) => idx[k] === undefined ? "" : (row[idx[k]] ?? "").trim();
        const descricao = get("descricao");
        const dia = /^\d{1,2}$/.test(get("dia")) ? Number(get("dia")) : null;
        if (!descricao && (dia === null || !get("valor"))) {
            ignoradas++;
            continue;
        }
        const valor = valorBR(get("valor"));
        const tipoRaw = normalizar(get("tipo"));
        const freqRaw = normalizar(get("frequencia"));
        const frequencia = ["", "mensal"].includes(freqRaw) ? "mensal" : freqRaw === "semanal" ? "semanal" : freqRaw === "anual" ? "anual" : null;
        const inicioRaw = get("inicio");
        let inicio = inicioRaw ? dataBR(inicioRaw) : null;
        if (!inicioRaw && dia && dia >= 1 && dia <= 31) {
            const [a, m, d] = hoje.split("-").map(Number);
            const nasc = (ano: number, mes: number) => { const ult = new Date(Date.UTC(ano, mes, 0)).getUTCDate(); return `${ano}-${String(mes).padStart(2, "0")}-${String(Math.min(dia, ult)).padStart(2, "0")}`; };
            inicio = dia >= d ? nasc(a, m) : m === 12 ? nasc(a + 1, 1) : nasc(a, m + 1);
        }
        const problemas = [!descricao && "Descrição obrigatória", !valor && "Valor brasileiro inválido", !dia || dia < 1 || dia > 31 ? "Dia de vencimento inválido (1 a 31)" : null, !frequencia && "Frequência inválida", !inicio && "Data de início inválida"].filter(Boolean);
        if (problemas.length) {
            erros.push({ linha, erro: problemas.join("; ") });
            continue;
        }
        const nota = ["estimativo", "predefinido"].includes(tipoRaw) ? `Valor ${tipoRaw}` : "";
        linhas.push({ linha, descricao, tipo: ["receita", "entrada", "income"].includes(tipoRaw) ? "entrada" : "saida", valor_centavos: valor!, dia: dia!, categoria: get("categoria") || null, beneficiario: get("beneficiario") || null, frequencia: frequencia!, data_inicio: inicio!, observacoes: get("observacoes") || nota || null });
    }
    return { linhas, erros, ignoradas };
}
