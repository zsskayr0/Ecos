import { useEffect, useState } from "react";
import { useAbrirDocumento } from "@/lib/documento-popup";
import { AlertTriangle, ListChecks, CheckCircle2, ChevronLeft, ChevronRight } from "lucide-react";
import { tarefas as tarefasApi, ApiError, type TarefaResumo } from "@/lib/api";
import { formatDuracao } from "@/lib/format";
import { EmptyState } from "@/components/common/EmptyState";
import { CalendarClock } from "lucide-react";
import { useRefreshBus } from "@/lib/refresh-bus";

type ModoAgenda = "mes" | "semana" | "dia";

function paraISO(d: Date) {
  return d.toISOString().slice(0, 10);
}

function somarDias(d: Date, n: number) {
  const novo = new Date(d);
  novo.setDate(novo.getDate() + n);
  return novo;
}

function gerarDiasDoMes(referencia: Date) {
  const ano = referencia.getFullYear();
  const mes = referencia.getMonth();
  const primeiroDia = new Date(ano, mes, 1);
  const totalDias = new Date(ano, mes + 1, 0).getDate();
  const offset = primeiroDia.getDay();
  return { offset, totalDias, ano, mes };
}

/** Sunday-start week (matching the month grid's "D S T Q Q S S" header) containing `d`. */
function inicioDaSemana(d: Date) {
  return somarDias(d, -d.getDay());
}

interface Capacidade {
  disponivel_producao_min: number;
  consumido_tarefas_min: number;
  estourado: boolean;
}

/**
 * Agenda — monthly/weekly/daily calendar + the day's time-block list
 * (section 3.4), reading real `GET /tarefas` and `GET /agenda/capacidade`.
 * User feedback: "a agenda continua intacta ali, com funções de calendário
 * mensal, semanal e diário" — the three views share one selected-day state
 * and the same task list below; only the picker widget above it changes.
 */
export function AgendaScreen() {
  const abrirDocumento = useAbrirDocumento();
  const { versao, notificar } = useRefreshBus();
  const [modo, setModo] = useState<ModoAgenda>("mes");
  const [diaAtual, setDiaAtual] = useState(() => new Date());
  const hoje = new Date();
  const dataStr = paraISO(diaAtual);

  const [blocos, setBlocos] = useState<TarefaResumo[] | null>(null);
  const [capacidade, setCapacidade] = useState<Capacidade | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function planejarTarefa(dado: string, data: Date) {
    try {
      const tarefa = JSON.parse(dado) as { id: string; duracao: number };
      const inicio = new Date(data.getFullYear(), data.getMonth(), data.getDate(), 9, 0).toISOString();
      await tarefasApi.timeEntries.criar(tarefa.id, { tipo: "planejado", inicio_em: inicio, duracao_min: Math.max(1, tarefa.duracao) });
      notificar();
    } catch (e) { setErro(e instanceof ApiError ? e.message : "Não foi possível planejar a tarefa."); }
  }


  useEffect(() => {
    let vivo = true;
    setErro(null);
    Promise.all([
      tarefasApi.listar({ data_de: dataStr, data_ate: dataStr, limit: 100 }),
      tarefasApi.capacidade(dataStr),
    ])
      .then(([t, c]) => {
        if (!vivo) return;
        setBlocos(t.items);
        setCapacidade(c);
      })
      .catch((e) => {
        if (!vivo) return;
        setErro(e instanceof ApiError ? e.message : "Não foi possível carregar a Agenda.");
        setBlocos([]);
      });
    return () => {
      vivo = false;
    };
  }, [dataStr, versao]);

  const ehHojeFn = (d: Date) => paraISO(d) === paraISO(hoje);

  return (
    <div className="px-4 pt-1">
      <div className="mb-4 flex justify-center rounded-pill bg-surface-2 p-1 self-center w-fit mx-auto">
        {(["mes", "semana", "dia"] as ModoAgenda[]).map((m) => (
          <button
            key={m}
            onClick={() => setModo(m)}
            className={`rounded-pill px-4 py-1.5 text-sm font-medium capitalize ${modo === m ? "bg-steel-700 text-white" : "text-text-muted"}`}
          >
            {m === "mes" ? "Mês" : m === "semana" ? "Semana" : "Dia"}
          </button>
        ))}
      </div>

      {modo === "mes" && (
        <VisaoMes diaAtual={diaAtual} hoje={hoje} onMudarMes={(delta) => setDiaAtual((d) => new Date(d.getFullYear(), d.getMonth() + delta, Math.min(d.getDate(), 28)))} onSelecionar={setDiaAtual} onPlanejarTarefa={planejarTarefa} />
      )}
      {modo === "semana" && (
        <VisaoSemana diaAtual={diaAtual} hoje={hoje} onMudarSemana={(delta) => setDiaAtual((d) => somarDias(d, delta * 7))} onSelecionar={setDiaAtual} />
      )}
      {modo === "dia" && (
        <VisaoDia diaAtual={diaAtual} onMudarDia={(delta) => setDiaAtual((d) => somarDias(d, delta))} />
      )}

      {erro && (
        <div className="mb-4 flex items-start gap-2 rounded-2xl border border-error/40 bg-error/10 p-3 text-sm text-error">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" strokeWidth={1.75} />
          {erro}
        </div>
      )}

      {capacidade?.estourado && (
        <div className="mb-4 flex items-start gap-3 rounded-2xl border border-warning/40 bg-warning/10 p-4">
          <AlertTriangle size={20} className="mt-0.5 shrink-0 text-warning" strokeWidth={1.75} />
          <p className="text-sm leading-snug text-text-primary">
            {blocos?.length ?? 0} tarefas somam {formatDuracao(capacidade.consumido_tarefas_min)}, mas o dia só tem{" "}
            {formatDuracao(Math.max(capacidade.disponivel_producao_min, 0) + capacidade.consumido_tarefas_min)} de produção
            disponível. A conta não fecha — alguma vai sobrar pra amanhã. Qual?
          </p>
        </div>
      )}

      <div className="flex flex-col gap-2.5">
        {blocos === null ? (
          <p className="py-10 text-center text-sm text-text-muted">Carregando...</p>
        ) : blocos.length === 0 ? (
          <EmptyState icon={CalendarClock} title="Dia livre." subtitle="Sem blocos encaixados — aproveite ou capture algo novo." />
        ) : (
          blocos
            .slice()
            .sort((a, b) => (a.scheduled_at ?? "").localeCompare(b.scheduled_at ?? ""))
            .map((t) => {
              const hora = t.scheduled_at ? new Date(t.scheduled_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "sem horário";
              const concluida = t.status === "concluida";
              return (
                <button
                  key={t.id}
                  onClick={(e) => abrirDocumento(`/tarefa/${t.id}`, e)}
                  className={`flex items-center gap-3 rounded-2xl border-l-4 bg-surface-1 p-3.5 text-left ${concluida ? "border-success" : t.prioridade === "alta" ? "border-error" : "border-cyan"}`}
                >
                  {concluida ? (
                    <CheckCircle2 size={18} strokeWidth={1.75} className="shrink-0 text-success" />
                  ) : (
                    <ListChecks size={18} strokeWidth={1.75} className="shrink-0 text-cyan" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className={`truncate text-[15px] font-medium ${concluida ? "text-text-muted line-through" : "text-text-primary"}`}>{t.titulo}</p>
                    <p className="font-mono-value text-xs text-text-muted">
                      {hora} {t.duration_min ? `· ${formatDuracao(t.duration_min)}` : ""}
                    </p>
                  </div>
                </button>
              );
            })
        )}
      </div>
    </div>
  );
}

function VisaoMes({ diaAtual, hoje, onMudarMes, onSelecionar, onPlanejarTarefa }: { diaAtual: Date; hoje: Date; onMudarMes: (delta: number) => void; onSelecionar: (d: Date) => void; onPlanejarTarefa: (dado: string, data: Date) => void }) {
  const { offset, totalDias, ano, mes } = gerarDiasDoMes(diaAtual);
  const nomeMes = diaAtual.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

  return (
    <>
      <div className="mb-3 flex items-center justify-between">
        <button onClick={() => onMudarMes(-1)} className="rounded-full p-1.5 text-text-muted hover:bg-surface-2" aria-label="Mês anterior">
          <ChevronLeft size={18} />
        </button>
        <h1 className="font-display text-xl capitalize text-text-primary">{nomeMes}</h1>
        <button onClick={() => onMudarMes(1)} className="rounded-full p-1.5 text-text-muted hover:bg-surface-2" aria-label="Próximo mês">
          <ChevronRight size={18} />
        </button>
      </div>

      <div className="mb-4 grid grid-cols-7 gap-y-2 rounded-card bg-surface-1 p-3">
        {["D", "S", "T", "Q", "Q", "S", "S"].map((d, i) => (
          <div key={i} className="text-center text-xs font-medium text-text-muted">
            {d}
          </div>
        ))}
        {Array.from({ length: offset }).map((_, i) => (
          <div key={`vazio-${i}`} />
        ))}
        {Array.from({ length: totalDias }, (_, i) => i + 1).map((dia) => {
          const data = new Date(ano, mes, dia);
          const ativo = paraISO(data) === paraISO(diaAtual);
          const ehHoje = paraISO(data) === paraISO(hoje);
          return (
            <button
              key={dia}
              onClick={() => onSelecionar(data)}
              onDragOver={(e) => { if (e.dataTransfer.types.includes("application/x-ecos-task")) e.preventDefault(); }}
              onDrop={(e) => { const dado = e.dataTransfer.getData("application/x-ecos-task"); if (dado) { e.preventDefault(); onPlanejarTarefa(dado, data); } }}
              className={`mx-auto flex h-8 w-8 items-center justify-center rounded-full text-sm ${
                ativo ? "bg-steel-700 font-semibold text-white" : ehHoje ? "border border-steel-500 text-text-primary" : "text-text-secondary"
              }`}
            >
              {dia}
            </button>
          );
        })}
      </div>
    </>
  );
}

function VisaoSemana({ diaAtual, hoje, onMudarSemana, onSelecionar }: { diaAtual: Date; hoje: Date; onMudarSemana: (delta: number) => void; onSelecionar: (d: Date) => void }) {
  const inicio = inicioDaSemana(diaAtual);
  const dias = Array.from({ length: 7 }, (_, i) => somarDias(inicio, i));
  const rotulo = `${inicio.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })} – ${somarDias(inicio, 6).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}`;

  return (
    <>
      <div className="mb-3 flex items-center justify-between">
        <button onClick={() => onMudarSemana(-1)} className="rounded-full p-1.5 text-text-muted hover:bg-surface-2" aria-label="Semana anterior">
          <ChevronLeft size={18} />
        </button>
        <h1 className="font-display text-lg text-text-primary">{rotulo}</h1>
        <button onClick={() => onMudarSemana(1)} className="rounded-full p-1.5 text-text-muted hover:bg-surface-2" aria-label="Próxima semana">
          <ChevronRight size={18} />
        </button>
      </div>

      <div className="mb-4 grid grid-cols-7 gap-1 rounded-card bg-surface-1 p-3">
        {dias.map((data) => {
          const ativo = paraISO(data) === paraISO(diaAtual);
          const ehHoje = paraISO(data) === paraISO(hoje);
          return (
            <button key={paraISO(data)} onClick={() => onSelecionar(data)} className="flex flex-col items-center gap-1">
              <span className="text-[10px] font-medium uppercase text-text-muted">{data.toLocaleDateString("pt-BR", { weekday: "narrow" })}</span>
              <span
                className={`flex h-8 w-8 items-center justify-center rounded-full text-sm ${
                  ativo ? "bg-steel-700 font-semibold text-white" : ehHoje ? "border border-steel-500 text-text-primary" : "text-text-secondary"
                }`}
              >
                {data.getDate()}
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}

function VisaoDia({ diaAtual, onMudarDia }: { diaAtual: Date; onMudarDia: (delta: number) => void }) {
  const rotulo = diaAtual.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" });
  return (
    <div className="mb-4 flex items-center justify-between rounded-card bg-surface-1 p-3">
      <button onClick={() => onMudarDia(-1)} className="rounded-full p-1.5 text-text-muted hover:bg-surface-2" aria-label="Dia anterior">
        <ChevronLeft size={18} />
      </button>
      <h1 className="font-display text-lg capitalize text-text-primary">{rotulo}</h1>
      <button onClick={() => onMudarDia(1)} className="rounded-full p-1.5 text-text-muted hover:bg-surface-2" aria-label="Próximo dia">
        <ChevronRight size={18} />
      </button>
    </div>
  );
}
