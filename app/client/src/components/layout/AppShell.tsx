import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { onBackButtonPress } from "@tauri-apps/api/app";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { Topbar } from "./Topbar";
import { BottomNav } from "./BottomNav";
import { Fab } from "./Fab";
import { Drawer } from "./Drawer";
import { CreateFlow } from "@/screens/Create/CreateFlow";
import { useAppUI } from "@/lib/ui-context";

const ROTAS_BASE_COM_TOPBAR = ["/feed", "/hoje", "/pastas", "/notas", "/agenda", "/cofre", "/tarefas", "/media", "/busca", "/lixeira"];
/** Folder-browsing sub-routes keep the topbar too (avatar/notifications
 * shouldn't disappear just because you went one level deeper) — but not
 * `/pasta/nova` (a form screen with its own back+cancel header) and not
 * single-item detail/edit screens (Nota/Tarefa/Transação detail already
 * have their own dedicated back header, by design). User feedback: "na
 * seção tarefas, a foto de perfil e as notificação não devem sumir" — the
 * bug pre-dated Tarefas, `/notas/pasta/:id` already lost it too. */
const REGEX_PASTA_COM_TOPBAR = /^\/(notas|tarefas)\/pasta\/(?!nova(?:[/?#]|$)).+$/;

function temTopbar(pathname: string): boolean {
  return ROTAS_BASE_COM_TOPBAR.includes(pathname) || REGEX_PASTA_COM_TOPBAR.test(pathname);
}

/** O cabeçalho compartilhado acompanha as telas de navegação e pastas.
 * Menus, perfis e formulários usam seus próprios cabeçalhos. */
export function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const { capturaAberta, fecharCaptura } = useAppUI();
  const capturaRef = useRef({ aberta: capturaAberta, fechar: fecharCaptura });
  capturaRef.current = { aberta: capturaAberta, fechar: fecharCaptura };
  const [avisoDeSaida, setAvisoDeSaida] = useState(false);
  const rotaAtual = useRef(location.pathname);
  const podeSairAte = useRef(0);
  const timeoutDoAviso = useRef<ReturnType<typeof setTimeout>>();
  const comTopbar = temTopbar(location.pathname);
  const documentoAberto = location.pathname.startsWith("/tarefa/") || location.pathname.startsWith("/notas/nota/");

  useEffect(() => {
    rotaAtual.current = location.pathname;
  }, [location.pathname]);

  useEffect(() => {
    const mostrarAviso = () => {
      podeSairAte.current = Date.now() + 2500;
      setAvisoDeSaida(true);
      clearTimeout(timeoutDoAviso.current);
      timeoutDoAviso.current = setTimeout(() => setAvisoDeSaida(false), 2500);
    };

    let remover: { unregister: () => Promise<void> } | undefined;
    // O evento só existe no Android. No navegador e no desktop, a API pode
    // rejeitar o registro e o comportamento normal de voltar é preservado.
    void onBackButtonPress(() => {
      // Captura aberta (tela cheia por cima do app): voltar fecha ela, não navega nem sai.
      if (capturaRef.current.aberta) {
        capturaRef.current.fechar();
        return;
      }
      if (rotaAtual.current !== "/feed") {
        navigate("/feed", { replace: true });
        mostrarAviso();
        return;
      }

      if (Date.now() <= podeSairAte.current) {
        void invoke("encerrar_app");
        return;
      }

      mostrarAviso();
    }).then((unlisten) => { remover = unlisten; }).catch(() => undefined);

    return () => {
      void remover?.unregister();
      clearTimeout(timeoutDoAviso.current);
    };
  }, [navigate]);

  return (
    <div className={`mx-auto min-h-full bg-base ${documentoAberto ? "max-w-6xl" : "max-w-md"}`}>
      {comTopbar && <Topbar />}
      <main className="pb-nav-safe">
        <Outlet />
      </main>
      <BottomNav />
      {!documentoAberto && <Fab />}
      <Drawer />
      <CreateFlow />
      {avisoDeSaida && (
        <div
          aria-live="polite"
          role="status"
          className="fixed inset-x-4 bottom-[calc(env(safe-area-inset-bottom)+5.5rem)] z-[100] mx-auto w-fit rounded-xl border border-steel-500/30 bg-surface-raised px-4 py-3 text-sm font-medium text-text-primary shadow-nav"
        >
          Volte novamente para sair do app.
        </div>
      )}
    </div>
  );
}
