import { useEffect, useRef, useState } from "react";
import { CalendarDays, CalendarRange, ChevronDown, Clock3, Globe2, Languages } from "lucide-react";
import { MenuSuspenso, TOM } from "@/components/common/MenuSuspenso";
import { Toggle } from "@/components/common/Toggle";
import { PainelMundo, type ModoPainel } from "@/components/common/globo/PainelMundo";
import type { FormatoData } from "@/lib/preferencias-aplicativo";
import { Cabecalho, Linha, Secao, Seletor, usePreferencias } from "./campos-config";
import { useCalendarioDaConta } from "./use-calendario-conta";
import { IDIOMAS } from "./idiomas";

const PAISES = ["Brasil", "Portugal", "Estados Unidos", "Canadá", "México", "Argentina", "Chile", "Colômbia", "Uruguai", "Reino Unido", "Espanha", "França", "Alemanha", "Itália", "Países Baixos", "Suíça", "Japão", "China", "Índia", "Austrália"]
  .map((valor) => ({ valor, rotulo: valor, icone: Globe2, cor: TOM.aco }));

const FUSOS = [
  ["America/Noronha", "(GMT-02:00) Fernando de Noronha"], ["America/Sao_Paulo", "(GMT-03:00) São Paulo"], ["America/Manaus", "(GMT-04:00) Manaus"], ["America/Rio_Branco", "(GMT-05:00) Rio Branco"],
  ["America/Argentina/Buenos_Aires", "(GMT-03:00) Buenos Aires"], ["America/Santiago", "Santiago (CLT)"], ["America/Montevideo", "(GMT-03:00) Montevidéu"], ["America/Bogota", "(GMT-05:00) Bogotá"],
  ["America/Mexico_City", "Cidade do México (CT)"], ["America/New_York", "Nova York (ET)"], ["America/Chicago", "Chicago (CT)"], ["America/Denver", "Denver (MT)"], ["America/Los_Angeles", "Los Angeles (PT)"],
  ["America/Toronto", "Toronto (ET)"], ["America/Vancouver", "Vancouver (PT)"], ["Europe/Lisbon", "Lisboa (WET)"], ["Europe/London", "Londres (GMT)"], ["Europe/Madrid", "Madri (CET)"],
  ["Europe/Paris", "Paris (CET)"], ["Europe/Berlin", "Berlim (CET)"], ["Europe/Rome", "Roma (CET)"], ["Europe/Amsterdam", "Amsterdã (CET)"], ["Europe/Zurich", "Zurique (CET)"],
  ["Asia/Tokyo", "(GMT+09:00) Tóquio"], ["Asia/Shanghai", "(GMT+08:00) Xangai"], ["Asia/Kolkata", "(GMT+05:30) Índia"], ["Australia/Sydney", "Sydney (AET)"], ["UTC", "(GMT+00:00) UTC"],
].map(([valor, rotulo]) => ({ valor, rotulo, icone: Clock3, cor: TOM.ciano }));

const FUSO_DO_PAIS: Record<string, string> = { Brasil: "America/Sao_Paulo", Portugal: "Europe/Lisbon", "Estados Unidos": "America/New_York", Canadá: "America/Toronto", México: "America/Mexico_City", Argentina: "America/Argentina/Buenos_Aires", Chile: "America/Santiago", Colômbia: "America/Bogota", Uruguai: "America/Montevideo", "Reino Unido": "Europe/London", Espanha: "Europe/Madrid", França: "Europe/Paris", Alemanha: "Europe/Berlin", Itália: "Europe/Rome", "Países Baixos": "Europe/Amsterdam", Suíça: "Europe/Zurich", Japão: "Asia/Tokyo", China: "Asia/Shanghai", Índia: "Asia/Kolkata", Austrália: "Australia/Sydney" };

const ROTULO_FORMATO_DATA: Record<FormatoData, string> = { completa: "Data completa", curta: "Data curta", mdy: "Mês/Dia/Ano", dmy: "Dia/Mês/Ano", ymd: "Ano/Mês/Dia", relativo: "Relativo" };
const FORMATOS_DATA = (Object.keys(ROTULO_FORMATO_DATA) as FormatoData[]).map((valor) => ({ valor, rotulo: ROTULO_FORMATO_DATA[valor], icone: CalendarDays, cor: TOM.aco }));

const CLASSE_GATILHO = "flex min-h-11 w-full items-center gap-2 rounded-xl bg-surface-2 px-3 text-left text-sm font-medium text-text-primary transition-colors hover:bg-surface-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-steel-400";

/** Em que língua o Ecos fala, onde a pessoa está e como datas aparecem. País e fuso ficam na conta; o resto, neste aparelho. */
export function IdiomaRegiaoScreen() {
  const [prefs, alterar] = usePreferencias();
  const [calendario, alterarCalendario, aviso] = useCalendarioDaConta();
  const { pais, fuso } = calendario;
  // Enquanto o seletor de fuso está aberto o globo dá lugar ao mapa de fusos; ele volta um instante depois de fechar.
  const [modoPainel, setModoPainel] = useState<ModoPainel>("globo");
  const voltarAoGlobo = useRef<number>();
  useEffect(() => () => window.clearTimeout(voltarAoGlobo.current), []);
  function aoAbrirFuso(aberto: boolean) {
    window.clearTimeout(voltarAoGlobo.current);
    if (aberto) setModoPainel("fusos");
    else voltarAoGlobo.current = window.setTimeout(() => setModoPainel("globo"), 1800);
  }

  return (
    <div className="px-4 pt-[calc(env(safe-area-inset-top)+12px)] pb-nav-safe">
      <Cabecalho titulo="Idioma e região" />

      <Secao titulo="Idioma">
        <Linha Icone={Languages} titulo="Idioma" descricao="Altera o idioma de exibição do aplicativo. O idioma do corretor ortográfico fica em Editor e escrita.">
          <Seletor valor={prefs.idioma} opcoes={IDIOMAS} onChange={(idioma) => alterar({ idioma })} label="Idioma do aplicativo" />
        </Linha>
      </Secao>

      <section className="mt-6">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Onde você está</p>
        <div className="rounded-2xl border border-border bg-surface-1 p-4">
          {/* O globo abre ao lado dos campos (acima deles no celular) e gira até o país escolhido. */}
          <div className="md:grid md:grid-cols-[minmax(0,1fr)_300px] md:items-start md:gap-6">
            <PainelMundo pais={pais} fuso={fuso} rotuloFuso={FUSOS.find((f) => f.valor === fuso)?.rotulo ?? fuso} modo={modoPainel} className="mb-4 md:col-start-2 md:row-start-1 md:mb-0" />
            <div className="md:col-start-1 md:row-start-1">
              <div data-config="pais">
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-text-muted">País</p>
                <MenuSuspenso valor={pais} opcoes={PAISES} onChange={(novo) => alterarCalendario({ pais: novo, fuso: FUSO_DO_PAIS[novo] ?? "UTC" })} ariaLabel="Selecionar país" larguraMenu="w-full" classeGatilho={CLASSE_GATILHO} gatilho={({ aberto, atual }) => <><Globe2 size={16} className="shrink-0 text-steel-300" /><span className="min-w-0 flex-1 truncate">{atual?.rotulo ?? pais}</span><ChevronDown size={15} className={`shrink-0 text-text-muted transition-transform duration-150 ${aberto ? "rotate-180" : ""}`} /></>} />
              </div>
              <div data-config="fuso-horario" className="mt-3">
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-text-muted">Fuso horário</p>
                <MenuSuspenso valor={fuso} opcoes={FUSOS} onChange={(novo) => alterarCalendario({ fuso: novo })} onAbrirChange={aoAbrirFuso} ariaLabel="Selecionar fuso horário" larguraMenu="w-full" classeGatilho={CLASSE_GATILHO} gatilho={({ aberto, atual }) => <><Clock3 size={16} className="shrink-0 text-cyan" /><span className="min-w-0 flex-1 truncate">{atual?.rotulo ?? fuso}</span><ChevronDown size={15} className={`shrink-0 text-text-muted transition-transform duration-150 ${aberto ? "rotate-180" : ""}`} /></>} />
              </div>
              <p className="mt-3 text-xs leading-relaxed text-text-muted">País e fuso ficam na sua conta e valem em todos os aparelhos. Trocar o país ajusta o fuso sozinho.</p>
              {aviso && <p role={aviso.tipo === "ok" ? "status" : "alert"} className={`mt-2 text-sm ${aviso.tipo === "ok" ? "text-success" : "text-error"}`}>{aviso.texto}</p>}
            </div>
          </div>
        </div>
      </section>

      <Secao titulo="Datas">
        <Linha Icone={CalendarDays} titulo="Formato de data" descricao="Como as datas aparecem em listas, notas e tarefas.">
          <Seletor valor={prefs.formatoData} opcoes={FORMATOS_DATA} onChange={(formatoData) => alterar({ formatoData })} label="Formato de data" />
        </Linha>
        <Linha Icone={CalendarRange} titulo="Iniciar semana na segunda-feira" descricao="Vale para a Agenda e para os seletores de data. Desligado, a semana começa no domingo.">
          <Toggle checked={prefs.semanaComecaSegunda} onChange={(semanaComecaSegunda) => alterar({ semanaComecaSegunda })} label="Iniciar semana na segunda-feira" />
        </Linha>
      </Secao>
    </div>
  );
}
