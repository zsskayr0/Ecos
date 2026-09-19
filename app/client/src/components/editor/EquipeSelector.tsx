import { useState } from "react";
import { Check, ChevronDown, Users } from "lucide-react";
import { useMinhasEquipes } from "@/lib/use-minhas-equipes";

export function EquipeSelector({ espaco, onChange, disabled = false }: { espaco: string; onChange: (espaco: string) => void; disabled?: boolean }) {
  const { equipes } = useMinhasEquipes();
  const [aberto, setAberto] = useState(false);
  const idEquipe = espaco.startsWith("equipe:") ? espaco.slice(7) : "";
  const nome = idEquipe ? equipes.find((e) => e.id === idEquipe)?.nome ?? "Equipe" : "Pessoal";
  return <div className="relative flex flex-col gap-2 text-sm text-text-secondary">
    <span>Equipe</span>
    <button type="button" aria-haspopup="listbox" aria-expanded={aberto} onClick={() => setAberto((valor) => !valor)} disabled={disabled} className="flex min-h-11 items-center gap-3 rounded-lg border border-border bg-surface-1 px-3 text-left text-text-primary transition-colors hover:border-steel-400 disabled:opacity-40"><Users size={17} className="text-violet" /><span className="min-w-0 flex-1 truncate">{nome}</span><ChevronDown size={17} className={`transition-transform ${aberto ? "rotate-180" : ""}`} /></button>
    {aberto && <div role="listbox" className="absolute top-full z-30 mt-1 w-full overflow-hidden rounded-xl border border-border bg-surface-1 p-1 shadow-nav"><button type="button" role="option" aria-selected={!idEquipe} onClick={() => { onChange("pessoal"); setAberto(false); }} className="flex min-h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-sm text-text-primary hover:bg-surface-2"><Users size={16} className="text-text-muted" /><span className="flex-1">Pessoal</span>{!idEquipe && <Check size={16} className="text-steel-300" />}</button>{equipes.map((equipe) => <button key={equipe.id} type="button" role="option" aria-selected={idEquipe === equipe.id} onClick={() => { onChange(`equipe:${equipe.id}`); setAberto(false); }} className="flex min-h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-sm text-text-primary hover:bg-surface-2"><Users size={16} className="text-violet" /><span className="flex-1 truncate">{equipe.nome}</span>{idEquipe === equipe.id && <Check size={16} className="text-steel-300" />}</button>)}</div>}
  </div>;
}
