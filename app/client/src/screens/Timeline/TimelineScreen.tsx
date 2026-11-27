import { Fragment, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { AlertTriangle, ArrowDown, ArrowUp } from "lucide-react";
import { tarefas } from "@/lib/api";
import { dataLocalISO, diaEMinutosLocais, diasEntre, instanteLocalISO, somarDiasISO } from "@/lib/agenda-tempo";
import { useEventosDoPeriodo } from "@/lib/eventos-agenda";
import { useEspacoFiltro } from "@/lib/use-espaco-filtro";
import { useNavigate } from "react-router-dom";
import { useAbrirDocumento } from "@/lib/documento-popup";
import { useIsDesktop } from "@/lib/use-viewport";
import { useRefreshBus } from "@/lib/refresh-bus";
import { avisarComDesfazer } from "@/lib/desfazer";
import { mensagemDeErro } from "@/lib/erros";
import {
  atrasadasAteOntem, janelaComDia, janelaInicial, montarTimeline, ramosDoRegistro, resumirDia, trechosDaTimeline,
  MAX_DIAS, PASSO_DIAS, type ItemTimeline, type Janela,
} from "@/lib/timeline";
import { SkeletonHoje } from "@/components/common/SkeletonTelas";
import { EventoDialog } from "@/screens/Eventos/EventoDialog";
import { CalendarioAtividade } from "./CalendarioAtividade";
import { FaixaVazia, GrupoDia } from "./GrupoDia";
import { LinhaItem, MarcadorAgora, type AcoesItem } from "./LinhaItem";
import { PainelDoDia } from "./PainelDoDia";
import { useDadosDaTimeline, useIntensidadeDoMes } from "./dados";
import { TRONCO } from "./geometria";
import { lerMemoria, useGuardarMemoria } from "./memoria";
import "./timeline.css";

const fmtDiaCurto = new Intl.DateTimeFormat("pt-BR", { weekday: "short", day: "numeric", month: "short" });
const fmtDiaCheio = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "numeric", month: "long" });
const formatar = (f: Intl.DateTimeFormat, dia: string) => f.format(new Date(`${dia}T12:00:00`)).replace(/\./g, "");
const maiuscula = (t: string) => t[0].toUpperCase() + t.slice(1);

function rotuloDoDia(dia: string, hoje: string): string {
  const distancia = diasEntre(hoje, dia);
  if (distancia === 0) return maiuscula(formatar(fmtDiaCheio, dia));
  if (distancia === -1) return "Ontem";
  if (distancia === 1) return "Amanhã";
  return maiuscula(formatar(fmtDiaCurto, dia));
}

/** Relógio de minuto em minuto: o marcador "agora" e o vermelho dos atrasos acompanham o tempo sem recarregar. */
function useAgora(): Date {
  const [agora, setAgora] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setAgora(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  return agora;
}

/** Quais grupos estão recolhidos. "Atrasadas" começa sempre recolhido; os dias, abertos. */
function useRecolhidos(iniciais: string[] = ["atrasadas"]) {
  const [recolhidos, setRecolhidos] = useState<Set<string>>(() => new Set(iniciais));
  const alternar = (id: string) => setRecolhidos((atual) => {
    const novo = new Set(atual);
    if (!novo.delete(id)) novo.add(id);
    return novo;
  });
  const abrir = (id: string) => setRecolhidos((atual) => {
    if (!atual.has(id)) return atual;
    const novo = new Set(atual);
    novo.delete(id);
    return novo;
  });
  return { recolhidos, recolhido: (id: string) => recolhidos.has(id), alternar, abrir };
}

/**
 * Timeline: o tempo como uma linha contínua. No trilho principal, o que estava programado (tarefas, prazos, eventos,
 * lançamentos do Cofre); num ramo ao lado, o que a pessoa fez (notas e tarefas criadas, editadas, concluídas).
 * Abre em volta de hoje e cresce para o passado e para o futuro. Ao lado, o resumo de hoje e o calendário de atividade.
 */
export function TimelineScreen() {
  const { versao, notificar } = useRefreshBus();
  const abrirDocumento = useAbrirDocumento();
  const navigate = useNavigate();
  const desktop = useIsDesktop();
  const hoje = dataLocalISO(new Date());
  // Voltando de uma nota/tarefa: retoma janela, grupos, mês e rolagem de onde a pessoa estava.
  const [lembrada] = useState(() => lerMemoria(hoje));
  const [janela, setJanela] = useState<Janela>(() => lembrada?.janela ?? janelaInicial(hoje));
  const [eventoEmEdicao, setEventoEmEdicao] = useState<{ id: string; ocorrencia?: string } | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const { recolhidos, recolhido, alternar, abrir: abrirGrupo } = useRecolhidos(lembrada?.recolhidos);

  const { dados, erro } = useDadosDaTimeline(janela, versao);
  const { eventos } = useEventosDoPeriodo(janela.de, janela.ate, versao, useEspacoFiltro(), true);
  const agora = useAgora();

  const dias = useMemo(() => dados ? montarTimeline({ janela, tarefas: dados.tarefas, eventos, atividades: dados.atividades, agora }) : [], [dados, eventos, janela, agora]);
  const atrasadas = useMemo(() => dados ? atrasadasAteOntem(dados.atrasadas, agora) : [], [dados, agora]);
  const resumo = useMemo(() => resumirDia(dias.find((d) => d.dia === hoje), atrasadas.length), [dias, hoje, atrasadas.length]);
  const [mesCalendario, setMesCalendario] = useState(() => lembrada?.mesCalendario ?? hoje.slice(0, 7));
  const intensidade = useIntensidadeDoMes(mesCalendario, versao);
  const trechos = useMemo(() => trechosDaTimeline(dias, hoje), [dias, hoje]);
  const listaRecolhidos = useMemo(() => [...recolhidos], [recolhidos]);
  useGuardarMemoria({ dia: hoje, janela, recolhidos: listaRecolhidos, mesCalendario });
  const podeCrescer = diasEntre(janela.de, janela.ate) + 1 < MAX_DIAS;

  const executar = async (acao: () => Promise<unknown>, falha: string) => {
    setAviso(null);
    try { await acao(); } catch (e) { setAviso(mensagemDeErro(e, falha)); }
    notificar();
  };
  const acoes: AcoesItem = {
    onAbrir: (item: ItemTimeline, e: MouseEvent<HTMLButtonElement>) => {
      const alvo = item.alvo;
      if (!alvo) return;
      if (alvo.tipo === "evento") {
        // No celular o evento abre como tela (o voltar do Android a fecha); no desktop, como diálogo sobre a Timeline.
        if (desktop) setEventoEmEdicao({ id: alvo.id, ocorrencia: alvo.ocorrencia });
        else navigate(`/eventos?evento=${encodeURIComponent(alvo.id)}${alvo.ocorrencia ? `&ocorrencia=${encodeURIComponent(alvo.ocorrencia)}` : ""}`);
      }
      else if (alvo.tipo === "transacao") abrirDocumento(`/cofre/transacao/${alvo.id}`, e);
      else abrirDocumento(`/${alvo.tipo}/${alvo.id}`, e);
    },
    onConcluir: (item) => {
      const id = item.alvo?.id;
      if (!id) return;
      void executar(async () => {
        await tarefas.atualizarStatus(id, "concluida");
        avisarComDesfazer("Tarefa concluída.", () => tarefas.atualizarStatus(id, "pendente"), { aoDesfazer: notificar, sucesso: "Tarefa reaberta." });
      }, "Não foi possível concluir a tarefa.");
    },
    onAdiar: (item) => {
      const id = item.alvo?.id;
      if (!id) return;
      const amanha = somarDiasISO(hoje, 1);
      const scheduledAt = item.info?.scheduledAt;
      const payload = scheduledAt ? { scheduled_at: instanteLocalISO(amanha, diaEMinutosLocais(scheduledAt).minutos) } : { due_date: amanha };
      void executar(() => tarefas.atualizar(id, { ...payload, adiar: item.dia < amanha }), "Não foi possível adiar a tarefa.");
    },
  };

  // Pular para um dia (pelo calendário): abre o grupo, estende a janela se preciso e rola quando ele existir.
  const diaPendente = useRef<string | null>(null);
  /** O dia pode ter grupo próprio ou estar dentro de uma faixa de dias vazios. */
  const elementoDoDia = (dia: string) => document.querySelector(`[data-dia="${dia}"]`)
    ?? [...document.querySelectorAll<HTMLElement>("[data-faixa-de]")].find((el) => el.dataset.faixaDe! <= dia && dia <= el.dataset.faixaAte!)
    ?? null;
  const rolarAte = (dia: string) => elementoDoDia(dia)?.scrollIntoView({ block: "start", behavior: "smooth" });
  const irPara = (dia: string) => {
    abrirGrupo(dia);
    if (dia < janela.de || dia > janela.ate) { diaPendente.current = dia; setJanela((j) => janelaComDia(j, dia)); return; }
    rolarAte(dia);
  };
  useEffect(() => {
    const dia = diaPendente.current;
    if (dia && elementoDoDia(dia)) { diaPendente.current = null; rolarAte(dia); }
  }, [dias]);

  // Na primeira carga, rola até hoje (o passado fica logo acima, a um gesto) — ou, na volta, até onde a pessoa estava.
  const hojeRef = useRef<HTMLLIElement | null>(null);
  const rolou = useRef(false);
  useEffect(() => {
    if (!dados || rolou.current) return;
    rolou.current = true;
    if (lembrada) window.scrollTo({ top: lembrada.rolagem });
    else hojeRef.current?.scrollIntoView({ block: "start" });
  }, [dados]);

  const botaoMais = "rounded-lg px-2.5 py-1 text-xs font-medium text-text-muted transition-colors hover:bg-surface-2 hover:text-text-primary";
  const calendario = <CalendarioAtividade hoje={hoje} mes={mesCalendario} intensidade={intensidade} onMudarMes={setMesCalendario} onIrPara={irPara} />;

  return <div className="w-full max-w-[92rem] px-4 pb-16 pt-1 max-lg:mx-auto max-lg:max-w-3xl">
    {/* No desktop o título fica onde fica o de Notas e Tarefas; no celular, preso ao topo. */}
    <header className="mb-2 max-lg:sticky max-lg:top-0 max-lg:z-10 max-lg:-mx-4 max-lg:border-b max-lg:border-border max-lg:bg-base/90 max-lg:px-4 max-lg:py-3 max-lg:backdrop-blur lg:mb-4">
      <h1 className="font-display text-2xl text-text-primary">Timeline</h1>
    </header>

    {erro && <div role="alert" className="mb-4 flex items-start gap-2 rounded-2xl border border-error/40 bg-error/10 p-3 text-sm text-error"><AlertTriangle size={16} className="mt-0.5 shrink-0" />{erro}</div>}
    {aviso && <div role="alert" className="mb-4 rounded-2xl border border-warning/40 bg-warning/10 p-3 text-sm text-warning">{aviso}</div>}

    {/* Desktop: resumo à esquerda, Timeline no centro, calendário à direita (abaixo do resumo em telas médias). */}
    <div className="lg:grid lg:grid-cols-[18rem_minmax(0,1fr)] lg:items-start lg:gap-10 2xl:grid-cols-[18rem_minmax(0,52rem)_18rem]">
      <div className="mb-4 flex flex-col gap-3 lg:sticky lg:top-4 lg:mb-0">
        {dados && <PainelDoDia hoje={hoje} versao={versao} resumo={resumo} />}
        {dados && <div className="max-lg:hidden 2xl:hidden">{calendario}</div>}
      </div>

      <div className="min-w-0">
        {dados === null ? <SkeletonHoje rotulo="Carregando a timeline…" className="pt-4" /> : <>
          {podeCrescer && <button type="button" onClick={() => setJanela((j) => ({ ...j, de: somarDiasISO(j.de, -PASSO_DIAS) }))} className={botaoMais} style={{ marginLeft: TRONCO + 8 }}>Ver dias anteriores</button>}
          <ol className="relative pt-1" aria-label="Timeline">
            {atrasadas.length > 0 && <GrupoDia id="atrasadas" rotulo="Atrasadas" contagem={atrasadas.length} destaque primeiro recolhido={recolhido("atrasadas")} onAlternar={alternar}>
              {atrasadas.map((item, i) => <LinhaItem key={item.chave} item={item} indice={i} enfase mostrarData acoes={acoes} />)}
            </GrupoDia>}
            {trechos.map((trecho, n) => {
              const ultimo = n === trechos.length - 1;
              if (trecho.tipo === "vazio") return <FaixaVazia key={trecho.de} de={trecho.de} ate={trecho.ate} ultimo={ultimo} />;
              const { dia, itens } = trecho.dia;
              const ehHoje = dia === hoje;
              const minutoAgora = agora.getHours() * 60 + agora.getMinutes();
              const posAgora = ehHoje ? itens.findIndex((i) => (i.minutos ?? -1) > minutoAgora) : -1;
              const ramos = ramosDoRegistro(itens);
              const porLinha = ramos.some((r) => r.porLinha);
              return <GrupoDia key={dia} id={dia} rotulo={rotuloDoDia(dia, hoje)} subtitulo={Math.abs(diasEntre(hoje, dia)) === 1 ? formatar(fmtDiaCurto, dia) : undefined}
                contagem={itens.length} atual={ehHoje} futuro={dia > hoje} primeiro={n === 0 && atrasadas.length === 0} ultimo={ultimo}
                recolhido={recolhido(dia)} onAlternar={alternar} refDia={ehHoje ? hojeRef : undefined} trilhoPorLinha={porLinha}>
                {itens.length === 0 && <li className="ecos-timeline-item py-2 text-sm text-text-muted">Nada programado.</li>}
                {itens.map((item, i) => <Fragment key={item.chave}>
                  {ehHoje && i === posAgora && <MarcadorAgora agora={agora} trilho={porLinha} />}
                  <LinhaItem item={item} indice={i} ramo={ramos[i]} acoes={acoes} />
                </Fragment>)}
                {ehHoje && itens.length > 0 && posAgora === -1 && <MarcadorAgora agora={agora} trilho={porLinha} />}
              </GrupoDia>;
            })}
          </ol>
          {podeCrescer && <button type="button" onClick={() => setJanela((j) => ({ ...j, ate: somarDiasISO(j.ate, PASSO_DIAS) }))} className={botaoMais} style={{ marginLeft: TRONCO + 8 }}>Ver próximos dias</button>}
        </>}
      </div>

      {dados && <div className="hidden 2xl:sticky 2xl:top-4 2xl:block">{calendario}</div>}
    </div>

    {dados && <BotaoHoje alvo={hojeRef} versao={dias.length} />}
    <EventoDialog aberto={eventoEmEdicao !== null} eventoId={eventoEmEdicao?.id ?? null} ocorrencia={eventoEmEdicao?.ocorrencia ?? null} categorias={[]} onFechar={() => setEventoEmEdicao(null)} onSalvo={() => { setEventoEmEdicao(null); notificar(); }} />
  </div>;
}

/**
 * Botão flutuante "Hoje": aparece quando o dia de hoje sai da tela e rola de volta até ele. A seta diz para que lado
 * ele ficou. No celular fica acima da barra de baixo, à direita (o "+" está no centro).
 */
function BotaoHoje({ alvo, versao }: { alvo: React.RefObject<HTMLLIElement | null>; versao: number }) {
  const [lado, setLado] = useState<"acima" | "abaixo" | null>(null);
  useEffect(() => {
    const el = alvo.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const obs = new IntersectionObserver(([e]) => {
      if (!e) return;
      setLado(e.isIntersecting ? null : e.boundingClientRect.top < 0 ? "acima" : "abaixo");
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, [alvo, versao]);
  if (!lado) return null;
  const Seta = lado === "acima" ? ArrowUp : ArrowDown;
  return <button type="button" onClick={() => alvo.current?.scrollIntoView({ block: "start", behavior: "smooth" })}
    className="ecos-pop fixed bottom-[calc(var(--ecos-safe-bottom,0px)+96px)] right-4 z-40 flex min-h-11 items-center gap-1.5 rounded-full border border-cyan/40 bg-surface-1/95 px-4 text-sm font-semibold text-cyan shadow-nav backdrop-blur-md hover:bg-surface-2 lg:bottom-6 lg:right-6">
    <Seta size={16} aria-hidden />Hoje
  </button>;
}
