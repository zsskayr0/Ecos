import {
  Bell,
  CalendarCheck2,
  CalendarClock,
  CalendarDays,
  HelpCircle,
  Library,
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

export type ModuloId =
  | "feed"
  | "hoje"
  | "agenda"
  | "eventos"
  | "tarefas"
  | "notas"
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
  feed: { id: "feed", titulo: "Feed", icone: Newspaper, raiz: "/feed" },
  hoje: { id: "hoje", titulo: "Hoje", icone: CalendarCheck2, raiz: "/hoje" },
  agenda: { id: "agenda", titulo: "Agenda", icone: CalendarDays, raiz: "/agenda" },
  eventos: { id: "eventos", titulo: "Eventos", icone: CalendarClock, raiz: "/eventos" },
  tarefas: { id: "tarefas", titulo: "Tarefas", icone: ListChecks, raiz: "/tarefas" },
  notas: { id: "notas", titulo: "Notas", icone: StickyNote, raiz: "/notas" },
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
export const RAIL_PRINCIPAL: ModuloId[] = ["hoje", "agenda", "eventos", "tarefas", "notas", "feed", "cofre", "media"];
export const RAIL_UTILITARIOS: ModuloId[] = ["lixeira"];

export function moduloDaRota(path: string): Modulo {
  const [primeiro] = path.split("/").filter(Boolean);
  switch (primeiro) {
    case "tarefa":
      return MODULOS.agenda;
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
    const arquivo = nomeDoArquivo(new URLSearchParams(query).get("c") ?? "");
    return arquivo || "Arquivo";
  }
  if (primeiro === "notas" && segundo === "nota") return "Nota";
  if (primeiro === "notas" && segundo === "pasta") return terceiro === "nova" ? "Nova pasta" : "Pasta de notas";
  if (primeiro === "tarefas" && segundo === "pasta") return terceiro === "nova" ? "Nova pasta" : "Pasta de tarefas";
  if (primeiro === "tarefa") return "Tarefa";
  if (primeiro === "cofre" && segundo === "transacao") return "Transação";
  if (primeiro === "equipe") return segundo === "nova" ? "Nova equipe" : "Equipe";
  if (primeiro === "perfil" && segundo === "editar") return "Editar perfil";
  if (primeiro === "perfil" && segundo === "rotina") return "Ajustar rotina";
  if (primeiro === "configuracoes" && segundo) {
    const nomes: Record<string, string> = {
      servidor: "Servidor",
      sync: "Sincronização",
      privacidade: "Privacidade",
      cofre: "Configurações do Cofre",
      conta: "Conta e dados",
      aparencia: "Aparência",
      organizacao: "Organização",
      sobre: "Sobre",
    };
    return nomes[segundo] ?? "Configurações";
  }
  return moduloDaRota(path).titulo;
}
