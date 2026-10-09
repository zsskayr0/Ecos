import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, CheckCircle2, ChevronLeft, Eye, EyeOff } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { ApiError, auth } from "@/lib/api";
import { EstadoCarregando } from "@/components/common/EstadoCarregando";
import { avisar } from "@/lib/toast";

const BOTAO = "rounded-lg bg-steel-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-steel-500 disabled:cursor-not-allowed disabled:bg-surface-3 disabled:text-text-muted disabled:hover:bg-surface-3";

/** Editar perfil: o nome de usuário (login e pasta em disco) é fixo; aqui ele só aparece, e a senha é trocada. */
export function EditarPerfilScreen() {
  const navigate = useNavigate();
  const { perfil, status } = useAuth();
  const [mensagem, setMensagem] = useState<{ tipo: "sucesso" | "erro"; texto: string } | null>(null);
  const [trocando, setTrocando] = useState(false);
  const [atual, setAtual] = useState("");
  const [nova, setNova] = useState("");
  const [mostrar, setMostrar] = useState(false);

  async function trocarSenha() {
    if (trocando || !atual || nova.length < 12) return;
    setTrocando(true); setMensagem(null);
    try {
      await auth.trocarSenha(atual, nova);
      setAtual(""); setNova("");
      setMensagem({ tipo: "sucesso", texto: "Senha alterada." });
      avisar("Senha alterada.", "sucesso");
    } catch (e) {
      setMensagem({ tipo: "erro", texto: e instanceof ApiError ? e.message : "Não foi possível alterar a senha." });
    } finally { setTrocando(false); }
  }

  if (!perfil) return status === "carregando" ? <EstadoCarregando texto="Carregando perfil…" /> : null;

  return (
    <div className="px-4 pt-[calc(env(safe-area-inset-top)+12px)] pb-nav-safe">
      <div className="mb-5 flex items-center gap-2">
        <button onClick={() => navigate(-1)} className="text-text-muted"><ChevronLeft size={22} /></button>
        <h1 className="font-display text-xl text-text-primary">Editar perfil</h1>
      </div>

      {mensagem && <div className={`mb-4 flex items-center gap-2 rounded-xl border p-3 text-sm ${mensagem.tipo === "erro" ? "border-error/40 bg-error/10 text-error" : "border-success/40 bg-success/10 text-success"}`}>{mensagem.tipo === "erro" ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}{mensagem.texto}</div>}

      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Nome de usuário</p>
      <div className="mb-6 rounded-2xl border border-border bg-surface-1 p-4">
        <label className="block text-sm text-text-secondary">Nome de usuário
          <input value={perfil.nome_usuario} readOnly autoComplete="username" className="ecos-input mt-1.5 w-full opacity-70" />
        </label>
        <p className="mt-2 text-xs text-text-muted">Usado para entrar na sua conta e para nomear a sua pasta de arquivos. Não pode ser alterado. Para mudar como você aparece para as outras pessoas, edite o seu nome no perfil.</p>
      </div>

      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Alterar senha</p>
      <div className="rounded-2xl border border-border bg-surface-1 p-4">
        <label className="block text-sm text-text-secondary">Senha atual
          <div className="relative">
            <input type={mostrar ? "text" : "password"} value={atual} onChange={(e) => setAtual(e.target.value.replace(/\s/g, ""))} autoComplete="current-password" className="ecos-input mt-1 w-full pr-10" />
            <button type="button" onClick={() => setMostrar(!mostrar)} aria-label={mostrar ? "Ocultar senhas" : "Mostrar senhas"} className="absolute bottom-2 right-2 text-text-muted">{mostrar ? <EyeOff size={17} /> : <Eye size={17} />}</button>
          </div>
        </label>
        <label className="mt-3 block text-sm text-text-secondary">Nova senha
          <input type={mostrar ? "text" : "password"} value={nova} onChange={(e) => setNova(e.target.value.replace(/\s/g, ""))} autoComplete="new-password" placeholder="12 ou mais caracteres, sem espaços" className="ecos-input mt-1 w-full" />
        </label>
        <p className="mt-2 text-xs text-text-muted">Mínimo de 12 caracteres, sem espaços; não pode ser uma senha comum nem conter o seu nome de usuário.</p>
        <button type="button" onClick={() => void trocarSenha()} disabled={trocando || !atual || nova.length < 12} className={`mt-3 ${BOTAO}`}>{trocando ? "Alterando…" : "Alterar senha"}</button>
      </div>
    </div>
  );
}
