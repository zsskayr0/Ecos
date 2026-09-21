import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AlertTriangle, Loader2 } from "lucide-react";
import { equipes, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useRefreshBus } from "@/lib/refresh-bus";

/**
 * Destino do QR code de convite (`/entrar/<código>`): a pessoa já tem conta e sessão (senão o app pede o login antes,
 * com o endereço preservado), então basta aceitar o convite e abrir a equipe.
 */
export function EntrarEquipeScreen() {
  const { codigo } = useParams();
  const navigate = useNavigate();
  const { recarregarPerfil } = useAuth();
  const { notificar } = useRefreshBus();
  const [erro, setErro] = useState<string | null>(null);
  const feito = useRef(false); // o StrictMode monta duas vezes; o convite é de uso único

  useEffect(() => {
    if (!codigo || feito.current) return;
    feito.current = true;
    (async () => {
      try {
        await equipes.aceitarConvite(codigo);
        await recarregarPerfil();
        notificar();
        const minhas = await equipes.listarMinhas();
        navigate(minhas.length ? "/equipes" : "/feed", { replace: true });
      } catch (e) {
        setErro(e instanceof ApiError ? e.message : "Não foi possível entrar na equipe.");
      }
    })();
  }, [codigo, navigate, recarregarPerfil, notificar]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-6 text-center">
      {erro ? (
        <>
          <AlertTriangle className="text-error" size={28} strokeWidth={1.5} />
          <p className="text-sm text-text-primary">{erro}</p>
          <button onClick={() => navigate("/equipes", { replace: true })} className="text-sm text-steel-300">Ir para as equipes</button>
        </>
      ) : (
        <>
          <Loader2 className="animate-spin text-text-muted" size={24} />
          <p className="text-sm text-text-secondary">Entrando na equipe…</p>
        </>
      )}
    </div>
  );
}
