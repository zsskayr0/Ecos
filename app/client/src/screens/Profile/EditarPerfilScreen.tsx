import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, CheckCircle2, ChevronLeft, Eye, EyeOff } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { ApiError, auth } from "@/lib/api";

const BOTAO = "rounded-lg bg-steel-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-steel-500 disabled:cursor-not-allowed disabled:bg-surface-3 disabled:text-text-muted disabled:hover:bg-surface-3";

/** Editar perfil: nome de usuário (usado no login) e senha. */
export function EditarPerfilScreen() {
  const navigate = useNavigate();
  const { perfil, recarregarPerfil } = useAuth();
  const [nomeUsuario, setNomeUsuario] = useState(perfil?.nome_usuario ?? "");
  const [salvando, setSalvando] = useState(false);
  const [mensagem, setMensagem] = useState<{ tipo: "sucesso" | "erro"; texto: string } | null>(null);
  const [atual, setAtual] = useState("");
  const [nova, setNova] = useState("");
  const [mostrar, setMostrar] = useState(false);
  useEffect(() => { if (perfil) setNomeUsuario(perfil.nome_usuario); }, [perfil]);

  async function salvarNomeUsuario() {
    if (!perfil || salvando || nomeUsuario.trim().length < 3 || nomeUsuario.trim() === perfil.nome_usuario) return;
    setSalvando(true); setMensagem(null);
    try {
      await auth.atualizarPerfil({ nome_usuario: nomeUsuario.trim() });
      await recarregarPerfil();
      setMensagem({ tipo: "sucesso", texto: "Nome de usuário atualizado." });
    } catch (e) {
      setMensagem({ tipo: "erro", texto: e instanceof ApiError ? e.message : "Não foi possível alterar o nome de usuário." });
    } finally { setSalvando(false); }
  }

  if (!perfil) return null;
  const nomeMudou = nomeUsuario.trim() !== perfil.nome_usuario;

  return (
    <div className="px-4 pt-[calc(env(safe-area-inset-top)+12px)] pb-nav-safe">
      <div className="mb-5 flex items-center gap-2">
        <button onClick={() => navigate(-1)} className="text-text-muted"><ChevronLeft size={22} /></button>
        <h1 className="font-display text-xl text-text-primary">Editar perfil</h1>
      </div>

      {mensagem && <div className={`mb-4 flex items-center gap-2 rounded-xl border p-3 text-sm ${mensagem.tipo === "erro" ? "border-error/40 bg-error/10 text-error" : "border-success/40 bg-success/10 text-success"}`}>{mensagem.tipo === "erro" ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}{mensagem.texto}</div>}

      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Nome de usuário</p>
      <form onSubmit={(e) => { e.preventDefault(); void salvarNomeUsuario(); }} className="mb-6 rounded-2xl border border-border bg-surface-1 p-4">
        <label className="block text-sm text-text-secondary">Nome de usuário
          <input value={nomeUsuario} onChange={(e) => setNomeUsuario(e.target.value)} autoComplete="username" className="ecos-input mt-1.5 w-full" />
        </label>
        <p className="mt-2 text-xs text-text-muted">Usado para entrar na sua conta. Mínimo de 3 caracteres.</p>
        <button disabled={salvando || nomeUsuario.trim().length < 3 || !nomeMudou} className={`mt-3 ${BOTAO}`}>{salvando ? "Salvando…" : "Salvar nome de usuário"}</button>
      </form>

      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Alterar senha</p>
      <div className="rounded-2xl border border-border bg-surface-1 p-4">
        <label className="block text-sm text-text-secondary">Senha atual
          <div className="relative">
            <input type={mostrar ? "text" : "password"} value={atual} onChange={(e) => setAtual(e.target.value)} autoComplete="current-password" className="ecos-input mt-1 w-full pr-10" />
            <button type="button" onClick={() => setMostrar(!mostrar)} aria-label={mostrar ? "Ocultar senhas" : "Mostrar senhas"} className="absolute bottom-2 right-2 text-text-muted">{mostrar ? <EyeOff size={17} /> : <Eye size={17} />}</button>
          </div>
        </label>
        <label className="mt-3 block text-sm text-text-secondary">Nova senha
          <input type={mostrar ? "text" : "password"} value={nova} onChange={(e) => setNova(e.target.value)} autoComplete="new-password" placeholder="8 ou mais caracteres" className="ecos-input mt-1 w-full" />
        </label>
        <p className="mt-2 text-xs text-text-muted">A troca efetiva será habilitada quando o endpoint de senha estiver disponível.</p>
        <button type="button" disabled className={`mt-3 ${BOTAO}`}>Alterar senha</button>
      </div>
    </div>
  );
}
