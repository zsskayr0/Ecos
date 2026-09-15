import { useState } from "react";
import { AlertTriangle, Copy, KeyRound } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { ApiError } from "@/lib/api";

/**
 * GAP-07: not one of the 12 screens in the front-end spec (which assumes
 * identity is already resolved) — but "identity local to the instance, no
 * cloud account" (architecture section 5.1) requires real login/register
 * for any other screen to work against the real backend. Registration is
 * only accepted while the instance has no user yet (first boot); after
 * that, `POST /auth/registrar` responds 409 and the UI already points to
 * asking for a Team invite instead of insisting on "create account".
 */
export function AuthScreen() {
  const { login, registrar } = useAuth();
  const [modo, setModo] = useState<"login" | "registro">("login");
  const [nomeUsuario, setNomeUsuario] = useState("");
  const [senha, setSenha] = useState("");
  const [carregando, setCarregando] = useState(false);
  const [erroLocal, setErroLocal] = useState<string | null>(null);
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);
  const [precisaConvite, setPrecisaConvite] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErroLocal(null);
    setCarregando(true);
    try {
      if (modo === "login") {
        await login(nomeUsuario, senha);
      } else {
        const { recovery_key } = await registrar(nomeUsuario, senha);
        setRecoveryKey(recovery_key);
      }
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.status === 409) setPrecisaConvite(true);
        setErroLocal(e.campos?.map((c) => `${c.campo}: ${c.motivo}`).join(" · ") || e.message);
      } else {
        setErroLocal("Não foi possível conectar ao ecos-app. Ele está rodando?");
      }
    } finally {
      setCarregando(false);
    }
  }

  if (recoveryKey) {
    return <RecoveryKeyReveal recoveryKey={recoveryKey} />;
  }

  return (
    <div className="flex min-h-screen flex-col justify-center gap-8 px-6 py-10">
      <div className="text-center">
        <p className="font-display text-4xl text-text-primary">Ecos</p>
        <p className="mt-1 text-sm text-text-secondary">Seu cofre vivo de notas, tempo e dinheiro.</p>
      </div>

      <div className="flex rounded-pill bg-surface-2 p-1 self-center">
        <button
          onClick={() => setModo("login")}
          className={`rounded-pill px-5 py-2 text-sm font-medium ${modo === "login" ? "bg-surface-3 text-text-primary" : "text-text-muted"}`}
        >
          Entrar
        </button>
        <button
          onClick={() => setModo("registro")}
          className={`rounded-pill px-5 py-2 text-sm font-medium ${modo === "registro" ? "bg-surface-3 text-text-primary" : "text-text-muted"}`}
        >
          Criar conta
        </button>
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">Usuário</span>
          <input value={nomeUsuario} onChange={(e) => setNomeUsuario(e.target.value)} className="ecos-input" autoFocus />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">Senha</span>
          <input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} className="ecos-input" />
          {modo === "registro" && <span className="text-xs text-text-muted">Mínimo 8 caracteres.</span>}
        </label>

        {erroLocal && (
          <div className="flex items-start gap-2 rounded-2xl border border-error/40 bg-error/10 p-3 text-sm text-error">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" strokeWidth={1.75} />
            <span>
              {erroLocal}
              {precisaConvite && " Peça um convite de Equipe pra alguém que já tem conta nesta instância."}
            </span>
          </div>
        )}

        <button
          type="submit"
          disabled={carregando || !nomeUsuario.trim() || senha.length < (modo === "registro" ? 8 : 1)}
          className="mt-2 rounded-2xl bg-steel-700 py-3.5 text-center font-body text-[15px] font-semibold text-white disabled:opacity-40"
        >
          {carregando ? "Um momento..." : modo === "login" ? "Entrar" : "Criar conta"}
        </button>
      </form>

      <p className="text-center text-xs text-text-muted">
        Identidade local desta instância — sem conta em nuvem de terceiro (seção 5.1).
      </p>
    </div>
  );
}

function RecoveryKeyReveal({ recoveryKey }: { recoveryKey: string }) {
  const { recarregarPerfil } = useAuth();
  const [copiado, setCopiado] = useState(false);
  const [confirmado, setConfirmado] = useState(false);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(recoveryKey);
      setCopiado(true);
    } catch {
      /* clipboard unavailable — the user copies it manually from the screen */
    }
  }

  return (
    <div className="flex min-h-screen flex-col justify-center gap-6 px-6 py-10">
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-warning/15">
          <KeyRound size={26} strokeWidth={1.5} className="text-warning" />
        </div>
        <p className="font-display text-2xl text-text-primary">Guarde sua recovery key</p>
        <p className="max-w-sm text-sm text-text-secondary">
          Ela só aparece essa vez. O Ecos não guarda em texto simples — sem ela, perder a senha significa perder o
          acesso à conta.
        </p>
      </div>

      <div className="rounded-2xl border border-warning/30 bg-surface-1 p-4">
        <p className="break-words font-mono-value text-[15px] leading-relaxed text-text-primary">{recoveryKey}</p>
      </div>

      <button
        onClick={copiar}
        className="flex items-center justify-center gap-2 rounded-2xl bg-surface-2 py-3 text-sm font-semibold text-text-primary"
      >
        <Copy size={15} />
        {copiado ? "Copiada" : "Copiar"}
      </button>

      <label className="flex items-center gap-2.5 text-sm text-text-secondary">
        <input type="checkbox" checked={confirmado} onChange={(e) => setConfirmado(e.target.checked)} className="accent-steel-400" />
        Já guardei essa chave num lugar seguro.
      </label>

      <button
        onClick={recarregarPerfil}
        disabled={!confirmado}
        className="rounded-2xl bg-steel-700 py-3.5 text-center font-body text-[15px] font-semibold text-white disabled:opacity-40"
      >
        Continuar
      </button>
    </div>
  );
}
