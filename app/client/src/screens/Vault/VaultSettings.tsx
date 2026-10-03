import { SeletorEcos } from "@/components/common/SeletorEcos";
import { useEffect, useState } from "react";
import { useAutoriaDoCofre } from "@/lib/use-autoria-cofre";
import { financeiro, vault, type ContaApi, type CategoriaApi } from "@/lib/api";
import { hojeISO, formatMoeda } from "@/lib/format";
import { valorBR } from "./csv";
type Recorrencia = Awaited<ReturnType<typeof financeiro.recorrencias>>[number];
export function VaultSettings({ atualizar, semTitulo = false }: {
    atualizar: () => void;
    /** Dentro do painel flutuante o título já está no cabeçalho do painel. */
    semTitulo?: boolean;
}) {
    const autoria = useAutoriaDoCofre();
    const [contas, setContas] = useState<ContaApi[]>([]);
    const [categorias, setCategorias] = useState<CategoriaApi[]>([]);
    const [recorrencias, setRecorrencias] = useState<Recorrencia[]>([]);
    const [secao, setSecao] = useState("categoria");
    const [nome, setNome] = useState("");
    const [tipo, setTipo] = useState("saida");
    const [valor, setValor] = useState("");
    const [data, setData] = useState(hojeISO());
    const [frequencia, setFrequencia] = useState("mensal");
    const [parcelas, setParcelas] = useState("");
    const [erro, setErro] = useState("");
    const [ocupado, setOcupado] = useState(false);
    const [versao, setVersao] = useState(0);
    useEffect(() => { let vivo = true; Promise.all([vault.contas.listar(), vault.categorias.listar(), financeiro.recorrencias()]).then(([cts, cats, recs]) => { if (vivo) {
        setContas(cts);
        setCategorias(cats);
        setRecorrencias(recs);
    } }).catch(e => { if (vivo)
        setErro(e.message); }); return () => { vivo = false; }; }, [versao]);
    async function salvar() { setOcupado(true); setErro(""); try {
        if (secao === "conta")
            await vault.contas.criar({ nome });
        else if (secao === "categoria")
            await vault.categorias.criar({ nome, tipo });
        else {
            const cents = valorBR(valor);
            if (!cents)
                throw new Error("Valor inválido.");
            await financeiro.criarRecorrencia({ descricao: nome, tipo: tipo as "entrada" | "saida", valor_centavos: cents, data_inicio: data, frequencia: frequencia as "semanal" | "mensal" | "anual", intervalo: 1, tipo_recorrencia: parcelas ? "parcelada" : "fixa", total_parcelas: parcelas ? Number(parcelas) : undefined });
        }
        setNome("");
        setVersao(v => v + 1);
        atualizar();
    }
    catch (e) {
        setErro((e as Error).message);
    }
    finally {
        setOcupado(false);
    } }
    return <section className="space-y-5">{!semTitulo&&<><h2 className="font-display text-xl">Configurações do Cofre</h2><p className="text-sm text-text-secondary">Organize suas contas, categorias e compromissos recorrentes.</p></>}
    {erro && <p role="alert" className="text-error">{erro}</p>}
    <form className="grid gap-3 rounded-2xl bg-surface-1 p-4 sm:grid-cols-2" onSubmit={e => { e.preventDefault(); void salvar(); }}><label>Cadastrar<SeletorEcos ariaLabel="Seção" classe="ecos-input w-full" valor={secao} onChange={setSecao} opcoes={[{ valor: "categoria", rotulo: "Categoria" }, { valor: "conta", rotulo: "Conta" }, { valor: "recorrencia", rotulo: "Recorrência" }]} /></label><label>Nome / descrição<input required className="ecos-input w-full" value={nome} onChange={e => setNome(e.target.value)}/></label>{secao !== "conta" && <label>Tipo<SeletorEcos ariaLabel="Tipo" classe="ecos-input w-full" valor={tipo} onChange={setTipo} opcoes={[{ valor: "saida", rotulo: "Despesa" }, { valor: "entrada", rotulo: "Receita" }]} /></label>}{secao === "recorrencia" && <><label>Valor (R$)<input required className="ecos-input w-full" value={valor} onChange={e => setValor(e.target.value)}/></label><label>Início<input required className="ecos-input w-full" type="date" value={data} onChange={e => setData(e.target.value)}/></label><label>Frequência<SeletorEcos ariaLabel="Frequência" classe="ecos-input w-full" valor={frequencia} onChange={setFrequencia} opcoes={[{ valor: "mensal", rotulo: "Mensal" }, { valor: "semanal", rotulo: "Semanal" }, { valor: "anual", rotulo: "Anual" }]} /></label><label>Parcelas (vazio: fixa)<input className="ecos-input w-full" type="number" min="1" max="1200" value={parcelas} onChange={e => setParcelas(e.target.value)}/></label></>}<button disabled={ocupado} className="ecos-input">{ocupado ? "Salvando…" : "Cadastrar"}</button></form>
    <div className="grid gap-4 lg:grid-cols-3"><section className="cofre-settings-card"><h3 className="font-semibold">Contas</h3><ul>{contas.map(c => <li key={c.id} className="py-2">{c.nome}{autoria.nomeDe(c.criado_por) && <span className="text-xs text-text-muted"> · por {autoria.nomeDe(c.criado_por)}</span>}</li>)}</ul></section><section className="cofre-settings-card"><h3 className="font-semibold">Categorias</h3><ul>{categorias.map(c => <li key={c.id} className="py-2">{c.nome} · {c.tipo === "entrada" ? "Receita" : "Despesa"}{autoria.nomeDe(c.criado_por) && <span className="text-xs text-text-muted"> · por {autoria.nomeDe(c.criado_por)}</span>}</li>)}</ul></section><section className="cofre-settings-card"><h3 className="font-semibold">Recorrências</h3><ul>{recorrencias.map(r => <li key={r.id} className="py-2"><p>{r.descricao} · {formatMoeda(r.valor_centavos)}</p><p className="text-xs text-text-muted">{r.frequencia} · {r.ativa ? "Ativa" : "Inativa"}</p></li>)}</ul></section></div>
  </section>;
}
