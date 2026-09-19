import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AlertTriangle, Briefcase, ChevronLeft, Moon, Sun, Utensils, Car, Sparkles, Coffee } from "lucide-react";
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

/**
 * "Ajustar rotina": perguntas sobre sono, trabalho e o resto do dia. As respostas viram os blocos de rotina
 * (`/rotina/blocos`) que a Agenda usa para saber quanto tempo o dia realmente tem. Serve tanto no primeiro uso
 * (`?onboarding=1`) quanto para quem já tem conta e quer mudar depois — refazer atualiza os blocos existentes.
 */
export function RotinaScreen() {
  const navigate = useNavigate();
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

  const sair = () => navigate(primeiraVez ? "/feed" : "/perfil");
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
    <div className="mx-auto max-w-xl px-4 pt-[calc(env(safe-area-inset-top)+12px)] pb-nav-safe">
      <button onClick={sair} className="mb-4 flex items-center gap-1 text-sm text-text-muted">
        <ChevronLeft size={18} />
        {primeiraVez ? "Pular por enquanto" : "Voltar"}
      </button>
      <h1 className="font-display text-2xl text-text-primary">{primeiraVez ? "Conte sobre a sua rotina" : "Ajustar rotina"}</h1>
      <p className="mb-6 mt-1 text-sm text-text-secondary">
        Com isso a Agenda sabe quantas horas do dia são suas de verdade e avisa quando as tarefas não cabem. Dá para mudar quando quiser.
      </p>

      <div className="flex flex-col gap-4">
        <Cartao Icone={Moon} titulo="Sono" descricao="Quando você costuma dormir e acordar?">
          <Horarios rotuloInicio="Vou dormir" rotuloFim="Acordo" valor={estado.sono} onChange={(sono) => atualizar({ sono })} />
        </Cartao>

        <Cartao Icone={Briefcase} titulo="Trabalho ou estudo fixo" descricao="Horário em que você não está disponível para outras tarefas."
          ativo={estado.trabalha} onAtivo={(trabalha) => atualizar({ trabalha })} textoAtivo="Tenho horário fixo">
          <Horarios rotuloInicio="Começo" rotuloFim="Termino" valor={estado.trabalho} onChange={(trabalho) => atualizar({ trabalho })} />
          <Dias valor={estado.diasTrabalho} onChange={(diasTrabalho) => atualizar({ diasTrabalho })} />
        </Cartao>

        <Cartao Icone={Utensils} titulo="Refeição principal" descricao="Almoço ou o intervalo em que você para de vez."
          ativo={estado.almoco} onAtivo={(almoco) => atualizar({ almoco })} textoAtivo="Reservar esse horário">
          <Horarios rotuloInicio="De" rotuloFim="Até" valor={estado.almocoJanela} onChange={(almocoJanela) => atualizar({ almocoJanela })} />
        </Cartao>

        <Cartao Icone={Car} titulo="Deslocamento" descricao="Ida e volta ou o trajeto que mais pesa no seu dia."
          ativo={estado.desloca} onAtivo={(desloca) => atualizar({ desloca })} textoAtivo="Tenho deslocamento">
          <Horarios rotuloInicio="De" rotuloFim="Até" valor={estado.deslocamento} onChange={(deslocamento) => atualizar({ deslocamento })} />
        </Cartao>

        <Cartao Icone={Sun} titulo="Horário de produção" descricao="Quando você costuma cuidar das suas tarefas? É a capacidade que a Agenda usa para avisar quando não cabe."
          ativo={estado.produz} onAtivo={(produz) => atualizar({ produz })} textoAtivo="Definir horário">
          <Horarios rotuloInicio="Das" rotuloFim="Até" valor={estado.producao} onChange={(producao) => atualizar({ producao })} />
          <Dias valor={estado.diasProducao} onChange={(diasProducao) => atualizar({ diasProducao })} />
        </Cartao>

        <Cartao Icone={Coffee} titulo="Tempo livre" descricao="Lazer e descanso que você quer proteger."
          ativo={estado.livre} onAtivo={(livre) => atualizar({ livre })} textoAtivo="Proteger esse horário">
          <Horarios rotuloInicio="Das" rotuloFim="Até" valor={estado.tempoLivre} onChange={(tempoLivre) => atualizar({ tempoLivre })} />
        </Cartao>
      </div>

      {erro && (
        <div role="alert" className="mt-4 flex items-start gap-2 rounded-2xl border border-error/40 bg-error/10 p-3 text-sm text-error">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" strokeWidth={1.75} />
          {erro}
        </div>
      )}

      <button onClick={salvar} disabled={salvando || !valido}
        className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl bg-steel-700 py-3.5 font-body text-[15px] font-semibold text-white disabled:opacity-40">
        <Sparkles size={16} />
        {salvando ? "Salvando..." : "Salvar rotina"}
      </button>
      {!valido && <p className="mt-2 text-center text-xs text-text-muted">Confira os horários: início e fim precisam ser diferentes, e escolha ao menos um dia.</p>}
    </div>
  );
}

function Cartao({ Icone, titulo, descricao, ativo, onAtivo, textoAtivo, children }: {
  Icone: typeof Moon; titulo: string; descricao: string; ativo?: boolean; onAtivo?: (v: boolean) => void; textoAtivo?: string; children: React.ReactNode;
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
      <label className="flex flex-col gap-1">
        <span className="text-xs text-text-muted">{rotuloInicio}</span>
        <input type="time" value={valor.inicio} onChange={(e) => onChange({ ...valor, inicio: e.target.value })} className="ecos-input font-mono-value" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-text-muted">{rotuloFim}</span>
        <input type="time" value={valor.fim} onChange={(e) => onChange({ ...valor, fim: e.target.value })} className="ecos-input font-mono-value" />
      </label>
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
