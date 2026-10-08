import { describe, expect, it } from "vitest";
import { dataBR, detectarSeparador, modeloCsv, modeloRecorrenciasCsv, prepararRecorrencias, valorBR, tokenizar, preparar as prepararCom, sugerirMapa, type Mapeamento } from "./csv";
import type { FormaPagamentoApi } from "@/lib/api";
const forma = (codigo: string, nome: string, extra: Partial<FormaPagamentoApi> = {}): FormaPagamentoApi => ({ codigo, nome, icone: null, cor: null, padrao: true, ativa: true, ordem: 1, criado_por: null, usos: 0, ...extra });
const FABRICA = [forma("pix", "Pix"), forma("ted", "TED"), forma("cartao", "Cartão"), forma("boleto", "Boleto"), forma("dinheiro", "Dinheiro")];
const preparar = (rows: string[][], mapa: Mapeamento, formas: FormaPagamentoApi[] | null = FABRICA) => prepararCom(rows, mapa, formas);
describe("CSV migrado do Nexus", () => {
    it("valida valores brasileiros sem arredondar lixo", () => {
        expect(valorBR("R$ 1.234,56")).toBe(123456);
        expect(valorBR("-12,3")).toBe(1230);
        for (const valor of ["abc123", "1,234", "12.34", "0", "Infinity", "1e3"])
            expect(valorBR(valor)).toBeNull();
    });
    it("valida datas reais, incluindo ano bissexto", () => {
        expect(dataBR("29/02/2024")).toBe("2024-02-29");
        expect(dataBR("31/02/2026")).toBeNull();
        expect(dataBR("2026-09-30")).toBe("2026-09-30");
    });
    it("preserva BOM, aspas, delimitadores e descrições multilinha", () => {
        const rows = tokenizar('\uFEFFData;Descrição;Tipo;Valor\r\n30/09/2026;"Mercado; \"\"Centro\"\"\nPix";Despesa;123,45\r\n');
        const previa = preparar(rows, sugerirMapa(rows[0]));
        expect(previa.erros).toEqual([]);
        expect(previa.linhas[0].descricao).toBe('Mercado; "Centro"\nPix');
        expect(previa.linhas[0].valor_centavos).toBe(12345);
    });
    it("o modelo para download é aceito pelo próprio importador", () => {
        const rows = tokenizar(modeloCsv());
        const previa = preparar(rows, sugerirMapa(rows[0]));
        expect(previa.erros).toEqual([]);
        expect(previa.linhas).toHaveLength(3);
    });
    it("recusa aspas abertas e informa erros por registro", () => {
        expect(() => tokenizar('Data;"Descrição')).toThrow();
        const rows = tokenizar('Quando,Histórico,Tipo,Quantia\n31/02/2026,Foo,Despesa,abc', ",");
        expect(preparar(rows, { data: 0, descricao: 1, tipo: 2, valor: 3 }).erros[0]).toEqual({ linha: 2, erro: "Valor brasileiro inválido; Data inválida" });
    });
});
describe("forma de pagamento no CSV", () => {
    const base = 'Data;Descrição;Tipo;Valor;Forma de pagamento\n30/09/2026;Mercado;Despesa;10,00;';
    const rodar = (texto: string, formas: FormaPagamentoApi[] | null = [...FABRICA, forma("cartao_de_debito", "Cartão de Débito", { padrao: false })]) => {
        const rows = tokenizar(`${base}${texto}\n`);
        return preparar(rows, sugerirMapa(rows[0]), formas);
    };
    it("aceita o código exato", () => expect(rodar("pix").linhas[0].forma_pagamento).toBe("pix"));
    it("aceita o nome, sem acento nem caixa, e devolve o código", () => expect(rodar("cartao de debito").linhas[0].forma_pagamento).toBe("cartao_de_debito"));
    it("aceita célula vazia", () => expect(rodar("").linhas[0].forma_pagamento).toBeNull());
    it("recusa pagamento inexistente", () => expect(rodar("cheque").erros[0].erro).toContain("Pagamento inválido"));
    it("recusa nome ambíguo em vez de escolher em silêncio", () => {
        const formas = [forma("credito", "Crédito"), forma("credito_2", "Credito", { padrao: false })];
        expect(rodar("credito", formas).linhas[0]?.forma_pagamento).toBe("credito"); // código exato vence
        expect(rodar("CRÉDITO", formas).erros[0].erro).toContain("ambíguo");
    });
    it("sem o cadastro carregado nunca aceita qualquer código", () => expect(rodar("pix", null).erros[0].erro).toContain("não carregadas"));
});
describe("CSV de recorrências", () => {
    it("lê planilha com título antes do cabeçalho e rodapé solto", () => {
        const txt = ',,,\n  DRE,,,"R$ 1,00"\nVenc.,Venc. Ext.,Descrição,Classificação,Valor,Tipo\n20,20/12/3799,Salários CLT,Salários," R$  45.000,00 ",Estimativo\n31,31/12/3799,Luz,Energia," R$  1.462,00 ",Predefinido\nIndex,,,,junho 2026,TRUE\n';
        const r = prepararRecorrencias(tokenizar(txt, detectarSeparador(txt)), "2026-10-03");
        expect(r.erros).toEqual([]);
        expect(r.ignoradas).toBe(1);
        expect(r.linhas.map(l => [l.descricao, l.valor_centavos, l.dia, l.data_inicio, l.categoria, l.observacoes])).toEqual([["Salários CLT", 4500000, 20, "2026-10-20", "Salários", "Valor estimativo"], ["Luz", 146200, 31, "2026-10-31", "Energia", "Valor predefinido"]]);
    });
    it("empurra para o mês seguinte e o modelo é aceito", () => {
        const r = prepararRecorrencias(tokenizar(modeloRecorrenciasCsv()), "2026-10-03");
        expect(r.erros).toEqual([]);
        expect(r.linhas.map(l => l.data_inicio)).toEqual(["2026-10-10", "2026-10-05", "2026-10-25"]);
        expect(r.linhas[1].tipo).toBe("entrada");
    });
});
