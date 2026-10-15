import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, AlertTriangle } from "lucide-react";
import { Toggle } from "@/components/common/Toggle";
import { ApiError, FRASE_RESET_COFRE, vault } from "@/lib/api";

const FRASE_CONFIRMACAO = FRASE_RESET_COFRE;

/**
 * Privacy & Vault (section 3.12) — "hide amounts in the Feed" (off by default,
 * saved on the server), biometrics (not available yet: shown disabled), and a
 * visually isolated danger zone, last. Zero humor across this entire screen
 * (tone rule, section 1.4).
 */
export function PrivacyVaultScreen() {
  const navigate = useNavigate();
  const [ocultarValores, setOcultarValores] = useState(false);
  const [prefCarregada, setPrefCarregada] = useState(false);
  const [prefErro, setPrefErro] = useState<string | null>(null);
  const [salvandoPref, setSalvandoPref] = useState(false);
  const [backup, setBackup] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [frase, setFrase] = useState("");
  const [apagando, setApagando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [apagado, setApagado] = useState(false);

  useEffect(() => {
    let ativo = true;
    vault.preferencias
      .obter()
      .then((p) => {
        if (!ativo) return;
        setOcultarValores(p.ocultar_valores_feed === true);
        setPrefCarregada(true);
      })
      .catch((e) => {
        if (!ativo) return;
        setPrefErro(
          e instanceof ApiError && e.code === "CONEXAO_INDISPONIVEL"
            ? "Sem conexão com o servidor. Não foi possível carregar esta opção."
            : "Desbloqueie o Cofre para ver e alterar esta opção.",
        );
      });
    return () => {
      ativo = false;
    };
  }, []);

  async function alternarOcultarValores(novo: boolean) {
    const anterior = ocultarValores;
    setOcultarValores(novo);
    setSalvandoPref(true);
    setPrefErro(null);
    try {
      await vault.preferencias.salvarOcultarValoresFeed(novo);
    } catch {
      setOcultarValores(anterior);
      setPrefErro("Não foi possível salvar. A opção continua como estava.");
    } finally {
      setSalvandoPref(false);
    }
  }

  async function resetarCofre() {
    setApagando(true);
    setErro(null);
    try {
      const r = await vault.resetar();
      setBackup(r.backup_de_seguranca ?? null);
      setApagado(true);
      setConfirmando(false);
      setFrase("");
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível resetar o Cofre. Nada foi apagado; tente novamente.");
    } finally {
      setApagando(false);
    }
  }

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
          <p className="text-xs text-text-muted">Em breve. Ainda não é possível exigir biometria para abrir o Cofre.</p>
        </div>
        <Toggle checked={false} onChange={() => {}} disabled label="Biometria obrigatória (em breve)" />
      </div>

      <div className="mb-8 rounded-2xl bg-surface-1 p-4">
        <div className="flex items-center justify-between">
          <div className="pr-3">
            <p className="text-[15px] font-medium text-text-primary">Ocultar valores no Feed</p>
            <p className="text-xs text-text-muted">Não mostra valores monetários no Feed, fora do Cofre.</p>
          </div>
          <Toggle
            checked={ocultarValores}
            onChange={(v) => void alternarOcultarValores(v)}
            disabled={!prefCarregada || salvandoPref}
            label="Ocultar valores no Feed"
          />
        </div>
        {prefErro && <p role="alert" className="mt-2 text-xs text-error">{prefErro}</p>}
      </div>

      <div className="rounded-2xl border border-error/40 bg-error/[0.06] p-4">
        <p className="mb-1 flex items-center gap-2 text-sm font-semibold text-error">
          <AlertTriangle size={16} strokeWidth={1.75} />
          Zona de risco
        </p>
        <p className="mb-4 text-sm text-text-secondary">
          Resetar o Cofre apaga todas as transações, categorias, contas, recorrências e comprovantes
          permanentemente. Antes de apagar, o servidor guarda um backup de segurança; se esse backup falhar, nada é
          apagado. Essa ação não pode ser desfeita pela tela.
        </p>

        {apagado && (
          <p role="status" className="mb-3 text-sm text-success">
            Cofre resetado.
            {backup ? ` Backup de segurança guardado: ${backup}.` : " O servidor guardou um backup de segurança antes de apagar."}
          </p>
        )}

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
              disabled={apagando}
            />
            {erro && <p role="alert" className="text-sm text-error">{erro}</p>}
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setConfirmando(false);
                  setFrase("");
                  setErro(null);
                }}
                disabled={apagando}
                className="flex-1 rounded-2xl bg-surface-2 py-2.5 text-sm font-medium text-text-primary"
              >
                Cancelar
              </button>
              <button
                onClick={() => void resetarCofre()}
                disabled={frase !== FRASE_CONFIRMACAO || apagando}
                className="flex-1 rounded-2xl bg-error py-2.5 text-sm font-semibold text-white disabled:opacity-40"
              >
                {apagando ? "Apagando…" : "Apagar permanentemente"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
