import { Outlet, useLocation } from "react-router-dom";
import { Topbar } from "./Topbar";
import { BottomNav } from "./BottomNav";
import { Fab } from "./Fab";
import { Drawer } from "./Drawer";
import { CreateFlow } from "@/screens/Create/CreateFlow";

const ROTAS_COM_TOPBAR = ["/feed", "/notas", "/agenda", "/cofre"];

/** Casca de app — topbar+nav+FAB nas 4 telas com nav (Feed/Notas/Agenda/Cofre); Busca tem cabeçalho próprio. */
export function AppShell() {
  const location = useLocation();
  const comTopbar = ROTAS_COM_TOPBAR.includes(location.pathname);

  return (
    <div className="mx-auto min-h-full max-w-md bg-base">
      {comTopbar && <Topbar />}
      <main className="pb-nav-safe">
        <Outlet />
      </main>
      <BottomNav />
      <Fab />
      <Drawer />
      <CreateFlow />
    </div>
  );
}
