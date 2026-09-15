import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppUIProvider } from "@/lib/ui-context";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { RefreshProvider } from "@/lib/refresh-bus";
import { AppShell } from "@/components/layout/AppShell";
import { AuthScreen } from "@/screens/Auth/AuthScreen";

import { FeedScreen } from "@/screens/Feed/FeedScreen";
import { NotesRootScreen } from "@/screens/Notes/NotesRootScreen";
import { FolderScreen } from "@/screens/Notes/FolderScreen";
import { NoteDetailScreen } from "@/screens/Notes/NoteDetailScreen";
import { FolderCreateScreen } from "@/screens/Notes/FolderCreateScreen";
import { SearchScreen } from "@/screens/Search/SearchScreen";
import { AgendaScreen } from "@/screens/Agenda/AgendaScreen";
import { TaskDetailScreen } from "@/screens/Agenda/TaskDetailScreen";
import { VaultScreen } from "@/screens/Vault/VaultScreen";
import { TransactionDetailScreen } from "@/screens/Vault/TransactionDetailScreen";
import { TeamProfileScreen } from "@/screens/Team/TeamProfileScreen";
import { TeamCreateJoinScreen } from "@/screens/Team/TeamCreateJoinScreen";
import { ProfileScreen } from "@/screens/Profile/ProfileScreen";
import { ProfileEditScreen } from "@/screens/Profile/ProfileEditScreen";
import { NotificationsScreen } from "@/screens/Notifications/NotificationsScreen";
import { OnboardingScreen } from "@/screens/Onboarding/OnboardingScreen";
import { SettingsScreen } from "@/screens/Settings/SettingsScreen";
import { SyncBackupScreen } from "@/screens/Settings/SyncBackupScreen";
import { PrivacyVaultScreen } from "@/screens/Settings/PrivacyVaultScreen";
import { AparenciaScreen } from "@/screens/Settings/AparenciaScreen";
import { AboutScreen } from "@/screens/Settings/AboutScreen";
import { HelpScreen } from "@/screens/Help/HelpScreen";

/** Portão real de autenticação (seção 5.1) — sem isso, nada abaixo fala com `ecos-app` de verdade. */
function AuthGate({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();

  if (status === "carregando") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="font-display text-2xl text-text-muted">Ecos</p>
      </div>
    );
  }
  if (status === "deslogado") {
    return <AuthScreen />;
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <AuthProvider>
      <RefreshProvider>
        <AppUIProvider>
          <BrowserRouter>
            <AuthGate>
              <Routes>
                {/* Onboarding é um fluxo próprio, sem nav/topbar (seção 3.11) — telas de
                    recurso são mini-visualizações reais de componente, mas não dependem
                    do backend (não precisam de rede pra existir). */}
                <Route path="/onboarding" element={<OnboardingScreen />} />

                <Route element={<AppShell />}>
                  <Route path="/" element={<Navigate to="/feed" replace />} />

                  <Route path="/feed" element={<FeedScreen />} />

                  <Route path="/notas" element={<NotesRootScreen />} />
                  <Route path="/notas/pasta/nova" element={<FolderCreateScreen />} />
                  <Route path="/notas/pasta/:pastaId" element={<FolderScreen />} />
                  <Route path="/notas/nota/:id" element={<NoteDetailScreen />} />

                  <Route path="/busca" element={<SearchScreen />} />

                  <Route path="/agenda" element={<AgendaScreen />} />
                  <Route path="/tarefa/:id" element={<TaskDetailScreen />} />

                  <Route path="/cofre" element={<VaultScreen />} />
                  <Route path="/cofre/transacao/:id" element={<TransactionDetailScreen />} />

                  <Route path="/equipe/nova" element={<TeamCreateJoinScreen />} />
                  <Route path="/equipe/:equipeId" element={<TeamProfileScreen />} />

                  <Route path="/perfil" element={<ProfileScreen />} />
                  <Route path="/perfil/editar" element={<ProfileEditScreen />} />

                  <Route path="/notificacoes" element={<NotificationsScreen />} />

                  <Route path="/configuracoes" element={<SettingsScreen />} />
                  <Route path="/configuracoes/sync" element={<SyncBackupScreen />} />
                  <Route path="/configuracoes/privacidade" element={<PrivacyVaultScreen />} />
                  <Route path="/configuracoes/aparencia" element={<AparenciaScreen />} />
                  <Route path="/configuracoes/sobre" element={<AboutScreen />} />

                  <Route path="/ajuda" element={<HelpScreen />} />

                  <Route path="*" element={<Navigate to="/feed" replace />} />
                </Route>
              </Routes>
            </AuthGate>
          </BrowserRouter>
        </AppUIProvider>
      </RefreshProvider>
    </AuthProvider>
  );
}
