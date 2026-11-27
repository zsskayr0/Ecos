import { useEffect, useMemo, useState } from "react";
import { Navigate, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { Bell, CloudUpload, CalendarClock, CalendarDays, DatabaseBackup, EyeOff, FolderCog, FolderTree, Info, Keyboard, Languages, ListChecks, Lock, Network, Palette, PenLine, Rss, Server, Shapes, StickyNote, User, UserCog, Users, type LucideIcon } from "lucide-react";
import { useIsDesktop } from "@/lib/use-viewport";
import { useAuth } from "@/lib/auth-context";
import { ABAS_COFRE } from "./abas-cofre";
import { buscarConfiguracoes, type Resultado } from "./indice-busca";
import { CampoBusca, ResultadosBusca } from "./BuscaConfiguracoes";

export interface Aba { para: string; rotulo: string; Icone: LucideIcon; fim?: boolean }
export interface Grupo { titulo: string; abas: Aba[] }

const C = "/configuracoes";
const abaCofre = (id: string): Aba => { const a = ABAS_COFRE.find((x) => x.id === id)!; return { para: `${C}/cofre/${a.id}`, rotulo: a.rotulo, Icone: a.Icone }; };

/**
 * O menu das configurações, por contexto: quem eu sou (Conta), como o Ecos se comporta em qualquer tela (Aplicativo),
 * o que eu escrevo e planejo (Tarefas e notas), onde isso fica guardado (Pastas e arquivos), o Cofre e, por último, a
 * instalação (Sistema). Dentro de cada grupo, o mais usado vem primeiro.
 */
function montarGrupos({ admin, desktop }: { admin: boolean; desktop: boolean }): Grupo[] {
  return [
    { titulo: "Conta", abas: [
      { para: `${C}/perfil`, rotulo: "Perfil", Icone: User },
      { para: `${C}/rotina`, rotulo: "Rotina", Icone: CalendarClock },
      { para: `${C}/equipes`, rotulo: "Equipes", Icone: Users },
      { para: `${C}/conta`, rotulo: "Conta e dados", Icone: DatabaseBackup },
    ] },
    { titulo: "Aplicativo", abas: [
      { para: `${C}/aparencia`, rotulo: "Aparência", Icone: Palette },
      { para: `${C}/idioma-regiao`, rotulo: "Idioma e região", Icone: Languages },
      { para: `${C}/notificacoes`, rotulo: "Notificações", Icone: Bell },
      ...(desktop ? [{ para: `${C}/atalhos`, rotulo: "Atalhos de teclado", Icone: Keyboard }] : []),
    ] },
    { titulo: "Tarefas e notas", abas: [
      { para: `${C}/tarefas`, rotulo: "Tarefas", Icone: ListChecks },
      { para: `${C}/notas`, rotulo: "Notas", Icone: StickyNote },
      { para: `${C}/feed`, rotulo: "Feed", Icone: Rss },
      { para: `${C}/editor`, rotulo: "Editor e escrita", Icone: PenLine },
      { para: `${C}/calendario`, rotulo: "Calendário e agenda", Icone: CalendarDays },
      { para: `${C}/grafico`, rotulo: "Gráfico", Icone: Network },
    ] },
    { titulo: "Pastas e arquivos", abas: [
      { para: `${C}/pastas-arquivos`, rotulo: "Exibição e lixeira", Icone: FolderTree },
      { para: `${C}/organizacao`, rotulo: "Gerenciar pastas e tags", Icone: FolderCog },
      { para: `${C}/pastas-trancadas`, rotulo: "Pastas trancadas", Icone: Lock },
      { para: `${C}/icones`, rotulo: "Ícones personalizados", Icone: Shapes },
    ] },
    { titulo: "Cofre", abas: [
      abaCofre("seguranca"),
      { para: `${C}/privacidade`, rotulo: "Privacidade e redefinição", Icone: EyeOff },
      abaCofre("valores"), abaCofre("csv"), abaCofre("github"), abaCofre("ajuda"),
    ] },
    { titulo: "Sistema", abas: [
      { para: `${C}/servidor`, rotulo: "Servidor e backup", Icone: Server },
      { para: `${C}/pendencias`, rotulo: "Pendências", Icone: CloudUpload },
      // Quem administra a instância ganha Usuários e equipes (criar contas, equipes); para as demais pessoas nem aparece.
      ...(admin ? [{ para: `${C}/administracao`, rotulo: "Usuários e equipes", Icone: UserCog }] : []),
      { para: `${C}/sobre`, rotulo: "Sobre", Icone: Info },
    ] },
  ];
}

export function useGrupos(): Grupo[] {
  const { perfil } = useAuth();
  const desktop = useIsDesktop();
  const admin = perfil?.papel === "admin";
  return useMemo(() => montarGrupos({ admin, desktop }), [admin, desktop]);
}

/** Busca das configurações: o texto digitado, o que ele encontra e como abrir um resultado. */
export function useBuscaConfiguracoes(grupos: Grupo[]) {
  const navigate = useNavigate();
  const [consulta, setConsulta] = useState("");
  const resultados = useMemo(() => buscarConfiguracoes(consulta, grupos), [consulta, grupos]);
  const abrir = (r: Resultado<Aba>) => navigate(r.destino);
  return { consulta, setConsulta, resultados, abrir, abrirPrimeiro: () => { if (resultados[0]) abrir(resultados[0]); } };
}

/** Ao chegar com `#opcao` (vindo da busca), rola até a opção e a destaca por um instante. A tela pode ainda estar carregando. */
function useDestacarOpcao() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    const ancora = decodeURIComponent(hash.replace(/^#/, ""));
    if (!ancora) return;
    let tentativas = 0;
    const procurar = window.setInterval(() => {
      const alvo = document.querySelector<HTMLElement>(`[data-config="${ancora.replace(/["\\]/g, "")}"]`);
      if (!alvo && ++tentativas < 30) return;
      window.clearInterval(procurar);
      if (!alvo) return;
      alvo.scrollIntoView?.({ behavior: "smooth", block: "center" });
      alvo.animate?.([{ backgroundColor: "rgb(var(--ecos-cyan-rgb) / 0.22)" }, { backgroundColor: "rgb(var(--ecos-cyan-rgb) / 0.22)", offset: 0.6 }, { backgroundColor: "transparent" }], { duration: 2200, easing: "ease-out" });
    }, 100);
    return () => window.clearInterval(procurar);
  }, [pathname, hash]);
}

const CHAVE_ULTIMA_ABA = "ecos:configuracoes:ultima-aba";
const lerUltimaAba = () => { try { return localStorage.getItem(CHAVE_ULTIMA_ABA); } catch { return null; } };

/** No desktop, as configurações ganham uma barra lateral com busca e categorias; no celular continua a lista de telas. */
export function ConfiguracoesLayout() {
  const desktop = useIsDesktop();
  const { pathname } = useLocation();
  const grupos = useGrupos();
  const busca = useBuscaConfiguracoes(grupos);
  useDestacarOpcao();
  const raiz = pathname.replace(/\/$/, "") === "/configuracoes";
  useEffect(() => {
    if (!raiz && grupos.some((g) => g.abas.some((a) => a.para === pathname))) { try { localStorage.setItem(CHAVE_ULTIMA_ABA, pathname); } catch { /* só vale nesta sessão */ } }
  }, [pathname, raiz, grupos]);
  if (!desktop) return <Outlet />;
  // Abre na última aba visitada (se ela ainda existir para esta pessoa); senão, no Perfil.
  if (raiz) {
    const ultima = lerUltimaAba();
    const destino = ultima && grupos.some((g) => g.abas.some((a) => a.para === ultima)) ? ultima : "/configuracoes/perfil";
    return <Navigate to={destino} replace />;
  }
  return (
    <div className="config-desktop flex h-full min-h-0 overflow-hidden">
      <div className="relative z-10 flex w-64 shrink-0 flex-col border-r border-border bg-surface-1/60">
        <CampoBusca valor={busca.consulta} onChange={busca.setConsulta} aoConfirmar={busca.abrirPrimeiro} className="mx-2 mb-2 mt-3 shrink-0" />
        {busca.consulta.trim() ? (
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-4"><ResultadosBusca resultados={busca.resultados} aoAbrir={busca.abrir} /></div>
        ) : (
          <nav aria-label="Categorias de configurações" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-4 pt-1">
            {grupos.map((grupo) => (
              <div key={grupo.titulo} className="mb-4">
                <p className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wide text-text-muted">{grupo.titulo}</p>
                {grupo.abas.map(({ para, rotulo, Icone, fim }) => (
                  <NavLink key={para} to={para} end={fim} className={({ isActive }) => `flex items-center gap-2.5 rounded-md px-3 py-1.5 text-sm transition-colors ${isActive ? "bg-surface-3 font-medium text-text-primary" : "text-text-secondary hover:bg-surface-2 hover:text-text-primary"}`}>
                    <Icone size={16} strokeWidth={1.75} aria-hidden className="shrink-0" /><span className="min-w-0 truncate">{rotulo}</span>
                  </NavLink>
                ))}
              </div>
            ))}
          </nav>
        )}
      </div>
      <div className="relative isolate min-w-0 flex-1 overflow-y-auto overscroll-contain"><div className="mx-auto max-w-[88rem]"><Outlet /></div></div>
    </div>
  );
}
