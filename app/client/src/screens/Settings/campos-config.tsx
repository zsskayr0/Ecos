import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronDown, ChevronLeft, type LucideIcon } from "lucide-react";
import { MenuSuspenso, type OpcaoMenu } from "@/components/common/MenuSuspenso";
import { lerPreferenciasAplicativo, salvarPreferenciasAplicativo, type PreferenciasAplicativo } from "@/lib/preferencias-aplicativo";

/** Peças comuns das telas de configuração: cabeçalho, seção, linha com ícone, seletor e segmentado. */

export function Cabecalho({ titulo }: { titulo: string }) {
  const navigate = useNavigate();
  return (
    <div className="mb-5 flex items-center gap-2">
      <button data-voltar onClick={() => navigate(-1)} className="text-text-muted" aria-label="Voltar"><ChevronLeft size={22} /></button>
      <h1 className="font-display text-xl text-text-primary">{titulo}</h1>
    </div>
  );
}

export function Secao({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="mt-6 first:mt-0">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">{titulo}</p>
      <div className="overflow-visible rounded-2xl border border-border bg-surface-1">{children}</div>
    </section>
  );
}

export function Linha({ Icone, titulo, descricao, children }: { Icone: LucideIcon; titulo: string; descricao: string; children: ReactNode }) {
  return (
    <div className="flex min-h-20 items-center gap-3 border-b border-border/60 px-4 py-3 text-sm last:border-0">
      <Icone size={18} className="shrink-0 text-steel-300" />
      <span className="min-w-0 flex-1"><span className="block text-sm font-medium text-text-primary">{titulo}</span><span className="block text-xs leading-relaxed text-text-muted">{descricao}</span></span>
      {children}
    </div>
  );
}

export function Seletor<T extends string>({ valor, opcoes, onChange, label }: { valor: T; opcoes: readonly OpcaoMenu<T>[]; onChange: (v: T) => void; label: string }) {
  return (
    <MenuSuspenso valor={valor} opcoes={opcoes} onChange={onChange} ariaLabel={label} alinhar="dir"
      classeGatilho="flex min-h-10 min-w-44 items-center gap-2 rounded-xl border border-border bg-surface-2 px-3 text-sm text-text-primary hover:bg-surface-3"
      gatilho={({ aberto, atual }) => <><span className="min-w-0 flex-1 truncate text-left">{atual?.rotulo}</span><ChevronDown size={15} className={`shrink-0 text-text-muted transition-transform ${aberto ? "rotate-180" : ""}`} /></>} />
  );
}

/** Duas ou três opções lado a lado, no mesmo desenho do seletor de visualização. */
export function Segmentado<T extends string>({ valor, opcoes, onChange, label }: { valor: T; opcoes: readonly { id: T; rotulo: string; Icone?: LucideIcon }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="flex shrink-0 rounded-lg border border-border bg-surface-2 p-1" role="group" aria-label={label}>
      {opcoes.map(({ id, rotulo, Icone }) => (
        <button key={id} type="button" aria-pressed={valor === id} onClick={() => onChange(id)} className={`flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium ${valor === id ? "bg-surface-3 text-text-primary" : "text-text-muted hover:text-text-secondary"}`}>
          {Icone && <Icone size={15} strokeWidth={1.75} />}{rotulo}
        </button>
      ))}
    </div>
  );
}

/** Campo de hora (HH:MM) no estilo dos campos do Ecos. */
export function CampoHora({ valor, onChange, label, desabilitado = false }: { valor: string; onChange: (v: string) => void; label: string; desabilitado?: boolean }) {
  return <input type="time" aria-label={label} value={valor} disabled={desabilitado} onChange={(e) => { if (/^\d{2}:\d{2}$/.test(e.target.value)) onChange(e.target.value); }} className="ecos-input !w-auto min-h-10 !rounded-xl border border-border font-mono-value text-sm disabled:opacity-40" />;
}

/** Preferências do aplicativo com gravação imediata (e aviso às telas que as usam). */
export function usePreferencias(): [PreferenciasAplicativo, (patch: Partial<PreferenciasAplicativo>) => void] {
  const [prefs, setPrefs] = useState(lerPreferenciasAplicativo);
  const alterar = (patch: Partial<PreferenciasAplicativo>) => setPrefs((atual) => { const proxima = { ...atual, ...patch }; salvarPreferenciasAplicativo(proxima); return proxima; });
  return [prefs, alterar];
}
