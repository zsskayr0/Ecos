import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, AlertTriangle } from "lucide-react";
import { Toggle } from "@/components/common/Toggle";

const FRASE_CONFIRMACAO = "apagar meu cofre";

/**
 * Privacy & Vault (section 3.12) — mandatory biometrics (on by default),
 * "hide amounts in the Feed" (off by default), a visually isolated danger
 * zone, last, away from harmless toggles. Zero humor across this entire
 * screen (tone rule, section 1.4).
 */
export function PrivacyVaultScreen() {
  const navigate = useNavigate();
  const [biometriaObrigatoria, setBiometriaObrigatoria] = useState(true);
  const [ocultarValores, setOcultarValores] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [frase, setFrase] = useState("");

  return (
    <div className="px-4 pt-[calc(env(safe-area-inset-top)+12px)] pb-nav-safe">
      <div className="mb-5 flex items-center gap-2">
        <button data-voltar onClick={() => navigate(-1)} className="text-text-muted">
          <ChevronLeft size={22} />
        </button>
        <h1 className="font-display text-xl text-text-primary">Privacidade &amp; Cofre</h1>
      </div>

      <div className="mb-3 flex items-center justify-between rounded-2xl bg-surface-1 p-4">
        <div className="pr-3">
          <p className="text-[15px] font-medium text-text-primary">Biometria obrigatória</p>
          <p className="text-xs text-text-muted">Exigir biometria pra abrir o Cofre, sempre.</p>
        </div>
        <Toggle checked={biometriaObrigatoria} onChange={setBiometriaObrigatoria} />
      </div>

      <div className="mb-8 flex items-center justify-between rounded-2xl bg-surface-1 p-4">
        <div className="pr-3">
          <p className="text-[15px] font-medium text-text-primary">Ocultar valores no Feed</p>
          <p className="text-xs text-text-muted">Substitui valores monetários por •••• fora do Cofre.</p>
        </div>
        <Toggle checked={ocultarValores} onChange={setOcultarValores} />
      </div>

      <div className="rounded-2xl border border-error/40 bg-error/[0.06] p-4">
        <p className="mb-1 flex items-center gap-2 text-sm font-semibold text-error">
          <AlertTriangle size={16} strokeWidth={1.75} />
          Zona de risco
        </p>
        <p className="mb-4 text-sm text-text-secondary">
          Resetar o Cofre apaga todas as transações, categorias e contas permanentemente. Essa ação não pode ser
          desfeita.
        </p>

        {!confirmando ? (
          <button
            onClick={() => setConfirmando(true)}
            className="w-full rounded-2xl border border-error/50 py-3 text-center text-sm font-semibold text-error"
          >
            Resetar Cofre
          </button>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-text-secondary">
              Digite <span className="font-mono-value text-text-primary">{FRASE_CONFIRMACAO}</span> para confirmar.
            </p>
            <input
              value={frase}
              onChange={(e) => setFrase(e.target.value)}
              className="ecos-input"
              placeholder={FRASE_CONFIRMACAO}
            />
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setConfirmando(false);
                  setFrase("");
                }}
                className="flex-1 rounded-2xl bg-surface-2 py-2.5 text-sm font-medium text-text-primary"
              >
                Cancelar
              </button>
              <button
                disabled={frase.trim().toLowerCase() !== FRASE_CONFIRMACAO}
                className="flex-1 rounded-2xl bg-error py-2.5 text-sm font-semibold text-white disabled:opacity-40"
              >
                Apagar permanentemente
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
