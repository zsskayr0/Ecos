import { useNavigate } from "react-router-dom";
import { ArrowLeft, ChevronRight, Users } from "lucide-react";
import { useBuscaConfiguracoes, useGrupos } from "./ConfiguracoesLayout";
import { CampoBusca, ResultadosBusca } from "./BuscaConfiguracoes";

/**
 * Índice das configurações, só nas telas pequenas (no desktop a barra lateral faz este papel).
 * Segue os mesmos grupos e itens da barra lateral, com a mesma busca no topo.
 */
export function SettingsScreen() {
  const navigate = useNavigate();
  const grupos = useGrupos();
  const busca = useBuscaConfiguracoes(grupos);
  // Voltar de verdade (Cofre, Feed, onde a pessoa estava); sem histórico (aberto direto), cai no Feed.
  const voltar = () => ((window.history.state as { idx?: number } | null)?.idx ?? 0) > 0 ? navigate(-1) : navigate("/feed", { replace: true });

  return (
    <div className="px-4 pt-[calc(env(safe-area-inset-top)+12px)] pb-nav-safe">
      <div className="mb-4 flex items-center gap-1">
        <button type="button" aria-label="Voltar" onClick={voltar} className="-ml-2 flex size-10 shrink-0 items-center justify-center rounded-full text-text-primary active:bg-surface-2"><ArrowLeft size={22} /></button>
        <h1 className="font-display text-xl text-text-primary">Configurações</h1>
      </div>
      <CampoBusca valor={busca.consulta} onChange={busca.setConsulta} aoConfirmar={busca.abrirPrimeiro} className="mb-5" />

      {busca.consulta.trim() ? <ResultadosBusca resultados={busca.resultados} aoAbrir={busca.abrir} espacoso /> : grupos.map((grupo) => (
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
