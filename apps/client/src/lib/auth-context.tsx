import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { ApiError, auth } from "./api";

export interface Perfil {
  id: string;
  nome_usuario: string;
  cofre_ativado: boolean;
  equipes: { id: string; nome: string; cargo: string }[];
}

type Status = "carregando" | "autenticado" | "deslogado";

interface AuthState {
  status: Status;
  perfil: Perfil | null;
  erro: string | null;
  login: (usuario: string, senha: string) => Promise<void>;
  registrar: (nomeUsuario: string, senha: string) => Promise<{ recovery_key: string }>;
  logout: () => Promise<void>;
  /** Chama de novo `/me` — usado depois de editar perfil, entrar em Equipe etc. */
  recarregarPerfil: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

/**
 * Sessão real contra `ecos-app` (cookie HttpOnly, seção 5.1) — sem refresh
 * automático no backend hoje (`apps/server/src/middleware/auth_guard.rs`
 * só valida o access token de 15min, sem rota de renovação); ao expirar,
 * qualquer chamada 401 aqui derruba pra tela de login de novo.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("carregando");
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const recarregarPerfil = useCallback(async () => {
    try {
      const p = await auth.perfil();
      setPerfil(p);
      setStatus("autenticado");
    } catch {
      setPerfil(null);
      setStatus("deslogado");
    }
  }, []);

  useEffect(() => {
    recarregarPerfil();
  }, [recarregarPerfil]);

  const login = useCallback(async (usuario: string, senha: string) => {
    setErro(null);
    try {
      await auth.login(usuario, senha);
      await recarregarPerfil();
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível entrar.");
      throw e;
    }
  }, [recarregarPerfil]);

  const registrar = useCallback(async (nomeUsuario: string, senha: string) => {
    setErro(null);
    try {
      const resposta = await auth.registrar(nomeUsuario, senha);
      // registrar() não abre sessão sozinho (seção 11.1) — login explícito na
      // sequência (isso já grava o cookie no browser). De propósito, NÃO
      // chama `recarregarPerfil()` aqui: o status global só vira
      // "autenticado" quando a tela de recovery key for confirmada (ver
      // AuthScreen) — a recovery key só aparece uma vez, não pode sumir
      // porque o app trocou de tela sozinho no meio do caminho.
      await auth.login(nomeUsuario, senha);
      return { recovery_key: resposta.recovery_key };
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível criar a conta.");
      throw e;
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await auth.logout();
    } finally {
      setPerfil(null);
      setStatus("deslogado");
    }
  }, []);

  return (
    <AuthContext.Provider value={{ status, perfil, erro, login, registrar, logout, recarregarPerfil }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth precisa estar dentro de <AuthProvider>");
  return ctx;
}
