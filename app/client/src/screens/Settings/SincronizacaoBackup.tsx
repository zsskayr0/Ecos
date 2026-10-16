import { useRef, useState } from "react";
import { CheckCircle2, Download, Loader2, Upload } from "lucide-react";
import { Toggle } from "@/components/common/Toggle";
import { conta, restauracao, type RelatorioRestauracao, type ResultadoRestauracao } from "@/lib/api";
import { baixarArquivo } from "@/lib/baixar-arquivo";
import { mensagemDeErro } from "@/lib/erros";

/**
 * Sincronização e backup — seção da tela Servidor: é o maior medo de quem usa
 * local-first (seção 3.12). Cartão de status, barra de armazenamento,
 * backup automático e exportar/restaurar.
 */
export function SincronizacaoBackup() {
  const [backupAuto, setBackupAuto] = useState(true);
  const usadoGb = 1.8;
  const totalGb = 10;
  const entrada = useRef<HTMLInputElement>(null);
  const [ocupado, setOcupado] = useState<null | "exportar" | "validar" | "aplicar">(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [relatorio, setRelatorio] = useState<RelatorioRestauracao | null>(null);
  const [copiar, setCopiar] = useState(false);
  const [comConfig, setComConfig] = useState(false);

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

  return (
    <section className="mt-10">
      <h2 className="mb-4 font-display text-lg text-text-primary">Sincronização e backup</h2>

      <div className="mb-5 flex items-center gap-3 rounded-2xl border border-success/30 bg-success/10 p-4">
        <CheckCircle2 size={22} className="text-success" strokeWidth={1.75} />
        <div>
          <p className="text-[15px] font-semibold text-text-primary">Tudo sincronizado</p>
          <p className="text-xs text-text-muted">Último check há 3 minutos</p>
        </div>
      </div>

      <div className="mb-5 rounded-2xl bg-surface-1 p-4">
        <div className="mb-2 flex items-center justify-between text-sm">
          <span className="text-text-secondary">Armazenamento local usado</span>
          <span className="font-mono-value text-text-primary">
            {usadoGb}GB / {totalGb}GB
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-pill bg-surface-3">
          <div className="h-full rounded-pill bg-steel-500" style={{ width: `${(usadoGb / totalGb) * 100}%` }} />
        </div>
      </div>

      <div className="mb-5 flex items-center justify-between rounded-2xl bg-surface-1 p-4">
        <div>
          <p className="text-[15px] font-medium text-text-primary">Backup automático</p>
          <p className="text-xs text-text-muted">Diário, com retenção de 7 dias + 4 semanas + 3 meses</p>
        </div>
        <Toggle checked={backupAuto} onChange={setBackupAuto} label="Backup automático" />
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
