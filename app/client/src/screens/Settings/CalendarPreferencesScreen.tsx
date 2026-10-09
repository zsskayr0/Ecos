import { useEffect, useRef, useState } from "react";
import { CalendarDays, ChevronDown, ChevronLeft, Clock3, Globe2, Link2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { MenuSuspenso, TOM } from "@/components/common/MenuSuspenso";
import { Toggle } from "@/components/common/Toggle";
import { PainelMundo, type ModoPainel } from "@/components/common/globo/PainelMundo";
import { GoogleCalendarCard } from "./GoogleCalendarCard";
import { lerPreferenciasCalendario, salvarPreferenciasCalendario } from "@/lib/preferencias-calendario";
import { lerPreferenciasAplicativo, salvarPreferenciasAplicativo, type FormatoData } from "@/lib/preferencias-aplicativo";

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

const ROTULO_FORMATO_DATA: Record<FormatoData, string> = { completa: "Data completa", curta: "Data curta", mdy: "Mês/Dia/Ano", dmy: "Dia/Mês/Ano", ymd: "Ano/Mês/Dia", relativo: "Relativo" };
const FORMATOS_DATA = (Object.keys(ROTULO_FORMATO_DATA) as FormatoData[]).map((valor) => ({ valor, rotulo: ROTULO_FORMATO_DATA[valor], icone: CalendarDays, cor: TOM.aco }));

const FUSO_DO_PAIS: Record<string, string> = { Brasil: "America/Sao_Paulo", Portugal: "Europe/Lisbon", "Estados Unidos": "America/New_York", Canadá: "America/Toronto", México: "America/Mexico_City", Argentina: "America/Argentina/Buenos_Aires", Chile: "America/Santiago", Colômbia: "America/Bogota", Uruguai: "America/Montevideo", "Reino Unido": "Europe/London", Espanha: "Europe/Madrid", França: "Europe/Paris", Alemanha: "Europe/Berlin", Itália: "Europe/Rome", "Países Baixos": "Europe/Amsterdam", Suíça: "Europe/Zurich", Japão: "Asia/Tokyo", China: "Asia/Shanghai", Índia: "Asia/Kolkata", Austrália: "Australia/Sydney" };
const CLASSE_GATILHO = "flex min-h-11 w-full items-center gap-2 rounded-xl bg-surface-2 px-3 text-left text-sm font-medium text-text-primary transition-colors hover:bg-surface-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-steel-400";

export function CalendarPreferencesScreen() {
  const navigate = useNavigate();
  const salvo = lerPreferenciasCalendario();
  const [pais, setPais] = useState(salvo.pais ?? "Brasil");
  const [fuso, setFuso] = useState(salvo.fuso ?? "America/Sao_Paulo");
  const inicio = salvo.inicio ?? "06:00";
  const [deadlines, setDeadlines] = useState(salvo.deadlines ?? true);
  const [mensagem, setMensagem] = useState("");
  // Enquanto o seletor de fuso está aberto o globo dá lugar ao mapa de fusos; ele volta um instante depois de fechar.
  const [modoPainel, setModoPainel] = useState<ModoPainel>("globo");
  const voltarAoGlobo = useRef<number>();
  useEffect(() => () => window.clearTimeout(voltarAoGlobo.current), []);
  function aoAbrirFuso(aberto: boolean) {
    window.clearTimeout(voltarAoGlobo.current);
    if (aberto) setModoPainel("fusos");
    else voltarAoGlobo.current = window.setTimeout(() => setModoPainel("globo"), 1800);
  }
  // Formato de data e início da semana são preferências do app: valem na hora, sem passar pelo "Salvar".
  const [app, setApp] = useState(lerPreferenciasAplicativo);
  const alterarApp = (patch: Partial<ReturnType<typeof lerPreferenciasAplicativo>>) => setApp((atual) => { const proxima = { ...atual, ...patch }; salvarPreferenciasAplicativo(proxima); return proxima; });
  function mudarPais(novoPais: string) { setPais(novoPais); setFuso(FUSO_DO_PAIS[novoPais] ?? "UTC"); setMensagem(""); }
  function salvar() { salvarPreferenciasCalendario({ pais, fuso, inicio, deadlines }); setMensagem("Preferências salvas neste dispositivo."); }

  return <div className="px-4 pt-[calc(env(safe-area-inset-top)+12px)] pb-nav-safe">
    <div className="mb-5 flex items-center gap-2"><button data-voltar onClick={() => navigate(-1)} className="text-text-muted"><ChevronLeft size={22} /></button><h1 className="font-display text-xl text-text-primary">Calendário e localização</h1></div>
    <Secao titulo="Localização">
      {/* O globo abre ao lado dos campos (acima deles no celular) e gira até o país escolhido. */}
      <div className="md:grid md:grid-cols-[minmax(0,1fr)_300px] md:items-start md:gap-6">
      <PainelMundo pais={pais} fuso={fuso} rotuloFuso={FUSOS.find((f) => f.valor === fuso)?.rotulo ?? fuso} modo={modoPainel} className="mb-4 md:col-start-2 md:row-start-1 md:mb-0" />
      <div className="md:col-start-1 md:row-start-1">
      <CampoMenu rotulo="País"><MenuSuspenso valor={pais} opcoes={PAISES} onChange={mudarPais} ariaLabel="Selecionar país" larguraMenu="w-full" classeGatilho={CLASSE_GATILHO} gatilho={({ aberto, atual }) => <><Globe2 size={16} className="shrink-0 text-steel-300" /><span className="min-w-0 flex-1 truncate">{atual?.rotulo ?? pais}</span><ChevronDown size={15} className={`shrink-0 text-text-muted transition-transform duration-150 ${aberto ? "rotate-180" : ""}`} /></>} /></CampoMenu>
      <CampoMenu rotulo="Fuso horário" margem><MenuSuspenso valor={fuso} opcoes={FUSOS} onChange={(valor) => { setFuso(valor); setMensagem(""); }} onAbrirChange={aoAbrirFuso} ariaLabel="Selecionar fuso horário" larguraMenu="w-full" classeGatilho={CLASSE_GATILHO} gatilho={({ aberto, atual }) => <><Clock3 size={16} className="shrink-0 text-cyan" /><span className="min-w-0 flex-1 truncate">{atual?.rotulo ?? fuso}</span><ChevronDown size={15} className={`shrink-0 text-text-muted transition-transform duration-150 ${aberto ? "rotate-180" : ""}`} /></>} /></CampoMenu>
      <CampoMenu rotulo="Formato de data" margem><MenuSuspenso valor={app.formatoData} opcoes={FORMATOS_DATA} onChange={(formatoData) => alterarApp({ formatoData })} ariaLabel="Formato de data" larguraMenu="w-full" classeGatilho={CLASSE_GATILHO} gatilho={({ aberto, atual }) => <><CalendarDays size={16} className="shrink-0 text-steel-300" /><span className="min-w-0 flex-1 truncate">{atual?.rotulo}</span><ChevronDown size={15} className={`shrink-0 text-text-muted transition-transform duration-150 ${aberto ? "rotate-180" : ""}`} /></>} /></CampoMenu>
      <div className="mt-4 flex items-center justify-between gap-3 text-sm text-text-primary"><span>Iniciar semana na segunda-feira</span><Toggle checked={app.semanaComecaSegunda} onChange={(semanaComecaSegunda) => alterarApp({ semanaComecaSegunda })} label="Iniciar semana na segunda-feira" /></div>
      </div>
      </div>
    </Secao>
    <Secao titulo="Integrações de calendário">
      <p className="mb-3 text-sm text-text-secondary">Conecte seus calendários para reunir eventos externos na Agenda.</p>
      <div className="space-y-2"><GoogleCalendarCard /><Integracao nome="Outlook Calendar" descricao="Calendário Microsoft 365 e Outlook" /><Integracao nome="iCal / CalDAV" descricao="Apple Calendar e outros calendários compatíveis" /></div>
      <div className="mt-4 flex items-center justify-between gap-3 text-sm text-text-primary"><span>Mostrar prazos no calendário</span><Toggle checked={deadlines} onChange={(valor) => { setDeadlines(valor); setMensagem(""); }} label="Mostrar prazos no calendário" /></div>
    </Secao>
    <button onClick={salvar} className="min-h-11 rounded-xl border border-[#1e4f82] bg-[#1e4f82] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-[background-color,border-color,transform,box-shadow] hover:border-[#28679f] hover:bg-[#28679f] hover:shadow-md active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1e4f82]">Salvar preferências</button>
    {mensagem && <p className="mt-3 text-sm text-success">{mensagem}</p>}
  </div>;
}

function CampoMenu({ rotulo, margem = false, children }: { rotulo: string; margem?: boolean; children: React.ReactNode }) { return <div className={margem ? "mt-3" : ""}><p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-text-muted">{rotulo}</p>{children}</div>; }
function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) { return <section className="mb-6"><p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">{titulo}</p><div className="rounded-2xl border border-border bg-surface-1 p-4">{children}</div></section>; }
/** Só o nome em texto (referência nominativa): sem logos de terceiros, que são marcas registradas. */
function Integracao({ nome, descricao }: { nome: string; descricao: string }) { const [aviso, setAviso] = useState(false); return <button type="button" onClick={() => setAviso(true)} className="flex w-full items-center gap-3 rounded-xl border border-border bg-base p-3 text-left transition-all hover:border-steel-400 hover:bg-surface-2 active:scale-[0.99]"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-surface-2 text-steel-300"><CalendarDays size={18} aria-hidden="true" /></span><span className="min-w-0 flex-1"><span className="block text-sm font-medium text-text-primary">{nome}</span><span className="block truncate text-xs text-text-muted">{aviso ? "Integração será liberada com o backend" : descricao}</span></span><Link2 size={17} className="text-steel-300" /></button>; }
