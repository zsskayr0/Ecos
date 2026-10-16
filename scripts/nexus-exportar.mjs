#!/usr/bin/env node
// Gera o pacote JSON que a migração assistida do Cofre (Configurações › Cofre › Backup & CSV › Nexus) lê.
// Só LÊ o banco do Nexus (nunca escreve nele) e não envia nada a lugar nenhum: o arquivo fica no seu disco.
//
//   node scripts/nexus-exportar.mjs [--source <nexus.db>] [--out nexus-pacote.json] [--sem-anexos]
//
// Formato = o do script migrate-local-to-server.mjs do Nexus (categories, payees, accounts, recurringTransactions,
// transactions, pendingItems, recurringExclusions) + attachments (arquivo em base64 + SHA-256, quando o arquivo existe).
// Antes de importar, o resumo impresso aqui (contagem e soma por tipo) é o que você confere contra o relatório do Cofre.
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const opcao = (nome, padrao) => { const i = args.indexOf(`--${nome}`); return i === -1 ? padrao : args[i + 1]; };
const origem = opcao("source", process.platform === "win32" ? `${process.env.APPDATA}\\com.nexus.desktop\\nexus.db` : `${process.env.HOME}/.local/share/com.nexus.desktop/nexus.db`);
const saida = opcao("out", "nexus-pacote.json");
const comAnexos = !args.includes("--sem-anexos");

if (!existsSync(origem)) {
  console.error(`Banco do Nexus não encontrado: ${origem}`);
  process.exit(1);
}
const db = new DatabaseSync(origem, { readOnly: true });
const bool = (v) => v === 1;
const tabela = (nome) => db.prepare(`SELECT * FROM ${nome}`).all();
const existe = (nome) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(nome);

const pacote = {
  categories: tabela("categories").map((r) => ({ id: r.id, name: r.name, type: r.type, icon: r.icon, color: r.color })),
  payees: tabela("payees").map((r) => ({ id: r.id, name: r.name, document: r.document, notes: r.notes })),
  accounts: tabela("accounts").map((r) => ({ id: r.id, name: r.name, bank: r.bank, agency: r.agency, accountNumber: r.account_number, color: r.color })),
  recurringTransactions: tabela("recurring_transactions").map((r) => ({
    id: r.id, type: r.type, description: r.description, amountCents: r.amount_cents, categoryId: r.category_id, payeeId: r.payee_id,
    accountId: r.account_id, paymentMethod: r.payment_method, recurrenceKind: r.recurrence_kind, frequency: r.frequency,
    intervalCount: r.interval_count, dueDay: r.due_day, startDate: r.start_date, endDate: r.end_date,
    totalInstallments: r.total_installments, installmentsGenerated: r.installments_generated, notes: r.notes, isActive: bool(r.is_active),
  })),
  transactions: tabela("transactions").map((r) => ({
    id: r.id, type: r.type, amountCents: r.amount_cents, currency: r.currency, occurredAt: r.occurred_at, description: r.description,
    categoryId: r.category_id, payeeId: r.payee_id, accountId: r.account_id, paymentMethod: r.payment_method, notes: r.notes,
    source: r.source, ocrRawText: r.ocr_raw_text, ocrConfidence: r.ocr_confidence, recurringTransactionId: r.recurring_transaction_id,
    isReconciled: bool(r.is_reconciled),
  })),
  pendingItems: tabela("pending_items").map((r) => ({
    id: r.id, type: r.type, description: r.description, amountCents: r.amount_cents, categoryId: r.category_id, payeeId: r.payee_id,
    recurringTransactionId: r.recurring_transaction_id, notes: r.notes,
  })),
  recurringExclusions: tabela("recurring_exclusions").map((r) => ({ recurringTransactionId: r.recurring_transaction_id, occurrenceDate: r.occurrence_date })),
  attachments: [],
};

const semArquivo = [];
if (comAnexos && existe("attachments")) {
  for (const r of tabela("attachments")) {
    const item = { id: r.id, transactionId: r.transaction_id, fileName: r.file_name };
    if (r.file_path && existsSync(r.file_path)) {
      const bytes = readFileSync(r.file_path);
      item.contentBase64 = bytes.toString("base64");
      item.checksumSha256 = createHash("sha256").update(bytes).digest("hex");
    } else {
      semArquivo.push(r.file_name);
    }
    pacote.attachments.push(item);
  }
}

db.close();
writeFileSync(saida, JSON.stringify(pacote));

const soma = (tipo) => pacote.transactions.filter((t) => t.type === tipo).reduce((s, t) => s + t.amountCents, 0);
const reais = (c) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
console.log(`Pacote gravado em ${saida} (somente leitura em ${origem}).\n`);
for (const [chave, lista] of Object.entries(pacote)) console.log(`  ${chave.padEnd(24)} ${lista.length}`);
console.log(`\n  Receitas (transactions income):  ${reais(soma("income"))}`);
console.log(`  Despesas (transactions expense): ${reais(soma("expense"))}`);
if (semArquivo.length) console.log(`\n  Atenção: ${semArquivo.length} anexo(s) sem arquivo neste computador (não serão migrados): ${semArquivo.slice(0, 5).join(", ")}${semArquivo.length > 5 ? "…" : ""}`);
console.log("\nPróximo passo: abra o Cofre > Configurações > Backup & CSV > Nexus, rode a simulação e confira estes números.");
