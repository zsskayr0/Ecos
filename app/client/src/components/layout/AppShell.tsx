import { Outlet, useLocation } from "react-router-dom";
import { Topbar } from "./Topbar";
import { BottomNav } from "./BottomNav";
import { Fab } from "./Fab";
import { Drawer } from "./Drawer";
import { CreateFlow } from "@/screens/Create/CreateFlow";

const ROTAS_BASE_COM_TOPBAR = ["/feed", "/notas", "/agenda", "/cofre", "/tarefas", "/media", "/busca", "/lixeira"];
/** Folder-browsing sub-routes keep the topbar too (avatar/notifications
 * shouldn't disappear just because you went one level deeper) — but not
 * `/pasta/nova` (a form screen with its own back+cancel header) and not
 * single-item detail/edit screens (Nota/Tarefa/Transação detail already
 * have their own dedicated back header, by design). User feedback: "na
 * seção tarefas, a foto de perfil e as notificação não devem sumir" — the
 * bug pre-dated Tarefas, `/notas/pasta/:id` already lost it too. */
const REGEX_PASTA_COM_TOPBAR = /^\/(notas|tarefas)\/pasta\/(?!nova$)[^/]+$/;

function temTopbar(pathname: string): boolean {
  return ROTAS_BASE_COM_TOPBAR.includes(pathname) || REGEX_PASTA_COM_TOPBAR.test(pathname);
}

/** O cabeçalho compartilhado acompanha as telas de navegação e pastas.
 * Menus, perfis e formulários usam seus próprios cabeçalhos. */
export function AppShell() {
  const location = useLocation();
  const comTopbar = temTopbar(location.pathname);
  const documentoAberto = location.pathname.startsWith("/tarefa/") || location.pathname.startsWith("/notas/nota/");

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
    </div>
  );
}
