import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, ListChecks, CheckCircle2 } from "lucide-react";
import { tarefas as tarefasApi, ApiError, type TarefaResumo } from "@/lib/api";
import { formatDuracao } from "@/lib/format";
import { EmptyState } from "@/components/common/EmptyState";
import { CalendarClock } from "lucide-react";
import { useRefreshBus } from "@/lib/refresh-bus";

function paraISO(d: Date) {
  return d.toISOString().slice(0, 10);
}

function gerarDiasDoMes(referencia: Date) {
  const ano = referencia.getFullYear();
  const mes = referencia.getMonth();
  const primeiroDia = new Date(ano, mes, 1);
  const totalDias = new Date(ano, mes + 1, 0).getDate();
  const offset = primeiroDia.getDay();
  return { offset, totalDias, ano, mes };
}

interface Capacidade {
  disponivel_producao_min: number;
  consumido_tarefas_min: number;
  estourado: boolean;
}

/**
 * Agenda — calendário mensal + lista de time-blocks do dia (seção 3.4),
 * lendo `GET /tarefas` e `GET /agenda/capacidade` de verdade — isso fecha
 * o GAP-03 da rodada anterior (capacidade não era mais placeholder de 6h
 * fixo, agora vem do Perfil de Rotina real, `apps/server/src/routes/tarefas.rs`).
 * Blocos de pagamento previsto/nota com prazo do mock anterior saíram: não
 * existe endpoint que componha isso hoje, só Tarefa entra na Agenda real.
 */
export function AgendaScreen() {
  const navigate = useNavigate();
  const { versao } = useRefreshBus();
  const hoje = new Date();
  const [diaSelecionado, setDiaSelecionado] = useState(hoje.getDate());
  const { offset, totalDias, ano, mes } = gerarDiasDoMes(hoje);
  const dataStr = paraISO(new Date(ano, mes, diaSelecionado));

  const [blocos, setBlocos] = useState<TarefaResumo[] | null>(null);
  const [capacidade, setCapacidade] = useState<Capacidade | null>(null);
  const [erro, setErro] = useState<string | null>(null);

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

  return (
    <div className="px-4 pt-1">
      <h1 className="mb-4 font-display text-2xl capitalize text-text-primary">
        {hoje.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}
      </h1>

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
          const ativo = dia === diaSelecionado;
          const ehHoje = dia === hoje.getDate();
          return (
            <button
              key={dia}
              onClick={() => setDiaSelecionado(dia)}
              className={`mx-auto flex h-8 w-8 items-center justify-center rounded-full text-sm ${
                ativo
                  ? "bg-steel-700 font-semibold text-white"
                  : ehHoje
                    ? "border border-steel-500 text-text-primary"
                    : "text-text-secondary"
              }`}
            >
              {dia}
            </button>
          );
        })}
      </div>

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
                  onClick={() => navigate(`/tarefa/${t.id}`)}
                  className={`flex items-center gap-3 rounded-2xl border-l-4 bg-surface-1 p-3.5 text-left ${concluida ? "border-success" : "border-cyan"}`}
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
