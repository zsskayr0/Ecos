import { useNavigate } from "react-router-dom";
import { ChevronLeft, Pencil } from "lucide-react";
import { Avatar } from "@/components/common/Avatar";
import { RoleBadge } from "@/components/common/RoleBadge";
import { useAuth } from "@/lib/auth-context";
import { corDaEquipe } from "@/lib/team-color";
import type { Cargo } from "@/lib/types";

/**
 * Perfil Pessoal — mesma estrutura visual do perfil de Equipe (seção 3.8).
 * `usuario` real só tem `nome_usuario` (sem handle/bio, ver
 * `apps/server/src/auth/mod.rs::perfil`) — nada inventado aqui.
 */
export function ProfileScreen() {
  const navigate = useNavigate();
  const { perfil } = useAuth();

  if (!perfil) return null;

  return (
    <div className="px-4 pt-[calc(env(safe-area-inset-top)+12px)] pb-nav-safe">
      <div className="mb-4 flex items-center justify-between">
        <button onClick={() => navigate(-1)} className="flex items-center gap-1 text-sm text-text-muted">
          <ChevronLeft size={18} />
          Voltar
        </button>
        <button onClick={() => navigate("/perfil/editar")} className="flex items-center gap-1.5 text-sm text-steel-300">
          <Pencil size={14} />
          Editar
        </button>
      </div>

      <div className="mb-6 flex flex-col items-center gap-3 text-center">
        <Avatar nome={perfil.nome_usuario} tamanho={72} />
        <div>
          <h1 className="font-display text-2xl text-text-primary">{perfil.nome_usuario}</h1>
          <p className="text-sm text-text-muted">Identidade local desta instância</p>
        </div>
      </div>

      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Equipes</p>
      {perfil.equipes.length === 0 ? (
        <p className="text-sm text-text-muted">Você ainda não faz parte de nenhuma Equipe.</p>
      ) : (
        <div className="flex flex-col gap-1">
          {perfil.equipes.map((eq) => (
            <button key={eq.id} onClick={() => navigate(`/equipe/${eq.id}`)} className="flex items-center gap-3 rounded-2xl px-1 py-2.5 text-left">
              <Avatar nome={eq.nome} corFundo={corDaEquipe(eq.id)} tamanho={38} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-medium text-text-primary">{eq.nome}</p>
              </div>
              <RoleBadge cargo={eq.cargo as Cargo} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
