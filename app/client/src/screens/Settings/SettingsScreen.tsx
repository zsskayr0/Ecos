import { useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight, User, Users, RefreshCw, ShieldCheck, Bell, Palette, Info, Server } from "lucide-react";
import { obterServidorBaseUrl } from "@/lib/server-config";
import { useAppUI } from "@/lib/ui-context";

/**
 * Settings index (section 3.12) — Account / System / About.
 * Sincronização&Backup and Privacidade&Cofre are their own screens (own
 * section below); Notificações and Aparência have no detailed content in
 * the spec — see GAP-04.
 */
export function SettingsScreen() {
  const navigate = useNavigate();
  const { intercalarEquipes, setIntercalarEquipes } = useAppUI();

  return (
    <div className="px-4 pt-[calc(env(safe-area-inset-top)+12px)] pb-nav-safe">
      <div className="mb-5 flex items-center gap-2">
        <button onClick={() => navigate(-1)} className="text-text-muted">
          <ChevronLeft size={22} />
        </button>
        <h1 className="font-display text-xl text-text-primary">Configurações</h1>
      </div>

      <Secao titulo="Conta">
        <Item Icon={User} label="Editar perfil" onClick={() => navigate("/perfil/editar")} />
        <Item Icon={Users} label="Equipes" onClick={() => navigate("/perfil")} />
      </Secao>

      <Secao titulo="Sistema">
        <ToggleItem Icon={Users} label="Intercalação de equipes" descricao="Exibe itens de todas as equipes e permite filtrá-los." ativo={intercalarEquipes} onChange={setIntercalarEquipes} />
        <Item Icon={Server} label="Servidor" onClick={() => navigate("/configuracoes/servidor")} valor={obterServidorBaseUrl() ?? "Padrão"} />
        <Item Icon={RefreshCw} label="Sincronização & Backup" onClick={() => navigate("/configuracoes/sync")} />
        <Item Icon={ShieldCheck} label="Privacidade & Cofre" onClick={() => navigate("/configuracoes/privacidade")} />
        <Item Icon={Bell} label="Notificações" onClick={() => navigate("/notificacoes")} />
        <Item Icon={Palette} label="Aparência" onClick={() => navigate("/configuracoes/aparencia")} />
      </Secao>

      <Secao titulo="Sobre">
        <Item Icon={Info} label="Sobre o Ecos" onClick={() => {}} valor="v0.1.0" />
      </Secao>
    </div>
  );
}

function ToggleItem({ Icon, label, descricao, ativo, onChange }: { Icon: typeof User; label: string; descricao: string; ativo: boolean; onChange: (ativo: boolean) => void }) {
  return <button type="button" onClick={() => onChange(!ativo)} className="flex items-center gap-3 border-b border-border/60 px-4 py-3.5 text-left"><Icon size={18} strokeWidth={1.75} className="text-text-secondary" /><span className="flex-1"><span className="block text-[15px] text-text-primary">{label}</span><span className="mt-0.5 block text-xs text-text-muted">{descricao}</span></span><span aria-hidden className={`relative h-6 w-11 rounded-full transition-colors ${ativo ? "bg-cyan" : "bg-surface-3"}`}><span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${ativo ? "translate-x-6" : "translate-x-1"}`} /></span></button>;
}

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">{titulo}</p>
      <div className="flex flex-col overflow-hidden rounded-2xl bg-surface-1">{children}</div>
    </div>
  );
}

function Item({
  Icon,
  label,
  onClick,
  valor,
}: {
  Icon: typeof User;
  label: string;
  onClick: () => void;
  valor?: string;
}) {
  return (
    <button onClick={onClick} className="flex items-center gap-3 border-b border-border/60 px-4 py-3.5 text-left last:border-0">
      <Icon size={18} strokeWidth={1.75} className="text-text-secondary" />
      <span className="flex-1 text-[15px] text-text-primary">{label}</span>
      {valor && <span className="text-sm text-text-muted">{valor}</span>}
      <ChevronRight size={16} className="text-text-muted" />
    </button>
  );
}

/* GAP-04: the spec lists "Notificações" and "Aparência" as System items
   (section 3.12) but doesn't describe their content (unlike Sincronização
   &Backup and Privacidade&Cofre, which are detailed). "Notificações"
   here reuses the Notifications screen (section 3.10) as the closest
   destination; "Aparência" doesn't have its own screen yet — see
   AparenciaScreen.tsx for the assumed placeholder (theme toggle). */
