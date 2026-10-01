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
export function baixarCsv(csv: string, nome: string) {
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = nome;
    a.click();
    URL.revokeObjectURL(url);
}
