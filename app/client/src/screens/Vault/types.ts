export interface Periodo {
    data_de: string;
    data_ate: string;
}
export interface Ocorrencia {
    recorrencia_id: string;
    data: string;
    tipo: "entrada" | "saida";
    descricao: string;
    valor_centavos: number;
}
export interface Pendencia {
    id: string;
    tipo: "entrada" | "saida";
    descricao: string;
    valor_centavos: number;
}
export interface Grupo {
    chave: string | null;
    valor: number;
}
export interface Maior {
    id: string;
    descricao: string;
    valor: number;
    data: string;
}
export interface Painel {
    saldo: number;
    receitas: number;
    despesas: number;
    taxa_economia: number | null;
    mensal: boolean;
    series: {
        data: string;
        receitas: number;
        despesas: number;
        receitas_confirmadas: number;
        despesas_confirmadas: number;
    }[];
    categorias: Grupo[];
    pagamentos: Grupo[];
    maiores_entradas: Maior[];
    maiores_saidas: Maior[];
    previsoes: Ocorrencia[];
}
export interface LinhaImportacao {
    linha: number;
    tipo: "entrada" | "saida";
    data: string;
    descricao: string;
    valor_centavos: number;
    categoria: string | null;
    beneficiario: string | null;
    conta: string | null;
    forma_pagamento: string | null;
    observacoes: string | null;
    conciliada: boolean;
    status: string;
}
export interface RelatorioImportacao {
    dry_run: boolean;
    validas: number;
    importadas: number;
    duplicadas: number[];
    erros: {
        linha: number;
        erro: string;
    }[];
}
/** Pacote do Nexus (formato do script `scripts/nexus-exportar.mjs`); só `attachments` carrega arquivos. */
export interface PacoteNexus {
    categories?: Record<string, unknown>[];
    payees?: Record<string, unknown>[];
    accounts?: Record<string, unknown>[];
    recurringTransactions?: Record<string, unknown>[];
    transactions?: Record<string, unknown>[];
    pendingItems?: Record<string, unknown>[];
    recurringExclusions?: Record<string, unknown>[];
    attachments?: { id: string; transactionId: string; fileName: string; contentBase64?: string; checksumSha256?: string }[];
}
export interface ContagemNexus {
    recebidas: number;
    criadas: number;
    reaproveitadas: number;
    ja_migradas: number;
    ignoradas: number;
    com_erro: number;
}
export interface TotaisNexus {
    lancamentos: number;
    entradas_centavos: number;
    saidas_centavos: number;
    anexos?: number;
}
export interface RelatorioNexus {
    dry_run: boolean;
    aplicado: boolean;
    backup: string | null;
    entidades: Record<string, ContagemNexus>;
    erros: { tabela: string; id: string; erro: string }[];
    avisos: string[];
    verificacao: {
        antes: TotaisNexus;
        depois: TotaisNexus;
        origem: TotaisNexus;
        criados: TotaisNexus;
        confere: boolean;
        projetado: boolean;
    };
}

