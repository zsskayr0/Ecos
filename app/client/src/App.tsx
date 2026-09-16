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
import { TaskFoldersRootScreen } from "@/screens/Tasks/TaskFoldersRootScreen";
import { TaskFolderScreen } from "@/screens/Tasks/TaskFolderScreen";
import { TaskFolderCreateScreen } from "@/screens/Tasks/TaskFolderCreateScreen";
import { VaultScreen } from "@/screens/Vault/VaultScreen";
import { TransactionDetailScreen } from "@/screens/Vault/TransactionDetailScreen";
import { TeamProfileScreen } from "@/screens/Team/TeamProfileScreen";
import { TeamCreateJoinScreen } from "@/screens/Team/TeamCreateJoinScreen";
import { ProfileScreen } from "@/screens/Profile/ProfileScreen";
import { ProfileEditScreen } from "@/screens/Profile/ProfileEditScreen";
import { NotificationsScreen } from "@/screens/Notifications/NotificationsScreen";
import { OnboardingScreen } from "@/screens/Onboarding/OnboardingScreen";
import { SettingsScreen } from "@/screens/Settings/SettingsScreen";
import { ServerConfigScreen } from "@/screens/Settings/ServerConfigScreen";
import { ConectarServidorScreen } from "@/screens/Onboarding/ConectarServidorScreen";
import { precisaConfigurarServidor } from "@/lib/server-config";
import { SyncBackupScreen } from "@/screens/Settings/SyncBackupScreen";
import { PrivacyVaultScreen } from "@/screens/Settings/PrivacyVaultScreen";
import { AparenciaScreen } from "@/screens/Settings/AparenciaScreen";
import { AboutScreen } from "@/screens/Settings/AboutScreen";
import { HelpScreen } from "@/screens/Help/HelpScreen";

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
                {/* Onboarding is its own flow, with no nav/topbar (section 3.11) — feature
                    slides are real component mini-visualizations, but don't depend on
                    the backend (no network needed for them to exist). */}
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

                  {/* Folder-browsing mode for Tarefas, reachable from the Drawer
                      (section 3.9) — Agenda (bottom nav) stays the calendar/
                      time-blocking view; this is the by-folder view, same
                      relationship Notas has to its own folder screens. */}
                  <Route path="/tarefas" element={<TaskFoldersRootScreen />} />
                  <Route path="/tarefas/pasta/nova" element={<TaskFolderCreateScreen />} />
                  <Route path="/tarefas/pasta/:pastaId" element={<TaskFolderScreen />} />

                  <Route path="/cofre" element={<VaultScreen />} />
                  <Route path="/cofre/transacao/:id" element={<TransactionDetailScreen />} />

                  <Route path="/equipe/nova" element={<TeamCreateJoinScreen />} />
                  <Route path="/equipe/:equipeId" element={<TeamProfileScreen />} />

                  <Route path="/perfil" element={<ProfileScreen />} />
                  <Route path="/perfil/editar" element={<ProfileEditScreen />} />

                  <Route path="/notificacoes" element={<NotificationsScreen />} />

                  <Route path="/configuracoes" element={<SettingsScreen />} />
                  <Route path="/configuracoes/servidor" element={<ServerConfigScreen />} />
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
