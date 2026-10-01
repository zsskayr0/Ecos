import { ArrowDownLeft, ArrowUpRight, Wallet, TrendingUp, ArrowRight } from "lucide-react";
import { KpiCard } from "./nexus/KpiCard";
import { ComposedAreaChart } from "./nexus/ComposedAreaChart";
import { DonutChart } from "./nexus/DonutChart";
import { HorizontalBarChart } from "./nexus/HorizontalBarChart";
import { useState } from "react";
import { formatMoeda } from "@/lib/format";
import type { CategoriaApi } from "@/lib/api";
import type { Painel, Periodo } from "./types";
export type Filtro = {
    tipo?: "entrada" | "saida";
    categoria?: string | null;
    pagamento?: string | null;
    data_de?: string;
    data_ate?: string;
};
export function VaultDashboard({ painel: p, categorias, periodo, drill, abrir, onFluxo }: {
    painel: Painel;
    categorias: CategoriaApi[];
    periodo: Periodo;
    drill: (f: Filtro) => void;
    abrir: (id: string) => void;
    onFluxo?: () => void;
}) {
    const [previsao, setPrevisao] = useState(false);
    const pontos = new Map<string, {
        data: string;
        receitas: number;
        despesas: number;
        prevReceitas: number;
        prevDespesas: number;
    }>();
    const cursor = new Date(`${periodo.data_de}T12:00:00Z`);
    const fim = new Date(`${periodo.data_ate}T12:00:00Z`);
    while (cursor <= fim) {
        const iso = cursor.toISOString().slice(0, p.mensal ? 7 : 10);
        pontos.set(iso, { data: iso, receitas: 0, despesas: 0, prevReceitas: 0, prevDespesas: 0 });
        cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    for (const s of p.series)
        pontos.set(s.data, { data: s.data, receitas: s.receitas_confirmadas, despesas: s.despesas_confirmadas, prevReceitas: s.receitas - s.receitas_confirmadas, prevDespesas: s.despesas - s.despesas_confirmadas });
    for (const o of p.previsoes) {
        const point = pontos.get(o.data.slice(0, p.mensal ? 7 : 10));
        if (point) {
            if (o.tipo === "entrada")
                point.prevReceitas += o.valor_centavos;
            else
                point.prevDespesas += o.valor_centavos;
        }
    }
    const series = [...pontos.values()];
    const cores = ["var(--cofre-income)", "var(--cofre-expense)"];

    const faixa = (data: string): Periodo => data.length === 7 ? { data_de: `${data}-01` < periodo.data_de ? periodo.data_de : `${data}-01`, data_ate: new Date(Number(data.slice(0, 4)), Number(data.slice(5, 7)), 0, 12).toLocaleDateString("sv-SE") } : { data_de: data, data_ate: data };
    function abrirData(data: string) {
        const faixaSelecionada = faixa(data);
        drill({...faixaSelecionada, data_ate: faixaSelecionada.data_ate > periodo.data_ate ? periodo.data_ate : faixaSelecionada.data_ate});
    }
    const points = series.map(s => ({
        label: p.mensal ? new Date(`${s.data}-01T12:00:00`).toLocaleDateString("pt-BR",{month:"short",year:"2-digit"}) : s.data.slice(8),
        incomeConfirmedCents:s.receitas, expenseConfirmedCents:s.despesas,
        incomeForecastCents:previsao?s.prevReceitas:0, expenseForecastCents:previsao?s.prevDespesas:0,
    }));
    const palette=["#38bdf8","#a78bfa","#f59e0b","#34d399","#f472b6","#fb923c","#60a5fa","#2dd4bf"];
    const segments=p.categorias.map((g,i)=>({label:categorias.find(c=>c.id===g.chave)?.nome??"Sem categoria",valueCents:g.valor,color:categorias.find(c=>c.id===g.chave)?.cor??palette[i%palette.length]}));
    const pagamentos:Record<string,string>={pix:"Pix",pix_automatico:"Pix automático",ted:"Transferência",cartao:"Cartão",dinheiro:"Dinheiro",boleto:"Boleto",outro:"Outro"};
    return <div className="cofre-dashboard">
        <div className="cofre-kpis">
            <KpiCard label="Saldo total (histórico)" value={formatMoeda(p.saldo)} icon={<Wallet size={14}/>}/>
            <KpiCard label="Receitas do período" value={formatMoeda(p.receitas)} icon={<ArrowUpRight size={14}/>} tone="income"/>
            <KpiCard label="Despesas do período" value={formatMoeda(p.despesas)} icon={<ArrowDownLeft size={14}/>} tone="expense"/>
            <KpiCard label="Taxa de economia" value={p.taxa_economia===null?"—":`${p.taxa_economia.toLocaleString("pt-BR",{maximumFractionDigits:1,minimumFractionDigits:1})}%`} icon={<TrendingUp size={14}/>}/>
        </div>
        <div className="cofre-chart-toolbar"><h2>Seu período em gráficos</h2></div>
        <div className="cofre-hero-grid">
            <section className="cofre-card cofre-chart-card"><div className="cofre-card-heading"><h3>Receitas × despesas</h3><div className="cofre-chart-actions"><div className="cofre-legend"><span><i style={{background:cores[0]}}/>Receitas</span><span><i style={{background:cores[1]}}/>Despesas</span></div><button className="cofre-forecast" aria-label="Incluir previsões" aria-pressed={previsao} onClick={()=>setPrevisao(v=>!v)}>Previsões {previsao?"ligadas":"desligadas"}</button></div></div>
                <ComposedAreaChart points={points} incomeColor={cores[0]} expenseColor={cores[1]} onSelect={i=>abrirData(series[i].data)}/>
                <p className="cofre-chart-caption">Confirmado: lançamentos efetivados (ou conciliados). Previsão: pendentes e recorrências.</p>
            </section>
            <section className="cofre-card cofre-chart-card"><div className="cofre-card-heading"><h3>Próximas ocorrências</h3><span className="cofre-count">{p.previsoes.length}</span></div><div className="cofre-upcoming">{p.previsoes.length?p.previsoes.slice(0,6).map(o=><button key={`${o.recorrencia_id}:${o.data}`} onClick={onFluxo}><span className="cofre-date-tile">{o.data.slice(8)}<small>{new Date(`${o.data}T12:00:00`).toLocaleDateString("pt-BR",{month:"short"})}</small></span><span><b>{o.descricao}</b><small>{o.tipo==="entrada"?"A receber":"A pagar"}</small></span><strong>{formatMoeda(o.valor_centavos)}</strong></button>):<div className="cofre-chart-empty"><TrendingUp size={25}/><span>Nenhuma ocorrência prevista</span><small>Cadastre recorrências nas configurações ou acompanhe o fluxo financeiro.</small></div>}</div></section>
        </div>
        <div className="cofre-charts-grid">
            <section className="cofre-card cofre-chart-card"><div className="cofre-card-heading"><h3>Gastos por categoria</h3><span className="cofre-caption">{formatMoeda(p.despesas)}</span></div><DonutChart segments={segments} onSelect={i=>drill({categoria:p.categorias[i].chave,tipo:"saida"})}/></section>
            <section className="cofre-card cofre-chart-card"><div className="cofre-card-heading"><h3>Formas de pagamento</h3></div><HorizontalBarChart items={p.pagamentos.map(g=>({label:pagamentos[g.chave??""]??"Não informado",valueCents:g.valor}))} color={cores[1]} onSelect={i=>drill({pagamento:p.pagamentos[i].chave,tipo:"saida"})}/></section>
            <section className="cofre-card cofre-chart-card"><div className="cofre-card-heading"><h3>Maiores despesas</h3><ArrowDownLeft size={16}/></div><HorizontalBarChart items={p.maiores_saidas.map(t=>({label:t.descricao,valueCents:t.valor}))} color={cores[1]} onSelect={i=>abrir(p.maiores_saidas[i].id)}/></section>
            <section className="cofre-card cofre-chart-card"><div className="cofre-card-heading"><h3>Maiores receitas</h3><ArrowUpRight size={16}/></div><HorizontalBarChart items={p.maiores_entradas.map(t=>({label:t.descricao,valueCents:t.valor}))} color={cores[0]} onSelect={i=>abrir(p.maiores_entradas[i].id)}/></section>
        </div>
        <button className="cofre-link" onClick={()=>drill({})}>Ver lançamentos do período <ArrowRight size={15}/></button>
    </div>;
}
