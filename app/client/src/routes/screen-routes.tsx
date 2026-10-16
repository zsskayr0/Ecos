import { lazy, type ComponentType, type ReactElement } from "react";
import { Navigate, Route } from "react-router-dom";

import { TelaSobDemanda } from "@/components/common/TelaSobDemanda";
import { ABAS_COFRE } from "@/screens/Settings/abas-cofre";
import { FeedScreen } from "@/screens/Feed/FeedScreen";

/**
 * Cada tela é um pedaço do pacote baixado só quando a rota é aberta (o Feed, que é a tela inicial, continua no pacote
 * principal). `carregar` troca o `import()` nomeado por um componente preguiçoso; o `Suspense` de `tela` mostra o
 * carregamento padrão enquanto o pedaço chega e o de erro (com "Recarregar") se o download falhar.
 */
type PropsDe<T> = T extends ComponentType<infer P> ? P : never;
function carregar<M, K extends keyof M>(importar: () => Promise<M>, nome: K) {
  return lazy(() => importar().then((m) => ({ default: m[nome] as unknown as ComponentType<PropsDe<M[K]>> })));
}

const tela = (Tela: ComponentType): ReactElement => (
  <TelaSobDemanda>
    <Tela />
  </TelaSobDemanda>
);

const HomeScreen = carregar(() => import("@/screens/Home/HomeScreen"), "HomeScreen");
const TodayScreen = carregar(() => import("@/screens/Today/TodayScreen"), "TodayScreen");
const NotesRootScreen = carregar(() => import("@/screens/Notes/NotesRootScreen"), "NotesRootScreen");
const FolderScreen = carregar(() => import("@/screens/Notes/FolderScreen"), "FolderScreen");
const NoteDetailScreen = carregar(() => import("@/screens/Notes/NoteDetailScreen"), "NoteDetailScreen");
const FolderCreateScreen = carregar(() => import("@/screens/Notes/FolderCreateScreen"), "FolderCreateScreen");
const SearchScreen = carregar(() => import("@/screens/Search/SearchScreen"), "SearchScreen");
const AgendaScreen = carregar(() => import("@/screens/Agenda/AgendaScreen"), "AgendaScreen");
const EventosScreen = carregar(() => import("@/screens/Eventos/EventosScreen"), "EventosScreen");
const TaskDetailScreen = carregar(() => import("@/screens/Agenda/TaskDetailScreen"), "TaskDetailScreen");
const TaskFoldersRootScreen = carregar(() => import("@/screens/Tasks/TaskFoldersRootScreen"), "TaskFoldersRootScreen");
const TaskFolderScreen = carregar(() => import("@/screens/Tasks/TaskFolderScreen"), "TaskFolderScreen");
const TaskFolderCreateScreen = carregar(() => import("@/screens/Tasks/TaskFolderCreateScreen"), "TaskFolderCreateScreen");
const VaultEntry = carregar(() => import("@/screens/Vault/VaultScreen"), "VaultEntry");
const VaultTransacaoEntry = carregar(() => import("@/screens/Vault/VaultScreen"), "VaultTransacaoEntry");
const TeamProfileScreen = carregar(() => import("@/screens/Team/TeamProfileScreen"), "TeamProfileScreen");
const TeamCreateJoinScreen = carregar(() => import("@/screens/Team/TeamCreateJoinScreen"), "TeamCreateJoinScreen");
const TeamsScreen = carregar(() => import("@/screens/Team/TeamsScreen"), "TeamsScreen");
const EscanearQrScreen = carregar(() => import("@/screens/Team/EscanearQrScreen"), "EscanearQrScreen");
const EntrarEquipeScreen = carregar(() => import("@/screens/Team/EntrarEquipeScreen"), "EntrarEquipeScreen");
const ProfileScreen = carregar(() => import("@/screens/Profile/ProfileScreen"), "ProfileScreen");
const RotinaScreen = carregar(() => import("@/screens/Profile/RotinaScreen"), "RotinaScreen");
const EditarPerfilScreen = carregar(() => import("@/screens/Profile/EditarPerfilScreen"), "EditarPerfilScreen");
const NotificationsScreen = carregar(() => import("@/screens/Notifications/NotificationsScreen"), "NotificationsScreen");
const CofreConfigScreen = carregar(() => import("@/screens/Settings/CofreConfigScreen"), "CofreConfigScreen");
const ConfiguracoesLayout = carregar(() => import("@/screens/Settings/ConfiguracoesLayout"), "ConfiguracoesLayout");
const SettingsScreen = carregar(() => import("@/screens/Settings/SettingsScreen"), "SettingsScreen");
const ServerConfigScreen = carregar(() => import("@/screens/Settings/ServerConfigScreen"), "ServerConfigScreen");
const PrivacyVaultScreen = carregar(() => import("@/screens/Settings/PrivacyVaultScreen"), "PrivacyVaultScreen");
const ContaDadosScreen = carregar(() => import("@/screens/Settings/ContaDadosScreen"), "ContaDadosScreen");
const AparenciaScreen = carregar(() => import("@/screens/Settings/AparenciaScreen"), "AparenciaScreen");
const AboutScreen = carregar(() => import("@/screens/Settings/AboutScreen"), "AboutScreen");
const LicensesScreen = carregar(() => import("@/screens/Settings/LicensesScreen"), "LicensesScreen");
const ProblemasSincronizacaoScreen = carregar(() => import("@/screens/Settings/ProblemasSincronizacaoScreen"), "ProblemasSincronizacaoScreen");
const CalendarPreferencesScreen = carregar(() => import("@/screens/Settings/CalendarPreferencesScreen"), "CalendarPreferencesScreen");
const UsoDiarioScreen = carregar(() => import("@/screens/Settings/UsoDiarioScreen"), "UsoDiarioScreen");
const NotificacoesPreferenciasScreen = carregar(() => import("@/screens/Settings/NotificacoesPreferenciasScreen"), "NotificacoesPreferenciasScreen");
const OrganizationScreen = carregar(() => import("@/screens/Settings/OrganizationScreen"), "OrganizationScreen");
const AdministracaoScreen = carregar(() => import("@/screens/Settings/AdministracaoScreen"), "AdministracaoScreen");
const HelpScreen = carregar(() => import("@/screens/Help/HelpScreen"), "HelpScreen");
const MediaScreen = carregar(() => import("@/screens/Media/MediaScreen"), "MediaScreen");
const FileViewerScreen = carregar(() => import("@/screens/Media/FileViewerScreen"), "FileViewerScreen");
const GraficoConfigScreen = carregar(() => import("@/screens/Settings/GraficoConfigScreen"), "GraficoConfigScreen");
const GraficoScreen = carregar(() => import("@/screens/Grafico/GraficoScreen"), "GraficoScreen");
const TrashScreen = carregar(() => import("@/screens/Trash/TrashScreen"), "TrashScreen");

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
    <Route path="/inicio" element={tela(HomeScreen)} />
    <Route path="/hoje" element={tela(TodayScreen)} />
    {/* Link legado: a administração agora pertence a Configurações. */}
    <Route path="/pastas" element={<Navigate to="/configuracoes/organizacao" replace />} />

    <Route path="/notas" element={tela(NotesRootScreen)} />
    <Route path="/notas/pasta/nova" element={tela(FolderCreateScreen)} />
    <Route path="/notas/pasta/*" element={tela(FolderScreen)} />
    <Route path="/notas/nota/:id" element={tela(NoteDetailScreen)} />

    <Route path="/grafico" element={tela(GraficoScreen)} />

    <Route path="/busca" element={tela(SearchScreen)} />

    <Route path="/agenda" element={tela(AgendaScreen)} />
    <Route path="/eventos" element={tela(EventosScreen)} />
    <Route path="/tarefa/:id" element={tela(TaskDetailScreen)} />

    {/* Folder-browsing mode for Tarefas, reachable from the Drawer
        (section 3.9) — Agenda stays the calendar/time-blocking view; this
        is the by-folder view, same relationship Notas has to its own
        folder screens. */}
    <Route path="/tarefas" element={tela(TaskFoldersRootScreen)} />
    <Route path="/tarefas/pasta/nova" element={tela(TaskFolderCreateScreen)} />
    <Route path="/tarefas/pasta/*" element={tela(TaskFolderScreen)} />
    <Route path="/media" element={tela(MediaScreen)} />
    <Route path="/media/ver" element={tela(FileViewerScreen)} />
    <Route path="/lixeira" element={tela(TrashScreen)} />

    <Route path="/cofre" element={tela(VaultEntry)} />
    <Route path="/cofre/transacao/:id" element={tela(VaultTransacaoEntry)} />
    <Route path="/cofre/*" element={tela(VaultEntry)} />

    <Route path="/equipe/nova" element={tela(TeamCreateJoinScreen)} />
    <Route path="/equipe/escanear" element={tela(EscanearQrScreen)} />
    <Route path="/equipes" element={tela(TeamsScreen)} />
    <Route path="/equipe/:equipeId" element={tela(TeamProfileScreen)} />

    <Route path="/perfil" element={tela(ProfileScreen)} />
    <Route path="/perfil/editar" element={<Navigate to="/perfil" replace />} />
    <Route path="/perfil/rotina" element={tela(RotinaScreen)} />

    <Route path="/notificacoes" element={tela(NotificationsScreen)} />

    <Route path="/configuracoes" element={tela(ConfiguracoesLayout)}>
      <Route index element={tela(SettingsScreen)} />
      <Route path="servidor" element={tela(ServerConfigScreen)} />
      <Route path="sync" element={<Navigate to="/configuracoes/servidor" replace />} />
      <Route path="privacidade" element={tela(PrivacyVaultScreen)} />
      <Route path="cofre" element={<Navigate to="/configuracoes/cofre/seguranca" replace />} />
      {ABAS_COFRE.map(({ id }) => (
        <Route
          key={id}
          path={`cofre/${id}`}
          element={<TelaSobDemanda><CofreConfigScreen aba={id} /></TelaSobDemanda>}
        />
      ))}
      <Route path="conta" element={tela(ContaDadosScreen)} />
      <Route path="aparencia" element={tela(AparenciaScreen)} />
      <Route path="grafico" element={tela(GraficoConfigScreen)} />
      <Route path="calendario" element={tela(CalendarPreferencesScreen)} />
      <Route path="calendario/problemas" element={tela(ProblemasSincronizacaoScreen)} />
      <Route path="uso-diario" element={tela(UsoDiarioScreen)} />
      <Route path="organizacao" element={tela(OrganizationScreen)} />
      <Route path="sobre" element={tela(AboutScreen)} />
      <Route path="sobre/licencas" element={tela(LicensesScreen)} />
      <Route path="perfil" element={tela(ProfileScreen)} />
      <Route path="editar-perfil" element={tela(EditarPerfilScreen)} />
      <Route path="rotina" element={tela(RotinaScreen)} />
      <Route path="equipes" element={tela(TeamsScreen)} />
      <Route path="equipes/nova" element={tela(TeamCreateJoinScreen)} />
      <Route path="equipes/escanear" element={tela(EscanearQrScreen)} />
      <Route path="equipes/:equipeId" element={tela(TeamProfileScreen)} />
      <Route path="notificacoes" element={tela(NotificacoesPreferenciasScreen)} />
      <Route path="administracao" element={tela(AdministracaoScreen)} />
    </Route>

    {/* Destino do QR code de convite de equipe: entra na equipe e abre a página dela. */}
    <Route path="/entrar/:codigo" element={tela(EntrarEquipeScreen)} />

    <Route path="/ajuda" element={tela(HelpScreen)} />

    <Route path="*" element={<Navigate to="/feed" replace />} />
  </>
);
