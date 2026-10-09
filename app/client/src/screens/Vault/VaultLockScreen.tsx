import { useState } from "react";
import { Fingerprint, AlertTriangle, ArrowLeft } from "lucide-react";
import { ApiError } from "@/lib/api";
import { lembradaExigeConfirmacao } from "@/lib/cofre-lembrado";

/**
 * Lock screen before any Vault content (section 3.5) — a password is the
 * real factor today (`app/vault/src/routes/ativacao.rs`); device
 * biometrics (WebAuthn) is a backend `TODO`, so "Unlock with biometrics"
 * asks for the Vault password under the hood — zero humor here (tone
 * rule, section 1.4), it's the most serious screen in the app.
 */
export function VaultLockScreen({
  primeiraVez,
  onSubmeter,
  permitirLembrar = false,
  onBiometria,
  equipe,
  onVoltar,
  seletorEquipe,
}: {
  /** Nome da equipe dona deste Cofre; ausente = o Cofre pessoal. */
  equipe?: string;
  /** Volta ao feed sem digitar a senha. */
  onVoltar?: () => void;
  /** Troca de equipe ali mesmo (cada espaço tem o seu Cofre e a sua senha). */
  seletorEquipe?: React.ReactNode;
  primeiraVez: boolean;
  /** `lembrar`: guardar a senha neste computador (só quando `permitirLembrar`). */
  onSubmeter: (senha: string, lembrar: boolean) => Promise<void>;
  /** Mostra "Lembrar a senha neste computador" (Windows). */
  permitirLembrar?: boolean;
  /** Abre o Cofre com a senha guardada neste aparelho (pede biometria); ausente = não há senha guardada. */
  onBiometria?: () => Promise<void>;
}) {
  const [senha, setSenha] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  // Marcado por padrão: quem tem onde guardar com segurança quase sempre quer não digitar de novo (e só vale neste aparelho).
  const [lembrar, setLembrar] = useState(true);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    if (primeiraVez && senha !== confirmacao) {
      setErro("As senhas não coincidem.");
      return;
    }
    setCarregando(true);
    try {
      await onSubmeter(senha, permitirLembrar && lembrar);
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
          {primeiraVez ? "Defina a senha do Cofre" : "O Cofre está bloqueado"}{equipe ? ` · ${equipe}` : ""}
        </p>
        <p className="mt-1 text-sm text-text-muted">
          {primeiraVez
            ? `${equipe ? "É o Cofre compartilhado da equipe: quem for membro e souber a senha vê e edita as mesmas finanças. Só dono e administradores ativam. " : ""}Essa senha é exclusiva do Cofre, separada da sua senha de login. Mínimo de 12 caracteres, sem espaços. Guarde-a — sem ela, não há como recuperar os dados.`
            : equipe ? "Digite a senha do Cofre da equipe, definida por quem o ativou." : "Confirme sua identidade para acessar dados financeiros."}
        </p>
      </div>

      {onBiometria && !primeiraVez && (
        <button
          type="button"
          onClick={() => { setErro(null); void onBiometria(); }}
          className="inline-flex w-full max-w-xs items-center justify-center gap-2 rounded-2xl border border-violet/50 py-3 text-center font-body text-[15px] font-semibold text-violet"
        >
          <Fingerprint size={18} strokeWidth={1.75} />
          Desbloquear com biometria
        </button>
      )}

      <form onSubmit={onSubmit} className="flex w-full max-w-xs flex-col gap-3">
        {/* Usuário escondido para o gerenciador de senhas do navegador salvar e preencher a senha de cada Cofre. */}
        <input
          type="text"
          name="username"
          autoComplete="username"
          value={`Cofre Ecos${equipe ? ` · ${equipe}` : ""}`}
          readOnly
          tabIndex={-1}
          aria-hidden="true"
          className="sr-only"
        />
        <input
          type="password"
          name="password"
          autoComplete={primeiraVez ? "new-password" : "current-password"}
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

        {permitirLembrar && (
          <label className="flex items-start gap-2 text-left text-xs text-text-secondary">
            <input type="checkbox" className="mt-0.5" checked={lembrar} onChange={(e) => setLembrar(e.target.checked)} />
            <span>
              {lembradaExigeConfirmacao() ? "Lembrar a senha neste aparelho" : "Lembrar a senha neste computador"}
              <span className="block text-text-muted">
                {lembradaExigeConfirmacao()
                  ? "Fica protegida pelo Keystore do Android e só abre com sua biometria. “Bloquear” continua pedindo a senha."
                  : "Fica no Gerenciador de Credenciais do Windows, só neste usuário. “Bloquear” continua pedindo a senha."}
              </span>
            </span>
          </label>
        )}

        {erro && (
          <div className="flex items-start gap-2 rounded-2xl border border-error/40 bg-error/10 p-3 text-left text-sm text-error">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" strokeWidth={1.75} />
            {erro}
          </div>
        )}

        <button
          type="submit"
          disabled={carregando || senha.length < (primeiraVez ? 12 : 1)}
          className="rounded-2xl bg-violet py-3.5 text-center font-body text-[15px] font-semibold text-black disabled:opacity-40"
        >
          {carregando ? "Um momento..." : primeiraVez ? "Ativar Cofre" : "Desbloquear"}
        </button>
      </form>

      {(seletorEquipe || onVoltar) && (
        <div className="flex w-full max-w-xs flex-col items-center gap-3 border-t border-border pt-4">
          {seletorEquipe}
          {onVoltar && (
            <button type="button" onClick={onVoltar} className="inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-text-primary">
              <ArrowLeft size={14} strokeWidth={1.75} />
              Voltar ao feed
            </button>
          )}
        </div>
      )}
    </div>
  );
}
