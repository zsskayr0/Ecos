import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { notificacoes } from "@/lib/api";
import { avisoTocado, sincronizarEndereco, temPushNoCelular } from "@/lib/push-celular";

/**
 * Só no app Android: mantém o servidor com o endereço de push atual deste aparelho e, quando a pessoa toca num aviso
 * na barra do sistema, abre a rota dele e o marca como lido (a leitura vale para todos os aparelhos, pelo servidor).
 */
export function ReceptorPush() {
  const navigate = useNavigate();

  useEffect(() => {
    if (!temPushNoCelular()) return;
    const abrirTocado = () => {
      const aviso = avisoTocado();
      if (!aviso) return;
      if (aviso.id) void notificacoes.marcarLida(aviso.id).catch(() => { /* a caixa marca depois */ });
      navigate(aviso.url || "/notificacoes");
    };
    const sincronizar = () => { void sincronizarEndereco(); };
    const aoVoltar = () => { if (document.visibilityState === "visible") { sincronizar(); abrirTocado(); } };
    sincronizar();
    abrirTocado();
    window.addEventListener("ecos:push-endpoint", sincronizar);
    window.addEventListener("ecos:abrir-aviso", abrirTocado);
    document.addEventListener("visibilitychange", aoVoltar);
    return () => {
      window.removeEventListener("ecos:push-endpoint", sincronizar);
      window.removeEventListener("ecos:abrir-aviso", abrirTocado);
      document.removeEventListener("visibilitychange", aoVoltar);
    };
  }, [navigate]);

  return null;
}
