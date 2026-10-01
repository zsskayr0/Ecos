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
