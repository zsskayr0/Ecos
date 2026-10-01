import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { financeiro, vault, FORMAS_PAGAMENTO, type CategoriaApi, type TransacaoApi } from "@/lib/api";
import { formatMoeda, hojeISO } from "@/lib/format";
import type { Periodo } from "./types";
import type { Filtro } from "./VaultDashboard";
import { valorBR } from "./csv";
export function VaultTransactions({ recarregar, periodo, filtro, categorias, abrir, atualizar }: {
    recarregar: number;
    periodo: Periodo;
    filtro: Filtro;
    categorias: CategoriaApi[];
    abrir: (id: string) => void;
    atualizar: () => void;
}) {
    const [rows, setRows] = useState<TransacaoApi[]>([]);
    const [cursor, setCursor] = useState<string | null>(null);
    const [selecionados, setSelecionados] = useState<string[]>([]);
    const [erro, setErro] = useState("");
    const [ocupado, setOcupado] = useState(false);
    const [carregando, setCarregando] = useState(true);
    const [versao, setVersao] = useState(0);
    const [feedback, setFeedback] = useState("");
    const [search, setSearch] = useSearchParams();
    const novo = search.get("nova") === "1";
    function setNovo(aberto: boolean) { setSearch(aberto ? {nova:"1"} : {}, {replace:true}); }
    const [descricao, setDescricao] = useState("");
    const [valor, setValor] = useState("");
    const [data, setData] = useState(hojeISO());
    const [tipo, setTipo] = useState<"entrada" | "saida">("saida");
    const [categoria, setCategoria] = useState("");
    const [pagamento, setPagamento] = useState("");
    const params = { ...periodo, tipo: filtro.tipo, limit: 100, ...(filtro.categoria === null ? { sem_categoria: true } : filtro.categoria ? { categoria_id: filtro.categoria } : {}), ...(filtro.pagamento === null ? { sem_pagamento: true } : filtro.pagamento ? { forma_pagamento: filtro.pagamento } : {}), ...(filtro.data_de ? { data_de: filtro.data_de } : {}), ...(filtro.data_ate ? { data_ate: filtro.data_ate } : {}) };
    const chave = JSON.stringify(params);
    useEffect(() => { let vivo = true; setCarregando(true); setErro(""); setRows([]); setSelecionados([]); setCursor(null); vault.transacoes.listar(JSON.parse(chave)).then(r => { if (vivo) {
        setRows(r.items);
        setCursor(r.next_cursor);
    } }).catch(e => { if (vivo)
        setErro(e.message); }).finally(() => { if (vivo)
        setCarregando(false); }); return () => { vivo = false; }; }, [chave, versao, recarregar]);
    async function mais() { if (!cursor)
        return; setOcupado(true); try {
        const r = await vault.transacoes.listar({ ...params, cursor });
        setRows(old => [...old, ...r.items]);
        setCursor(r.next_cursor);
    }
    catch (e) {
        setErro((e as Error).message);
    }
    finally {
        setOcupado(false);
    } }
    async function lote(acao: "conciliar" | "desconciliar" | "excluir") {
        if (acao === "excluir" && !window.confirm(`Excluir ${selecionados.length} lançamentos?`))
            return;
        setOcupado(true);
        setErro("");
        setFeedback("");
        try {
            const r = await financeiro.lote(selecionados, acao);
            if (r.erros.length)
                setErro(r.erros.map(e => `Linha ${e.linha}: ${e.erro}`).join("; "));
            setFeedback(`${r.aplicadas} operações aplicadas. ${r.erros.length ? "Nenhuma alteração foi gravada." : "Lote confirmado integralmente."}`);
            setVersao(v => v + 1);
            atualizar();
        }
        catch (e) {
            setErro(`${(e as Error).message} Atualize a lista antes de repetir.`);
        }
        finally {
            setOcupado(false);
        }
    }
    async function criar() { const cents = valorBR(valor); if (!cents) {
        setErro("Valor inválido. Use 1.234,56.");
        return;
    } setOcupado(true); setErro(""); try {
        await vault.transacoes.criar({ tipo, descricao, data, valor_centavos: cents, categoria_id: categoria || undefined, forma_pagamento: pagamento || undefined });
        setNovo(false);
        setDescricao("");
        setValor("");
        setVersao(v => v + 1);
        atualizar();
    }
    catch (e) {
        setErro((e as Error).message);
    }
    finally {
        setOcupado(false);
    } }
    return <section className="space-y-4">
    
    {novo && <form className="grid gap-3 rounded-xl border border-border p-4 sm:grid-cols-2" onSubmit={e => { e.preventDefault(); void criar(); }}><label>Descrição<input autoFocus required className="ecos-input w-full" value={descricao} onChange={e => setDescricao(e.target.value)}/></label><label>Valor (R$)<input required className="ecos-input w-full" value={valor} onChange={e => setValor(e.target.value)} placeholder="123,45"/></label><label>Data<input required className="ecos-input w-full" type="date" value={data} onChange={e => setData(e.target.value)}/></label><label>Tipo<select className="ecos-input w-full" value={tipo} onChange={e => setTipo(e.target.value as typeof tipo)}><option value="saida">Despesa</option><option value="entrada">Receita</option></select></label><label>Categoria<select className="ecos-input w-full" value={categoria} onChange={e => setCategoria(e.target.value)}><option value="">Sem categoria</option>{categorias.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}</select></label><label>Pagamento<select className="ecos-input w-full" value={pagamento} onChange={e => setPagamento(e.target.value)}><option value="">Não informado</option>{FORMAS_PAGAMENTO.map(f => <option key={f}>{f}</option>)}</select></label><button disabled={ocupado} className="ecos-input">Salvar transação</button><button type="button" disabled={ocupado} className="cofre-secondary" onClick={()=>setNovo(false)}>Cancelar</button></form>}
    {erro && <p role="alert" className="text-error">{erro}</p>}{feedback && <p role="status">{feedback}</p>}
    <div className="flex flex-wrap items-center gap-2 text-sm"><button disabled={ocupado || carregando} className="ecos-input" onClick={() => setVersao(v => v + 1)}>Atualizar</button>{rows.length > 0 && <button disabled={ocupado || carregando} className="ecos-input" onClick={() => setSelecionados(selecionados.length === rows.length ? [] : rows.slice(0, 1000).map(t => t.id))}>{selecionados.length === rows.length ? "Limpar seleção" : "Selecionar carregados (máx. 1.000)"}</button>}</div>
    {selecionados.length > 0 && <fieldset disabled={ocupado || carregando} className="ecos-fade-in flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface-1 px-3 py-2 text-sm"><span className="font-medium">{selecionados.length} {selecionados.length === 1 ? "selecionado" : "selecionados"}</span>{(["conciliar", "desconciliar", "excluir"] as const).map(a => <button key={a} className="ecos-input" onClick={() => void lote(a)}>{({conciliar:"Conciliar",desconciliar:"Desconciliar",excluir:"Excluir"})[a]}</button>)}<button className="cofre-secondary" onClick={() => setSelecionados([])}>Cancelar</button></fieldset>}
    {ocupado && <div role="status"><progress aria-label="Processando lote"/> Processando…</div>}
    {carregando ? <p role="status">Carregando lançamentos…</p> : !rows.length ? <p>Nenhum lançamento neste filtro.</p> : <ul className="space-y-2">{rows.map(t => <li key={t.id} className="flex items-center gap-3 rounded-xl bg-surface-1 p-3"><input disabled={ocupado} aria-label={`Selecionar ${t.descricao}`} type="checkbox" checked={selecionados.includes(t.id)} onChange={e => setSelecionados(old => e.target.checked ? [...old, t.id].slice(0, 1000) : old.filter(id => id !== t.id))}/><button onClick={() => abrir(t.id)} className="cofre-transaction-row"><span><span className="block font-medium">{t.descricao}</span><span className="text-xs text-text-muted">{t.data.split("-").reverse().join("/")} · {t.status === "pendente" ? "Pendente" : "Efetivada"}{t.conciliada ? " · Conciliada" : ""}</span></span><span className="cofre-transaction-value font-mono-value" data-tipo={t.tipo}>{t.tipo === "entrada" ? "+" : "−"}{formatMoeda(t.valor_centavos)}</span></button></li>)}</ul>}
    {cursor && <button disabled={ocupado} className="ecos-input" onClick={() => void mais()}>Carregar mais lançamentos</button>}
  </section>;
}
