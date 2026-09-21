import { useState } from "react";
import { AlertTriangle, Eye, EyeOff, LockKeyhole } from "lucide-react";
import { useAuth, nomeExibicao } from "@/lib/auth-context";
import { ApiError, auth } from "@/lib/api";
import { RecoveryKeyReveal } from "./AuthScreen";

/**
 * Primeiro acesso de uma conta criada pela administração: a senha que a pessoa recebeu é temporária, e o app não abre
 * nada antes de ela definir a própria (o servidor também recusa o resto até lá). Ao terminar, a pessoa recebe uma
 * recovery key nova — a que existia foi gerada às cegas na criação e ninguém a conhece.
 */
export function TrocaSenhaObrigatoriaScreen() {
  const { perfil, logout } = useAuth();
  const [atual, setAtual] = useState("");
  const [nova, setNova] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [mostrar, setMostrar] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);
  const { recarregarPerfil } = useAuth();

  if (recoveryKey) return <RecoveryKeyReveal recoveryKey={recoveryKey} />;

  const semEspacos = (v: string) => v.replace(/\s/g, "");
  const invalido = !atual || nova.length < 12 || nova !== confirmacao;

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (salvando || invalido) return;
    setSalvando(true); setErro(null);
    try {
      const r = await auth.trocarSenha(atual, nova);
      if (r.recovery_key) setRecoveryKey(r.recovery_key);
      else await recarregarPerfil();
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : "Não foi possível trocar a senha.");
    } finally { setSalvando(false); }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-steel-500/15">
          <LockKeyhole size={26} strokeWidth={1.5} className="text-steel-300" />
        </div>
        <p className="font-display text-2xl text-text-primary">Defina a sua senha</p>
        <p className="max-w-sm text-sm text-text-secondary">
          {perfil ? `Olá, ${nomeExibicao(perfil)}. ` : ""}Você entrou com uma senha temporária criada por quem administra o Ecos. Escolha uma senha só sua para continuar.
        </p>
      </div>

      <form onSubmit={enviar} className="flex flex-col gap-4">
        <label className="flex flex-col gap-2">
          <span className="text-sm font-semibold text-text-primary">Senha temporária</span>
          <input type={mostrar ? "text" : "password"} value={atual} onChange={(e) => setAtual(semEspacos(e.target.value))} autoComplete="current-password" className="ecos-input" autoFocus />
        </label>
        <label className="flex flex-col gap-2">
          <span className="text-sm font-semibold text-text-primary">Nova senha</span>
          <div className="relative">
            <input type={mostrar ? "text" : "password"} value={nova} onChange={(e) => setNova(semEspacos(e.target.value))} autoComplete="new-password" placeholder="Mínimo 12 caracteres, sem espaços" className="ecos-input pr-12" />
            <button type="button" onClick={() => setMostrar((v) => !v)} aria-label={mostrar ? "Ocultar senhas" : "Mostrar senhas"} className="absolute right-4 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary">
              {mostrar ? <Eye size={18} strokeWidth={1.75} /> : <EyeOff size={18} strokeWidth={1.75} />}
            </button>
          </div>
          <span className="text-xs text-text-muted">Evite senhas comuns e o seu nome de usuário.</span>
        </label>
        <label className="flex flex-col gap-2">
          <span className="text-sm font-semibold text-text-primary">Repita a nova senha</span>
          <input type={mostrar ? "text" : "password"} value={confirmacao} onChange={(e) => setConfirmacao(semEspacos(e.target.value))} autoComplete="new-password" className="ecos-input" />
          {confirmacao && nova !== confirmacao && <span className="text-xs text-error">As senhas não coincidem.</span>}
        </label>

        {erro && (
          <div className="flex items-start gap-2 rounded-2xl border border-error/40 bg-error/10 p-3 text-sm text-error">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" strokeWidth={1.75} />
            {erro}
          </div>
        )}

        <button type="submit" disabled={salvando || invalido} className="rounded-2xl bg-text-primary py-3.5 text-center font-body text-[15px] font-semibold text-base transition-opacity disabled:opacity-40">
          {salvando ? "Um momento..." : "Salvar e continuar"}
        </button>
        <button type="button" onClick={() => void logout()} className="text-center text-sm text-text-muted hover:text-text-primary">Sair</button>
      </form>
    </div>
  );
}
