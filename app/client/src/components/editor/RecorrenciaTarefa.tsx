import { useState } from "react";
import { Repeat, Pause, Play, SkipForward, Square, X } from "lucide-react";
import { tarefas, ApiError, type EscopoSerie, type FimDeMesSerie, type FrequenciaSerie, type RegraSerie, type SerieResumo } from "@/lib/api";
import { SeletorEcos } from "@/components/common/SeletorEcos";
import { DatePicker } from "@/components/common/DatePicker";
import { avisar } from "@/lib/toast";

const FREQUENCIAS: { valor: FrequenciaSerie; rotulo: string; unidade: [string, string] }[] = [
  { valor: "diaria", rotulo: "Diária", unidade: ["dia", "dias"] },
  { valor: "semanal", rotulo: "Semanal", unidade: ["semana", "semanas"] },
  { valor: "mensal", rotulo: "Mensal", unidade: ["mês", "meses"] },
  { valor: "anual", rotulo: "Anual", unidade: ["ano", "anos"] },
];
const DIAS = [{ n: 1, r: "Seg" }, { n: 2, r: "Ter" }, { n: 3, r: "Qua" }, { n: 4, r: "Qui" }, { n: 5, r: "Sex" }, { n: 6, r: "Sáb" }, { n: 7, r: "Dom" }];
type Termino = "nunca" | "data" | "contagem";

export const ESCOPOS: { valor: EscopoSerie; rotulo: string }[] = [
  { valor: "esta", rotulo: "Só esta ocorrência" },
  { valor: "proximas", rotulo: "Esta e as próximas" },
  { valor: "serie", rotulo: "Toda a série" },
];

function fusoDoDispositivo(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Sao_Paulo"; } catch { return "America/Sao_Paulo"; }
}

export function descreverRegra(r: Pick<RegraSerie, "frequencia" | "intervalo" | "dias_semana">): string {
  const f = FREQUENCIAS.find((x) => x.valor === r.frequencia)!;
  const base = r.intervalo === 1 ? ({ diaria: "Todo dia", semanal: "Toda semana", mensal: "Todo mês", anual: "Todo ano" })[r.frequencia] : `A cada ${r.intervalo} ${f.unidade[1]}`;
  if (r.frequencia === "semanal" && r.dias_semana.length > 0) return `${base} (${r.dias_semana.map((n) => DIAS.find((d) => d.n === n)?.r).join(", ")})`;
  return base;
}

function formatarDia(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "");
}

const ESTADO_ROTULO = { ativa: "Ativa", pausada: "Pausada", encerrada: "Encerrada" } as const;

/**
 * Repetição de uma tarefa: cria, ajusta, pausa, retoma, pula ou encerra a série. A regra vale para esta ocorrência e
 * as próximas; `escopo` (usado nas edições da tarefa) diz se um ajuste de título/prazo etc. fica só nesta ocorrência.
 */
export function RecorrenciaTarefa({ tarefaId, serie, temData, concluida, escopo, onEscopo, onMudou }: {
  tarefaId: string;
  serie: SerieResumo | null;
  /** A tarefa tem data (agendamento ou prazo): sem ela não há de onde contar a repetição. */
  temData: boolean;
  concluida: boolean;
  escopo: EscopoSerie;
  onEscopo: (e: EscopoSerie) => void;
  /** Recarrega a tarefa (e avisa o resto do app) depois de uma mudança na série. */
  onMudou: () => void;
}) {
  const [editando, setEditando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const inicial = serie?.regra;
  const [frequencia, setFrequencia] = useState<FrequenciaSerie>(inicial?.frequencia ?? "semanal");
  const [intervalo, setIntervalo] = useState(String(inicial?.intervalo ?? 1));
  const [dias, setDias] = useState<number[]>(inicial?.dias_semana ?? []);
  const [fimDeMes, setFimDeMes] = useState<FimDeMesSerie>(inicial?.fim_de_mes ?? "ajustar");
  const [termino, setTermino] = useState<Termino>(inicial?.data_fim ? "data" : inicial?.max_ocorrencias ? "contagem" : "nunca");
  const [dataFim, setDataFim] = useState(inicial?.data_fim ?? "");
  const [contagem, setContagem] = useState(String(inicial?.max_ocorrencias ?? 10));

  async function executar(fn: () => Promise<unknown>, mensagem?: string) {
    setOcupado(true); setErro(null);
    try { await fn(); if (mensagem) avisar(mensagem, "sucesso"); onMudou(); }
    catch (e) { setErro(e instanceof ApiError ? e.message : "Não foi possível atualizar a repetição."); }
    finally { setOcupado(false); }
  }

  function aplicar() {
    const n = Number(intervalo);
    if (!Number.isInteger(n) || n < 1 || n > 999) { setErro("O intervalo deve ser um número inteiro de 1 a 999."); return; }
    if (termino === "data" && !dataFim) { setErro("Escolha a data final da repetição."); return; }
    const max = Number(contagem);
    if (termino === "contagem" && (!Number.isInteger(max) || max < 1)) { setErro("Informe quantas ocorrências a série deve ter."); return; }
    const regra: RegraSerie = {
      frequencia, intervalo: n, dias_semana: frequencia === "semanal" ? dias : [], fim_de_mes: fimDeMes,
      data_fim: termino === "data" ? dataFim : null, max_ocorrencias: termino === "contagem" ? max : null,
      timezone: serie?.regra.timezone ?? fusoDoDispositivo(),
    };
    void executar(async () => { await tarefas.serie.definir(tarefaId, regra); setEditando(false); }, "Repetição salva.");
  }

  const unidade = FREQUENCIAS.find((f) => f.valor === frequencia)!.unidade;
  const botao = "flex min-h-10 items-center gap-2 rounded-lg border border-border px-3 text-sm text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary disabled:opacity-40";

  return (
    <section className="mt-6 border-t border-border pt-6" aria-label="Repetição">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-semibold text-text-primary"><Repeat size={17} aria-hidden="true" />Repetir</h2>
          {serie ? (
            <p className="text-sm text-text-secondary">
              {descreverRegra(serie.regra)} · {ESTADO_ROTULO[serie.estado]}
              {serie.estado === "ativa" && serie.proxima_data ? ` · próxima em ${formatarDia(serie.proxima_data)}` : ""}
              {serie.excecao ? " · esta ocorrência foi editada à parte" : ""}
            </p>
          ) : (
            <p className="text-sm text-text-secondary">{temData ? "Esta tarefa não se repete." : "Defina uma data (agendamento ou prazo) para poder repetir a tarefa."}</p>
          )}
        </div>
        {!editando && (
          <button type="button" disabled={ocupado || (!serie && !temData)} onClick={() => setEditando(true)} className={botao}>{serie ? "Alterar repetição" : "Repetir"}</button>
        )}
      </div>

      {erro && <p role="alert" className="mb-3 rounded-lg border border-error/40 bg-error/10 p-2 text-sm text-error">{erro}</p>}

      {editando && (
        <div className="mb-4 grid gap-3 rounded-xl border border-border bg-surface-1 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-text-secondary">A cada</span>
            <input type="number" min={1} max={999} value={intervalo} onChange={(e) => setIntervalo(e.target.value)} aria-label="Intervalo da repetição" className="ecos-input w-20" />
            <SeletorEcos<FrequenciaSerie> valor={frequencia} ariaLabel="Frequência da repetição" classe="ecos-input min-w-36"
              opcoes={FREQUENCIAS.map((f) => ({ valor: f.valor, rotulo: f.rotulo }))} onChange={setFrequencia} />
            <span className="text-sm text-text-secondary">({Number(intervalo) === 1 ? unidade[0] : unidade[1]})</span>
          </div>

          {frequencia === "semanal" && (
            <div role="group" aria-label="Dias da semana" className="flex flex-wrap gap-2">
              {DIAS.map((d) => {
                const ativo = dias.includes(d.n);
                return <button key={d.n} type="button" aria-pressed={ativo} onClick={() => setDias((atual) => ativo ? atual.filter((x) => x !== d.n) : [...atual, d.n])}
                  className={`min-h-10 min-w-12 rounded-lg border px-3 text-sm ${ativo ? "border-cyan bg-cyan/15 text-text-primary" : "border-border text-text-secondary"}`}>{d.r}</button>;
              })}
              <span className="self-center text-xs text-text-muted">Sem seleção: repete no mesmo dia da semana.</span>
            </div>
          )}

          {(frequencia === "mensal" || frequencia === "anual") && (
            <label className="flex flex-wrap items-center gap-2 text-sm text-text-secondary">Se o mês não tiver o dia
              <SeletorEcos<FimDeMesSerie> valor={fimDeMes} ariaLabel="Regra para fim de mês" classe="ecos-input min-w-52"
                opcoes={[{ valor: "ajustar", rotulo: "Usar o último dia do mês" }, { valor: "pular", rotulo: "Pular esse mês" }, { valor: "ultimo_dia", rotulo: "Sempre no último dia" }]} onChange={setFimDeMes} />
            </label>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-text-secondary">Termina</span>
            <SeletorEcos<Termino> valor={termino} ariaLabel="Término da repetição" classe="ecos-input min-w-44"
              opcoes={[{ valor: "nunca", rotulo: "Nunca" }, { valor: "data", rotulo: "Em uma data" }, { valor: "contagem", rotulo: "Após N ocorrências" }]} onChange={setTermino} />
            {termino === "data" && <DatePicker value={dataFim} onChange={setDataFim} accent="cyan" ariaLabel="Data final da repetição" />}
            {termino === "contagem" && <input type="number" min={1} value={contagem} onChange={(e) => setContagem(e.target.value)} aria-label="Número de ocorrências" className="ecos-input w-24" />}
          </div>

          <p className="text-xs text-text-muted">A contagem recomeça nesta ocorrência. Fuso: {serie?.regra.timezone ?? fusoDoDispositivo()}.</p>
          <div className="flex gap-2">
            <button type="button" disabled={ocupado} onClick={() => { setEditando(false); setErro(null); }} className={botao}><X size={15} />Cancelar</button>
            <button type="button" disabled={ocupado} onClick={aplicar} className="min-h-10 rounded-lg bg-cyan px-4 text-sm font-semibold text-black disabled:opacity-40">{ocupado ? "Salvando..." : "Salvar repetição"}</button>
          </div>
        </div>
      )}

      {serie && !editando && (
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-text-secondary">Ao editar, aplicar a</span>
            <SeletorEcos<EscopoSerie> valor={escopo} ariaLabel="Escopo da edição na série" classe="ecos-input min-w-48" opcoes={ESCOPOS} onChange={onEscopo} />
          </div>
          <div className="flex flex-wrap gap-2">
            {serie.estado === "ativa" && !concluida && (
              <button type="button" disabled={ocupado} onClick={() => void executar(() => tarefas.serie.acao(tarefaId, "pular"), "Ocorrência pulada.")} className={botao}><SkipForward size={15} />Pular esta</button>
            )}
            {serie.estado === "ativa" && <button type="button" disabled={ocupado} onClick={() => void executar(() => tarefas.serie.acao(tarefaId, "pausar"), "Repetição pausada.")} className={botao}><Pause size={15} />Pausar</button>}
            {serie.estado === "pausada" && <button type="button" disabled={ocupado} onClick={() => void executar(() => tarefas.serie.acao(tarefaId, "retomar"), "Repetição retomada.")} className={botao}><Play size={15} />Retomar</button>}
            {serie.estado !== "encerrada" && <button type="button" disabled={ocupado} onClick={() => void executar(() => tarefas.serie.acao(tarefaId, "encerrar"), "Série encerrada.")} className={botao}><Square size={15} />Encerrar série</button>}
            <button type="button" disabled={ocupado} onClick={() => void executar(() => tarefas.serie.acao(tarefaId, "remover"), "Esta tarefa não se repete mais.")} className={botao}>Parar de repetir</button>
          </div>
        </div>
      )}
    </section>
  );
}
