import { useEffect, useMemo, useRef, useState } from "react";
import { tarefas, timeline as timelineApi, type AtividadeTimeline, type TarefaResumo } from "@/lib/api";
import { dataLocalISO, somarDiasISO } from "@/lib/agenda-tempo";
import { useEventosDoPeriodo } from "@/lib/eventos-agenda";
import { useEspacoFiltro } from "@/lib/use-espaco-filtro";
import { useAppUI } from "@/lib/ui-context";
import { mensagemDeErro } from "@/lib/erros";
import { intensidadePorDia, montarTimeline, type Janela } from "@/lib/timeline";

/** Busca todas as páginas (até um teto) de uma listagem de tarefas. */
async function todasAsTarefas(params: Parameters<typeof tarefas.listar>[0]): Promise<TarefaResumo[]> {
  const itens: TarefaResumo[] = [];
  let cursor: string | undefined;
  for (let pagina = 0; pagina < 5; pagina += 1) {
    const r = await tarefas.listar({ ...params, cursor, limit: 200 });
    itens.push(...r.items);
    if (!r.next_cursor) break;
    cursor = r.next_cursor;
  }
  return itens;
}

/** Espaço das buscas de Tarefas e do registro, seguindo o mesmo filtro das outras telas. */
function useEspacoDasTarefas(): string | undefined {
  const { filtroEquipeId, espacoAtivo, intercalarEquipes } = useAppUI();
  return intercalarEquipes ? (filtroEquipeId ? `equipe:${filtroEquipeId}` : undefined) : espacoAtivo;
}

const fusoMinutos = () => -new Date().getTimezoneOffset();

/** Tarefas com data na janela e o registro de atividade dela. O registro é complemento: falhar não derruba a busca. */
function carregarJanela(janela: Janela, espaco: string | undefined) {
  const tz = fusoMinutos();
  return Promise.all([
    todasAsTarefas({ data_de: janela.de, data_ate: janela.ate, espaco, tz }),
    timelineApi.atividade({ data_de: janela.de, data_ate: janela.ate, tz, espaco }).catch(() => [] as AtividadeTimeline[]),
  ]);
}

export interface DadosTimeline { tarefas: TarefaResumo[]; atrasadas: TarefaResumo[]; atividades: AtividadeTimeline[] }

/** Dados da lista: a janela visível e todas as atrasadas até ontem. Eventos e Cofre vêm do hook da Agenda. */
export function useDadosDaTimeline(janela: Janela, versao: number) {
  const espaco = useEspacoDasTarefas();
  const [dados, setDados] = useState<DadosTimeline | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  // As atrasadas (um ano para trás) não dependem da janela: mudar de dia não as busca de novo.
  const atrasadasRef = useRef<{ chave: string; promessa: Promise<TarefaResumo[]> } | null>(null);
  useEffect(() => {
    let ativo = true;
    setErro(null);
    const hoje = dataLocalISO(new Date());
    const chave = `${hoje}|${versao}|${espaco ?? ""}`;
    if (atrasadasRef.current?.chave !== chave) {
      atrasadasRef.current = { chave, promessa: todasAsTarefas({ status: "pendente", data_de: somarDiasISO(hoje, -365), data_ate: somarDiasISO(hoje, -1), espaco, tz: fusoMinutos() }) };
    }
    Promise.all([carregarJanela(janela, espaco), atrasadasRef.current.promessa])
      .then(([[doPeriodo, atividades], atrasadas]) => { if (ativo) setDados({ tarefas: doPeriodo, atrasadas, atividades }); })
      .catch((e) => { if (ativo) { atrasadasRef.current = null; setErro(mensagemDeErro(e, "Não foi possível carregar a timeline.")); setDados({ tarefas: [], atrasadas: [], atividades: [] }); } });
    return () => { ativo = false; };
  }, [janela.de, janela.ate, versao, espaco]);

  return { dados, erro };
}

/** Primeiro e último dia de um mês `YYYY-MM`. */
export function janelaDoMes(mes: string): Janela {
  const [a, m] = mes.split("-").map(Number);
  return { de: `${mes}-01`, ate: `${mes}-${String(new Date(a, m, 0).getDate()).padStart(2, "0")}` };
}

/**
 * Quanto aconteceu em cada dia do mês, para o calendário. Busca o mês inteiro ao trocar de mês — independente de
 * quanto a lista já carregou — e conta do mesmo jeito que a Timeline monta os dias.
 */
export function useIntensidadeDoMes(mes: string, versao: number): Map<string, number> | null {
  const espaco = useEspacoDasTarefas();
  const janela = useMemo(() => janelaDoMes(mes), [mes]);
  const { eventos } = useEventosDoPeriodo(janela.de, janela.ate, versao, useEspacoFiltro(), true);
  const [dados, setDados] = useState<{ mes: string; tarefas: TarefaResumo[]; atividades: AtividadeTimeline[] } | null>(null);

  useEffect(() => {
    let ativo = true;
    carregarJanela(janela, espaco)
      .then(([doMes, atividades]) => { if (ativo) setDados({ mes, tarefas: doMes, atividades }); })
      .catch(() => { if (ativo) setDados({ mes, tarefas: [], atividades: [] }); });
    return () => { ativo = false; };
  }, [janela, mes, versao, espaco]);

  return useMemo(() => {
    if (!dados || dados.mes !== mes) return null;
    return intensidadePorDia(montarTimeline({ janela, tarefas: dados.tarefas, eventos, atividades: dados.atividades, agora: new Date() }));
  }, [dados, mes, janela, eventos]);
}
