import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { ApiError, auth } from "./api";

export interface Perfil {
  id: string;
  nome_usuario: string;
  nome: string | null;
  cofre_ativado: boolean;
  equipes: { id: string; nome: string; cargo: string }[];
}

type Status = "carregando" | "autenticado" | "deslogado";

interface AuthState {
  status: Status;
  perfil: Perfil | null;
  erro: string | null;
  login: (usuario: string, senha: string) => Promise<void>;
  registrar: (nomeUsuario: string, senha: string, nome: string) => Promise<{ recovery_key: string }>;
  logout: () => Promise<void>;
  /** Calls `/me` again — used after editing the profile, joining a Team, etc. */
  recarregarPerfil: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

/** Usuários registrados antes da migração 0004 ficam com `nome: null` — cai pro `nome_usuario` (login) nesse caso. */
export function nomeExibicao(perfil: Pick<Perfil, "nome" | "nome_usuario">): string {
  return perfil.nome?.trim() || perfil.nome_usuario;
}

/**
 * Real session against `ecos-app` (HttpOnly cookie, section 5.1) — no
 * automatic refresh on the backend today (`app/server/src/middleware/auth_guard.rs`
 * only validates the 15min access token, no renewal route); once it
 * expires, any 401 here drops back to the login screen.
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

  const registrar = useCallback(async (nomeUsuario: string, senha: string, nome: string) => {
    setErro(null);
    try {
      const resposta = await auth.registrar(nomeUsuario, senha, nome);
      // registrar() doesn't open a session on its own (section 11.1) —
      // explicit login right after (that already writes the browser
      // cookie). Deliberately NOT calling `recarregarPerfil()` here: the
      // global status only flips to "autenticado" once the recovery key
      // screen is confirmed (see AuthScreen) — the recovery key only
      // shows once, it can't disappear because the app switched screens
      // on its own midway through.
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
