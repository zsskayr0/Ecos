import { useEffect, useRef, useState } from "react";
import { useAppUI } from "@/lib/ui-context";
import { financeiro, vault, type TransacaoApi } from "@/lib/api";
import { formatMoeda, hojeISO } from "@/lib/format";
import { valorBR } from "./csv";
import { buildMonthGrid, WEEKDAY_ABBR } from "./nexus/period";
import type { Ocorrencia, Pendencia } from "./types";
type Item = {
    key: string;
    id: string;
    kind: "transacao" | "pendencia" | "recorrencia";
    data: string;
    descricao: string;
    valor_centavos: number;
    tipo: string;
    status?: string;
};
export function VaultWorkflow({ atualizar, recarregar }: {
    atualizar: () => void;
    recarregar: number;
}) {
    const [diaAberto, setDiaAberto] = useState(hojeISO());
    const [modo, setModo] = useState("month");
    const [ancora, setAncora] = useState(hojeISO());
    const [items, setItems] = useState<Item[]>([]);
    const [escolhido, setEscolhido] = useState<Item | null>(null);
    const [destino, setDestino] = useState(hojeISO());
    const [erro, setErro] = useState("");
    const [ocupado, setOcupado] = useState(false);
    const [carregando, setCarregando] = useState(true);
    const [versao, setVersao] = useState(0);
    const [descricao, setDescricao] = useState("");
    const [valor, setValor] = useState("");
    const [tipo, setTipo] = useState<"entrada" | "saida">("saida");
    const operando = useRef(false);
    const { setDiaCofre } = useAppUI();
    useEffect(() => { setDiaCofre(diaAberto); }, [diaAberto, setDiaCofre]);
    const start = new Date(`${ancora}T12:00:00Z`);
    if (modo === "month")
        start.setUTCDate(1);
    if (modo === "week")
        start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
    const count = modo === "month" ? new Date(start.getUTCFullYear(), start.getUTCMonth() + 1, 0).getDate() : modo === "week" ? 7 : modo === "timeline" ? 45 : 15;
    const dias = Array.from({ length: count }, (_, i) => new Date(start.getTime() + i * 86400000).toISOString().slice(0, 10));
    const de = dias[0], ate = dias[dias.length - 1];
    useEffect(() => {
        let vivo = true;
        setCarregando(true);
        setErro("");
        setItems([]);
        setEscolhido(null);
        async function carregar() {
            try {
                const [pendencias, recorrencias] = await Promise.all([financeiro.pendencias.listar(), financeiro.ocorrencias({ data_de: de, data_ate: ate })]);
                const tx: TransacaoApi[] = [];
                let cursor: string | undefined;
                do {
                    const page = await vault.transacoes.listar({ data_de: de, data_ate: ate, limit: 200, cursor });
                    if (!vivo)
                        return;
                    tx.push(...page.items);
                    cursor = page.next_cursor ?? undefined;
                } while (cursor);
                if (vivo)
                    setItems([...tx.map(t => ({ ...t, key: `t:${t.id}`, kind: "transacao" as const })), ...pendencias.map((p: Pendencia) => ({ ...p, key: `p:${p.id}`, data: "", kind: "pendencia" as const })), ...recorrencias.map((r: Ocorrencia) => ({ ...r, id: r.recorrencia_id, key: `r:${r.recorrencia_id}:${r.data}`, kind: "recorrencia" as const }))]);
            }
            catch (e) {
                if (vivo)
                    setErro((e as Error).message);
            }
            finally {
                if (vivo)
                    setCarregando(false);
            }
        }
        void carregar();
        return () => { vivo = false; };
    }, [de, ate, versao, recarregar]);
    async function mover(item: Item, date: string) {
        if (operando.current || !date)
            return;
        operando.current = true;
        setOcupado(true);
        setErro("");
        const antes = items;
        setItems(old => old.map(i => i.key === item.key ? { ...i, data: date } : i));
        try {
            if (item.kind === "pendencia")
                await financeiro.pendencias.converter(item.id, date);
            else if (item.kind === "recorrencia")
                await financeiro.concluir(item.id, item.data, date);
            else
                await financeiro.reagendar(item.id, date);
            setEscolhido(null);
            setVersao(v => v + 1);
            atualizar();
        }
        catch (e) {
            setItems(antes);
            setErro(`${(e as Error).message} A visualização foi restaurada. Atualize para confirmar o estado no servidor; repetir a operação não duplica pendências ou recorrências.`);
        }
        finally {
            operando.current = false;
            setOcupado(false);
        }
    }
    async function criar() { const cents = valorBR(valor); if (!cents || !descricao.trim()) {
        setErro("Informe descrição e valor brasileiro válido.");
        return;
    } setOcupado(true); try {
        await financeiro.pendencias.criar({ tipo, descricao, valor_centavos: cents });
        setDescricao("");
        setValor("");
        setVersao(v => v + 1);
    }
    catch (e) {
        setErro((e as Error).message);
    }
    finally {
        setOcupado(false);
    } }
    async function concluirLancamento(item: Item) {
        if (operando.current) return;
        operando.current=true; setOcupado(true);setErro("");
        const antes=items;
        setItems(old=>old.map(i=>i.key===item.key?{...i,status:"efetivada"}:i));
        try {
            const r=await financeiro.lote([item.id],"efetivar");
            if (r.erros.length) throw new Error(r.erros[0].erro);
            setVersao(v=>v+1);atualizar();
        } catch(e) {setItems(antes);setErro((e as Error).message);}
        finally {operando.current=false;setOcupado(false);}
    }
    async function excluir(item: Item) { setOcupado(true); try {
        await financeiro.pendencias.excluir(item.id);
        setVersao(v => v + 1);
    }
    catch (e) {
        setErro((e as Error).message);
    }
    finally {
        setOcupado(false);
    } }
    function card(item: Item) { return <div key={item.key} draggable={!ocupado} onDragStart={e => { e.dataTransfer.setData("text/plain", item.key); setEscolhido(item); }} className="rounded-lg border border-border bg-surface-2 p-2 text-sm"><button disabled={ocupado} aria-pressed={escolhido?.key === item.key} onClick={() => { setEscolhido(item); setDestino(item.data || hojeISO()); }} className="w-full text-left"><span className="block font-medium">{item.descricao}</span><span className="font-mono-value">{item.tipo === "entrada" ? "+" : "−"}{formatMoeda(item.valor_centavos)}</span><span className="block text-xs text-text-muted">{item.kind === "recorrencia" ? "Ocorrência prevista" : item.kind === "pendencia" ? "Sem data" : "Lançamento"} · selecionar para agendar</span></button>{item.kind === "transacao" && item.status === "pendente" && <button disabled={ocupado} className="mt-2 text-xs underline" onClick={()=>void concluirLancamento(item)}>Concluir lançamento</button>}{item.kind === "pendencia" && <button disabled={ocupado} className="mt-2 text-xs text-error" onClick={() => void excluir(item)}>Excluir pendência</button>}</div>; }
    function avancar(dir: number) { const d = new Date(`${ancora}T12:00:00Z`); if (modo === "month") {
        d.setUTCDate(1);
        d.setUTCMonth(d.getUTCMonth() + dir);
    }
    else
        d.setUTCDate(d.getUTCDate() + count * dir); setAncora(d.toISOString().slice(0, 10)); }
    return <section className="space-y-4">
    <h2 className="font-display text-xl">Fluxo financeiro</h2>
    <fieldset disabled={ocupado} className="cofre-flow-toolbar"><label className="sr-only" htmlFor="fluxo-visao">Visão</label><select id="fluxo-visao" className="ecos-input" value={modo} onChange={e => setModo(e.target.value)}><option value="timeline">Timeline</option><option value="month">Mês</option><option value="week">Semana</option><option value="fortnight">Quinzena</option></select><button className="ecos-input" aria-label="Período anterior" onClick={() => avancar(-1)}>‹</button><label className="sr-only" htmlFor="fluxo-data">Data de referência</label><input id="fluxo-data" className="ecos-input" type="date" value={ancora} onChange={e => {if(e.target.value){setAncora(e.target.value);setDiaAberto(e.target.value);}}}/><button className="ecos-input" aria-label="Próximo período" onClick={() => avancar(1)}>›</button><button className="ecos-input" onClick={() => {setAncora(hojeISO());setDiaAberto(hojeISO());}}>Hoje</button><button className="ecos-input" onClick={() => setVersao(v => v + 1)}>Atualizar</button></fieldset>
    {erro && <p role="alert" className="text-error">{erro}</p>}
    {ocupado && <p role="status">Salvando alteração…</p>}
    {escolhido && <div className="flex flex-wrap items-center gap-3 rounded-xl border border-violet p-3"><p>Agendar: {escolhido.descricao}</p><label>Data <input className="ecos-input" type="date" value={destino} onChange={e => setDestino(e.target.value)}/></label><button disabled={ocupado || !destino} className="ecos-input" onClick={() => void mover(escolhido, destino)}>{escolhido.kind === "transacao" ? "Reagendar" : "Concluir na data"}</button><button onClick={() => setEscolhido(null)}>Cancelar</button></div>}
    <div className="cofre-flow-layout">
      <aside className="space-y-3 rounded-2xl bg-surface-1 p-3"><h3 className="font-semibold">Pendências sem data</h3><details><summary className="cofre-new-pending">Nova pendência</summary><form onSubmit={e => { e.preventDefault(); void criar(); }} className="space-y-2"><input className="ecos-input w-full" aria-label="Descrição da pendência" placeholder="Descrição" value={descricao} onChange={e => setDescricao(e.target.value)} required/><input className="ecos-input w-full" aria-label="Valor da pendência em reais" placeholder="Valor: 123,45" value={valor} onChange={e => setValor(e.target.value)} required/><select className="ecos-input w-full" aria-label="Tipo da pendência" value={tipo} onChange={e => setTipo(e.target.value as typeof tipo)}><option value="saida">Despesa</option><option value="entrada">Receita</option></select><button className="ecos-input" disabled={ocupado}>Criar pendência</button></form></details>{items.filter(i => !i.data).map(card)}</aside>
      <div className="cofre-flow-board">{carregando ? <p role="status">Carregando fluxo…</p> : <>
        <p className="cofre-flow-hint">Selecione um item para agendar por data ou arraste para um dia. Toque no dia para consultar seus lançamentos.</p>
        {modo === "month" && <div className="cofre-month-weekdays">{WEEKDAY_ABBR.map((d,i)=><span key={i}>{d}</span>)}</div>}
        <div className={modo === "month" ? "cofre-month-grid" : "cofre-agenda-columns"}>
          {(modo === "month" ? buildMonthGrid(start.getUTCFullYear(),start.getUTCMonth()+1) : dias.map(iso=>({iso,day:Number(iso.slice(8)),inMonth:true}))).map(cell => {
            const d=cell.iso, agendados=items.filter(i=>i.data===d);
            return <section key={d} data-outside={!cell.inMonth} data-today={d===hojeISO()} data-selected={d===diaAberto} onDragOver={e=>{if(cell.inMonth)e.preventDefault();}} onDrop={e=>{e.preventDefault();if(!cell.inMonth)return;const item=items.find(i=>i.key===e.dataTransfer.getData("text/plain"));if(item)void mover(item,d);}}>
              <button disabled={!cell.inMonth || ocupado} className="cofre-day-button" aria-label={escolhido ? `Agendar selecionado em ${d}` : `Ver ${d}: ${agendados.length} itens`} aria-pressed={d===diaAberto} onClick={()=>{setDiaAberto(d);if(escolhido)void mover(escolhido,d);}}><span>{cell.day}</span>{modo !== "month" && <small>{new Date(`${d}T12:00:00Z`).toLocaleDateString("pt-BR",{weekday:"short",month:"short",timeZone:"UTC"})}</small>}{agendados.length>0 && <i aria-hidden="true">{agendados.length}</i>}</button>
              <div className="cofre-day-items">{agendados.slice(0,modo === "month" ? 2 : undefined).map(card)}{modo === "month" && agendados.length>2 && <button onClick={()=>setDiaAberto(d)}>+{agendados.length-2} mais</button>}</div>
            </section>;
          })}
        </div>
        {modo === "month" && <section className="cofre-day-detail"><h3>{diaAberto.split("-").reverse().join("/")}</h3>{items.filter(i=>i.data===diaAberto).length ? items.filter(i=>i.data===diaAberto).map(card) : <p>Nenhum lançamento neste dia.</p>}</section>}
      </>}</div>
    </div>
  </section>;
}
