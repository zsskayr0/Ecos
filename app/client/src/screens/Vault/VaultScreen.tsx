import { useEffect, useState } from "react";
import * as Icons from "lucide-react";
import { Lock, AlertTriangle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { VaultLockScreen } from "./VaultLockScreen";
import { vault, auth, ApiError, type TransacaoApi, type CategoriaApi } from "@/lib/api";
import { formatMoeda } from "@/lib/format";
import { useRefreshBus } from "@/lib/refresh-bus";

type Fase = "carregando" | "desativado" | "precisa-ativar" | "bloqueado" | "aberto";

/**
 * Vault — balance card, statement, icon+color by category (section 3.5),
 * now against the real `ecos-vault-db` via `ecos-app`'s proxy
 * (`/api/v1/vault/*`). Three real states: module disabled
 * (`ECOS_VAULT_ENABLED=false`), enabled but never configured (first
 * password), and locked (password again every time the process starts).
 */
export function VaultScreen() {
  const { versao, notificar } = useRefreshBus();
  const navigate = useNavigate();
  const [fase, setFase] = useState<Fase>("carregando");
  const [saldoTotal, setSaldoTotal] = useState(0);
  const [transacoes, setTransacoes] = useState<TransacaoApi[]>([]);
  const [categorias, setCategorias] = useState<CategoriaApi[]>([]);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const perfil = await auth.perfil();
        if (!perfil.cofre_ativado) {
          if (vivo) setFase("desativado");
          return;
        }
        const cfg = await vault.config();
        if (!vivo) return;
        if (!cfg.cofre_ativado) return setFase("precisa-ativar");
        if (!cfg.destrancado) return setFase("bloqueado");

        setSaldoTotal(cfg.saldos_por_conta.reduce((acc, c) => acc + c.saldo_centavos, 0));
        const [tx, cat] = await Promise.all([vault.transacoes.listar({ limit: 30 }), vault.categorias.listar()]);
        if (!vivo) return;
        setTransacoes(tx.items);
        setCategorias(cat);
        setFase("aberto");
      } catch (e) {
        if (!vivo) return;
        setErro(e instanceof ApiError ? e.message : "Não foi possível falar com o Cofre.");
        setFase("bloqueado");
      }
    })();
    return () => {
      vivo = false;
    };
  }, [versao]);

  async function ativar(senha: string) {
    await vault.ativar(senha);
    notificar();
  }

  async function desbloquear(senha: string) {
    await vault.desbloquear(senha);
    notificar();
  }

  async function bloquear() {
    await vault.bloquear();
    notificar();
  }

  if (fase === "carregando") {
    return <p className="py-16 text-center text-sm text-text-muted">Carregando Cofre...</p>;
  }

  if (fase === "desativado") return <VaultTeaserScreen />;
  if (fase === "precisa-ativar") return <VaultLockScreen primeiraVez onSubmeter={ativar} />;
  if (fase === "bloqueado") return <VaultLockScreen primeiraVez={false} onSubmeter={desbloquear} />;

  const categoriaPorId = new Map(categorias.map((c) => [c.id, c]));

  return (
    <div className="px-4 pt-1">
      <div className="mb-5 rounded-card border border-violet/25 bg-gradient-to-br from-violet/15 to-transparent p-5">
        <p className="mb-1 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-violet">
          <Icons.ShieldHalf size={13} />
          Saldo do Cofre
        </p>
        {/* Section 3.5 asks for large Space Grotesk, but rule 7 (section
            4) is emphatic: JetBrains Mono for any monetary value, no
            exceptions — the general rule wins over section 3.5's
            one-off mention. */}
        <p className="font-mono-value text-4xl font-bold text-text-primary">{formatMoeda(saldoTotal)}</p>
      </div>

      {erro && (
        <div className="mb-4 flex items-start gap-2 rounded-2xl border border-error/40 bg-error/10 p-3 text-sm text-error">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" strokeWidth={1.75} />
          {erro}
        </div>
      )}

      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Transações recentes</p>
        <button onClick={bloquear} className="flex items-center gap-1 text-xs text-text-muted">
          <Lock size={12} />
          Bloquear
        </button>
      </div>

      {transacoes.length === 0 ? (
        <p className="py-10 text-center text-sm text-text-muted">
          Nenhuma transação ainda. Toque no + pra registrar a primeira.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {transacoes.map((tx) => {
            const cat = tx.categoria_id ? categoriaPorId.get(tx.categoria_id) : undefined;
            const IconCmp = (Icons as unknown as Record<string, Icons.LucideIcon>)[cat?.icone ?? ""] ?? Icons.Circle;
            const positivo = tx.tipo === "entrada";
            const cor = cat?.cor ?? "#8f8f96";
            return (
              <button
                key={tx.id}
                onClick={() => navigate(`/cofre/transacao/${tx.id}`)}
                className="flex items-center gap-3 rounded-2xl bg-surface-1 p-3.5 text-left"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: `${cor}22` }}>
                  <IconCmp size={17} strokeWidth={1.75} style={{ color: cor }} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-medium text-text-primary">{tx.descricao}</p>
                  <p className="text-xs text-text-muted">
                    {tx.data}
                    {tx.status === "pendente" && " · pendente"}
                  </p>
                </div>
                <p className={`font-mono-value text-[15px] font-semibold ${positivo ? "text-success" : "text-error"}`}>
                  {positivo ? "+" : "-"}
                  {formatMoeda(tx.valor_centavos)}
                </p>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Activation teaser — the Vault icon never disappears from the nav even with the module disabled (rule 4). */
function VaultTeaserScreen() {
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-4 px-8 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-violet/15">
        <Icons.ShieldHalf size={28} strokeWidth={1.5} className="text-violet" />
      </div>
      <div>
        <p className="font-body text-[15px] font-semibold text-text-primary">O Cofre ainda não foi ativado</p>
        <p className="mt-1 text-sm text-text-muted">
          É um módulo à parte, com seu próprio banco. Ative subindo <code className="font-mono-value">ecos-vault-db</code> com{" "}
          <code className="font-mono-value">ECOS_VAULT_ENABLED=true</code> no servidor.
        </p>
      </div>
      <p className="text-xs text-text-muted">Ver docs/README-cofre.md do servidor.</p>
    </div>
  );
}
