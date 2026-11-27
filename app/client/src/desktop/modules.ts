import {
  Bell,
  GitCommitVertical,
  CalendarClock,
  CalendarDays,
  FolderTree,
  HelpCircle,
  Home,
  Library,
  Network,
  ListChecks,
  Newspaper,
  Search,
  Settings,
  StickyNote,
  Trash2,
  User,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { nomeDoArquivo } from "@/lib/format";
import { ABAS_COFRE } from "@/screens/Settings/abas-cofre";

export type ModuloId =
  | "inicio"
  | "feed"
  | "hoje"
  | "agenda"
  | "eventos"
  | "tarefas"
  | "notas"
  | "arquivos"
  | "grafico"
  | "cofre"
  | "media"
  | "busca"
  | "lixeira"
  | "equipe"
  | "perfil"
  | "notificacoes"
  | "configuracoes"
  | "ajuda";

interface Modulo {
  id: ModuloId;
  titulo: string;
  icone: LucideIcon;
  raiz: string;
}

const MODULOS: Record<ModuloId, Modulo> = {
  inicio: { id: "inicio", titulo: "Início", icone: Home, raiz: "/inicio" },
  feed: { id: "feed", titulo: "Feed", icone: Newspaper, raiz: "/feed" },
  // Id "hoje" mantido: preferências salvas do trilho referenciam o módulo por ele.
  hoje: { id: "hoje", titulo: "Timeline", icone: GitCommitVertical, raiz: "/timeline" },
  agenda: { id: "agenda", titulo: "Agenda", icone: CalendarDays, raiz: "/agenda" },
  eventos: { id: "eventos", titulo: "Eventos", icone: CalendarClock, raiz: "/eventos" },
  tarefas: { id: "tarefas", titulo: "Tarefas", icone: ListChecks, raiz: "/tarefas" },
  notas: { id: "notas", titulo: "Notas", icone: StickyNote, raiz: "/notas" },
  arquivos: { id: "arquivos", titulo: "Arquivos", icone: FolderTree, raiz: "/arquivos" },
  grafico: { id: "grafico", titulo: "Gráfico", icone: Network, raiz: "/grafico" },
  cofre: { id: "cofre", titulo: "Cofre", icone: Wallet, raiz: "/cofre" },
  media: { id: "media", titulo: "Media", icone: Library, raiz: "/media" },
  busca: { id: "busca", titulo: "Busca", icone: Search, raiz: "/busca" },
  lixeira: { id: "lixeira", titulo: "Lixeira", icone: Trash2, raiz: "/lixeira" },
  equipe: { id: "equipe", titulo: "Equipe", icone: Users, raiz: "/equipe" },
  perfil: { id: "perfil", titulo: "Perfil", icone: User, raiz: "/perfil" },
  notificacoes: { id: "notificacoes", titulo: "Notificações", icone: Bell, raiz: "/notificacoes" },
  configuracoes: { id: "configuracoes", titulo: "Configurações", icone: Settings, raiz: "/configuracoes" },
  ajuda: { id: "ajuda", titulo: "Ajuda", icone: HelpCircle, raiz: "/ajuda" },
};

/** Ordem do rail: navegação principal em cima, utilitários embaixo. */
export const RAIL_PRINCIPAL: ModuloId[] = ["inicio", "hoje", "agenda", "eventos", "tarefas", "notas", "arquivos", "grafico", "feed", "cofre", "media"];
/** Modo explorador: só os módulos que não são arquivos; notas e o resto ficam na árvore embaixo. */
export const RAIL_EXPLORADOR: ModuloId[] = ["inicio", "hoje", "tarefas", "notas", "cofre"];
export const RAIL_UTILITARIOS: ModuloId[] = ["lixeira"];

export function moduloDaRota(path: string): Modulo {
  const [primeiro] = path.split(/[?#]/)[0].split("/").filter(Boolean);
  switch (primeiro) {
    case "tarefa":
      return MODULOS.agenda;
    case "conexoes":
      return MODULOS.grafico;
    default:
      return MODULOS[primeiro as ModuloId] ?? MODULOS.feed;
  }
}

export function moduloPorId(id: ModuloId): Modulo {
  return MODULOS[id];
}

/** Rota "pai" usada como histórico anterior de uma aba aberta direto num detalhe (o `navigate(-1)` das telas). */
export function rotaPai(path: string): string | null {
  const partes = path.split("/").filter(Boolean);
  const [primeiro, segundo] = partes;
  if (partes.length <= 1) return null;
  if (primeiro === "notas" && (segundo === "nota" || segundo === "pasta")) return "/notas";
  if (primeiro === "tarefas" && segundo === "pasta") return "/tarefas";
  if (primeiro === "cofre" && segundo === "transacao") return "/cofre";
  if (primeiro === "media" && segundo === "ver") return "/media";
  if (primeiro === "configuracoes") return "/configuracoes";
  if (primeiro === "perfil") return "/perfil";
  if (primeiro === "tarefa") return "/agenda";
  return null;
}

export function tituloDaRota(path: string): string {
  const [caminhoUrl, query = ""] = path.split("?");
  const partes = caminhoUrl.split("/").filter(Boolean);
  const [primeiro, segundo, terceiro] = partes;
  if (primeiro === "media" && segundo === "ver") {
    const busca = new URLSearchParams(query);
    const arquivo = nomeDoArquivo(busca.get("c") ?? busca.get("a") ?? "");
    return arquivo || "Arquivo";
  }
  if (primeiro === "notas" && segundo === "nota") return "Nota";
  if (primeiro === "notas" && segundo === "pasta") return terceiro === "nova" ? "Nova pasta" : "Pasta de notas";
  if (primeiro === "tarefas" && segundo === "pasta") return terceiro === "nova" ? "Nova pasta" : "Pasta de tarefas";
  if (primeiro === "arquivos") {
    const pasta = new URLSearchParams(query).get("pasta");
    if (pasta) return pasta.split("/").filter(Boolean).pop() ?? "Arquivos";
  }
  if (primeiro === "tarefa") return "Tarefa";
  if (primeiro === "conexoes") return "Conexões";
  if (primeiro === "cofre" && segundo === "transacao") return "Transação";
  if (primeiro === "equipe") return segundo === "nova" ? "Nova equipe" : "Equipe";
  if (primeiro === "perfil" && segundo === "editar") return "Editar perfil";
  if (primeiro === "perfil" && segundo === "rotina") return "Ajustar rotina";
  if (primeiro === "configuracoes" && segundo) {
    // Mesmos rótulos das abas em ConfiguracoesLayout.
    if (segundo === "cofre" && terceiro) { const aba = ABAS_COFRE.find((a) => a.id === terceiro); return aba ? `Cofre · ${aba.rotulo}` : "Cofre"; }
    if (segundo === "equipes" && terceiro) return terceiro === "nova" ? "Nova equipe" : terceiro === "escanear" ? "Entrar com QR" : "Equipe";
    const sub: Record<string, string> = {
      "calendario/problemas": "Problemas de sincronização",
      "arquivos/problemas": "Problemas de arquivos",
      "sobre/licencas": "Licenças",
    };
    if (terceiro && sub[`${segundo}/${terceiro}`]) return sub[`${segundo}/${terceiro}`];
    const nomes: Record<string, string> = {
      perfil: "Perfil",
      "editar-perfil": "Editar perfil",
      rotina: "Rotina",
      equipes: "Equipes",
      conta: "Conta e dados",
      aparencia: "Aparência",
      "idioma-regiao": "Idioma e região",
      notificacoes: "Notificações",
      atalhos: "Atalhos de teclado",
      tarefas: "Tarefas",
      notas: "Notas",
      feed: "Feed",
      editor: "Editor e escrita",
      calendario: "Calendário e agenda",
      grafico: "Gráfico",
      "pastas-arquivos": "Exibição e lixeira",
      organizacao: "Gerenciar pastas e tags",
      "pastas-trancadas": "Pastas trancadas",
      icones: "Ícones personalizados",
      privacidade: "Privacidade e redefinição",
      cofre: "Cofre",
      servidor: "Servidor e backup",
      pendencias: "Pendências",
      sync: "Sincronização",
      administracao: "Usuários e equipes",
      sobre: "Sobre",
    };
    return nomes[segundo] ?? "Configurações";
  }
  return moduloDaRota(path).titulo;
}
