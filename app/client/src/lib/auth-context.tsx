import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { ApiError, auth, definirUsuarioDoCofre, prepararConteudoOffline } from "./api";
import { esquecerSenhasDaConta } from "./cofre-lembrado";
import { contarRascunhosLocais, expirarRascunhosAntigos, limparConteudoLocal } from "./dados-locais";
import { limparDadosOffline, listarMutacoesPendentes } from "./offline-store";
import { Dialog } from "@/components/common/Dialog";
import { registrarCoresDasEquipes } from "./team-color";
import { definirUsuarioDasFotos } from "./profile-avatar";
import { sincronizarPreferenciasCalendario } from "./preferencias-calendario";

import { mensagemDeErro } from "@/lib/erros";
export interface Perfil {
  id: string;
  nome_usuario: string;
  nome: string | null;
  cofre_ativado: boolean;
  avatar_atualizado_em: number | null;
  equipes: { id: string; nome: string; cargo: string; cor?: string; avatar_atualizado_em?: number | null }[];
  /** Quem administra a instância cria as contas das demais pessoas (aba Administração). */
  papel: "admin" | "usuario";
  /** Senha temporária: o app só deixa trocar a senha até que isso seja feito. */
  deve_trocar_senha: boolean;
  /** Vigente diferente da aceita: o app mostra a tela de novo aceite (ver ReaceiteTermos). */
  termos_pendente?: boolean;
  termos_versao?: string;
}

type Status = "carregando" | "autenticado" | "deslogado" | "indisponivel";

/** Lembra que esta pessoa já teve sessão neste aparelho: se o servidor estiver fora do ar ao abrir (reinício, deploy),
 * o app espera por ele em vez de mostrar o login como se a sessão tivesse caído. */
const CHAVE_SESSAO_ATIVA = "ecos.sessao.ativa";
const lerSessaoAtiva = () => { try { return localStorage.getItem(CHAVE_SESSAO_ATIVA) === "1"; } catch { return false; } };
const gravarSessaoAtiva = (ativa: boolean) => { try { ativa ? localStorage.setItem(CHAVE_SESSAO_ATIVA, "1") : localStorage.removeItem(CHAVE_SESSAO_ATIVA); } catch { /* cache indisponível */ } };

interface AuthState {
  status: Status;
  perfil: Perfil | null;
  erro: string | null;
  login: (usuario: string, senha: string) => Promise<void>;
  registrar: (nomeUsuario: string, senha: string, nome: string, declaraIdadeMinima: boolean, aceitaTermos: boolean) => Promise<{ recovery_key: string }>;
  /** Com rascunhos não salvos neste aparelho, pergunta antes de sair; `semAviso` pula a pergunta (conta já apagada). */
  logout: (opcoes?: { semAviso?: boolean }) => Promise<void>;
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
  const [pedidoSaida, setPedidoSaida] = useState<PedidoSaida | null>(null);

  const recarregarPerfil = useCallback(async () => {
    try {
      const p = await auth.perfil();
      registrarCoresDasEquipes(p.equipes);
      setPerfil(p);
      setStatus("autenticado");
      gravarSessaoAtiva(true);
      void prepararConteudoOffline(["pessoal", ...p.equipes.map((equipe) => `equipe:${equipe.id}`)]);
    } catch (e) {
      // Uma perda temporária de rede não deve apagar uma sessão válida nem
      // mandar a pessoa de volta ao login. Apenas 401 significa credencial
      // inválida depois da tentativa de renovação feita pelo cliente HTTP.
      if (e instanceof ApiError && e.status === 401) {
        setPerfil(null);
        setStatus("deslogado");
        gravarSessaoAtiva(false);
      } else if (lerSessaoAtiva()) {
        // Servidor fora do ar (conexão recusada, 502/503/504) para quem já estava logado: a sessão pode estar ótima.
        setErro(mensagemDeErro(e, "Não foi possível falar com o servidor."));
        setStatus((previous) => previous === "carregando" ? "indisponivel" : previous);
      } else {
        setErro(mensagemDeErro(e, "Não foi possível falar com o servidor."));
        // No authenticated session exists during first load. A connection
        // failure must not leave startup stuck forever in "carregando".
        setStatus((previous) => previous === "carregando" ? "deslogado" : previous);
      }
    }
  }, []);

  useEffect(() => {
    recarregarPerfil();
  }, [recarregarPerfil]);

  // Cadastros em cache (formas de pagamento…) pertencem a quem está autenticado.
  useEffect(() => { definirUsuarioDoCofre(perfil?.id ?? null); definirUsuarioDasFotos(perfil?.id ?? null); }, [perfil?.id]);
  // Rascunhos de nota/tarefa esquecidos há semanas não ficam no aparelho para sempre.
  useEffect(() => { expirarRascunhosAntigos(); }, []);

  // Preferências de calendário e localização acompanham a conta: cópia local espelha o servidor ao entrar.
  useEffect(() => { if (perfil?.id) void sincronizarPreferenciasCalendario(perfil.id); }, [perfil?.id]);

  const login = useCallback(async (usuario: string, senha: string) => {
    setErro(null);
    try {
      await auth.login(usuario, senha);
      const p = await auth.perfil();
      registrarCoresDasEquipes(p.equipes);
      setPerfil(p);
      setStatus("autenticado");
      gravarSessaoAtiva(true);
      void prepararConteudoOffline(["pessoal", ...p.equipes.map((equipe) => `equipe:${equipe.id}`)]);
    } catch (e) {
      setErro(mensagemDeErro(e, "Não foi possível entrar."));
      throw e;
    }
  }, []);

  const registrar = useCallback(async (nomeUsuario: string, senha: string, nome: string, declaraIdadeMinima: boolean, aceitaTermos: boolean) => {
    setErro(null);
    try {
      const resposta = await auth.registrar(nomeUsuario, senha, nome, declaraIdadeMinima, aceitaTermos);
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
      setErro(mensagemDeErro(e, "Não foi possível criar a conta."));
      throw e;
    }
  }, []);

  const logout = useCallback(async (opcoes?: { semAviso?: boolean }) => {
    if (!opcoes?.semAviso) {
      const rascunhos = contarRascunhosLocais();
      let pendentes = 0;
      try { pendentes = (await listarMutacoesPendentes()).length; } catch { /* sem fila legível: só os rascunhos contam */ }
      if (rascunhos + pendentes > 0 && !(await new Promise<boolean>((resolver) => setPedidoSaida({ rascunhos, pendentes, resolver })))) return;
    }
    try {
      // Quem sai da conta não deixa senha de Cofre guardada neste computador.
      if (perfil) await esquecerSenhasDaConta(perfil.id, ["pessoal", ...perfil.equipes.map((e) => `equipe:${e.id}`)]);
      await auth.logout();
    } finally {
      setPerfil(null);
      setStatus("deslogado");
      gravarSessaoAtiva(false);
      limparConteudoLocal(); // rascunhos, buscas e abas abertas não ficam no aparelho
      void limparDadosOffline(); // cache e alterações pendentes pertencem à conta que saiu
    }
  }, [perfil]);

  // Enquanto o servidor não volta, tenta de novo sozinho.
  useEffect(() => {
    if (status !== "indisponivel") return;
    const timer = window.setInterval(() => { void recarregarPerfil(); }, 3000);
    return () => window.clearInterval(timer);
  }, [status, recarregarPerfil]);

  return (
    <AuthContext.Provider value={{ status, perfil, erro, login, registrar, logout, recarregarPerfil }}>
      {children}
      {pedidoSaida && <ConfirmarSaida pedido={pedidoSaida} aoResponder={(ok) => { pedidoSaida.resolver(ok); setPedidoSaida(null); }} />}
    </AuthContext.Provider>
  );
}

interface PedidoSaida { rascunhos: number; pendentes: number; resolver: (ok: boolean) => void }

/** Aviso antes de Sair quando há algo que só existe neste aparelho (rascunhos e alterações ainda não enviadas). */
function ConfirmarSaida({ pedido, aoResponder }: { pedido: PedidoSaida; aoResponder: (ok: boolean) => void }) {
  const { rascunhos, pendentes } = pedido;
  const partes = [
    rascunhos > 0 ? `${rascunhos} rascunho${rascunhos > 1 ? "s" : ""} de nota ou tarefa não salvo${rascunhos > 1 ? "s" : ""}` : "",
    pendentes > 0 ? `${pendentes} alteraç${pendentes > 1 ? "ões" : "ão"} ainda não enviada${pendentes > 1 ? "s" : ""} ao servidor` : "",
  ].filter(Boolean);
  return (
    <Dialog rotuloId="sair-titulo" descricaoId="sair-descricao" onFechar={() => aoResponder(false)}>
      <div className="w-full max-w-sm rounded-2xl border border-border bg-surface-1 p-5 text-text-primary">
        <h2 id="sair-titulo" className="mb-2 text-lg font-semibold">Você tem alterações não enviadas</h2>
        <p id="sair-descricao" className="mb-5 text-sm text-text-secondary">
          Há {partes.join(" e ")} neste aparelho. Sair da conta descarta {partes.length > 1 || rascunhos > 1 || pendentes > 1 ? "tudo isso" : "isso"}. Sair mesmo assim?
        </p>
        <div className="flex gap-3">
          <button type="button" autoFocus onClick={() => aoResponder(false)} className="min-h-12 flex-1 rounded-xl bg-surface-2 px-4 text-sm font-medium">Continuar na conta</button>
          <button type="button" onClick={() => aoResponder(true)} className="min-h-12 flex-1 rounded-xl bg-error px-4 text-sm font-semibold text-on-accent">Sair mesmo assim</button>
        </div>
      </div>
    </Dialog>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth precisa estar dentro de <AuthProvider>");
  return ctx;
}
