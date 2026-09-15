import { useState } from "react";
import { Fingerprint, AlertTriangle } from "lucide-react";
import { ApiError } from "@/lib/api";

/**
 * Lock screen before any Vault content (section 3.5) — a password is the
 * real factor today (`apps/vault/src/routes/ativacao.rs`); device
 * biometrics (WebAuthn) is a backend `TODO`, so "Unlock with biometrics"
 * asks for the Vault password under the hood — zero humor here (tone
 * rule, section 1.4), it's the most serious screen in the app.
 */
export function VaultLockScreen({
  primeiraVez,
  onSubmeter,
}: {
  primeiraVez: boolean;
  onSubmeter: (senha: string) => Promise<void>;
}) {
  const [senha, setSenha] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    if (primeiraVez && senha !== confirmacao) {
      setErro("As senhas não coincidem.");
      return;
    }
    setCarregando(true);
    try {
      await onSubmeter(senha);
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível conectar ao Cofre.");
    } finally {
      setCarregando(false);
    }
  }

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-6 px-8 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-violet/15">
        <Fingerprint size={30} strokeWidth={1.5} className="text-violet" />
      </div>
      <div>
        <p className="font-body text-[15px] font-semibold text-text-primary">
          {primeiraVez ? "Defina a senha do Cofre" : "O Cofre está bloqueado"}
        </p>
        <p className="mt-1 text-sm text-text-muted">
          {primeiraVez
            ? "Essa senha é exclusiva do Cofre, separada da sua senha de login. Guarde-a — sem ela, não há como recuperar os dados."
            : "Confirme sua identidade para acessar dados financeiros."}
        </p>
      </div>

      <form onSubmit={onSubmit} className="flex w-full max-w-xs flex-col gap-3">
        <input
          type="password"
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          placeholder="Senha do Cofre"
          className="ecos-input text-center"
          autoFocus
        />
        {primeiraVez && (
          <input
            type="password"
            value={confirmacao}
            onChange={(e) => setConfirmacao(e.target.value)}
            placeholder="Confirme a senha"
            className="ecos-input text-center"
          />
        )}

        {erro && (
          <div className="flex items-start gap-2 rounded-2xl border border-error/40 bg-error/10 p-3 text-left text-sm text-error">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" strokeWidth={1.75} />
            {erro}
          </div>
        )}

        <button
          type="submit"
          disabled={carregando || senha.length < 8}
          className="rounded-2xl bg-violet py-3.5 text-center font-body text-[15px] font-semibold text-black disabled:opacity-40"
        >
          {carregando ? "Um momento..." : primeiraVez ? "Ativar Cofre" : "Desbloquear"}
        </button>
      </form>
    </div>
  );
}
