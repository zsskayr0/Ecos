import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { AlertTriangle, Briefcase, ChevronDown, ChevronLeft, Clock3, Moon, Sun, Utensils, Car, Sparkles, Coffee } from "lucide-react";
import { ApiError, rotina, type BlocoRotina } from "@/lib/api";

interface Janela { inicio: string; fim: string }
interface Estado {
  sono: Janela;
  trabalha: boolean; trabalho: Janela; diasTrabalho: number[];
  almoco: boolean; almocoJanela: Janela;
  desloca: boolean; deslocamento: Janela;
  produz: boolean; producao: Janela; diasProducao: number[];
  livre: boolean; tempoLivre: Janela;
}

const TODOS_OS_DIAS = [1, 2, 3, 4, 5, 6, 7];
const DIAS = [["Seg", 1], ["Ter", 2], ["Qua", 3], ["Qui", 4], ["Sex", 5], ["Sáb", 6], ["Dom", 7]] as const;

const PADRAO: Estado = {
  sono: { inicio: "23:00", fim: "07:00" },
  trabalha: true, trabalho: { inicio: "09:00", fim: "18:00" }, diasTrabalho: [1, 2, 3, 4, 5],
  almoco: true, almocoJanela: { inicio: "12:00", fim: "13:00" },
  desloca: false, deslocamento: { inicio: "08:00", fim: "09:00" },
  produz: true, producao: { inicio: "19:00", fim: "22:00" }, diasProducao: TODOS_OS_DIAS,
  livre: false, tempoLivre: { inicio: "22:00", fim: "23:00" },
};

/** Cada pergunta vira um bloco de rotina; `casa` identifica o bloco já salvo que ela substitui. */
const CATEGORIAS = {
  sono: { tipo: "sono", classificacao: "indisponivel", casa: (b: BlocoRotina) => b.tipo === "sono" },
  trabalho: { tipo: "trabalho_fixo", classificacao: "indisponivel", casa: (b: BlocoRotina) => b.tipo === "trabalho_fixo" },
  almoco: { tipo: "refeicao", classificacao: "indisponivel", casa: (b: BlocoRotina) => b.tipo === "refeicao" },
  deslocamento: { tipo: "deslocamento", classificacao: "indisponivel", casa: (b: BlocoRotina) => b.tipo === "deslocamento" },
  producao: { tipo: "outro", classificacao: "disponivel_producao", casa: (b: BlocoRotina) => b.tipo === "outro" && b.classificacao === "disponivel_producao" },
  livre: { tipo: "outro", classificacao: "tempo_livre", casa: (b: BlocoRotina) => b.tipo === "outro" && b.classificacao === "tempo_livre" },
} as const;

const lerDias = (s: string) => (s === "diario" ? TODOS_OS_DIAS : s.split(",").map((d) => Number(d.trim())).filter((d) => d >= 1 && d <= 7));
const gravarDias = (dias: number[]) => (dias.length === 7 ? "diario" : dias.slice().sort().join(","));

function doServidor(blocos: BlocoRotina[]): Estado {
  const e: Estado = structuredClone(PADRAO);
  const janela = (b: BlocoRotina): Janela => ({ inicio: b.hora_inicio, fim: b.hora_fim });
  const sono = blocos.find(CATEGORIAS.sono.casa);
  if (sono) e.sono = janela(sono);
  const trabalho = blocos.find(CATEGORIAS.trabalho.casa);
  e.trabalha = Boolean(trabalho);
  if (trabalho) { e.trabalho = janela(trabalho); e.diasTrabalho = lerDias(trabalho.dias_semana); }
  const almoco = blocos.find(CATEGORIAS.almoco.casa);
  e.almoco = Boolean(almoco);
  if (almoco) e.almocoJanela = janela(almoco);
  const desloca = blocos.find(CATEGORIAS.deslocamento.casa);
  e.desloca = Boolean(desloca);
  if (desloca) e.deslocamento = janela(desloca);
  const producao = blocos.find(CATEGORIAS.producao.casa);
  e.produz = blocos.length === 0 || Boolean(producao);
  if (producao) { e.producao = janela(producao); e.diasProducao = lerDias(producao.dias_semana); }
  const livre = blocos.find(CATEGORIAS.livre.casa);
  e.livre = Boolean(livre);
  if (livre) e.tempoLivre = janela(livre);
  return e;
}

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const janelaValida = (j: Janela) => HORA.test(j.inicio) && HORA.test(j.fim) && j.inicio !== j.fim;
const minutosDaJanela = (j: Janela) => {
  if (!HORA.test(j.inicio) || !HORA.test(j.fim)) return 0;
  const [hi, mi] = j.inicio.split(":").map(Number);
  const [hf, mf] = j.fim.split(":").map(Number);
  const inicio = hi * 60 + mi;
  const fim = hf * 60 + mf;
  return fim > inicio ? fim - inicio : 24 * 60 - inicio + fim;
};
const horasTexto = (minutos: number) => {
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  return resto ? `${horas}h ${resto}min` : `${horas}h`;
};
const resumoDuracao = (janela: Janela, dias = 7) => `${horasTexto(minutosDaJanela(janela))}/dia · ${horasTexto(minutosDaJanela(janela) * dias)}/semana`;

/**
 * "Ajustar rotina": perguntas sobre sono, trabalho e o resto do dia. As respostas viram os blocos de rotina
 * (`/rotina/blocos`) que a Agenda usa para saber quanto tempo o dia realmente tem. Serve tanto no primeiro uso
 * (`?onboarding=1`) quanto para quem já tem conta e quer mudar depois — refazer atualiza os blocos existentes.
 */
export function RotinaScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const primeiraVez = params.get("onboarding") === "1";
  const [estado, setEstado] = useState<Estado | null>(null);
  const [existentes, setExistentes] = useState<BlocoRotina[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    rotina.listar().then((b) => { setExistentes(b); setEstado(doServidor(b)); })
      .catch((e) => { setErro(e instanceof ApiError ? e.message : "Não foi possível carregar sua rotina."); setEstado(structuredClone(PADRAO)); });
  }, []);

  const sair = () => navigate(primeiraVez ? "/feed" : location.pathname.startsWith("/configuracoes") ? "/configuracoes" : "/perfil");
  if (!estado) return <p className="px-4 py-10 text-center text-sm text-text-muted">Carregando...</p>;

  const atualizar = (patch: Partial<Estado>) => setEstado((e) => (e ? { ...e, ...patch } : e));
  const valido = janelaValida(estado.sono)
    && (!estado.trabalha || (janelaValida(estado.trabalho) && estado.diasTrabalho.length > 0))
    && (!estado.almoco || janelaValida(estado.almocoJanela))
    && (!estado.desloca || janelaValida(estado.deslocamento))
    && (!estado.produz || (janelaValida(estado.producao) && estado.diasProducao.length > 0))
    && (!estado.livre || janelaValida(estado.tempoLivre));

  async function salvar() {
    if (!estado) return;
    setSalvando(true);
    setErro(null);
    const desejados: [keyof typeof CATEGORIAS, boolean, Janela, number[]][] = [
      ["sono", true, estado.sono, TODOS_OS_DIAS],
      ["trabalho", estado.trabalha, estado.trabalho, estado.diasTrabalho],
      ["almoco", estado.almoco, estado.almocoJanela, TODOS_OS_DIAS],
      ["deslocamento", estado.desloca, estado.deslocamento, estado.trabalha ? estado.diasTrabalho : TODOS_OS_DIAS],
      ["producao", estado.produz, estado.producao, estado.diasProducao],
      ["livre", estado.livre, estado.tempoLivre, TODOS_OS_DIAS],
    ];
    try {
      for (const [chave, ativo, j, dias] of desejados) {
        const cat = CATEGORIAS[chave];
        const atual = existentes.find(cat.casa);
        const corpo = { tipo: cat.tipo, classificacao: cat.classificacao, hora_inicio: j.inicio, hora_fim: j.fim, dias_semana: gravarDias(dias) };
        if (ativo && atual) await rotina.atualizar(atual.id, corpo);
        else if (ativo) await rotina.criar(corpo);
        else if (atual) await rotina.excluir(atual.id);
      }
      sair();
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível salvar sua rotina.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-4 pt-[calc(env(safe-area-inset-top)+12px)] pb-nav-safe">
      <button data-voltar onClick={sair} className="mb-4 flex items-center gap-1 text-sm text-text-muted">
        <ChevronLeft size={18} />
        {primeiraVez ? "Pular por enquanto" : "Voltar"}
      </button>
      <h1 className="font-display text-2xl text-text-primary">{primeiraVez ? "Conte sobre a sua rotina" : "Rotina"}</h1>
      <p className="mb-6 mt-1 max-w-2xl text-sm text-text-secondary">
        Com isso a Agenda sabe quantas horas do dia são suas de verdade e avisa quando as tarefas não cabem. Dá para mudar quando quiser.
      </p>

      <ResumoRotina estado={estado} />

      <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2">
        <Cartao Icone={Moon} titulo="Sono" descricao="Quando você costuma dormir e acordar?" indicador={resumoDuracao(estado.sono)}>
          <Horarios rotuloInicio="Vou dormir" rotuloFim="Acordo" valor={estado.sono} onChange={(sono) => atualizar({ sono })} />
        </Cartao>

        <Cartao Icone={Briefcase} titulo="Trabalho ou estudo fixo" descricao="Horário em que você não está disponível para outras tarefas."
          ativo={estado.trabalha} onAtivo={(trabalha) => atualizar({ trabalha })} textoAtivo="Tenho horário fixo" indicador={estado.trabalha ? resumoDuracao(estado.trabalho, estado.diasTrabalho.length) : "Não definido"}>
          <Horarios rotuloInicio="Começo" rotuloFim="Termino" valor={estado.trabalho} onChange={(trabalho) => atualizar({ trabalho })} />
          <Dias valor={estado.diasTrabalho} onChange={(diasTrabalho) => atualizar({ diasTrabalho })} />
        </Cartao>

        <Cartao Icone={Utensils} titulo="Refeição principal" descricao="Almoço ou o intervalo em que você para de vez."
          ativo={estado.almoco} onAtivo={(almoco) => atualizar({ almoco })} textoAtivo="Reservar esse horário" indicador={estado.almoco ? resumoDuracao(estado.almocoJanela) : "Não definido"}>
          <Horarios rotuloInicio="De" rotuloFim="Até" valor={estado.almocoJanela} onChange={(almocoJanela) => atualizar({ almocoJanela })} />
        </Cartao>

        <Cartao Icone={Car} titulo="Deslocamento" descricao="Ida e volta ou o trajeto que mais pesa no seu dia."
          ativo={estado.desloca} onAtivo={(desloca) => atualizar({ desloca })} textoAtivo="Tenho deslocamento" indicador={estado.desloca ? resumoDuracao(estado.deslocamento, estado.trabalha ? estado.diasTrabalho.length : 7) : "Não definido"}>
          <Horarios rotuloInicio="De" rotuloFim="Até" valor={estado.deslocamento} onChange={(deslocamento) => atualizar({ deslocamento })} />
        </Cartao>

        <Cartao Icone={Sun} titulo="Horário de produção" descricao="Quando você costuma cuidar das suas tarefas? É a capacidade que a Agenda usa para avisar quando não cabe."
          ativo={estado.produz} onAtivo={(produz) => atualizar({ produz })} textoAtivo="Definir horário" indicador={estado.produz ? resumoDuracao(estado.producao, estado.diasProducao.length) : "Não definido"}>
          <Horarios rotuloInicio="Das" rotuloFim="Até" valor={estado.producao} onChange={(producao) => atualizar({ producao })} />
          <Dias valor={estado.diasProducao} onChange={(diasProducao) => atualizar({ diasProducao })} />
        </Cartao>

        <Cartao Icone={Coffee} titulo="Tempo livre" descricao="Lazer e descanso que você quer proteger."
          ativo={estado.livre} onAtivo={(livre) => atualizar({ livre })} textoAtivo="Proteger esse horário" indicador={estado.livre ? resumoDuracao(estado.tempoLivre) : "Não definido"}>
          <Horarios rotuloInicio="Das" rotuloFim="Até" valor={estado.tempoLivre} onChange={(tempoLivre) => atualizar({ tempoLivre })} />
        </Cartao>
      </div>

      {erro && (
        <div role="alert" className="mt-4 flex items-start gap-2 rounded-2xl border border-error/40 bg-error/10 p-3 text-sm text-error">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" strokeWidth={1.75} />
          {erro}
        </div>
      )}

      <div className="mt-6 pb-4">
        <button onClick={salvar} disabled={salvando || !valido}
          className={`flex w-full items-center justify-center gap-2 rounded-2xl border py-3.5 font-body text-[15px] font-semibold transition-[background-color,border-color,transform] active:scale-[0.995] ${salvando || !valido ? "cursor-not-allowed border-border bg-surface-2 text-text-secondary" : "border-[#1e4f82] bg-[#1e4f82] text-white shadow-sm hover:border-[#28679f] hover:bg-[#28679f]"}`}>
          <Sparkles size={16} />
          {salvando ? "Salvando..." : "Salvar rotina"}
        </button>
        {!valido && <p className="mt-2 text-center text-xs text-text-muted">Confira os horários: início e fim precisam ser diferentes, e escolha ao menos um dia.</p>}
      </div>
    </div>
  );
}

type MetricaRotina = { id: string; nome: string; minutosDia: number; minutosSemana: number; cor: string; icone: typeof Moon };

function ResumoRotina({ estado }: { estado: Estado }) {
  const metricas: MetricaRotina[] = [
    { id: "sono", nome: "Sono", minutosDia: minutosDaJanela(estado.sono), minutosSemana: minutosDaJanela(estado.sono) * 7, cor: "#7867e8", icone: Moon },
    { id: "trabalho", nome: "Trabalho", minutosDia: estado.trabalha ? minutosDaJanela(estado.trabalho) : 0, minutosSemana: estado.trabalha ? minutosDaJanela(estado.trabalho) * estado.diasTrabalho.length : 0, cor: "#3b82c4", icone: Briefcase },
    { id: "producao", nome: "Produção", minutosDia: estado.produz ? minutosDaJanela(estado.producao) : 0, minutosSemana: estado.produz ? minutosDaJanela(estado.producao) * estado.diasProducao.length : 0, cor: "#18a978", icone: Sun },
    { id: "lazer", nome: "Tempo livre", minutosDia: estado.livre ? minutosDaJanela(estado.tempoLivre) : 0, minutosSemana: estado.livre ? minutosDaJanela(estado.tempoLivre) * 7 : 0, cor: "#e79732", icone: Coffee },
    { id: "refeicao", nome: "Refeição", minutosDia: estado.almoco ? minutosDaJanela(estado.almocoJanela) : 0, minutosSemana: estado.almoco ? minutosDaJanela(estado.almocoJanela) * 7 : 0, cor: "#df5f74", icone: Utensils },
    { id: "deslocamento", nome: "Deslocamento", minutosDia: estado.desloca ? minutosDaJanela(estado.deslocamento) : 0, minutosSemana: estado.desloca ? minutosDaJanela(estado.deslocamento) * (estado.trabalha ? estado.diasTrabalho.length : 7) : 0, cor: "#78909c", icone: Car },
  ];
  const [selecionada, setSelecionada] = useState("sono");
  const [periodo, setPeriodo] = useState<"dia" | "semana">("dia");
  const atual = metricas.find((item) => item.id === selecionada) ?? metricas[0];
  const maximo = periodo === "dia" ? 12 * 60 : 12 * 60 * 7;
  const IconeAtual = atual.icone;

  return (
    <section aria-label="Resumo da rotina" className="mb-6 overflow-hidden rounded-2xl border border-border bg-surface-1">
      <div className="flex flex-col gap-3 border-b border-border px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-base text-text-primary">Visão da sua rotina</h2>
          <p className="mt-0.5 text-xs text-text-muted">Compare como seu tempo está distribuído. Os dados mudam enquanto você ajusta os horários.</p>
        </div>
        <div className="relative grid shrink-0 grid-cols-2 rounded-xl bg-surface-2 p-1 text-xs font-medium">
          <span aria-hidden className={`absolute bottom-1 top-1 w-[calc(50%-4px)] rounded-lg bg-[#1e4f82] shadow-sm transition-transform duration-300 ease-out ${periodo === "semana" ? "translate-x-full" : "translate-x-0"}`} />
          <button type="button" onClick={() => setPeriodo("dia")} className={`relative z-10 min-w-20 rounded-lg px-3 py-2 transition-colors ${periodo === "dia" ? "text-white" : "text-text-muted"}`}>Por dia</button>
          <button type="button" onClick={() => setPeriodo("semana")} className={`relative z-10 min-w-20 rounded-lg px-3 py-2 transition-colors ${periodo === "semana" ? "text-white" : "text-text-muted"}`}>Semana</button>
        </div>
      </div>

      <div className="grid gap-5 p-4 md:grid-cols-[minmax(0,1fr)_220px]">
        <div className="flex flex-col gap-2.5">
          {metricas.map((item) => {
            const minutos = periodo === "dia" ? item.minutosDia : item.minutosSemana;
            const ativa = item.id === atual.id;
            return (
              <button key={item.id} type="button" onClick={() => setSelecionada(item.id)} aria-pressed={ativa}
                className={`group grid grid-cols-[92px_minmax(0,1fr)_64px] items-center gap-3 rounded-xl px-2 py-1.5 text-left transition-colors ${ativa ? "bg-surface-2" : "hover:bg-surface-2/60"}`}>
                <span className={`truncate text-xs font-medium transition-colors ${ativa ? "text-text-primary" : "text-text-secondary"}`}>{item.nome}</span>
                <span className="h-2.5 overflow-hidden rounded-pill bg-surface-3">
                  <span className="block h-full rounded-pill transition-[width,background-color] duration-500 ease-out" style={{ width: `${minutos ? Math.min(100, Math.max(4, (minutos / maximo) * 100)) : 0}%`, backgroundColor: item.cor }} />
                </span>
                <span className="text-right font-mono-value text-xs text-text-secondary">{horasTexto(minutos)}</span>
              </button>
            );
          })}
          <div aria-hidden className="grid grid-cols-[92px_minmax(0,1fr)_64px] items-center gap-3 px-2">
            <span />
            <span className="flex justify-between border-t border-border pt-1 font-mono-value text-[10px] text-text-muted">
              <span>0h</span>
              <span>{periodo === "dia" ? "6h" : "42h"}</span>
              <span>{periodo === "dia" ? "12h" : "84h"}</span>
            </span>
            <span />
          </div>
        </div>

        <div className="flex min-h-40 flex-col items-center justify-center rounded-2xl border border-border bg-surface-2/60 p-4 text-center transition-colors">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl text-white shadow-sm transition-colors duration-300" style={{ backgroundColor: atual.cor }}>
            <IconeAtual size={21} strokeWidth={1.8} />
          </span>
          <strong className="mt-3 font-display text-2xl text-text-primary">{horasTexto(periodo === "dia" ? atual.minutosDia : atual.minutosSemana)}</strong>
          <span className="mt-0.5 text-xs text-text-muted">{atual.nome} {periodo === "dia" ? "por dia ativo" : "por semana"}</span>
          {periodo === "semana" && atual.minutosSemana > 0 && (
            <span className="mt-2 rounded-pill bg-surface-1 px-2.5 py-1 text-[11px] text-text-secondary">média de {horasTexto(Math.round(atual.minutosSemana / 7))}/dia</span>
          )}
        </div>
      </div>
      <p className="border-t border-border px-4 py-2.5 text-[11px] text-text-muted">Os blocos podem se sobrepor; o gráfico compara cada período configurado separadamente.</p>
    </section>
  );
}

function Cartao({ Icone, titulo, descricao, indicador, ativo, onAtivo, textoAtivo, children }: {
  Icone: typeof Moon; titulo: string; descricao: string; indicador?: string; ativo?: boolean; onAtivo?: (v: boolean) => void; textoAtivo?: string; children: React.ReactNode;
}) {
  const opcional = onAtivo !== undefined;
  return (
    <section className="rounded-2xl border border-border bg-surface-1 p-4">
      <div className="flex items-start gap-3">
        <Icone size={20} strokeWidth={1.75} className="mt-0.5 shrink-0 text-steel-300" />
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-medium text-text-primary">{titulo}</h2>
          <p className="text-xs text-text-muted">{descricao}</p>
        </div>
        {indicador && <span className="shrink-0 rounded-pill bg-steel-700/10 px-2.5 py-1 text-[11px] font-semibold text-steel-300">{indicador}</span>}
      </div>
      {opcional && (
        <label className="mt-3 flex min-h-11 cursor-pointer items-center gap-2 text-sm text-text-secondary">
          <input type="checkbox" checked={ativo} onChange={(e) => onAtivo(e.target.checked)} className="h-4 w-4 accent-steel-400" />
          {textoAtivo}
        </label>
      )}
      {(!opcional || ativo) && <div className="mt-3 flex flex-col gap-3">{children}</div>}
    </section>
  );
}

function Horarios({ rotuloInicio, rotuloFim, valor, onChange }: { rotuloInicio: string; rotuloFim: string; valor: Janela; onChange: (j: Janela) => void }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-xs text-text-muted">{rotuloInicio}</span>
        <SeletorHorario valor={valor.inicio} rotulo={rotuloInicio} onChange={(inicio) => onChange({ ...valor, inicio })} />
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-xs text-text-muted">{rotuloFim}</span>
        <SeletorHorario valor={valor.fim} rotulo={rotuloFim} onChange={(fim) => onChange({ ...valor, fim })} />
      </div>
    </div>
  );
}

const HORAS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const MINUTOS = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, "0"));

function SeletorHorario({ valor, rotulo, onChange }: { valor: string; rotulo: string; onChange: (valor: string) => void }) {
  const [aberto, setAberto] = useState(false);
  const raiz = useRef<HTMLDivElement>(null);
  const [hora = "00", minutoOriginal = "00"] = valor.split(":");
  const minuto = MINUTOS.includes(minutoOriginal) ? minutoOriginal : minutoOriginal;

  useEffect(() => {
    if (!aberto) return;
    const fechar = (evento: PointerEvent) => {
      if (!raiz.current?.contains(evento.target as Node)) setAberto(false);
    };
    document.addEventListener("pointerdown", fechar);
    return () => document.removeEventListener("pointerdown", fechar);
  }, [aberto]);

  return (
    <div ref={raiz} className="relative min-w-0">
      <button type="button" aria-label={`${rotulo}: ${valor}`} aria-haspopup="listbox" aria-expanded={aberto}
        onClick={() => setAberto((atual) => !atual)}
        className={`flex h-11 w-full items-center gap-2 rounded-xl border px-3 text-left font-mono-value text-sm transition-colors ${aberto ? "border-steel-400 bg-surface-1 ring-2 ring-steel-400/15" : "border-border bg-surface-2 hover:border-steel-300"}`}>
        <Clock3 size={16} className="shrink-0 text-steel-300" strokeWidth={1.8} />
        <span className="min-w-0 flex-1 text-text-primary">{valor}</span>
        <ChevronDown size={15} className={`shrink-0 text-text-muted transition-transform duration-200 ${aberto ? "rotate-180" : ""}`} />
      </button>

      {aberto && (
        <div className="absolute left-0 top-[calc(100%+6px)] z-50 w-full min-w-[156px] overflow-hidden rounded-2xl border border-border bg-surface-1 p-2 shadow-xl shadow-black/20 animate-in fade-in zoom-in-95 duration-150">
          <div className="mb-1 grid grid-cols-2 px-1 text-center text-[10px] font-semibold uppercase tracking-wider text-text-muted">
            <span>Hora</span><span>Min</span>
          </div>
          <div className="grid grid-cols-2 gap-1">
            <div role="listbox" aria-label="Hora" className="ecos-scrollbar max-h-48 overflow-y-auto pr-0.5">
              {HORAS.map((opcao) => (
                <button key={opcao} type="button" role="option" aria-selected={hora === opcao}
                  onClick={() => onChange(`${opcao}:${minuto}`)}
                  className={`mb-0.5 flex h-9 w-full items-center justify-center rounded-lg font-mono-value text-sm transition-colors ${hora === opcao ? "bg-[#1e4f82] font-semibold text-white" : "text-text-secondary hover:bg-surface-2 hover:text-text-primary"}`}>
                  {opcao}
                </button>
              ))}
            </div>
            <div role="listbox" aria-label="Minutos" className="ecos-scrollbar max-h-48 overflow-y-auto pl-0.5">
              {MINUTOS.map((opcao) => (
                <button key={opcao} type="button" role="option" aria-selected={minuto === opcao}
                  onClick={() => { onChange(`${hora}:${opcao}`); setAberto(false); }}
                  className={`mb-0.5 flex h-9 w-full items-center justify-center rounded-lg font-mono-value text-sm transition-colors ${minuto === opcao ? "bg-[#1e4f82] font-semibold text-white" : "text-text-secondary hover:bg-surface-2 hover:text-text-primary"}`}>
                  {opcao}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Dias({ valor, onChange }: { valor: number[]; onChange: (d: number[]) => void }) {
  return (
    <div role="group" aria-label="Dias da semana" className="flex flex-wrap gap-1.5">
      {DIAS.map(([rotulo, n]) => {
        const marcado = valor.includes(n);
        return (
          <button key={n} type="button" aria-pressed={marcado}
            onClick={() => onChange(marcado ? valor.filter((d) => d !== n) : [...valor, n])}
            className={`min-h-9 min-w-11 rounded-pill px-3 text-xs font-medium ${marcado ? "bg-steel-700 text-white" : "bg-surface-2 text-text-muted"}`}>
            {rotulo}
          </button>
        );
      })}
    </div>
  );
}
