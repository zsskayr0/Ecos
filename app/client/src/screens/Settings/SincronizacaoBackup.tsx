import { useState } from "react";
import { CheckCircle2, Download, Upload } from "lucide-react";
import { Toggle } from "@/components/common/Toggle";

/**
 * Sincronização e backup — seção da tela Servidor: é o maior medo de quem usa
 * local-first (seção 3.12). Cartão de status, barra de armazenamento,
 * backup automático e exportar/restaurar.
 */
export function SincronizacaoBackup() {
  const [backupAuto, setBackupAuto] = useState(true);
  const usadoGb = 1.8;
  const totalGb = 10;

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
        <button className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-surface-2 py-3 text-sm font-semibold text-text-primary">
          <Download size={16} strokeWidth={1.75} />
          Exportar
        </button>
        <button className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-surface-2 py-3 text-sm font-semibold text-text-primary">
          <Upload size={16} strokeWidth={1.75} />
          Restaurar
        </button>
      </div>
    </section>
  );
}
