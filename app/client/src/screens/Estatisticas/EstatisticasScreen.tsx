import { useEffect, useMemo, useState } from "react";
import { Activity, CheckCheck, FileText, ListChecks, RotateCw } from "lucide-react";
import { auth, type AtividadeResumo } from "@/lib/api";
import { mensagemDeErro } from "@/lib/erros";
import { useRefreshBus } from "@/lib/refresh-bus";

type Periodo = 30 | 90 | 365;
type Serie = "notas" | "tarefas" | "concluidas";
type Ponto = { rotulo: string; notas: number; tarefas: number; concluidas: number };

const SERIES: { id: Serie; nome: string; cor: string }[] = [
  { id: "notas", nome: "Notas criadas", cor: "#65a9c9" },
  { id: "tarefas", nome: "Tarefas criadas", cor: "#d4824e" },
  { id: "concluidas", nome: "Tarefas concluídas", cor: "#83af79" },
];

const numero = (n: number) => n.toLocaleString("pt-BR");

/** Em períodos longos, agrega dias em semanas ou meses para a linha continuar legível. */
export function agruparDias(dias: AtividadeResumo["dias"], periodo: Periodo): Ponto[] {
  const grupos = new Map<string, Ponto>();
  for (const dia of dias) {
    const data = new Date(`${dia.data}T12:00:00`);
    const inicio = new Date(data);
    if (periodo === 90) inicio.setDate(data.getDate() - ((data.getDay() + 6) % 7));
    const chave = periodo === 365 ? dia.data.slice(0, 7) : periodo === 90
      ? `${inicio.getFullYear()}-${String(inicio.getMonth() + 1).padStart(2, "0")}-${String(inicio.getDate()).padStart(2, "0")}`
      : dia.data;
    const rotulo = periodo === 365
      ? data.toLocaleDateString("pt-BR", { month: "short", year: "2-digit" })
      : inicio.toLocaleDateString("pt-BR", { day: "numeric", month: "short" });
    const ponto = grupos.get(chave) ?? { rotulo, notas: 0, tarefas: 0, concluidas: 0 };
    ponto.notas += dia.notas;
    ponto.tarefas += dia.tarefas;
    ponto.concluidas += dia.concluidas;
    grupos.set(chave, ponto);
  }
  return [...grupos.values()];
}

function GraficoLinhas({ pontos, visiveis }: { pontos: Ponto[]; visiveis: Serie[] }) {
  const maximo = Math.max(1, ...pontos.flatMap((p) => visiveis.map((s) => p[s])));
  const coordenadas = (serie: Serie) => pontos.map((p, i) => `${40 + (i * 620) / Math.max(1, pontos.length - 1)},${178 - (p[serie] / maximo) * 150}`).join(" ");
  const marcas = [0, Math.floor((pontos.length - 1) / 2), pontos.length - 1].filter((i, pos, a) => i >= 0 && a.indexOf(i) === pos);
  return <div className="overflow-x-auto" role="img" aria-label={`Gráfico de atividade. Máximo de ${maximo} itens por intervalo.`}>
    <svg viewBox="0 0 680 225" className="h-[225px] w-full min-w-[430px]" preserveAspectRatio="none" aria-hidden="true">
      {[0, 0.5, 1].map((f) => <g key={f}>
        <line x1="40" x2="660" y1={178 - f * 150} y2={178 - f * 150} stroke="currentColor" className="text-border" strokeDasharray="3 5" />
        <text x="32" y={182 - f * 150} textAnchor="end" className="fill-text-muted text-[11px]">{Math.round(maximo * f)}</text>
      </g>)}
      {visiveis.map((serie) => <polyline key={serie} points={coordenadas(serie)} fill="none" stroke={SERIES.find((s) => s.id === serie)?.cor} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />)}
      {marcas.map((i) => <text key={i} x={40 + (i * 620) / Math.max(1, pontos.length - 1)} y="210" textAnchor={i === 0 ? "start" : i === pontos.length - 1 ? "end" : "middle"} className="fill-text-muted text-[11px]">{pontos[i]?.rotulo}</text>)}
    </svg>
  </div>;
}

function Cartao({ icone: Icone, rotulo, valor, detalhe }: { icone: typeof Activity; rotulo: string; valor: number; detalhe: string }) {
  return <div className="rounded-2xl border border-border bg-surface-1 p-4">
    <div className="flex items-center gap-2 text-xs text-text-muted"><Icone size={16} aria-hidden />{rotulo}</div>
    <p className="mt-3 font-display text-3xl text-text-primary">{numero(valor)}</p>
    <p className="mt-1 text-xs text-text-muted">{detalhe}</p>
  </div>;
}

export function EstatisticasPerfil({ escopo }: { escopo: "geral" | "pessoal" | `equipe:${string}` }) {
  const { versao } = useRefreshBus();
  const [periodo, setPeriodo] = useState<Periodo>(30);
  const [dados, setDados] = useState<AtividadeResumo | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [tentativa, setTentativa] = useState(0);
  const [visiveis, setVisiveis] = useState<Serie[]>(["notas", "tarefas", "concluidas"]);

  useEffect(() => {
    let ativo = true;
    setDados(null);
    setErro(null);
    auth.atividade(periodo, escopo).then((resposta) => { if (ativo) setDados(resposta); })
      .catch((e) => { if (ativo) setErro(mensagemDeErro(e, "Não foi possível carregar as estatísticas.")); });
    return () => { ativo = false; };
  }, [periodo, escopo, tentativa, versao]);

  const pontos = useMemo(() => agruparDias(dados?.dias ?? [], periodo), [dados, periodo]);
  const total = (campo: Serie) => dados?.dias.reduce((soma, dia) => soma + dia[campo], 0) ?? 0;
  const totalTags = dados?.tags.reduce((soma, tag) => soma + tag.quantidade, 0) ?? 0;
  const maxTag = Math.max(1, ...(dados?.tags.map((tag) => tag.quantidade) ?? []));
  const alternarSerie = (serie: Serie) => setVisiveis((atual) => atual.includes(serie) ? atual.filter((s) => s !== serie) : [...atual, serie]);

  return <section className="mt-8 text-text-primary" aria-label="Estatísticas de uso">
    <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
      <div><p className="mb-1 text-xs font-semibold uppercase tracking-wide text-text-muted">Atividade</p><h2 className="font-display text-xl">Estatísticas de uso</h2><p className="mt-1 text-sm text-text-secondary">Criação de notas, andamento de tarefas e temas mais usados.</p></div>
      <div className="flex flex-wrap gap-2">
        <div className="flex rounded-xl border border-border bg-surface-1 p-1" aria-label="Período das estatísticas">
          {([30, 90, 365] as const).map((dias) => <button key={dias} type="button" onClick={() => setPeriodo(dias)} aria-pressed={periodo === dias} className={`rounded-lg px-3 py-1.5 text-sm ${periodo === dias ? "bg-surface-3 text-text-primary" : "text-text-muted hover:text-text-primary"}`}>{dias === 365 ? "1 ano" : `${dias} dias`}</button>)}
        </div>
      </div>
    </header>

    {erro && <div role="alert" className="mb-5 flex items-center justify-between gap-3 rounded-xl border border-error/40 bg-error/10 p-3 text-sm text-error"><span>{erro}</span><button type="button" onClick={() => setTentativa((n) => n + 1)} className="flex items-center gap-1 font-medium"><RotateCw size={14} />Tentar novamente</button></div>}
    {!dados && !erro && <p role="status" className="rounded-2xl border border-border bg-surface-1 p-8 text-center text-sm text-text-muted">Carregando estatísticas…</p>}
    {dados && <>
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cartao icone={FileText} rotulo="Notas criadas" valor={total("notas")} detalhe={`Nos últimos ${periodo} dias`} />
        <Cartao icone={ListChecks} rotulo="Tarefas criadas" valor={total("tarefas")} detalhe={`Nos últimos ${periodo} dias`} />
        <Cartao icone={CheckCheck} rotulo="Tarefas concluídas" valor={total("concluidas")} detalhe={`Nos últimos ${periodo} dias`} />
        <Cartao icone={Activity} rotulo="Tarefas pendentes" valor={dados.pendentes} detalhe="Total atual no escopo" />
      </div>
      <section className="rounded-2xl border border-border bg-surface-1 p-4 sm:p-5" aria-labelledby="titulo-atividade">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 id="titulo-atividade" className="font-display text-lg">Atividade ao longo do tempo</h2><p className="text-xs text-text-muted">{periodo === 30 ? "Por dia" : periodo === 90 ? "Por semana" : "Por mês"} · datas no fuso deste dispositivo</p></div>
          <div className="flex flex-wrap gap-2">{SERIES.map((s) => <button key={s.id} type="button" aria-pressed={visiveis.includes(s.id)} onClick={() => alternarSerie(s.id)} className={`flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs ${visiveis.includes(s.id) ? "bg-surface-3 text-text-primary" : "text-text-muted"}`}><span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.cor }} />{s.nome}</button>)}</div>
        </div>
        {total("notas") + total("tarefas") + total("concluidas") === 0 ? <p className="py-16 text-center text-sm text-text-muted">Ainda não há atividade neste período.</p> : <GraficoLinhas pontos={pontos} visiveis={visiveis} />}
      </section>
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <section className="rounded-2xl border border-border bg-surface-1 p-5" aria-labelledby="titulo-tarefas"><h2 id="titulo-tarefas" className="font-display text-lg">Situação das tarefas</h2><p className="mt-1 text-xs text-text-muted">Estado atual, considerando todo o histórico do escopo.</p>
          {dados.pendentes + dados.concluidas ? <><div className="mt-6 flex h-3 overflow-hidden rounded-full bg-surface-3"><div className="bg-[#83af79]" style={{ width: `${dados.concluidas / (dados.concluidas + dados.pendentes) * 100}%` }} /><div className="bg-[#d4824e]" style={{ flex: 1 }} /></div><div className="mt-4 flex justify-between gap-3 text-sm"><span>Concluídas <strong>{numero(dados.concluidas)}</strong></span><span>Pendentes <strong>{numero(dados.pendentes)}</strong></span></div></> : <p className="py-8 text-sm text-text-muted">Nenhuma tarefa ainda.</p>}
        </section>
        <section className="rounded-2xl border border-border bg-surface-1 p-5" aria-labelledby="titulo-tags"><h2 id="titulo-tags" className="font-display text-lg">Temas mais usados</h2><p className="mt-1 text-xs text-text-muted">Tags em notas e tarefas, considerando todo o histórico.</p>
          {dados.tags.length ? <div className="mt-5 space-y-3">{dados.tags.map((tag) => <div key={tag.nome}><div className="mb-1 flex justify-between gap-3 text-sm"><span className="truncate">#{tag.nome}</span><span className="font-mono-value text-text-muted">{numero(tag.quantidade)}</span></div><div className="h-1.5 rounded-full bg-surface-3"><div className="h-full rounded-full bg-[#65a9c9]" style={{ width: `${tag.quantidade / maxTag * 100}%` }} /></div></div>)}</div> : <p className="py-8 text-sm text-text-muted">Adicione tags para ver os temas aqui.</p>}
          {totalTags > 0 && <p className="mt-4 text-xs text-text-muted">Até 6 tags mais frequentes.</p>}
        </section>
      </div>
    </>}
  </section>;
}
