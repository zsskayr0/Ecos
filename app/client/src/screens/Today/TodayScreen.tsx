import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarCheck2, CalendarClock, Check, Clock, Flag, TimerReset } from "lucide-react";
import { agenda as agendaApi, rotina as rotinaApi, tarefas, ApiError, type BlocoPlanejado, type TarefaResumo } from "@/lib/api";
import { dataLocalISO, diaEMinutosLocais, duracaoParaAlocar, instanteLocalISO, rotuloHorario, somarDiasISO } from "@/lib/agenda-tempo";
import { montarPlanejamento, proximoHorarioLivre, type ItemDoDia } from "@/lib/planejamento-dia";
import { useEventosLocais } from "@/lib/eventos-locais";
import { EmptyState } from "@/components/common/EmptyState";
import { useAppUI } from "@/lib/ui-context";
import { useRefreshBus } from "@/lib/refresh-bus";

type Capacidade = Awaited<ReturnType<typeof tarefas.capacidade>>;
const fmtDuracao = (min: number) => (min >= 60 ? `${Math.floor(min / 60)}h${min % 60 ? ` ${min % 60}min` : ""}` : `${min}min`);
const fmtDia = (iso: string) => iso.split("-").reverse().slice(0, 2).join("/");

/**
 * Planejamento do dia: junta o que já tem horário (tarefas agendadas, eventos, tempo alocado), os prazos de hoje, o que
 * ficou atrasado e a capacidade da rotina — e deixa concluir, reagendar e encaixar tempo sem sair da tela.
 * Tudo grava pelo mesmo caminho da Agenda e avisa o `RefreshBus`, então os dois refletem na hora.
 */
export function TodayScreen() {
  const { filtroEquipeId, espacoAtivo, intercalarEquipes } = useAppUI();
  const { versao, notificar } = useRefreshBus();
  const [eventos] = useEventosLocais();
  const [lista, setLista] = useState<TarefaResumo[] | null>(null);
  const [blocos, setBlocos] = useState<BlocoPlanejado[]>([]);
  const [capacidade, setCapacidade] = useState<Capacidade | null>(null);
  const [temRotina, setTemRotina] = useState<boolean | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [reagendando, setReagendando] = useState<string | null>(null);
  const hoje = dataLocalISO(new Date());

  useEffect(() => {
    let ativo = true;
    setErro(null);
    const tz = -new Date().getTimezoneOffset();
    const espaco = intercalarEquipes ? (filtroEquipeId ? `equipe:${filtroEquipeId}` : undefined) : espacoAtivo;
    const base = { status: "pendente" as const, espaco, tz, limit: 200 };
    Promise.all([
      tarefas.listar({ ...base, data_de: hoje, data_ate: hoje }),
      tarefas.listar({ ...base, data_de: somarDiasISO(hoje, -365), data_ate: somarDiasISO(hoje, -1) }),
    ]).then(([doDia, atrasadas]) => {
      if (!ativo) return;
      const vistos = new Set<string>();
      setLista([...atrasadas.items, ...doDia.items].filter((t) => !vistos.has(t.id) && !!vistos.add(t.id)));
    }).catch((e) => { if (ativo) { setErro(e instanceof ApiError ? e.message : "Não foi possível carregar o dia."); setLista([]); } });
    // Blocos, capacidade e rotina são complementos: se falharem o dia continua utilizável.
    agendaApi.blocos({ data_de: hoje, data_ate: hoje, tz }).then((b) => { if (ativo) setBlocos(b); }).catch(() => { if (ativo) setBlocos([]); });
    tarefas.capacidade(hoje, tz).then((c) => { if (ativo) setCapacidade(c); }).catch(() => { if (ativo) setCapacidade(null); });
    rotinaApi.listar().then((b) => { if (ativo) setTemRotina(b.length > 0); }).catch(() => { if (ativo) setTemRotina(null); });
    return () => { ativo = false; };
  }, [filtroEquipeId, espacoAtivo, intercalarEquipes, hoje, versao]);

  const plano = useMemo(() => montarPlanejamento({ hoje, tarefas: lista ?? [], blocos, eventos }), [hoje, lista, blocos, eventos]);

  const executar = async (acao: () => Promise<unknown>, falha: string) => {
    setAviso(null);
    try { await acao(); } catch (e) { setAviso(e instanceof ApiError ? e.message : falha); }
    notificar(); // em caso de falha o refetch desfaz a atualização otimista
  };
  const concluir = (t: TarefaResumo) => {
    setLista((atual) => atual && atual.filter((x) => x.id !== t.id)); // some na hora
    return executar(() => tarefas.atualizarStatus(t.id, "concluida"), "Não foi possível concluir a tarefa.");
  };
  const reagendar = (t: TarefaResumo, dia: string) => {
    setReagendando(null);
    const payload: { due_date?: string; scheduled_at?: string } = {};
    if (t.scheduled_at) payload.scheduled_at = instanteLocalISO(dia, diaEMinutosLocais(t.scheduled_at).minutos);
    if (t.due_date || !t.scheduled_at) payload.due_date = dia;
    return executar(() => tarefas.atualizar(t.id, payload), "Não foi possível reagendar a tarefa.");
  };
  const encaixar = (t: TarefaResumo) => {
    const duracao = duracaoParaAlocar(t.duration_min);
    const agora = new Date();
    const ocupados = plano.cronograma.filter((i) => i.inicioMin !== null).map((i) => ({ inicioMin: i.inicioMin as number, duracaoMin: i.duracaoMin }));
    const inicio = proximoHorarioLivre(ocupados, agora.getHours() * 60 + agora.getMinutes(), duracao);
    if (inicio === null) { setAviso("Não há um intervalo livre hoje para encaixar essa tarefa."); return; }
    return executar(() => tarefas.timeEntries.criar(t.id, { tipo: "planejado", inicio_em: instanteLocalISO(hoje, inicio), duracao_min: duracao }), "Não foi possível encaixar o tempo.");
  };

  const botao = "flex h-8 w-8 items-center justify-center rounded-lg text-text-muted hover:bg-surface-2";
  const linha = (item: ItemDoDia) => {
    const t = item.tarefa;
    const alta = t?.prioridade === "alta";
    const borda = alta ? "border-l-error" : item.tipo === "evento" ? "border-l-steel-500" : item.tipo === "bloco" ? "border-l-cyan" : "border-l-border";
    const quando = item.inicioMin === null
      ? (item.desde ? `desde ${fmtDia(item.desde)}` : item.tipo === "prazo" ? "Prazo" : "Dia todo")
      : `${rotuloHorario(item.inicioMin)}–${rotuloHorario(item.inicioMin + item.duracaoMin)}`;
    return <li key={item.chave} data-item-dia={item.chave} className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-l-4 border-border bg-surface-1 px-3 py-2 ${borda}`}>
      <span className="w-24 shrink-0 text-xs tabular-nums text-text-muted">{quando}</span>
      <span className="min-w-0 flex-1 text-sm text-text-primary">{item.titulo}
        {item.tipo === "evento" && <span className="ml-2 text-[10px] uppercase tracking-wide text-text-muted">Evento</span>}
        {item.tipo === "bloco" && <span className="ml-2 text-[10px] uppercase tracking-wide text-text-muted">Tempo alocado</span>}
        {item.comPrazo && <span className="ml-2 rounded bg-warning/15 px-1.5 py-0.5 text-[10px] font-semibold text-warning">Prazo hoje</span>}
        {alta && <span className="ml-2 rounded bg-error/15 px-1.5 py-0.5 text-[10px] font-semibold text-error">ALTA</span>}
      </span>
      {t && <span className="flex items-center gap-1">
        <button type="button" aria-label={`Concluir ${item.titulo}`} title="Concluir" onClick={() => concluir(t)} className={`${botao} hover:text-success`}><Check size={16} /></button>
        <button type="button" aria-label={`Reagendar ${item.titulo}`} title="Reagendar" aria-expanded={reagendando === t.id} onClick={() => setReagendando(reagendando === t.id ? null : t.id)} className={`${botao} hover:text-text-primary`}><CalendarClock size={16} /></button>
        <button type="button" aria-label={`Encaixar tempo para ${item.titulo}`} title="Encaixar tempo hoje" onClick={() => encaixar(t)} className={`${botao} hover:text-cyan`}><TimerReset size={16} /></button>
      </span>}
      {t && reagendando === t.id && <div role="group" aria-label={`Reagendar ${item.titulo}`} className="flex w-full flex-wrap items-center gap-2 pt-1 text-xs">
        <button type="button" onClick={() => reagendar(t, hoje)} className="rounded-lg border border-border px-2 py-1 hover:bg-surface-2">Hoje</button>
        <button type="button" onClick={() => reagendar(t, somarDiasISO(hoje, 1))} className="rounded-lg border border-border px-2 py-1 hover:bg-surface-2">Amanhã</button>
        <button type="button" onClick={() => reagendar(t, somarDiasISO(hoje, 7))} className="rounded-lg border border-border px-2 py-1 hover:bg-surface-2">Em 7 dias</button>
        <input type="date" aria-label="Outra data" min={hoje} onChange={(e) => e.target.value && reagendar(t, e.target.value)} className="rounded-lg border border-border bg-surface-1 px-2 py-1" />
      </div>}
    </li>;
  };

  const grupo = (id: string, titulo: string, itens: ItemDoDia[], destaque = false) => itens.length === 0 ? null : (
    <section key={id} aria-labelledby={`grupo-${id}`} data-grupo={id}>
      <h2 id={`grupo-${id}`} className={`mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide ${destaque ? "text-error" : "text-text-muted"}`}>{destaque && <Flag size={12} />}{titulo}<span className="font-normal">({itens.length})</span></h2>
      <ul className="flex flex-col gap-2">{itens.map(linha)}</ul>
    </section>
  );

  const livre = capacidade ? (capacidade.disponivel_producao_total_min ?? capacidade.disponivel_producao_min) : null;
  const carregando = lista === null;
  return <div className="px-4 pt-1">
    <header className="mb-4 flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-steel-700/20 text-steel-300"><CalendarCheck2 size={21} /></span><div><h1 className="font-display text-2xl text-text-primary">Hoje</h1><p className="text-sm text-text-secondary">{carregando ? "Carregando o dia…" : `${plano.total} ${plano.total === 1 ? "item" : "itens"} no planejamento`}</p></div></header>
    {capacidade && temRotina !== false && <div data-capacidade className={`mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border px-3 py-2 text-sm ${capacidade.estourado ? "border-error/40 bg-error/10 text-error" : "border-border bg-surface-1 text-text-secondary"}`}>
      <Clock size={14} /><span>Livre para produzir: <strong className="text-text-primary">{fmtDuracao(Math.max(0, livre ?? 0))}</strong></span>
      <span>Planejado: <strong className="text-text-primary">{fmtDuracao(capacidade.consumido_tarefas_min)}</strong></span>
      {capacidade.estourado && <span>O dia está acima da sua capacidade.</span>}
    </div>}
    {erro && <div role="alert" className="mb-4 flex items-start gap-2 rounded-2xl border border-error/40 bg-error/10 p-3 text-sm text-error"><AlertTriangle size={16} className="mt-0.5 shrink-0" />{erro}</div>}
    {aviso && <div role="alert" className="mb-4 rounded-2xl border border-warning/40 bg-warning/10 p-3 text-sm text-warning">{aviso}</div>}
    {carregando ? <p className="py-10 text-center text-sm text-text-muted">Carregando…</p> : plano.total === 0 ? (
      <EmptyState icon={CalendarCheck2} title="Seu dia está livre." subtitle={temRotina === false ? "Sem tarefas, prazos ou eventos hoje. Configure sua rotina para ver quanto tempo você tem disponível." : livre !== null ? `Sem tarefas, prazos ou eventos hoje — ${fmtDuracao(Math.max(0, livre))} livres na sua rotina para encaixar algo.` : "Sem tarefas, prazos ou eventos hoje."} />
    ) : <div className="space-y-5">
      {grupo("atrasadas", "Atrasadas", plano.atrasadas, true)}
      {grupo("dia-todo", "Dia todo", plano.diaTodo)}
      {grupo("cronograma", "Cronograma de hoje", plano.cronograma)}
      {grupo("sem-horario", "Sem horário", plano.semHorario)}
    </div>}
  </div>;
}
