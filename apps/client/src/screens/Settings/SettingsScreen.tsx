import { useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight, User, Users, RefreshCw, ShieldCheck, Bell, Palette, Info } from "lucide-react";

/**
 * Índice de Configurações (seção 3.12) — Conta / Sistema / Sobre.
 * Sincronização & Backup e Privacidade & Cofre são telas próprias (seção
 * própria abaixo); Notificações e Aparência não têm conteúdo detalhado na
 * especificação — ver GAP-04.
 */
export function SettingsScreen() {
  const navigate = useNavigate();

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

/* GAP-04: a especificação lista "Notificações" e "Aparência" como itens de
   Sistema (seção 3.12) mas não descreve seu conteúdo (diferente de
   Sincronização&Backup e Privacidade&Cofre, detalhadas). "Notificações"
   aqui reaproveita a tela de Notificações (seção 3.10) como destino mais
   próximo; "Aparência" ainda não tem tela própria — ver
   AparenciaScreen.tsx para o placeholder assumido (toggle de tema). */
