import { SkeletonLinhasCartao } from "@/components/common/SkeletonTelas";
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CalendarDays, CheckCircle2, ExternalLink, Link2, Loader2, RefreshCw, Unplug } from "lucide-react";
import { Link } from "react-router-dom";
import { calendario, type CalendarioConectado, type ResumoSyncCalendario } from "@/lib/api";
import { useRefreshBus } from "@/lib/refresh-bus";

import { mensagemDeErro } from "@/lib/erros";
const LIMITE_ESPERA_MS = 3 * 60_000;

const quando = (iso: string | null) => (iso ? new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "ainda não sincronizou");

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/** Linhas do resultado detalhado: o que entrou, o que saiu e o que deu problema. */
export function linhasDoSync(r: ResumoSyncCalendario): string[] {
  const enviados = (r.enviados_criados ?? 0) + (r.enviados_atualizados ?? 0);
  const l: string[] = [];
  if (r.criados) l.push(`${plural(r.criados, "evento criado", "eventos criados")} a partir do Google`);
  if (r.atualizados) l.push(`${plural(r.atualizados, "evento atualizado", "eventos atualizados")} a partir do Google`);
  if (r.removidos) l.push(`${plural(r.removidos, "evento removido", "eventos removidos")} (apagados no Google; foram para a Lixeira)`);
  if (r.excecoes_aplicadas) l.push(`${plural(r.excecoes_aplicadas, "ocorrência de série aplicada", "ocorrências de série aplicadas")}`);
  if (enviados) l.push(`${plural(enviados, "alteração enviada", "alterações enviadas")} ao Google`);
  if (r.removidos_no_google) l.push(`${plural(r.removidos_no_google, "evento apagado", "eventos apagados")} no Google`);
  if (r.conflitos_mantidos_locais) l.push(`${plural(r.conflitos_mantidos_locais, "edição local mantida", "edições locais mantidas")} (mais nova que a do Google)`);
  if (r.envios_adiados) l.push(`${plural(r.envios_adiados, "envio adiado", "envios adiados")}: o evento mudou no Google; o próximo ciclo decide`);
  if (r.envios_com_erro) l.push(`${plural(r.envios_com_erro, "problema", "problemas")}: o Google recusou (continua pendente)`);
  if (r.problemas_resolvidos) l.push(`${plural(r.problemas_resolvidos, "problema resolvido", "problemas resolvidos")}`);
  if (r.excecoes_ignoradas) l.push(`${plural(r.excecoes_ignoradas, "ocorrência editada de série não importada", "ocorrências editadas de série não importadas")} (ainda não suportado)`);
  if (l.length === 0) l.push(`Nada mudou (${plural(r.inalterados, "evento já em dia", "eventos já em dia")})`);
  return l;
}

function intervaloTexto(segundos?: number | null): string {
  if (!segundos) return "Automática";
  return segundos < 120 ? `Automática a cada ${segundos} s` : `Automática a cada ${Math.round(segundos / 60)} min`;
}

/** Conexão com o Google Calendar: conectar (OAuth no navegador), sincronizar agora e desconectar. */
export function GoogleCalendarCard({ intervaloPollMs = 2000 }: { intervaloPollMs?: number }) {
  const { notificar } = useRefreshBus();
  const [config, setConfig] = useState<{ conectado: CalendarioConectado | null; configurado: boolean; intervalo: number | null; problemas: number } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [detalhe, setDetalhe] = useState<string[] | null>(null);
  const [ocupado, setOcupado] = useState<null | "conectar" | "sincronizar" | "desconectar">(null);
  const [urlPendente, setUrlPendente] = useState<string | null>(null);
  const [confirmaDesconectar, setConfirmaDesconectar] = useState(false);
  const espera = useRef<ReturnType<typeof setInterval> | null>(null);

  const carregar = useCallback(async () => {
    const c = await calendario.config();
    const conectado = c.conectados.find((x) => x.provider === "google") ?? null;
    setConfig({ conectado, configurado: c.google_configurado, intervalo: c.intervalo_secs ?? null, problemas: c.problemas_abertos ?? 0 });
    return conectado;
  }, []);

  const pararEspera = useCallback(() => { if (espera.current) { clearInterval(espera.current); espera.current = null; } setUrlPendente(null); }, []);
  useEffect(() => () => { if (espera.current) clearInterval(espera.current); }, []);
  useEffect(() => { carregar().catch((e) => setErro(mensagemDeErro(e, "Não foi possível carregar o estado do Google Calendar."))); }, [carregar]);

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
      setErro(mensagemDeErro(e, "Não foi possível iniciar a conexão com o Google."));
    } finally { setOcupado(null); }
  }

  async function sincronizar() {
    setErro(null);
    setMensagem(null);
    setDetalhe(null);
    setOcupado("sincronizar");
    try {
      const r = await calendario.sincronizar();
      setMensagem(r.problemas_abertos ? `Sincronizado com ${plural(r.problemas_abertos, "problema aberto", "problemas abertos")}.` : "Sincronizado.");
      setDetalhe(linhasDoSync(r));
      notificar();
    } catch (e) {
      setErro(mensagemDeErro(e, "Não foi possível sincronizar agora. Tente novamente."));
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
      setErro(mensagemDeErro(e, "Não foi possível desconectar. Tente novamente."));
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

      {config === null && !erro && <SkeletonLinhasCartao rotulo="Carregando…" />}
      {config && !config.configurado && !conectado && (
        <p className="mt-3 text-xs text-text-muted">Este servidor ainda não tem as credenciais do Google. Defina <code>GOOGLE_CLIENT_ID</code> e <code>GOOGLE_CLIENT_SECRET</code> no <code>.env</code> e reinicie.</p>
      )}

      {conectado?.precisa_reconectar && (
        <div role="alert" className="mt-3 text-xs text-warning">
          <p className="flex items-start gap-2"><AlertTriangle size={14} className="mt-0.5 shrink-0" />O Google revogou ou expirou o acesso do Ecos. Reconecte para voltar a sincronizar; seus eventos continuam aqui.</p>
          <p className="mt-1 text-text-muted">Se isso se repete a cada poucos dias, o app OAuth do Google pode estar em modo de teste (acessos expiram em 7 dias). Só publicar o app no Google resolve isso; reconectar é o que dá para fazer daqui.</p>
        </div>
      )}
      {conectado && !conectado.precisa_reconectar && (
        <p className="mt-3 text-xs text-text-muted">Última sincronização: {quando(conectado.ultima_sync_em)}. {intervaloTexto(config?.intervalo)}.</p>
      )}
      {conectado?.ultimo_erro && !conectado.precisa_reconectar && (
        <p className="mt-1 text-xs text-error">
          {conectado.erro_tipo === "temporario" ? "Falha temporária, o Ecos tenta de novo sozinho" : "Última tentativa falhou"}
          {conectado.ultima_tentativa_em ? ` (${quando(conectado.ultima_tentativa_em)}${conectado.erros_seguidos ? `, ${plural(conectado.erros_seguidos, "tentativa seguida", "tentativas seguidas")}` : ""})` : ""}: {conectado.ultimo_erro}
        </p>
      )}
      {conectado && (config?.problemas ?? 0) > 0 && (
        <p className="mt-2 text-xs"><Link to="/configuracoes/calendario/problemas" className="font-medium text-warning underline">{plural(config?.problemas ?? 0, "problema de sincronização", "problemas de sincronização")}: ver e resolver</Link></p>
      )}

      {erro && <p role="alert" className="mt-3 text-sm text-error">{erro}</p>}
      {mensagem && <p role="status" className="mt-3 text-sm text-text-secondary">{mensagem}</p>}
      {detalhe && <ul aria-label="Resultado da sincronização" className="mt-1 list-disc pl-5 text-xs text-text-secondary">{detalhe.map((x) => <li key={x}>{x}</li>)}</ul>}

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
