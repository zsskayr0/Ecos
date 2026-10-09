import { VaultScreen } from "@/screens/Vault/VaultScreen";
import { useEffect, useRef, useState } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AppUIProvider } from "@/lib/ui-context";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { RefreshProvider } from "@/lib/refresh-bus";
import { useIsDesktop } from "@/lib/use-viewport";
import { AppShell } from "@/components/layout/AppShell";
import { DesktopShell } from "@/desktop/DesktopShell";
import { screenRoutes } from "@/routes/screen-routes";
import { AuthScreen } from "@/screens/Auth/AuthScreen";
import { ReaceiteTermos } from "@/components/legal/ReaceiteTermos";
import { TrocaSenhaObrigatoriaScreen } from "@/screens/Auth/TrocaSenhaObrigatoriaScreen";
import { OnboardingScreen } from "@/screens/Onboarding/OnboardingScreen";
import { ConectarServidorScreen, useFluxoConectar } from "@/screens/Onboarding/ConectarServidorScreen";
import { CarregandoScreen } from "@/screens/Onboarding/CarregandoScreen";
import { PalcoIntro } from "@/components/layout/PalcoIntro";
import { ReceptorCompartilhamento } from "@/components/layout/ReceptorCompartilhamento";
import { ToastHost } from "@/lib/toast";
import { ArrasteTarefaProvider } from "@/lib/arraste-tarefa";
import { precisaConfigurarServidor } from "@/lib/server-config";
import { OfflineStatus } from "@/components/common/OfflineStatus";
import { ResumoDiarioAgente } from "@/lib/resumo-diario";

/** Tempo mínimo da abertura (ms): sem isso, num servidor rápido a marca piscaria e sumiria antes de dar pra ver. */
const ABERTURA_MINIMA_MS = 900;

/**
 * Real authentication gate (section 5.1) — without it, nothing below actually talks to `ecos-app`.
 *
 * Tudo que vem antes do app (carregando → boas-vindas → onde está o Ecos → login) roda dentro de UM `PalcoIntro`:
 * como ele é sempre o mesmo elemento na mesma posição, a arte de fundo não reinicia e só a etapa da direita troca,
 * com transição. Quem já está logado passa direto, sem abertura.
 */
function AuthGate({ children }: { children: React.ReactNode }) {
  const { status, perfil } = useAuth();
  const fluxoConectar = useFluxoConectar();
  const [abertura, setAbertura] = useState(true);
  useEffect(() => {
    const t = window.setTimeout(() => setAbertura(false), ABERTURA_MINIMA_MS);
    return () => window.clearTimeout(t);
  }, []);

  // The Tauri shell (desktop/Android) has no working default address —
  // asking "who's logged in" before the user has told it *where* to ask
  // would just be a network error. User feedback: "deixa configurável no
  // próprio app" (`server-config.ts`).
  const semServidor = precisaConfigurarServidor();
  if (!semServidor && status === "autenticado") {
    // Conta criada pela administração: antes de tudo, trocar a senha temporária (o servidor também recusa o resto até lá).
    if (perfil?.deve_trocar_senha) return <PalcoIntro etapa="trocar-senha"><TrocaSenhaObrigatoriaScreen /></PalcoIntro>;
    return perfil?.termos_pendente ? <ReaceiteTermos /> : <>{children}</>;
  }

  if (abertura || (!semServidor && status === "carregando")) {
    return (
      <PalcoIntro etapa="carregando">
        <CarregandoScreen />
      </PalcoIntro>
    );
  }
  if (semServidor) {
    return (
      <PalcoIntro etapa={`conectar:${fluxoConectar.passo}`} direcao={fluxoConectar.direcao}>
        <ConectarServidorScreen fluxo={fluxoConectar} />
      </PalcoIntro>
    );
  }
  if (status === "indisponivel") {
    return (
      <PalcoIntro etapa="indisponivel">
        <CarregandoScreen mensagem="O servidor não respondeu." aviso="Sua sessão continua salva — tentando reconectar…" />
      </PalcoIntro>
    );
  }
  return (
    <PalcoIntro etapa="login">
      <AuthScreen />
    </PalcoIntro>
  );
}

/**
 * Wide windows get the multi-pane desktop workspace, which manages its own
 * per-tab MemoryRouters (React Router forbids nesting a Router inside
 * another one, so it lives outside `BrowserRouter` entirely). Narrow
 * windows and Android keep the single-column mobile shell.
 */
function Shell() {
  const desktop = useIsDesktop();
  const desktopRef = useRef(desktop);
  desktopRef.current = desktop;
  const [cofre, setCofre] = useState(() => window.location.pathname.startsWith("/cofre"));
  useEffect(() => {
    const abrir = (event: Event) => { if (desktopRef.current) return; const path=(event as CustomEvent<string>).detail; window.history.pushState(null,"",path?.startsWith("/cofre")?path:"/cofre"); setCofre(true); };
    const navegar = () => setCofre(window.location.pathname.startsWith("/cofre"));
    window.addEventListener("ecos:abrir-cofre", abrir);
    window.addEventListener("popstate", navegar);
    return () => { window.removeEventListener("ecos:abrir-cofre", abrir); window.removeEventListener("popstate", navegar); };
  }, []);
  if (cofre && !desktop) return <BrowserRouter><Routes><Route path="/cofre/transacao/:id" element={<VaultScreen voltar={() => { window.history.replaceState(null,"","/feed"); setCofre(false); }} />} /><Route path="*" element={<VaultScreen voltar={() => { window.history.replaceState(null,"","/feed"); setCofre(false); }} />} /></Routes></BrowserRouter>;
  if (desktop) return <DesktopShell />;

  return (
    <BrowserRouter>
      <Routes>
        {/* Onboarding is its own flow, with no nav/topbar (section 3.11) — feature
            slides are real component mini-visualizations, but don't depend on
            the backend (no network needed for them to exist). */}
        <Route path="/onboarding" element={<OnboardingScreen />} />
        <Route element={<AppShell />}>{screenRoutes}</Route>
      </Routes>
    </BrowserRouter>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <RefreshProvider>
        <AppUIProvider>
          <ArrasteTarefaProvider>
            <AuthGate>
              <ResumoDiarioAgente />
              <Shell />
              <ReceptorCompartilhamento />
              <ToastHost />
            </AuthGate>
            <OfflineStatus />
          </ArrasteTarefaProvider>
        </AppUIProvider>
      </RefreshProvider>
    </AuthProvider>
  );
}
