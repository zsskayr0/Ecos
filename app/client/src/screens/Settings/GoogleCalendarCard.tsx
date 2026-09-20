import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CalendarDays, CheckCircle2, ExternalLink, Link2, Loader2, RefreshCw, Unplug } from "lucide-react";
import { ApiError, calendario, type CalendarioConectado, type ResumoSyncCalendario } from "@/lib/api";
import { useRefreshBus } from "@/lib/refresh-bus";

const LIMITE_ESPERA_MS = 3 * 60_000;

const quando = (iso: string | null) => (iso ? new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "ainda não sincronizou");

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

function resumoDoSync(r: ResumoSyncCalendario): string {
  const enviados = (r.enviados_criados ?? 0) + (r.enviados_atualizados ?? 0);
  const partes = [
    // Google → Ecos
    r.criados && plural(r.criados, "novo", "novos"),
    r.atualizados && plural(r.atualizados, "atualizado", "atualizados"),
    r.removidos && plural(r.removidos, "removido", "removidos"),
    r.conflitos_mantidos_locais && `${r.conflitos_mantidos_locais} com edição local mantida`,
    // Ecos → Google
    enviados && `${plural(enviados, "enviado", "enviados")} ao Google`,
    r.removidos_no_google && `${plural(r.removidos_no_google, "apagado", "apagados")} no Google`,
    r.envios_adiados && `${plural(r.envios_adiados, "adiado", "adiados")} (mudou no Google; o próximo ciclo decide)`,
    r.envios_com_erro && `${plural(r.envios_com_erro, "recusado", "recusados")} pelo Google (continua pendente)`,
  ].filter(Boolean);
  const base = partes.length ? partes.join(", ") : "tudo em dia";
  return r.excecoes_ignoradas ? `${base}. ${r.excecoes_ignoradas} ocorrência${r.excecoes_ignoradas === 1 ? "" : "s"} editada${r.excecoes_ignoradas === 1 ? "" : "s"} de série não importada${r.excecoes_ignoradas === 1 ? "" : "s"} (ainda não suportado).` : `${base}.`;
}

/** Conexão com o Google Calendar: conectar (OAuth no navegador), sincronizar agora e desconectar. */
export function GoogleCalendarCard({ intervaloPollMs = 2000 }: { intervaloPollMs?: number }) {
  const { notificar } = useRefreshBus();
  const [config, setConfig] = useState<{ conectado: CalendarioConectado | null; configurado: boolean } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<null | "conectar" | "sincronizar" | "desconectar">(null);
  const [urlPendente, setUrlPendente] = useState<string | null>(null);
  const [confirmaDesconectar, setConfirmaDesconectar] = useState(false);
  const espera = useRef<ReturnType<typeof setInterval> | null>(null);

  const carregar = useCallback(async () => {
    const c = await calendario.config();
    const conectado = c.conectados.find((x) => x.provider === "google") ?? null;
    setConfig({ conectado, configurado: c.google_configurado });
    return conectado;
  }, []);

  const pararEspera = useCallback(() => { if (espera.current) { clearInterval(espera.current); espera.current = null; } setUrlPendente(null); }, []);
  useEffect(() => () => { if (espera.current) clearInterval(espera.current); }, []);
  useEffect(() => { carregar().catch((e) => setErro(e instanceof ApiError ? e.message : "Não foi possível carregar o estado do Google Calendar.")); }, [carregar]);

  async function conectar() {
    setErro(null);
    setMensagem(null);
    setOcupado("conectar");
    try {
      const { url } = await calendario.conectar("google");
      setUrlPendente(url);
      window.open(url, "_blank", "noopener,noreferrer");
      // O retorno acontece na janela do Google; aqui só esperamos a conexão aparecer no servidor.
      const inicio = Date.now();
      if (espera.current) clearInterval(espera.current);
      espera.current = setInterval(async () => {
        try {
          const c = await carregar();
          if (c && !c.precisa_reconectar) { pararEspera(); setMensagem("Google Calendar conectado. A primeira sincronização já começou."); notificar(); }
          else if (Date.now() - inicio > LIMITE_ESPERA_MS) { pararEspera(); setErro("A autorização não foi concluída. Tente conectar de novo."); }
        } catch { /* uma falha de rede isolada não cancela a espera */ }
      }, intervaloPollMs);
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível iniciar a conexão com o Google.");
    } finally { setOcupado(null); }
  }

  async function sincronizar() {
    setErro(null);
    setMensagem(null);
    setOcupado("sincronizar");
    try {
      const r = await calendario.sincronizar();
      setMensagem(`Sincronizado: ${resumoDoSync(r)}`);
      notificar();
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível sincronizar agora. Tente novamente.");
    } finally { setOcupado(null); await carregar().catch(() => undefined); }
  }

  async function desconectar() {
    setErro(null);
    setMensagem(null);
    setOcupado("desconectar");
    try {
      await calendario.desconectar("google");
      setConfirmaDesconectar(false);
      setMensagem("Google Calendar desconectado. Seus eventos continuam no Ecos, como privados.");
      notificar();
      await carregar();
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível desconectar. Tente novamente.");
    } finally { setOcupado(null); }
  }

  const conectado = config?.conectado ?? null;
  const aguardando = urlPendente !== null;
  const botao = "flex min-h-10 items-center gap-1.5 rounded-xl px-3 text-sm font-medium transition-colors disabled:opacity-40";

  return (
    <div className="rounded-xl border border-border bg-base p-3">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-steel-300"><CalendarDays size={18} aria-hidden="true" /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-text-primary">Google Calendar</span>
          <span className="block truncate text-xs text-text-muted">
            {conectado ? <>Conectado como {conectado.email ?? "sua conta"}</> : "Eventos, compromissos e lembretes"}
          </span>
        </span>
        {conectado && !conectado.precisa_reconectar && <CheckCircle2 size={18} className="shrink-0 text-success" aria-label="Conectado" />}
      </div>

      {config === null && !erro && <p className="mt-3 text-xs text-text-muted">Carregando...</p>}
      {config && !config.configurado && !conectado && (
        <p className="mt-3 text-xs text-text-muted">Este servidor ainda não tem as credenciais do Google. Defina <code>GOOGLE_CLIENT_ID</code> e <code>GOOGLE_CLIENT_SECRET</code> no <code>.env</code> e reinicie.</p>
      )}

      {conectado?.precisa_reconectar && (
        <p role="alert" className="mt-3 flex items-start gap-2 text-xs text-warning"><AlertTriangle size={14} className="mt-0.5 shrink-0" />O acesso ao Google foi revogado ou expirou. Reconecte para voltar a sincronizar.</p>
      )}
      {conectado && !conectado.precisa_reconectar && (
        <p className="mt-3 text-xs text-text-muted">Última sincronização: {quando(conectado.ultima_sync_em)}. Automática a cada poucos minutos.</p>
      )}
      {conectado?.ultimo_erro && !conectado.precisa_reconectar && <p className="mt-1 text-xs text-error">Última tentativa falhou: {conectado.ultimo_erro}</p>}

      {erro && <p role="alert" className="mt-3 text-sm text-error">{erro}</p>}
      {mensagem && <p role="status" className="mt-3 text-sm text-text-secondary">{mensagem}</p>}

      {aguardando && (
        <p role="status" className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-muted">
          <Loader2 size={14} className="animate-spin" />Aguardando você autorizar no Google…
          <a href={urlPendente ?? "#"} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-steel-300 underline">abrir de novo<ExternalLink size={12} /></a>
          <button type="button" onClick={pararEspera} className="underline">cancelar</button>
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {(!conectado || conectado.precisa_reconectar) && (
          <button type="button" onClick={() => void conectar()} disabled={!config?.configurado || ocupado !== null || aguardando} className={`${botao} bg-cyan text-black`}><Link2 size={15} />{conectado ? "Reconectar" : "Conectar"}</button>
        )}
        {conectado && !conectado.precisa_reconectar && (
          <button type="button" onClick={() => void sincronizar()} disabled={ocupado !== null} className={`${botao} bg-surface-2 text-text-primary hover:bg-surface-3`}><RefreshCw size={15} className={ocupado === "sincronizar" ? "animate-spin" : ""} />{ocupado === "sincronizar" ? "Sincronizando..." : "Sincronizar agora"}</button>
        )}
        {conectado && !confirmaDesconectar && (
          <button type="button" onClick={() => setConfirmaDesconectar(true)} disabled={ocupado !== null} className={`${botao} text-text-muted hover:bg-surface-2`}><Unplug size={15} />Desconectar</button>
        )}
      </div>
      {confirmaDesconectar && (
        <div role="alertdialog" aria-label="Confirmar desconexão" className="mt-3 rounded-xl bg-surface-2 p-3">
          <p className="text-sm text-text-primary">Desconectar o Google Calendar?</p>
          <p className="mt-1 text-xs text-text-muted">Os eventos continuam no Ecos, como privados e sem vínculo com o Google. O acesso do Ecos à sua conta é revogado.</p>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={() => setConfirmaDesconectar(false)} disabled={ocupado !== null} className={`${botao} bg-surface-1 text-text-primary`}>Cancelar</button>
            <button type="button" onClick={() => void desconectar()} disabled={ocupado !== null} className={`${botao} bg-error text-white`}>{ocupado === "desconectar" ? "Desconectando..." : "Desconectar"}</button>
          </div>
        </div>
      )}
    </div>
  );
}
