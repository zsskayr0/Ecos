import { SeletorEcos } from "@/components/common/SeletorEcos";
import { useMemo, useState } from "react";
import { financeiro } from "@/lib/api";
import { formatMoeda } from "@/lib/format";
import { baixarCsv, campos, preparar, sugerirMapa, tokenizar, type Mapeamento } from "./csv";
import type { Periodo, RelatorioImportacao } from "./types";
export function VaultCsv({ periodo, atualizar }: {
    periodo: Periodo;
    atualizar: () => void;
}) {
    const [texto, setTexto] = useState("");
    const [separador, setSeparador] = useState(";");
    const [mapa, setMapa] = useState<Mapeamento>({});
    const [erro, setErro] = useState("");
    const [ocupado, setOcupado] = useState(false);
    const [relatorio, setRelatorio] = useState<RelatorioImportacao | null>(null);
    const parsed = useMemo(() => { try {
        return { rows: tokenizar(texto, separador), erro: "" };
    }
    catch (e) {
        return { rows: [], erro: (e as Error).message };
    } }, [texto, separador]);
    const previa = useMemo(() => preparar(parsed.rows, mapa), [parsed.rows, mapa]);
    function carregar(text: string, sep: string) { setTexto(text); setSeparador(sep); setRelatorio(null); try {
        setMapa(sugerirMapa(tokenizar(text, sep)[0] ?? []));
    }
    catch {
        setMapa({});
    } }
    async function importar(dryRun: boolean) {
        setOcupado(true);
        setErro("");
        try {
            const r = await financeiro.importar(previa.linhas, dryRun);
            setRelatorio(r);
            if (!dryRun) {
                atualizar();
            }
        }
        catch (e) {
            setRelatorio(null);
            setErro((e as Error).message);
        }
        finally {
            setOcupado(false);
        }
    }
    async function exportar() { setOcupado(true); setErro(""); try {
        const r = await financeiro.exportar(periodo);
        baixarCsv(r.csv, `cofre_${periodo.data_de}_${periodo.data_ate}.csv`);
    }
    catch (e) {
        setErro((e as Error).message);
    }
    finally {
        setOcupado(false);
    } }
    return <section className="space-y-4">
    <h2 className="font-display text-xl">Importação e exportação CSV</h2>
    <p className="text-sm text-text-secondary">Traga seu histórico do Nexus ou de uma planilha. Confira os dados antes de importar.</p>
    <button className="ecos-input" disabled={ocupado} onClick={() => void exportar()}>Baixar CSV do período</button>
    <fieldset disabled={ocupado} className="space-y-3"><h3 className="font-semibold">1. Escolha o arquivo</h3><p className="text-xs text-text-muted">CSV de até 1,5 MB e 10.000 linhas. Datas brasileiras e valores como 1.234,56 são aceitos.</p>
      <label className="block">Arquivo CSV<input className="ecos-input block w-full" type="file" accept=".csv,text/csv" onChange={async (e) => { const file = e.target.files?.[0]; if (!file)
        return; setErro(""); if (file.size > 1500000) {
        setErro("Arquivo excede 1,5 MB. Divida em arquivos menores.");
        return;
    } try {
        carregar(await file.text(), separador);
    }
    catch {
        setErro("Não foi possível ler o arquivo.");
    } }}/></label>
      <label className="block">Separador<SeletorEcos ariaLabel="Separador" classe="ecos-input" valor={separador} onChange={v => carregar(texto, v)} opcoes={[{ valor: ";", rotulo: "Ponto e vírgula" }, { valor: ",", rotulo: "Vírgula" }, { valor: "\t", rotulo: "Tabulação" }]} /></label>
      {parsed.rows.length > 0 && <><h3 className="font-semibold">2. Confira as colunas</h3><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{campos.map(c => <label key={c} className="text-sm">{c}<SeletorEcos ariaLabel={`Coluna para ${c}`} classe="ecos-input w-full" valor={String(mapa[c] ?? "")} onChange={v => { setMapa({ ...mapa, [c]: v === "" ? undefined : Number(v) }); setRelatorio(null); }} opcoes={[{ valor: "", rotulo: "Não importar" }, ...parsed.rows[0].map((h, i) => ({ valor: String(i), rotulo: h }))]} /></label>)}</div></>}
    </fieldset>
    {(erro || parsed.erro) && <p role="alert" className="text-error">{erro || parsed.erro}</p>}
    {texto && <>
      <h3 className="font-semibold">3. Revise e valide</h3><p className="text-xs text-text-muted">Duplicatas são identificadas por data, tipo, valor, descrição e conta.</p><p>{previa.linhas.length} linhas válidas; {previa.erros.length} com erro. Prévia das primeiras 20:</p>
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th>Linha</th><th>Data</th><th>Descrição</th><th>Tipo</th><th>Valor</th></tr></thead><tbody>{previa.linhas.slice(0, 20).map(l => <tr key={l.linha}><td>{l.linha}</td><td>{l.data}</td><td>{l.descricao}</td><td>{l.tipo}</td><td className="font-mono-value">{formatMoeda(l.valor_centavos)}</td></tr>)}</tbody></table></div>
      <button className="ecos-input" disabled={ocupado || !previa.linhas.length || !!previa.erros.length || !!parsed.erro} onClick={() => void importar(true)}>Validar no Cofre (dry-run)</button>
      <button className="ecos-input ml-2" disabled={ocupado || !relatorio?.dry_run || !!relatorio.erros.length || !relatorio.validas} onClick={() => void importar(false)}>Importar {relatorio?.validas ?? 0} registros</button>
    </>}
    {ocupado && <div role="status"><progress aria-label="Processando CSV"/> Processando arquivo…</div>}
    {relatorio && <p role="status">{relatorio.dry_run ? "Simulação sem gravação" : "Importação concluída"}: {relatorio.validas} válidas, {relatorio.importadas} importadas, {relatorio.duplicadas.length} duplicadas ignoradas.{relatorio.duplicadas.length > 0 && ` Linhas: ${relatorio.duplicadas.join(", ")}`}</p>}
    <ul className="max-h-64 overflow-auto text-sm text-error">{[...previa.erros, ...(relatorio?.erros ?? [])].map((e, i) => <li key={i}>Linha {e.linha}: {e.erro}</li>)}</ul>
  </section>;
}
