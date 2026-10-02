import { SeletorEcos } from "@/components/common/SeletorEcos";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Copy, KeyRound, Shield, UserPlus, X } from "lucide-react";
import { admin, ApiError, type EquipeAdmin, type UsuarioAdmin } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

const BOTAO = "rounded-lg bg-steel-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-steel-500 disabled:cursor-not-allowed disabled:bg-surface-3 disabled:text-text-muted disabled:hover:bg-surface-3";
const NOME_USUARIO = /[^A-Za-z0-9._-]/g;

function nomeDe(u: { nome: string | null; nome_usuario: string }) { return u.nome?.trim() || u.nome_usuario; }

/**
 * Administração da instância (estilo Jellyfin): quem administra cria as contas das outras pessoas — cada uma nasce com uma
 * senha temporária, mostrada uma única vez aqui, e é obrigada a trocá-la no primeiro acesso — e coloca contas em equipes
 * (a outra forma de entrar numa equipe é o QR code de convite, na página da própria equipe).
 */
export function AdministracaoScreen() {
  const { perfil } = useAuth();
  const [usuarios, setUsuarios] = useState<UsuarioAdmin[] | null>(null);
  const [equipes, setEquipes] = useState<EquipeAdmin[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [temporaria, setTemporaria] = useState<{ nome: string; senha: string; nova: boolean } | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [novoUsuario, setNovoUsuario] = useState("");
  const [novoNome, setNovoNome] = useState("");
  const [novoAdmin, setNovoAdmin] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [confirmarReset, setConfirmarReset] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      const [u, e] = await Promise.all([admin.listarUsuarios(), admin.listarEquipes()]);
      setUsuarios(u); setEquipes(e);
    } catch (e) { setErro(e instanceof ApiError ? e.message : "Não foi possível carregar a administração."); }
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);

  async function executar(acao: () => Promise<void>) {
    setOcupado(true); setErro(null);
    try { await acao(); await carregar(); }
    catch (e) { setErro(e instanceof ApiError ? e.message : "Não foi possível concluir."); }
    finally { setOcupado(false); }
  }

  async function criar(e: React.FormEvent) {
    e.preventDefault();
    if (ocupado || novoUsuario.length < 3) return;
    await executar(async () => {
      const r = await admin.criarUsuario(novoUsuario, novoNome.trim() || undefined, novoAdmin ? "admin" : "usuario");
      setTemporaria({ nome: r.nome_usuario, senha: r.senha_temporaria, nova: true });
      setCopiado(false); setNovoUsuario(""); setNovoNome(""); setNovoAdmin(false);
    });
  }

  async function copiar(texto: string) {
    try { await navigator.clipboard.writeText(texto); setCopiado(true); } catch { /* o texto está na tela para copiar à mão */ }
  }

  if (erro && !usuarios) return <div className="p-4 text-sm text-error">{erro}</div>;

  return (
    <div className="px-4 pt-[calc(env(safe-area-inset-top)+12px)] pb-nav-safe">
      <h1 className="mb-1 font-display text-xl text-text-primary">Usuários e equipes</h1>
      <p className="mb-5 text-sm text-text-secondary">Crie as contas de quem vai usar o Ecos neste servidor. Cada pessoa tem os próprios dados; só o que está numa equipe é compartilhado.</p>

      {erro && <div className="mb-4 flex items-start gap-2 rounded-xl border border-error/40 bg-error/10 p-3 text-sm text-error"><AlertTriangle size={16} className="mt-0.5 shrink-0" />{erro}</div>}

      {temporaria && (
        <div className="mb-5 rounded-2xl border border-warning/40 bg-surface-1 p-4" role="status">
          <div className="mb-2 flex items-start justify-between gap-2">
            <p className="text-sm font-semibold text-text-primary">{temporaria.nova ? "Conta criada" : "Senha redefinida"}: {temporaria.nome}</p>
            <button onClick={() => setTemporaria(null)} aria-label="Fechar aviso" className="text-text-muted"><X size={16} /></button>
          </div>
          <p className="mb-2 text-xs text-text-secondary">Passe esta senha temporária para a pessoa. Ela só aparece agora e precisa ser trocada no primeiro acesso.</p>
          <div className="flex items-center justify-between gap-3 rounded-xl bg-surface-2 px-3 py-2.5">
            <span className="select-all font-mono-value text-base tracking-wide text-text-primary">{temporaria.senha}</span>
            <button onClick={() => void copiar(temporaria.senha)} className="flex items-center gap-1.5 text-xs font-medium text-steel-300"><Copy size={13} />{copiado ? "Copiada" : "Copiar"}</button>
          </div>
        </div>
      )}

      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Nova conta</p>
      <form onSubmit={criar} className="mb-6 rounded-2xl border border-border bg-surface-1 p-4">
        <label className="block text-sm text-text-secondary">Nome de usuário
          <input value={novoUsuario} onChange={(e) => setNovoUsuario(e.target.value.replace(NOME_USUARIO, ""))} maxLength={32} autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="ex.: thaty" className="ecos-input mt-1.5 w-full" />
        </label>
        <p className="mt-1 text-xs text-text-muted">3 a 32 caracteres: letras, números, ponto, hífen e sublinhado. Vira o login e o nome da pasta da pessoa, e não muda depois.</p>
        <label className="mt-3 block text-sm text-text-secondary">Nome (opcional)
          <input value={novoNome} onChange={(e) => setNovoNome(e.target.value)} maxLength={80} placeholder="como ela aparece para as outras pessoas" className="ecos-input mt-1.5 w-full" />
        </label>
        <label className="mt-3 flex items-center gap-2.5 text-sm text-text-secondary">
          <input type="checkbox" checked={novoAdmin} onChange={(e) => setNovoAdmin(e.target.checked)} className="accent-steel-400" />
          Também administra o Ecos
        </label>
        <button disabled={ocupado || novoUsuario.length < 3} className={`mt-4 flex items-center gap-2 ${BOTAO}`}><UserPlus size={15} />Criar conta</button>
      </form>

      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Contas</p>
      <div className="mb-6 overflow-hidden rounded-2xl bg-surface-1">
        {(usuarios ?? []).map((u) => (
          <div key={u.id} className="flex items-center gap-3 border-b border-border/60 px-4 py-3 last:border-0">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] text-text-primary">{nomeDe(u)}{u.id === perfil?.id && <span className="ml-2 text-xs text-text-muted">você</span>}</p>
              <p className="truncate text-xs text-text-muted">@{u.nome_usuario}{u.deve_trocar_senha && " · aguardando a troca da senha temporária"}</p>
            </div>
            {u.papel === "admin" && <span className="flex items-center gap-1 rounded-full bg-steel-500/15 px-2 py-0.5 text-xs text-steel-300"><Shield size={12} />Admin</span>}
            {u.id !== perfil?.id && (confirmarReset === u.id ? (
              <span className="flex items-center gap-2 text-xs">
                <button disabled={ocupado} onClick={() => void executar(async () => { const r = await admin.redefinirSenha(u.id); setTemporaria({ nome: u.nome_usuario, senha: r.senha_temporaria, nova: false }); setCopiado(false); setConfirmarReset(null); })} className="font-medium text-error">Confirmar</button>
                <button onClick={() => setConfirmarReset(null)} className="text-text-muted">Cancelar</button>
              </span>
            ) : (
              <button onClick={() => setConfirmarReset(u.id)} className="flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary" title="Gera uma nova senha temporária e encerra as sessões da pessoa"><KeyRound size={13} />Redefinir senha</button>
            ))}
          </div>
        ))}
      </div>

      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Equipes</p>
      <p className="mb-3 text-xs text-text-muted">Você também pode convidar por QR code, na página de cada equipe.</p>
      {equipes.length === 0 && <p className="mb-6 text-sm text-text-muted">Ainda não há equipes.</p>}
      {equipes.map((eq) => {
        const disponiveis = (usuarios ?? []).filter((u) => !eq.membros.some((m) => m.usuario_id === u.id));
        return (
          <div key={eq.id} className="mb-4 overflow-hidden rounded-2xl bg-surface-1">
            <p className="border-b border-border/60 px-4 py-3 text-[15px] font-medium text-text-primary">{eq.nome}</p>
            {eq.membros.map((m) => (
              <div key={m.usuario_id} className="flex items-center gap-3 border-b border-border/60 px-4 py-2.5 last:border-0">
                <span className="min-w-0 flex-1 truncate text-sm text-text-primary">{nomeDe(m)} <span className="text-xs text-text-muted">@{m.nome_usuario}</span></span>
                <span className="text-xs text-text-muted">{m.cargo}</span>
                <button disabled={ocupado} onClick={() => void executar(async () => { await admin.removerMembro(eq.id, m.usuario_id); })} aria-label={`Remover ${nomeDe(m)} de ${eq.nome}`} className="text-text-muted hover:text-error"><X size={15} /></button>
              </div>
            ))}
            {disponiveis.length > 0 && (
              <div className="flex items-center gap-2 border-t border-border/60 px-4 py-2.5 text-sm text-text-secondary">
                <UserPlus size={15} />
                <div className="min-w-0 flex-1">
                  <SeletorEcos valor="" disabled={ocupado} onChange={(id) => { if (id) void executar(async () => { await admin.adicionarMembro(eq.id, id); }); }} classe="ecos-input w-full" ariaLabel={`Adicionar pessoa a ${eq.nome}`}
                    opcoes={[{ valor: "", rotulo: "Adicionar pessoa…" }, ...disponiveis.map((u) => ({ valor: u.id, rotulo: `${nomeDe(u)} (@${u.nome_usuario})` }))]} />
                </div>
              </div>
            )}
          </div>
        );
      })}
      {!erro && usuarios && <p className="mt-4 flex items-center gap-1.5 text-xs text-text-muted"><CheckCircle2 size={13} />{usuarios.length} {usuarios.length === 1 ? "conta" : "contas"} neste servidor.</p>}
    </div>
  );
}
