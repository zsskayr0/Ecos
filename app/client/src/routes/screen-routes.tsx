import { AdministracaoScreen } from "@/screens/Settings/AdministracaoScreen";
import { EscanearQrScreen } from "@/screens/Team/EscanearQrScreen";
import { EntrarEquipeScreen } from "@/screens/Team/EntrarEquipeScreen";
import { Navigate, Route } from "react-router-dom";

import { FeedScreen } from "@/screens/Feed/FeedScreen";
import { TodayScreen } from "@/screens/Today/TodayScreen";
import { NotesRootScreen } from "@/screens/Notes/NotesRootScreen";
import { FolderScreen } from "@/screens/Notes/FolderScreen";
import { NoteDetailScreen } from "@/screens/Notes/NoteDetailScreen";
import { FolderCreateScreen } from "@/screens/Notes/FolderCreateScreen";
import { SearchScreen } from "@/screens/Search/SearchScreen";
import { AgendaScreen } from "@/screens/Agenda/AgendaScreen";
import { EventosScreen } from "@/screens/Eventos/EventosScreen";
import { TaskDetailScreen } from "@/screens/Agenda/TaskDetailScreen";
import { TaskFoldersRootScreen } from "@/screens/Tasks/TaskFoldersRootScreen";
import { TaskFolderScreen } from "@/screens/Tasks/TaskFolderScreen";
import { TaskFolderCreateScreen } from "@/screens/Tasks/TaskFolderCreateScreen";
import { VaultEntry, VaultTransacaoEntry } from "@/screens/Vault/VaultScreen";
import { TeamProfileScreen } from "@/screens/Team/TeamProfileScreen";
import { TeamCreateJoinScreen } from "@/screens/Team/TeamCreateJoinScreen";
import { TeamsScreen } from "@/screens/Team/TeamsScreen";
import { ProfileScreen } from "@/screens/Profile/ProfileScreen";
import { RotinaScreen } from "@/screens/Profile/RotinaScreen";
import { NotificationsScreen } from "@/screens/Notifications/NotificationsScreen";
import { EditarPerfilScreen } from "@/screens/Profile/EditarPerfilScreen";
import { ABAS_COFRE, CofreConfigScreen } from "@/screens/Settings/CofreConfigScreen";
import { ConfiguracoesLayout } from "@/screens/Settings/ConfiguracoesLayout";
import { SettingsScreen } from "@/screens/Settings/SettingsScreen";
import { ServerConfigScreen } from "@/screens/Settings/ServerConfigScreen";
import { PrivacyVaultScreen } from "@/screens/Settings/PrivacyVaultScreen";
import { ContaDadosScreen } from "@/screens/Settings/ContaDadosScreen";
import { AparenciaScreen } from "@/screens/Settings/AparenciaScreen";
import { AboutScreen } from "@/screens/Settings/AboutScreen";
import { LicensesScreen } from "@/screens/Settings/LicensesScreen";
import { CalendarPreferencesScreen } from "@/screens/Settings/CalendarPreferencesScreen";
import { OrganizationScreen } from "@/screens/Settings/OrganizationScreen";
import { HelpScreen } from "@/screens/Help/HelpScreen";
import { MediaScreen } from "@/screens/Media/MediaScreen";
import { FileViewerScreen } from "@/screens/Media/FileViewerScreen";
import { TrashScreen } from "@/screens/Trash/TrashScreen";

/**
 * The single route table for every content screen — the mobile shell
 * (`AppShell`, one BrowserRouter) and each desktop tab (its own
 * MemoryRouter) both render exactly these, so a screen never has to know
 * which shell is hosting it.
 */
export const screenRoutes = (
  <>
    <Route path="/" element={<Navigate to="/feed" replace />} />

    <Route path="/feed" element={<FeedScreen />} />
    <Route path="/hoje" element={<TodayScreen />} />
    {/* Link legado: a administração agora pertence a Configurações. */}
    <Route path="/pastas" element={<Navigate to="/configuracoes/organizacao" replace />} />

    <Route path="/notas" element={<NotesRootScreen />} />
    <Route path="/notas/pasta/nova" element={<FolderCreateScreen />} />
    <Route path="/notas/pasta/*" element={<FolderScreen />} />
    <Route path="/notas/nota/:id" element={<NoteDetailScreen />} />

    <Route path="/busca" element={<SearchScreen />} />

    <Route path="/agenda" element={<AgendaScreen />} />
    <Route path="/eventos" element={<EventosScreen />} />
    <Route path="/tarefa/:id" element={<TaskDetailScreen />} />

    {/* Folder-browsing mode for Tarefas, reachable from the Drawer
        (section 3.9) — Agenda stays the calendar/time-blocking view; this
        is the by-folder view, same relationship Notas has to its own
        folder screens. */}
    <Route path="/tarefas" element={<TaskFoldersRootScreen />} />
    <Route path="/tarefas/pasta/nova" element={<TaskFolderCreateScreen />} />
    <Route path="/tarefas/pasta/*" element={<TaskFolderScreen />} />
    <Route path="/media" element={<MediaScreen />} />
    <Route path="/media/ver" element={<FileViewerScreen />} />
    <Route path="/lixeira" element={<TrashScreen />} />

    <Route path="/cofre" element={<VaultEntry />} />
    <Route path="/cofre/transacao/:id" element={<VaultTransacaoEntry />} />
    <Route path="/cofre/*" element={<VaultEntry />} />

    <Route path="/equipe/nova" element={<TeamCreateJoinScreen />} />
    <Route path="/equipe/escanear" element={<EscanearQrScreen />} />
    <Route path="/equipes" element={<TeamsScreen />} />
    <Route path="/equipe/:equipeId" element={<TeamProfileScreen />} />

    <Route path="/perfil" element={<ProfileScreen />} />
    <Route path="/perfil/editar" element={<Navigate to="/perfil" replace />} />
    <Route path="/perfil/rotina" element={<RotinaScreen />} />

    <Route path="/notificacoes" element={<NotificationsScreen />} />

    <Route path="/configuracoes" element={<ConfiguracoesLayout />}>
      <Route index element={<SettingsScreen />} />
      <Route path="servidor" element={<ServerConfigScreen />} />
      <Route path="sync" element={<Navigate to="/configuracoes/servidor" replace />} />
      <Route path="privacidade" element={<PrivacyVaultScreen />} />
      <Route path="cofre" element={<Navigate to="/configuracoes/cofre/seguranca" replace />} />
      {ABAS_COFRE.map(({ id }) => <Route key={id} path={`cofre/${id}`} element={<CofreConfigScreen aba={id} />} />)}
      <Route path="conta" element={<ContaDadosScreen />} />
      <Route path="aparencia" element={<AparenciaScreen />} />
      <Route path="calendario" element={<CalendarPreferencesScreen />} />
      <Route path="organizacao" element={<OrganizationScreen />} />
      <Route path="sobre" element={<AboutScreen />} />
      <Route path="sobre/licencas" element={<LicensesScreen />} />
      <Route path="perfil" element={<ProfileScreen />} />
      <Route path="editar-perfil" element={<EditarPerfilScreen />} />
      <Route path="rotina" element={<RotinaScreen />} />
      <Route path="equipes" element={<TeamsScreen />} />
      <Route path="equipes/nova" element={<TeamCreateJoinScreen />} />
      <Route path="equipes/escanear" element={<EscanearQrScreen />} />
      <Route path="equipes/:equipeId" element={<TeamProfileScreen />} />
      <Route path="notificacoes" element={<NotificationsScreen />} />
      <Route path="administracao" element={<AdministracaoScreen />} />
    </Route>

    {/* Destino do QR code de convite de equipe: entra na equipe e abre a página dela. */}
    <Route path="/entrar/:codigo" element={<EntrarEquipeScreen />} />

    <Route path="/ajuda" element={<HelpScreen />} />

    <Route path="*" element={<Navigate to="/feed" replace />} />
  </>
);
