import { describe, expect, it } from "vitest";
import { dataBR, valorBR, tokenizar, preparar, sugerirMapa } from "./csv";
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
    it("recusa aspas abertas e informa erros por registro", () => {
        expect(() => tokenizar('Data;"Descrição')).toThrow();
        const rows = tokenizar('Quando,Histórico,Tipo,Quantia\n31/02/2026,Foo,Despesa,abc', ",");
        expect(preparar(rows, { data: 0, descricao: 1, tipo: 2, valor: 3 }).erros[0]).toEqual({ linha: 2, erro: "Valor brasileiro inválido; Data inválida" });
    });
});
