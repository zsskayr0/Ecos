import { SeletorEcos } from "@/components/common/SeletorEcos";
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, FileText, RotateCcw, Upload } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { financeiro } from "@/lib/api";
import { formatMoeda } from "@/lib/format";
import { VaultCsvRecorrencias } from "./VaultCsvRecorrencias";
import { baixarCsv, campos, modeloCsv, preparar, sugerirMapa, tokenizar, type Mapeamento } from "./csv";
import type { Periodo, RelatorioImportacao } from "./types";
const ROTULOS: Record<string, string> = { data: "Data", descricao: "Descrição", tipo: "Tipo", valor: "Valor", categoria: "Categoria", beneficiario: "Pagador/Recebedor", conta: "Conta", forma_pagamento: "Forma de pagamento", observacoes: "Observações", conciliada: "Conciliada", status: "Status" };
const OBRIGATORIOS = ["data", "descricao", "tipo", "valor"];
export function VaultCsv({ periodo, atualizar }: {
    periodo: Periodo;
    atualizar: () => void;
}) {
    const [modo, setModo] = useState<"lancamentos" | "recorrencias">("lancamentos");
    const [texto, setTexto] = useState("");
    const [nomeArquivo, setNomeArquivo] = useState("");
    const [separador, setSeparador] = useState(";");
    const [mapa, setMapa] = useState<Mapeamento>({});
    const [erro, setErro] = useState("");
    const [ocupado, setOcupado] = useState(false);
    const [arrastando, setArrastando] = useState(false);
    const [relatorio, setRelatorio] = useState<RelatorioImportacao | null>(null);
    const entrada = useRef<HTMLInputElement>(null);
    const parsed = useMemo(() => { try {
        return { rows: tokenizar(texto, separador), erro: "" };
    }
    catch (e) {
        return { rows: [], erro: (e as Error).message };
    } }, [texto, separador]);
    const previa = useMemo(() => preparar(parsed.rows, mapa), [parsed.rows, mapa]);
    const faltando = OBRIGATORIOS.filter(c => mapa[c as keyof Mapeamento] === undefined);
    function carregar(text: string, sep: string) { setTexto(text); setSeparador(sep); setRelatorio(null); try {
        setMapa(sugerirMapa(tokenizar(text, sep)[0] ?? []));
    }
    catch {
        setMapa({});
    } }
    function limpar() { setTexto(""); setNomeArquivo(""); setMapa({}); setRelatorio(null); setErro(""); if (entrada.current)
        entrada.current.value = ""; }
    async function lerArquivo(file: File | undefined) {
        if (!file)
            return;
        setErro("");
        if (file.size > 1500000) {
            setErro("Arquivo excede 1,5 MB. Divida em arquivos menores.");
            return;
        }
        try {
            carregar(await file.text(), separador);
            setNomeArquivo(file.name);
        }
        catch {
            setErro("Não foi possível ler o arquivo.");
        }
    }
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
    const errosTodos = [...previa.erros, ...(relatorio?.erros ?? [])];
    const concluida = !!relatorio && !relatorio.dry_run;
    return <section className="cofre-csv">
    <p className="cofre-csv-intro">Traga seu histórico do Nexus ou de uma planilha, ou leve seus lançamentos para fora. Datas brasileiras e valores como 1.234,56 são aceitos.</p>

    <div className="cofre-csv-modos" role="group" aria-label="O que importar">
      <button type="button" className="cofre-filter-chip" aria-pressed={modo === "lancamentos"} onClick={() => setModo("lancamentos")}>Lançamentos</button>
      <button type="button" className="cofre-filter-chip" aria-pressed={modo === "recorrencias"} onClick={() => setModo("recorrencias")}>Recorrências</button>
    </div>
    {modo === "recorrencias" ? <VaultCsvRecorrencias atualizar={atualizar}/> : <>
    <div className="cofre-csv-duo">
      <article className="cofre-card cofre-csv-card">
        <span className="cofre-csv-icone"><FileText size={18} aria-hidden/></span>
        <h3>Modelo para preencher</h3>
        <p>Planilha de exemplo com as 11 colunas aceitas e 3 lançamentos fictícios. Apague os exemplos e cole os seus.</p>
        <button type="button" className="cofre-config-btn" onClick={() => baixarCsv(modeloCsv(), "cofre_modelo_importacao.csv")}><Download size={14} aria-hidden/>Baixar modelo CSV</button>
      </article>
      <article className="cofre-card cofre-csv-card">
        <span className="cofre-csv-icone"><FileSpreadsheet size={18} aria-hidden/></span>
        <h3>Exportar lançamentos</h3>
        <p>Todos os lançamentos do período <b>{periodo.data_de}</b> a <b>{periodo.data_ate}</b>, no mesmo formato da importação.</p>
        <button type="button" className="cofre-config-btn" disabled={ocupado} onClick={() => void exportar()}><Download size={14} aria-hidden/>Baixar CSV do período</button>
      </article>
    </div>

    <article className="cofre-card cofre-csv-import">
      <header className="cofre-csv-passos" aria-label="Etapas da importação">
        {["Arquivo", "Colunas", "Revisão"].map((p, i) => { const ativo = i === 0 ? !texto : i === 1 ? !!texto && !relatorio : !!relatorio; const feito = i === 0 ? !!texto : i === 1 ? !!relatorio : concluida; return <span key={p} data-ativo={ativo || undefined} data-feito={feito || undefined}><b>{feito ? "✓" : i + 1}</b>{p}</span>; })}
      </header>

      {!texto ? <div className="cofre-csv-drop" data-arrastando={arrastando || undefined} onDragOver={e => { e.preventDefault(); setArrastando(true); }} onDragLeave={() => setArrastando(false)} onDrop={e => { e.preventDefault(); setArrastando(false); void lerArquivo(e.dataTransfer.files?.[0]); }}>
        <Upload size={26} aria-hidden/>
        <strong>Arraste o CSV até aqui</strong>
        <span>ou</span>
        <button type="button" className="cofre-config-btn" onClick={() => entrada.current?.click()}>Escolher arquivo</button>
        <small>CSV de até 1,5 MB e 10.000 linhas.</small>
      </div> : <div className="cofre-csv-arquivo">
        <FileText size={18} aria-hidden/>
        <div><b>{nomeArquivo || "arquivo.csv"}</b><small>{Math.max(parsed.rows.length - 1, 0)} linhas de dados</small></div>
        <label className="cofre-csv-sep">Separador<SeletorEcos ariaLabel="Separador" classe="ecos-input" valor={separador} onChange={v => carregar(texto, v)} opcoes={[{ valor: ";", rotulo: "Ponto e vírgula" }, { valor: ",", rotulo: "Vírgula" }, { valor: "\t", rotulo: "Tabulação" }]}/></label>
        <button type="button" className="cofre-config-btn" disabled={ocupado} onClick={limpar}><RotateCcw size={14} aria-hidden/>Trocar arquivo</button>
      </div>}
      <input ref={entrada} className="sr-only" aria-label="Arquivo CSV" type="file" accept=".csv,text/csv" onChange={e => void lerArquivo(e.target.files?.[0])}/>

      {(erro || parsed.erro) && <p role="alert" className="cofre-csv-erro"><AlertTriangle size={14} aria-hidden/>{erro || parsed.erro}</p>}

      {parsed.rows.length > 0 && <fieldset disabled={ocupado} className="cofre-csv-colunas">
        <legend>Confira as colunas</legend>
        <p>Associamos pelo nome do cabeçalho. Ajuste o que não bateu; só Data, Descrição, Tipo e Valor são obrigatórios.</p>
        <div className="cofre-csv-grade">{campos.map(c => <label key={c} data-falta={faltando.includes(c) || undefined}>{ROTULOS[c]}{OBRIGATORIOS.includes(c) ? " *" : ""}<SeletorEcos ariaLabel={`Coluna para ${c}`} classe="ecos-input w-full" valor={String(mapa[c] ?? "")} onChange={v => { setMapa({ ...mapa, [c]: v === "" ? undefined : Number(v) }); setRelatorio(null); }} opcoes={[{ valor: "", rotulo: "Não importar" }, ...parsed.rows[0].map((h, i) => ({ valor: String(i), rotulo: h }))]}/></label>)}</div>
      </fieldset>}

      {texto && <div className="cofre-csv-revisao">
        <div className="cofre-csv-resumo">
          <span data-tom="ok"><CheckCircle2 size={14} aria-hidden/>{previa.linhas.length} válidas</span>
          <span data-tom={previa.erros.length ? "erro" : undefined}><AlertTriangle size={14} aria-hidden/>{previa.erros.length} com erro</span>
          <small>Duplicatas são identificadas por data, tipo, valor, descrição e conta.</small>
        </div>
        {previa.linhas.length > 0 && <div className="cofre-csv-tabela"><table><caption className="sr-only">Prévia das primeiras 20 linhas</caption><thead><tr><th>Linha</th><th>Data</th><th>Descrição</th><th>Tipo</th><th>Valor</th></tr></thead><tbody>{previa.linhas.slice(0, 20).map(l => <tr key={l.linha}><td>{l.linha}</td><td>{l.data}</td><td>{l.descricao}</td><td data-tipo={l.tipo}>{l.tipo === "entrada" ? "Receita" : "Despesa"}</td><td className="font-mono-value">{formatMoeda(l.valor_centavos)}</td></tr>)}</tbody></table></div>}
        <div className="cofre-csv-acoes">
          <button type="button" className="cofre-config-btn" disabled={ocupado || !previa.linhas.length || !!previa.erros.length || !!parsed.erro} onClick={() => void importar(true)}>Validar no Cofre (simulação)</button>
          <button type="button" className="cofre-config-btn cofre-csv-primario" disabled={ocupado || !relatorio?.dry_run || !!relatorio.erros.length || !relatorio.validas} onClick={() => void importar(false)}>Importar {relatorio?.validas ?? 0} registros</button>
        </div>
      </div>}

      {ocupado && <div role="status" className="cofre-csv-status"><progress aria-label="Processando CSV"/> Processando arquivo…</div>}
      {relatorio && <p role="status" className="cofre-csv-status" data-tom={concluida ? "ok" : undefined}>{relatorio.dry_run ? "Simulação sem gravação" : "Importação concluída"}: {relatorio.validas} válidas, {relatorio.importadas} importadas, {relatorio.duplicadas.length} duplicadas ignoradas.{relatorio.duplicadas.length > 0 && ` Linhas: ${relatorio.duplicadas.join(", ")}`}</p>}
      {errosTodos.length > 0 && <ul className="cofre-csv-erros">{errosTodos.map((e, i) => <li key={i}>Linha {e.linha}: {e.erro}</li>)}</ul>}
    </article></>}
  </section>;
}
