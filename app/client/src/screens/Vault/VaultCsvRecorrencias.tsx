import { AlertTriangle, CheckCircle2, Download, FileText, RotateCcw, Upload } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { financeiro, vault, type RecorrenciaApi } from "@/lib/api";
import { formatMoeda } from "@/lib/format";
import { baixarCsv, detectarSeparador, modeloRecorrenciasCsv, prepararRecorrencias, tokenizar } from "./csv";
const norm = (s: string) => s.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const chave = (d: string, v: number, dia: number) => `${norm(d)}|${v}|${dia}`;
const diaDe = (r: RecorrenciaApi) => r.dia_vencimento ?? Number(r.data_inicio.slice(8, 10));
export function VaultCsvRecorrencias({ atualizar }: { atualizar: () => void }) {
    const [texto, setTexto] = useState("");
    const [nomeArquivo, setNomeArquivo] = useState("");
    const [erro, setErro] = useState("");
    const [ocupado, setOcupado] = useState(false);
    const [existentes, setExistentes] = useState<Set<string>>(new Set());
    const [resultado, setResultado] = useState<{ criadas: number; falhas: { linha: number; erro: string }[] } | null>(null);
    const entrada = useRef<HTMLInputElement>(null);
    const parsed = useMemo(() => { try {
        const rows = tokenizar(texto, detectarSeparador(texto));
        return { ...prepararRecorrencias(rows, new Date().toISOString().slice(0, 10)), erroLeitura: "" };
    }
    catch (e) {
        return { linhas: [], erros: [], ignoradas: 0, erroLeitura: (e as Error).message };
    } }, [texto]);
    const jaExiste = (l: { descricao: string; valor_centavos: number; dia: number }) => existentes.has(chave(l.descricao, l.valor_centavos, l.dia));
    const duplicadas = parsed.linhas.filter(jaExiste);
    const novas = parsed.linhas.filter(l => !jaExiste(l));
    async function ler(file: File | undefined) {
        if (!file)
            return;
        setErro("");
        setResultado(null);
        if (file.size > 1500000) {
            setErro("Arquivo excede 1,5 MB.");
            return;
        }
        try {
            const t = await file.text();
            const lista = await financeiro.recorrencias();
            setExistentes(new Set(lista.map(r => chave(r.descricao, r.valor_centavos, diaDe(r)))));
            setTexto(t);
            setNomeArquivo(file.name);
        }
        catch (e) {
            setErro((e as Error).message || "Não foi possível ler o arquivo.");
        }
    }
    function limpar() { setTexto(""); setNomeArquivo(""); setResultado(null); setErro(""); if (entrada.current)
        entrada.current.value = ""; }
    async function importar() {
        setOcupado(true);
        setErro("");
        const falhas: { linha: number; erro: string }[] = [];
        let criadas = 0;
        try {
            const categorias = new Map((await vault.categorias.listar()).map(c => [norm(c.nome), c.id]));
            for (const l of novas) {
                try {
                    let categoria: string | null = null;
                    if (l.categoria) {
                        categoria = categorias.get(norm(l.categoria)) ?? null;
                        if (!categoria) {
                            categoria = (await vault.categorias.criar({ nome: l.categoria, tipo: l.tipo, cor: "#64748b" })).id;
                            categorias.set(norm(l.categoria), categoria);
                        }
                    }
                    const beneficiario = l.beneficiario ? (await vault.beneficiarios.criarOuEncontrar({ nome: l.beneficiario })).id : null;
                    await financeiro.criarRecorrencia({ tipo: l.tipo, descricao: l.descricao, valor_centavos: l.valor_centavos, categoria_id: categoria, beneficiario_id: beneficiario, tipo_recorrencia: "fixa", frequencia: l.frequencia, intervalo: 1, dia_vencimento: l.frequencia === "semanal" ? null : l.dia, data_inicio: l.data_inicio, observacoes: l.observacoes });
                    criadas++;
                    setExistentes(s => new Set(s).add(chave(l.descricao, l.valor_centavos, l.dia)));
                }
                catch (e) {
                    falhas.push({ linha: l.linha, erro: (e as Error).message });
                }
            }
            setResultado({ criadas, falhas });
            if (criadas)
                atualizar();
        }
        catch (e) {
            setErro((e as Error).message);
        }
        finally {
            setOcupado(false);
        }
    }
    const erros = [...parsed.erros, ...(resultado?.falhas ?? [])];
    return <>
    <div className="cofre-csv-duo">
      <article className="cofre-card cofre-csv-card">
        <span className="cofre-csv-icone"><FileText size={18} aria-hidden/></span>
        <h3>Modelo de recorrências</h3>
        <p>Dia do vencimento, descrição, categoria, valor, tipo e frequência. Aceita também planilhas com título antes do cabeçalho, como o DRE.</p>
        <button type="button" className="cofre-config-btn" onClick={() => baixarCsv(modeloRecorrenciasCsv(), "cofre_modelo_recorrencias.csv")}><Download size={14} aria-hidden/>Baixar modelo CSV</button>
      </article>
    </div>
    <article className="cofre-card cofre-csv-import">
      {!texto ? <div className="cofre-csv-drop">
        <Upload size={26} aria-hidden/>
        <strong>Importar recorrências por CSV</strong>
        <button type="button" className="cofre-config-btn" onClick={() => entrada.current?.click()}>Escolher arquivo</button>
        <small>Cada linha vira uma regra mensal (fixa), que gera os vencimentos automaticamente.</small>
      </div> : <div className="cofre-csv-arquivo">
        <FileText size={18} aria-hidden/>
        <div><b>{nomeArquivo}</b><small>{parsed.linhas.length} válidas · {duplicadas.length} já existem · {parsed.erros.length} com erro</small></div>
        <button type="button" className="cofre-config-btn" disabled={ocupado} onClick={limpar}><RotateCcw size={14} aria-hidden/>Trocar arquivo</button>
      </div>}
      <input ref={entrada} className="sr-only" aria-label="Arquivo CSV de recorrências" type="file" accept=".csv,text/csv" onChange={e => void ler(e.target.files?.[0])}/>
      {(erro || parsed.erroLeitura) && <p role="alert" className="cofre-csv-erro"><AlertTriangle size={14} aria-hidden/>{erro || parsed.erroLeitura}</p>}
      {texto && parsed.linhas.length > 0 && <div className="cofre-csv-revisao">
        <div className="cofre-csv-resumo"><span data-tom="ok"><CheckCircle2 size={14} aria-hidden/>{novas.length} serão criadas</span><span>{duplicadas.length} ignoradas (mesma descrição, valor e dia)</span><small>Início no próximo vencimento a partir de hoje. Categorias e pagadores novos são criados.</small></div>
        <div className="cofre-csv-tabela"><table><caption className="sr-only">Recorrências a importar</caption><thead><tr><th>Dia</th><th>Descrição</th><th>Categoria</th><th>Início</th><th>Valor</th></tr></thead><tbody>{parsed.linhas.map(l => <tr key={l.linha} style={jaExiste(l) ? { opacity: .5 } : undefined}><td>{l.dia}</td><td>{l.descricao}</td><td>{l.categoria ?? "—"}</td><td>{l.data_inicio}</td><td className="font-mono-value" data-tipo={l.tipo}>{formatMoeda(l.valor_centavos)}</td></tr>)}</tbody></table></div>
        <div className="cofre-csv-acoes"><button type="button" className="cofre-config-btn cofre-csv-primario" disabled={ocupado || !novas.length || !!parsed.erros.length || !!resultado} onClick={() => void importar()}>Criar {novas.length} recorrências</button></div>
      </div>}
      {ocupado && <div role="status" className="cofre-csv-status"><progress aria-label="Criando recorrências"/> Criando recorrências…</div>}
      {resultado && <p role="status" className="cofre-csv-status" data-tom={resultado.falhas.length ? undefined : "ok"}>{resultado.criadas} recorrências criadas{resultado.falhas.length > 0 && `, ${resultado.falhas.length} falharam`}.</p>}
      {erros.length > 0 && <ul className="cofre-csv-erros">{erros.map((e, i) => <li key={i}>Linha {e.linha}: {e.erro}</li>)}</ul>}
    </article>
  </>;
}
