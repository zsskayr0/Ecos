import { useState } from "react";
import { ChevronDown, ChevronLeft, Clock3, Globe2, Link2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { MenuSuspenso, TOM } from "@/components/common/MenuSuspenso";
import { Toggle } from "@/components/common/Toggle";
import { lerPreferenciasCalendario, salvarPreferenciasCalendario } from "@/lib/preferencias-calendario";
import appleLogo from "../../assets/calendar-integrations/apple-black-logo-svgrepo-com.svg";
import googleLogo from "../../assets/calendar-integrations/google-icon-logo-svgrepo-com.svg";
import outlookLogo from "../../assets/calendar-integrations/outlook-svgrepo-com.svg";

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
const CLASSE_GATILHO = "flex min-h-11 w-full items-center gap-2 rounded-xl bg-surface-2 px-3 text-left text-sm font-medium text-text-primary transition-colors hover:bg-surface-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-steel-400";

export function CalendarPreferencesScreen() {
  const navigate = useNavigate();
  const salvo = lerPreferenciasCalendario();
  const [pais, setPais] = useState(salvo.pais ?? "Brasil");
  const [fuso, setFuso] = useState(salvo.fuso ?? "America/Sao_Paulo");
  const inicio = salvo.inicio ?? "06:00";
  const [deadlines, setDeadlines] = useState(salvo.deadlines ?? true);
  const [mensagem, setMensagem] = useState("");
  function mudarPais(novoPais: string) { setPais(novoPais); setFuso(FUSO_DO_PAIS[novoPais] ?? "UTC"); setMensagem(""); }
  function salvar() { salvarPreferenciasCalendario({ pais, fuso, inicio, deadlines }); setMensagem("Preferências salvas neste dispositivo."); }

  return <div className="px-4 pt-[calc(env(safe-area-inset-top)+12px)] pb-nav-safe">
    <div className="mb-5 flex items-center gap-2"><button data-voltar onClick={() => navigate(-1)} className="text-text-muted"><ChevronLeft size={22} /></button><h1 className="font-display text-xl text-text-primary">Calendário e localização</h1></div>
    <Secao titulo="Localização">
      <CampoMenu rotulo="País"><MenuSuspenso valor={pais} opcoes={PAISES} onChange={mudarPais} ariaLabel="Selecionar país" larguraMenu="w-full" classeGatilho={CLASSE_GATILHO} gatilho={({ aberto, atual }) => <><Globe2 size={16} className="shrink-0 text-steel-300" /><span className="min-w-0 flex-1 truncate">{atual?.rotulo ?? pais}</span><ChevronDown size={15} className={`shrink-0 text-text-muted transition-transform duration-150 ${aberto ? "rotate-180" : ""}`} /></>} /></CampoMenu>
      <CampoMenu rotulo="Fuso horário" margem><MenuSuspenso valor={fuso} opcoes={FUSOS} onChange={(valor) => { setFuso(valor); setMensagem(""); }} ariaLabel="Selecionar fuso horário" larguraMenu="w-full" classeGatilho={CLASSE_GATILHO} gatilho={({ aberto, atual }) => <><Clock3 size={16} className="shrink-0 text-cyan" /><span className="min-w-0 flex-1 truncate">{atual?.rotulo ?? fuso}</span><ChevronDown size={15} className={`shrink-0 text-text-muted transition-transform duration-150 ${aberto ? "rotate-180" : ""}`} /></>} /></CampoMenu>
    </Secao>
    <Secao titulo="Integrações de calendário">
      <p className="mb-3 text-sm text-text-secondary">Conecte seus calendários para reunir eventos externos na Agenda.</p>
      <div className="space-y-2"><Integracao logo={googleLogo} nome="Google Calendar" descricao="Eventos, compromissos e lembretes" /><Integracao logo={outlookLogo} nome="Outlook Calendar" descricao="Calendário Microsoft 365 e Outlook" /><Integracao logo={appleLogo} nome="iCal / CalDAV" descricao="Apple Calendar e outros calendários compatíveis" /></div>
      <div className="mt-4 flex items-center justify-between gap-3 text-sm text-text-primary"><span>Mostrar prazos no calendário</span><Toggle checked={deadlines} onChange={(valor) => { setDeadlines(valor); setMensagem(""); }} label="Mostrar prazos no calendário" /></div>
    </Secao>
    <button onClick={salvar} className="min-h-11 rounded-xl border border-[#1e4f82] bg-[#1e4f82] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-[background-color,border-color,transform,box-shadow] hover:border-[#28679f] hover:bg-[#28679f] hover:shadow-md active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1e4f82]">Salvar preferências</button>
    {mensagem && <p className="mt-3 text-sm text-success">{mensagem}</p>}
  </div>;
}

function CampoMenu({ rotulo, margem = false, children }: { rotulo: string; margem?: boolean; children: React.ReactNode }) { return <div className={margem ? "mt-3" : ""}><p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-text-muted">{rotulo}</p>{children}</div>; }
function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) { return <section className="mb-6"><p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">{titulo}</p><div className="rounded-2xl border border-border bg-surface-1 p-4">{children}</div></section>; }
function Integracao({ logo, nome, descricao }: { logo: string; nome: string; descricao: string }) { const [aviso, setAviso] = useState(false); return <button type="button" onClick={() => setAviso(true)} className="flex w-full items-center gap-3 rounded-xl border border-border bg-base p-3 text-left transition-all hover:border-steel-400 hover:bg-surface-2 active:scale-[0.99]"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white"><img src={logo} alt="" className="h-5 w-5 object-contain" /></span><span className="min-w-0 flex-1"><span className="block text-sm font-medium text-text-primary">{nome}</span><span className="block truncate text-xs text-text-muted">{aviso ? "Integração será liberada com o backend" : descricao}</span></span><Link2 size={17} className="text-steel-300" /></button>; }
