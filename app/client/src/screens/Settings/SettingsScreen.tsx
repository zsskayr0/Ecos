import { useNavigate } from "react-router-dom";
import { ChevronRight, Users } from "lucide-react";
import { GRUPOS } from "./ConfiguracoesLayout";

/**
 * Índice das configurações, só nas telas pequenas (no desktop a barra lateral faz este papel).
 * Segue os mesmos grupos e itens da barra lateral.
 */
export function SettingsScreen() {
  const navigate = useNavigate();

  return (
    <div className="px-4 pt-[calc(env(safe-area-inset-top)+12px)] pb-nav-safe">
      <h1 className="mb-5 font-display text-xl text-text-primary">Configurações</h1>

      {GRUPOS.map((grupo) => (
        <div key={grupo.titulo} className="mb-6">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">{grupo.titulo}</p>
          <div className="flex flex-col overflow-hidden rounded-2xl bg-surface-1">
            {grupo.abas.map(({ para, rotulo, Icone }) => (
              <button key={para} onClick={() => navigate(para)} className="flex items-center gap-3 border-b border-border/60 px-4 py-3.5 text-left last:border-0">
                <Icone size={18} strokeWidth={1.75} className="text-text-secondary" />
                <span className="flex-1 text-[15px] text-text-primary">{rotulo}</span>
                <ChevronRight size={16} className="text-text-muted" />
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function ToggleItem({ Icon = Users, label, descricao, ativo, onChange }: { Icon?: typeof Users; label: string; descricao: string; ativo: boolean; onChange: (ativo: boolean) => void }) {
  return <button type="button" onClick={() => onChange(!ativo)} className="flex w-full items-center gap-3 rounded-2xl bg-surface-1 px-4 py-3.5 text-left"><Icon size={18} strokeWidth={1.75} className="text-text-secondary" /><span className="flex-1"><span className="block text-[15px] text-text-primary">{label}</span><span className="mt-0.5 block text-xs text-text-muted">{descricao}</span></span><span aria-hidden className={`relative h-6 w-11 rounded-full transition-colors ${ativo ? "bg-cyan" : "bg-surface-3"}`}><span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${ativo ? "translate-x-6" : "translate-x-1"}`} /></span></button>;
}
