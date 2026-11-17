import { CalendarClock, CalendarDays, ChevronRight, Globe2, Ruler } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { TOM } from "@/components/common/MenuSuspenso";
import { Toggle } from "@/components/common/Toggle";
import { GoogleCalendarCard } from "./GoogleCalendarCard";
import { Cabecalho, Linha, Secao, Seletor, usePreferencias } from "./campos-config";
import { useCalendarioDaConta } from "./use-calendario-conta";

const ENCAIXES = [5, 10, 15, 30, 60].map((min) => ({ valor: String(min), rotulo: `${min} min`, icone: Ruler, cor: TOM.ciano }));

/** A Agenda e os calendários de fora. País, fuso e formato de data ficam em Idioma e região. */
export function CalendarPreferencesScreen() {
  const navigate = useNavigate();
  const [prefs, alterar] = usePreferencias();
  const [calendario, alterarCalendario, aviso] = useCalendarioDaConta();

  return (
    <div className="px-4 pt-[calc(env(safe-area-inset-top)+12px)] pb-nav-safe">
      <Cabecalho titulo="Calendário e agenda" />

      <Secao titulo="Agenda">
        <Linha Icone={CalendarClock} titulo="Mostrar prazos no calendário" descricao="Marca na Agenda as tarefas que têm prazo. Fica na sua conta e vale em todos os aparelhos.">
          <Toggle checked={calendario.deadlines} onChange={(deadlines) => alterarCalendario({ deadlines })} label="Mostrar prazos no calendário" />
        </Linha>
        <Linha Icone={Ruler} titulo="Encaixe inicial" descricao="Passo ao arrastar e redimensionar blocos. Dá para trocar a qualquer momento na própria Agenda.">
          <Seletor valor={String(prefs.agendaEncaixe)} opcoes={ENCAIXES} onChange={(v) => alterar({ agendaEncaixe: Number(v) as typeof prefs.agendaEncaixe })} label="Encaixe inicial da Agenda" />
        </Linha>
        <Linha Icone={Globe2} titulo="Fuso, semana e formato de data" descricao="País, fuso horário, primeiro dia da semana e formato das datas.">
          <button type="button" onClick={() => navigate("/configuracoes/idioma-regiao")} className="flex min-h-10 shrink-0 items-center gap-1 rounded-xl border border-border bg-surface-2 px-3 text-sm text-text-primary hover:bg-surface-3">Idioma e região<ChevronRight size={15} className="text-text-muted" /></button>
        </Linha>
      </Secao>
      {aviso && <p role={aviso.tipo === "ok" ? "status" : "alert"} className={`mt-3 text-sm ${aviso.tipo === "ok" ? "text-success" : "text-error"}`}>{aviso.texto}</p>}

      <section className="mt-6" data-config="integracoes-de-calendario">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Integrações de calendário</p>
        <div className="rounded-2xl border border-border bg-surface-1 p-4">
          <p className="mb-3 text-sm text-text-secondary">Conecte seus calendários para reunir eventos externos na Agenda.</p>
          <div className="space-y-2"><GoogleCalendarCard /><Integracao nome="Outlook Calendar" descricao="Calendário Microsoft 365 e Outlook" /><Integracao nome="iCal / CalDAV" descricao="Apple Calendar e outros calendários compatíveis" /></div>
        </div>
      </section>
    </div>
  );
}

/** Só o nome em texto (referência nominativa): sem logos de terceiros, que são marcas registradas. */
/** Integração ainda inexistente: cartão informativo "Em breve", sem ação e sem chamada ao servidor. */
function Integracao({ nome, descricao }: { nome: string; descricao: string }) { return <div className="flex w-full items-center gap-3 rounded-xl border border-border bg-base p-3 opacity-80"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-surface-2 text-steel-300"><CalendarDays size={18} aria-hidden="true" /></span><span className="min-w-0 flex-1"><span className="block text-sm font-medium text-text-primary">{nome}</span><span className="block truncate text-xs text-text-muted">{descricao}</span></span><span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-xs text-text-muted">Em breve</span></div>; }
