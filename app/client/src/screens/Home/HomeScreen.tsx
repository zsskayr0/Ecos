import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarDays, CalendarClock, ListChecks, PenLine, Plus, Search, StickyNote, Zap } from "lucide-react";
import { notas, tarefas, type NotaResumo, type TarefaResumo } from "@/lib/api";
import { nomeExibicao, useAuth } from "@/lib/auth-context";
import { dataLocalISO, somarDiasISO } from "@/lib/agenda-tempo";
import { useAppUI } from "@/lib/ui-context";
import { useRefreshBus } from "@/lib/refresh-bus";
import { useEspacoFiltro } from "@/lib/use-espaco-filtro";
import { useEventosDoPeriodo } from "@/lib/eventos-agenda";
import { useAbrirDocumento } from "@/lib/documento-popup";
import { useWorkspaceOpcional } from "@/desktop/workspace-store";
import { EstadoCarregando } from "@/components/common/EstadoCarregando";
import { EstadoErro } from "@/components/common/EstadoErro";
import { mensagemDeErro } from "@/lib/erros";
import { saudacaoDoDia } from "./saudacao";

type Recente = { chave: string; titulo: string; tipo: "nota" | "tarefa"; caminho: string; em: string };

const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

/**
 * Tela inicial do desktop: saudação, atalhos, resumo do dia (tarefas de hoje e próximos eventos) e itens recentes.
 * É a aba que o workspace mostra quando não há mais nenhuma.
 */
export function HomeScreen() {
  const { perfil } = useAuth();
  const { abrirCaptura } = useAppUI();
  const { versao } = useRefreshBus();
  const abrirDocumento = useAbrirDocumento();
  const workspace = useWorkspaceOpcional();
  const navigate = useNavigate();
  const espaco = useEspacoFiltro();
  const agora = useMemo(() => new Date(), []);
  const hoje = dataLocalISO(agora);
  const { saudacao, frase } = saudacaoDoDia(agora, perfil ? nomeExibicao(perfil) : "");

  const [doDia, setDoDia] = useState<TarefaResumo[] | null>(null);
  const [recentes, setRecentes] = useState<Recente[] | null>(null);
  const [erroDia, setErroDia] = useState<string | null>(null);
  const [erroRecentes, setErroRecentes] = useState<string | null>(null);
  const [tentativa, setTentativa] = useState(0);
  const { eventos } = useEventosDoPeriodo(hoje, somarDiasISO(hoje, 7), versao, espaco);

  useEffect(() => {
    let vivo = true;
    const tz = -new Date().getTimezoneOffset();
    setErroDia(null);
    setErroRecentes(null);
    tarefas.listar({ status: "pendente", data_de: hoje, data_ate: hoje, espaco, tz, limit: 50 })
      .then((r) => { if (vivo) setDoDia(r.items); })
      .catch((e) => { if (vivo) { setErroDia(mensagemDeErro(e, "Não foi possível carregar o dia.")); setDoDia([]); } });
    Promise.all([notas.listar({ espaco, limit: 8 }), tarefas.listar({ espaco, limit: 8 })])
      .then(([n, t]) => {
        if (!vivo) return;
        const itens: Recente[] = [
          ...n.items.map((x: NotaResumo) => ({ chave: `n-${x.id}`, titulo: x.titulo || "Sem título", tipo: "nota" as const, caminho: `/notas/nota/${x.id}`, em: x.atualizado_em ?? x.criado_em })),
          ...t.items.map((x: TarefaResumo) => ({ chave: `t-${x.id}`, titulo: x.titulo, tipo: "tarefa" as const, caminho: `/tarefa/${x.id}`, em: x.atualizado_em ?? x.criado_em })),
        ];
        setRecentes(itens.sort((a, b) => b.em.localeCompare(a.em)).slice(0, 6));
      })
      .catch((e) => { if (vivo) { setErroRecentes(mensagemDeErro(e, "Não foi possível carregar os itens recentes.")); setRecentes([]); } });
    return () => { vivo = false; };
  }, [hoje, espaco, versao, tentativa]);

  const minutosAgora = agora.getHours() * 60 + agora.getMinutes();
  const proximos = eventos
    .filter((e) => e.inicio > hoje || (e.inicio === hoje && (e.minutos === null || e.minutos + e.duracaoMin >= minutosAgora)))
    .sort((a, b) => a.inicio.localeCompare(b.inicio) || (a.minutos ?? -1) - (b.minutos ?? -1))
    .slice(0, 5);

  const abrirModulo = (path: string) => (workspace ? workspace.dispatch({ type: "open", path, where: "focused", reuse: "modulo" }) : navigate(path));
  // A paleta é do shell do desktop e escuta Ctrl+K na janela: o botão dispara o mesmo atalho.
  const abrirBusca = () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }));

  const atalhos = [
    { rotulo: "Nova nota", icone: StickyNote, aoClicar: () => abrirCaptura("nota") },
    { rotulo: "Nova tarefa", icone: ListChecks, aoClicar: () => abrirCaptura("tarefa") },
    { rotulo: "Capturar", icone: Zap, aoClicar: () => abrirCaptura("escolha") },
    { rotulo: "Abrir Agenda", icone: CalendarDays, aoClicar: () => abrirModulo("/agenda") },
    { rotulo: "Buscar", icone: Search, dica: "Ctrl+K", aoClicar: abrirBusca },
  ];

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-6 py-8">
      <header className="ecos-home-entrada">
        <h1 className="font-display text-3xl text-text-primary">{saudacao}</h1>
        <p className="mt-1 text-[15px] text-text-secondary">{frase}</p>
      </header>

      <section aria-label="Ações rápidas" className="ecos-home-entrada flex flex-wrap gap-2" style={{ animationDelay: "60ms" }}>
        {atalhos.map(({ rotulo, icone: Icone, dica, aoClicar }) => (
          <button key={rotulo} type="button" onClick={aoClicar} className="flex min-h-11 items-center gap-2 rounded-xl border border-border bg-surface-1 px-4 text-sm font-medium text-text-primary hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-steel-400">
            <Icone size={16} aria-hidden className="text-steel-300" />{rotulo}
            {dica && <kbd className="rounded border border-border bg-surface-3 px-1.5 py-0.5 font-mono text-[10px] text-text-secondary">{dica}</kbd>}
          </button>
        ))}
      </section>

      <div className="ecos-home-entrada grid gap-6 md:grid-cols-2" style={{ animationDelay: "120ms" }}>
        <section aria-label="Resumo do dia" className="rounded-2xl border border-border bg-surface-1 p-4">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-text-primary"><ListChecks size={16} aria-hidden />Tarefas de hoje{doDia && doDia.length > 0 && <span className="font-normal text-text-muted">· {doDia.length}</span>}</h2>
          {erroDia && <EstadoErro mensagem={erroDia} onTentarDeNovo={() => setTentativa((n) => n + 1)} />}
          {doDia === null ? <EstadoCarregando /> : doDia.length === 0 ? (
            !erroDia && <p className="text-sm text-text-muted">Nada agendado para hoje. Que tal capturar algo novo?</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {doDia.slice(0, 6).map((t) => (
                <li key={t.id}><button type="button" onClick={(e) => abrirDocumento(`/tarefa/${t.id}`, e)} title={t.titulo} className="w-full truncate rounded-lg px-2 py-1.5 text-left text-sm text-text-primary hover:bg-surface-2">{t.titulo}</button></li>
              ))}
              {doDia.length > 6 && <li><button type="button" onClick={() => abrirModulo("/hoje")} className="px-2 py-1 text-xs text-steel-300 hover:underline">Ver todas em Hoje (+{doDia.length - 6})</button></li>}
            </ul>
          )}
        </section>

        <section aria-label="Próximos eventos" className="rounded-2xl border border-border bg-surface-1 p-4">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-text-primary"><CalendarClock size={16} aria-hidden />Próximos eventos</h2>
          {proximos.length === 0 ? <p className="text-sm text-text-muted">Nenhum evento nos próximos 7 dias.</p> : (
            <ul className="flex flex-col gap-1">
              {proximos.map((e) => (
                <li key={`${e.id}-${e.inicio}`} className="flex items-baseline gap-2 px-2 py-1.5 text-sm text-text-primary" title={e.titulo}>
                  <span className="shrink-0 font-mono-value text-xs text-text-muted">{e.inicio === hoje ? "Hoje" : e.inicio.split("-").reverse().slice(0, 2).join("/")}{e.minutos !== null ? ` ${hhmm(e.minutos)}` : ""}</span>
                  <span className="min-w-0 truncate">{e.titulo}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section aria-label="Itens recentes" className="ecos-home-entrada" style={{ animationDelay: "180ms" }}>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-text-primary"><PenLine size={16} aria-hidden />Recentes</h2>
        {erroRecentes && <EstadoErro mensagem={erroRecentes} onTentarDeNovo={() => setTentativa((n) => n + 1)} />}
        {recentes === null ? <EstadoCarregando /> : recentes.length === 0 ? (
          !erroRecentes && <p className="flex items-center gap-2 text-sm text-text-muted"><Plus size={14} aria-hidden />Suas notas e tarefas recentes aparecem aqui.</p>
        ) : (
          <ul className="grid gap-1 md:grid-cols-2">
            {recentes.map((r) => (
              <li key={r.chave}><button type="button" onClick={(e) => abrirDocumento(r.caminho, e)} title={r.titulo} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-text-primary hover:bg-surface-2">
                {r.tipo === "nota" ? <StickyNote size={14} aria-hidden className="shrink-0 text-text-muted" /> : <ListChecks size={14} aria-hidden className="shrink-0 text-text-muted" />}
                <span className="min-w-0 truncate">{r.titulo}</span>
              </button></li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
