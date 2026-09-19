import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AppUIProvider } from "@/lib/ui-context";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { RefreshProvider } from "@/lib/refresh-bus";
import { useIsDesktop } from "@/lib/use-viewport";
import { AppShell } from "@/components/layout/AppShell";
import { DesktopShell } from "@/desktop/DesktopShell";
import { screenRoutes } from "@/routes/screen-routes";
import { AuthScreen } from "@/screens/Auth/AuthScreen";
import { OnboardingScreen } from "@/screens/Onboarding/OnboardingScreen";
import { ConectarServidorScreen } from "@/screens/Onboarding/ConectarServidorScreen";
import { precisaConfigurarServidor } from "@/lib/server-config";

/** Real authentication gate (section 5.1) — without it, nothing below actually talks to `ecos-app`. */
function AuthGate({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();

  // The Tauri shell (desktop/Android) has no working default address —
  // asking "who's logged in" before the user has told it *where* to ask
  // would just be a network error. User feedback: "deixa configurável no
  // próprio app" (`server-config.ts`).
  if (precisaConfigurarServidor()) {
    return <ConectarServidorScreen />;
  }

  if (status === "carregando") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="font-display text-2xl text-text-muted">Ecos</p>
      </div>
    );
  }
  if (status === "indisponivel") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-2 px-6 text-center">
        <p className="font-display text-2xl text-text-muted">Ecos</p>
        <p role="status" className="text-sm text-text-secondary">O servidor não respondeu. Sua sessão continua salva — tentando reconectar…</p>
      </div>
    );
  }
  if (status === "deslogado") {
    return <AuthScreen />;
  }
  return <>{children}</>;
}

/**
 * Wide windows get the multi-pane desktop workspace, which manages its own
 * per-tab MemoryRouters (React Router forbids nesting a Router inside
 * another one, so it lives outside `BrowserRouter` entirely). Narrow
 * windows and Android keep the single-column mobile shell.
 */
function Shell() {
  const desktop = useIsDesktop();
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
          <AuthGate>
            <Shell />
          </AuthGate>
        </AppUIProvider>
      </RefreshProvider>
    </AuthProvider>
  );
}
