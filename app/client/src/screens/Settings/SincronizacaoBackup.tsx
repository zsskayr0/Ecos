import { useCallback, useEffect, useRef, useState } from "react";
import { CloudOff, Download, HardDrive, Loader2, Smartphone, Upload } from "lucide-react";
import { SkeletonBackups, SkeletonSincronizacao } from "@/components/common/SkeletonTelas";
import { EstadoErro } from "@/components/common/EstadoErro";
import { conta, restauracao, sync, vault, type DispositivoSync, type ModoSync, type RelatorioRestauracao, type ResultadoRestauracao, type StatusSync } from "@/lib/api";
import { baixarArquivo } from "@/lib/baixar-arquivo";
import { mensagemDeErro } from "@/lib/erros";

/**
 * Sincronização e backup (seção 3.12). Tudo o que aparece aqui vem do servidor: `/sync/status` (modo, estado do
 * transporte, aparelhos), `/vault/backup/*` (cópias do Cofre) e exportar/restaurar. O que ainda não existe
 * (transporte entre aparelhos, Google Drive, backup automático de notas e tarefas) fica rotulado "Em breve" e nunca
 * aparece como sucesso: com o transporte desativado ou falhando, a tela nunca diz "sincronizado".
 */

const MODOS: { id: ModoSync; nome: string; descricao: string }[] = [
  { id: "local_unico", nome: "Somente este servidor", descricao: "Os dados ficam só aqui." },
  { id: "direto_lan", nome: "Rede local (LAN)", descricao: "Entre aparelhos pareados, sem internet." },
  { id: "google_drive", nome: "Google Drive", descricao: "Cópia sincronizada na sua conta Google." },
];

export function formatarDataHora(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export function formatarTamanho(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1).replace(".", ",")} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

type Backups = { config: { frequencia: string; retencao: string; proxima_execucao_automatica: string }; historico: { nome: string; tamanho_bytes: number }[] };

export function SincronizacaoBackup() {
  const entrada = useRef<HTMLInputElement>(null);
  const [ocupado, setOcupado] = useState<null | "exportar" | "validar" | "aplicar">(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [relatorio, setRelatorio] = useState<RelatorioRestauracao | null>(null);
  const [copiar, setCopiar] = useState(false);
  const [comConfig, setComConfig] = useState(false);

  const [status, setStatus] = useState<StatusSync | null>(null);
  const [erroStatus, setErroStatus] = useState<string | null>(null);
  const [carregandoStatus, setCarregandoStatus] = useState(true);
  const [backups, setBackups] = useState<Backups | null>(null);
  const [erroBackups, setErroBackups] = useState<string | null>(null);
  const [carregandoBackups, setCarregandoBackups] = useState(true);
  const [fazendoBackup, setFazendoBackup] = useState(false);
  const [mensagemBackup, setMensagemBackup] = useState<string | null>(null);
  const [codigo, setCodigo] = useState<{ codigo: string; expira_em: string } | null>(null);
  const [codigoDigitado, setCodigoDigitado] = useState("");
  const [nomeAparelho, setNomeAparelho] = useState("");
  const [removendo, setRemovendo] = useState<string | null>(null);
  const [acaoAparelho, setAcaoAparelho] = useState(false);
  const [erroAparelho, setErroAparelho] = useState<string | null>(null);

  const carregarStatus = useCallback(async () => {
    setCarregandoStatus(true); setErroStatus(null);
    try { setStatus(await sync.status()); }
    catch (e) { setStatus(null); setErroStatus(mensagemDeErro(e, "Não foi possível consultar o estado da sincronização.")); }
    finally { setCarregandoStatus(false); }
  }, []);
  const carregarBackups = useCallback(async () => {
    setCarregandoBackups(true); setErroBackups(null);
    try {
      const [config, historico] = await Promise.all([vault.backup.config(), vault.backup.historico()]);
      setBackups({ config, historico });
    } catch (e) { setBackups(null); setErroBackups(mensagemDeErro(e, "Não foi possível consultar as cópias de segurança do Cofre.")); }
    finally { setCarregandoBackups(false); }
  }, []);
  useEffect(() => { void carregarStatus(); void carregarBackups(); }, [carregarStatus, carregarBackups]);

  async function backupAgora() {
    setFazendoBackup(true); setMensagemBackup(null); setErroBackups(null);
    try {
      const r = await vault.backup.exportar();
      setMensagemBackup(r.arquivo ? `Cópia gerada: ${r.arquivo}.` : "Nada para copiar: o Cofre ainda não tem dados.");
      await carregarBackups();
    } catch (e) { setErroBackups(mensagemDeErro(e, "Não foi possível gerar a cópia de segurança.")); }
    finally { setFazendoBackup(false); }
  }

  async function agir(fn: () => Promise<unknown>, falha: string) {
    setAcaoAparelho(true); setErroAparelho(null);
    try { await fn(); await carregarStatus(); }
    catch (e) { setErroAparelho(mensagemDeErro(e, falha)); }
    finally { setAcaoAparelho(false); }
  }

  async function exportar() {
    setOcupado("exportar"); setErro(null); setOk(null);
    try {
      const zip = await conta.exportar();
      baixarArquivo(zip, `ecos-exportacao-${new Date().toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-")}.zip`);
      setOk("Arquivo gerado. Confira sua pasta de downloads.");
    } catch (e) { setErro(mensagemDeErro(e, "Não foi possível gerar a exportação.")); } finally { setOcupado(null); }
  }
  async function escolher(arquivo: File | undefined) {
    if (!arquivo) return;
    setOcupado("validar"); setErro(null); setOk(null); setRelatorio(null);
    try { setRelatorio(await restauracao.validar(arquivo)); }
    catch (e) { setErro(mensagemDeErro(e, "Não foi possível validar o arquivo.")); } finally { setOcupado(null); }
  }
  async function cancelar() {
    const t = relatorio?.token; setRelatorio(null);
    if (t) await restauracao.cancelar(t).catch(() => undefined);
  }
  async function aplicar() {
    if (!relatorio) return;
    setOcupado("aplicar"); setErro(null);
    try {
      const r: ResultadoRestauracao = await restauracao.aplicar(relatorio.token, { conflitos: copiar ? "copiar" : "ignorar", restaurar_configuracoes: comConfig });
      setRelatorio(null);
      setOk(`Restauração concluída: ${r.restaurados} item(ns) novos, ${r.copias} cópia(s), ${r.conflitos_ignorados} conflito(s) preservado(s). Backup de segurança: ${r.backup}.${r.avisos.length ? " " + r.avisos.join(" ") : ""}`);
    } catch (e) { setErro(mensagemDeErro(e, "Não foi possível restaurar. Seus dados atuais não foram alterados.")); } finally { setOcupado(null); }
  }

  const BOTAO = "min-h-11 rounded-2xl bg-surface-2 px-4 text-sm font-semibold text-text-primary disabled:opacity-60";

  return (
    <section className="mt-10">
      <h2 className="mb-4 font-display text-lg text-text-primary">Sincronização e backup</h2>

      {/* Estado da sincronização: só o que o servidor informa. */}
      {carregandoStatus ? <SkeletonSincronizacao rotulo="Consultando a sincronização…" />
        : erroStatus ? <EstadoErro mensagem={erroStatus} onTentarDeNovo={() => void carregarStatus()} />
        : status && (
          <>
            <div className="mb-3 flex items-start gap-3 rounded-2xl border border-border bg-surface-1 p-4" data-testid="estado-sync">
              {status.transporte.estado === "nao_aplicavel" ? <HardDrive size={22} className="mt-0.5 text-text-secondary" strokeWidth={1.75} aria-hidden /> : <CloudOff size={22} className="mt-0.5 text-warning" strokeWidth={1.75} aria-hidden />}
              <div className="min-w-0">
                <p className="text-[15px] font-semibold text-text-primary">
                  {status.transporte.estado === "nao_aplicavel" ? "Sem sincronização entre aparelhos" : status.transporte.estado === "ativo" ? "Sincronização ativa" : "Sincronização indisponível"}
                </p>
                <p className="mt-1 text-xs text-text-muted">{status.transporte.motivo}</p>
                <p className="mt-1 text-xs text-text-muted">Última sincronização: {status.ultima_sincronizacao ? formatarDataHora(status.ultima_sincronizacao) : "nenhuma registrada"}</p>
              </div>
            </div>

            <div className="mb-5 rounded-2xl bg-surface-1 p-4">
              <p className="mb-2 text-sm font-medium text-text-primary">Modo</p>
              <ul className="space-y-2">
                {MODOS.map((m) => (
                  <li key={m.id} className="flex items-start justify-between gap-3 text-sm">
                    <span className="min-w-0"><span className={m.id === status.modo ? "font-semibold text-text-primary" : "text-text-secondary"}>{m.nome}</span><span className="block text-xs text-text-muted">{m.descricao}</span></span>
                    <span className="shrink-0 text-xs text-text-muted">{m.id === status.modo ? "Em uso" : m.id === "local_unico" ? "" : "Em breve"}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="mb-5 rounded-2xl bg-surface-1 p-4">
              <p className="mb-2 text-sm font-medium text-text-primary">Aparelhos pareados</p>
              {status.dispositivos.length === 0 && <p className="text-xs text-text-muted">Nenhum aparelho pareado.</p>}
              <ul className="divide-y divide-border">
                {status.dispositivos.map((d: DispositivoSync) => (
                  <li key={d.id} className="py-3 first:pt-0 last:pb-0">
                    <div className="flex items-start gap-3">
                      <Smartphone size={18} className="mt-0.5 shrink-0 text-text-secondary" aria-hidden />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-text-primary">{d.nome}</p>
                        <p className="text-xs text-text-muted">{d.papel === "primario" ? "Principal" : "Espelho"} · {d.ultima_sincronizacao ? `última sincronização ${formatarDataHora(d.ultima_sincronizacao)}` : "ainda não sincronizou"}</p>
                      </div>
                    </div>
                    {removendo === d.id ? (
                      <div className="mt-2 flex flex-wrap items-center gap-2 pl-[30px] text-xs">
                        <span className="text-text-secondary">Remover este aparelho? Os dados dele não são apagados.</span>
                        <button type="button" disabled={acaoAparelho} onClick={() => void agir(async () => { await sync.removerDispositivo(d.id); setRemovendo(null); }, "Não foi possível remover o aparelho.")} className="font-semibold text-error disabled:opacity-60">Remover</button>
                        <button type="button" onClick={() => setRemovendo(null)} className="text-text-muted">Cancelar</button>
                      </div>
                    ) : (
                      <div className="mt-2 flex gap-4 pl-[30px] text-xs">
                        {d.papel === "espelho" && <button type="button" disabled={acaoAparelho} onClick={() => void agir(() => sync.atualizarDispositivo(d.id, { papel: "primario" }), "Não foi possível trocar o aparelho principal.")} className="text-steel-300 disabled:opacity-60">Tornar principal</button>}
                        <button type="button" onClick={() => setRemovendo(d.id)} className="text-text-muted hover:text-error">Remover</button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
              {erroAparelho && <p role="alert" className="mt-3 text-xs text-error">{erroAparelho}</p>}

              <div className="mt-4 border-t border-border pt-4">
                <p className="mb-1 text-sm font-medium text-text-primary">Parear um aparelho</p>
                <p className="mb-3 text-xs text-text-muted">O pareamento só registra o aparelho nesta conta. A troca de dados entre aparelhos pareados ainda não existe (em breve).</p>
                <button type="button" disabled={acaoAparelho} onClick={() => void agir(async () => setCodigo(await sync.gerarCodigoPareamento()), "Não foi possível gerar o código.")} className={BOTAO}>Gerar código de pareamento</button>
                {codigo && <p className="mt-3 text-sm text-text-secondary">Código: <span className="font-mono-value text-lg font-semibold tracking-widest text-text-primary">{codigo.codigo}</span> <span className="text-xs text-text-muted">(vale até {formatarDataHora(codigo.expira_em)})</span></p>}
                <form className="mt-4 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); void agir(async () => { await sync.confirmarPareamento(codigoDigitado.trim(), nomeAparelho.trim() || "Novo dispositivo"); setCodigoDigitado(""); setNomeAparelho(""); }, "Código inválido ou expirado."); }}>
                  <input aria-label="Código de pareamento recebido" inputMode="numeric" maxLength={6} value={codigoDigitado} onChange={(e) => setCodigoDigitado(e.target.value.replace(/\D/g, ""))} placeholder="Código de 6 dígitos" className="ecos-input w-40" />
                  <input aria-label="Nome do aparelho" maxLength={60} value={nomeAparelho} onChange={(e) => setNomeAparelho(e.target.value)} placeholder="Nome deste aparelho" className="ecos-input min-w-0 flex-1" />
                  <button type="submit" disabled={acaoAparelho || codigoDigitado.length !== 6} className={BOTAO}>Confirmar código</button>
                </form>
              </div>
            </div>
          </>
        )}

      {/* Backup: as cópias do Cofre são reais; o de notas e tarefas ainda não existe. */}
      <div className="mb-5 rounded-2xl bg-surface-1 p-4">
        <p className="text-[15px] font-medium text-text-primary">Cópias de segurança do Cofre</p>
        {carregandoBackups ? <SkeletonBackups rotulo="Consultando as cópias…" />
          : backups ? (
            <>
              <p className="mt-1 text-xs text-text-muted">Frequência: {backups.config.frequencia} · retenção: {backups.config.retencao} · próxima automática: {formatarDataHora(backups.config.proxima_execucao_automatica)}</p>
              {backups.historico.length === 0 ? <p className="mt-3 text-xs text-text-muted">Nenhuma cópia gerada ainda.</p> : (
                <ul className="mt-3 space-y-1 text-xs text-text-secondary">
                  {backups.historico.slice(0, 8).map((h) => <li key={h.nome} className="flex justify-between gap-3"><span className="truncate">{h.nome}</span><span className="shrink-0 text-text-muted">{formatarTamanho(h.tamanho_bytes)}</span></li>)}
                </ul>
              )}
            </>
          ) : null}
        {erroBackups && <div className="mt-3"><EstadoErro mensagem={erroBackups} onTentarDeNovo={() => void carregarBackups()} /></div>}
        <div aria-live="polite">{mensagemBackup && <p className="mt-3 text-sm text-success">{mensagemBackup}</p>}</div>
        <button type="button" onClick={() => void backupAgora()} disabled={fazendoBackup || carregandoBackups} className={`mt-3 flex items-center gap-2 ${BOTAO}`}>
          {fazendoBackup && <Loader2 size={16} className="animate-spin" aria-hidden />}
          Fazer backup agora
        </button>
        <p className="mt-4 text-xs text-text-muted">Notas e tarefas: são arquivos .md na pasta do servidor. O backup automático delas ainda não existe (em breve); use Exportar abaixo para guardar uma cópia.</p>
      </div>

      <div className="flex gap-3">
        <button type="button" onClick={() => void exportar()} disabled={ocupado !== null} className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-surface-2 py-3 text-sm font-semibold text-text-primary disabled:opacity-60">
          {ocupado === "exportar" ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Download size={16} strokeWidth={1.75} />}
          Exportar
        </button>
        <button type="button" onClick={() => entrada.current?.click()} disabled={ocupado !== null || relatorio !== null} className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-surface-2 py-3 text-sm font-semibold text-text-primary disabled:opacity-60">
          {ocupado === "validar" ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Upload size={16} strokeWidth={1.75} />}
          Restaurar
        </button>
        <input ref={entrada} type="file" accept=".zip,application/zip" hidden aria-label="Arquivo de exportação para restaurar" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; void escolher(f); }} />
      </div>
      <div aria-live="polite">
        {ok && <p className="mt-3 text-sm text-success">{ok}</p>}
        {erro && <p role="alert" className="mt-3 text-sm text-error">{erro}</p>}
      </div>
      {relatorio && (
        <div className="mt-4 rounded-2xl bg-surface-1 p-4 text-sm text-text-secondary">
          <p className="mb-2 font-semibold text-text-primary">Prévia da restauração</p>
          <p>{relatorio.novos} item(ns) novos, {relatorio.iguais} já iguais, {relatorio.conflitos_total} conflito(s), {relatorio.ignorados_total} ignorado(s).</p>
          {relatorio.conflitos_total > 0 && (
            <ul className="mt-2 list-disc pl-5 text-xs text-text-muted">
              {relatorio.conflitos.slice(0, 10).map((c) => <li key={c.caminho}>{c.caminho}: {c.motivo}</li>)}
            </ul>
          )}
          <label className="mt-3 flex items-center gap-2"><input type="checkbox" checked={copiar} onChange={(e) => setCopiar(e.target.checked)} />Salvar conflitos como cópia (restaurado)</label>
          {relatorio.tem_configuracoes && <label className="mt-2 flex items-center gap-2"><input type="checkbox" checked={comConfig} onChange={(e) => setComConfig(e.target.checked)} />Substituir preferências e rotina pelas do pacote</label>}
          <p className="mt-3 text-xs">Nada existente é sobrescrito. Um backup de segurança é gerado antes de gravar.</p>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={() => void cancelar()} disabled={ocupado === "aplicar"} className="min-h-11 flex-1 rounded-2xl bg-surface-2 text-sm font-medium text-text-primary disabled:opacity-40">Cancelar</button>
            <button type="button" onClick={() => void aplicar()} disabled={ocupado === "aplicar"} className="min-h-11 flex-1 rounded-2xl bg-steel-500 text-sm font-semibold text-white disabled:opacity-40">{ocupado === "aplicar" ? "Restaurando…" : "Restaurar"}</button>
          </div>
        </div>
      )}
    </section>
  );
}
