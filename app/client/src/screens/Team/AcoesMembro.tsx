import { useState } from "react";
import { MoreHorizontal } from "lucide-react";
import type { Cargo } from "@/lib/types";

const CARGOS: { valor: Cargo; rotulo: string }[] = [
  { valor: "admin", rotulo: "Administrador" },
  { valor: "membro", rotulo: "Membro" },
];

/**
 * Quem pode agir sobre quem (espelha o servidor, que é quem decide de verdade): dono age sobre todos os outros;
 * administrador só sobre quem não é dono; membro comum, sobre ninguém. Ninguém age sobre si mesmo aqui
 * (sair da equipe tem seção própria).
 */
export function podeGerenciarMembro(meuCargo: string | undefined, cargoAlvo: string, souEu: boolean): boolean {
  if (souEu) return false;
  if (meuCargo === "dono") return true;
  return meuCargo === "admin" && cargoAlvo !== "dono";
}

interface Props {
  nome: string;
  cargoAtual: Cargo;
  ocupado: boolean;
  onTrocarCargo: (cargo: Cargo) => void;
  onRemover: () => void;
  /** Só o dono transfere a propriedade; quando definido, o menu oferece a opção. */
  onTransferir?: () => void;
}

/** Menu inline (sem diálogo nativo): alterar cargo e remover da equipe, com confirmação para a remoção. */
export function AcoesMembro({ nome, cargoAtual, ocupado, onTrocarCargo, onRemover, onTransferir }: Props) {
  const [aberto, setAberto] = useState(false);
  const [confirmando, setConfirmando] = useState<"remover" | "transferir" | null>(null);
  // Dono não é alterado por esta lista: a propriedade só muda por transferência explícita.
  const cargosOferecidos = CARGOS.filter((c) => c.valor !== cargoAtual);

  return (
    <div className="relative">
      <button
        type="button"
        aria-label={`Gerenciar ${nome}`}
        aria-expanded={aberto}
        onClick={() => { setAberto((v) => !v); setConfirmando(null); }}
        className="flex h-11 w-11 items-center justify-center rounded-lg text-text-muted hover:bg-surface-2 hover:text-text-primary"
      >
        <MoreHorizontal size={18} />
      </button>
      {aberto && (
        <div role="group" aria-label={`Ações para ${nome}`} className="ecos-fade-in absolute right-0 top-full z-30 w-60 rounded-xl border border-border bg-surface-1 p-2 shadow-nav">
          {confirmando === null ? (
            <>
              {cargoAtual !== "dono" && cargosOferecidos.map((c) => (
                <button
                  key={c.valor}
                  type="button"
                  disabled={ocupado}
                  onClick={() => { onTrocarCargo(c.valor); setAberto(false); }}
                  className="flex min-h-11 w-full items-center rounded-lg px-3 text-left text-sm text-text-secondary hover:bg-surface-2 hover:text-text-primary disabled:opacity-40"
                >
                  Tornar {c.rotulo.toLowerCase()}
                </button>
              ))}
              {onTransferir && (
                <button
                  type="button"
                  disabled={ocupado}
                  onClick={() => setConfirmando("transferir")}
                  className="flex min-h-11 w-full items-center rounded-lg px-3 text-left text-sm text-text-secondary hover:bg-surface-2 hover:text-text-primary disabled:opacity-40"
                >
                  Transferir propriedade
                </button>
              )}
              <button
                type="button"
                disabled={ocupado}
                onClick={() => setConfirmando("remover")}
                className="flex min-h-11 w-full items-center rounded-lg px-3 text-left text-sm text-error hover:bg-error/10 disabled:opacity-40"
              >
                Remover da equipe
              </button>
            </>
          ) : (
            <div className="p-1">
              <p className="mb-3 text-sm text-text-secondary">
                {confirmando === "transferir"
                  ? <>Tornar <strong className="text-text-primary">{nome}</strong> dono da equipe? Você passa a ser administrador e não poderá desfazer isso sozinho.</>
                  : <>Remover <strong className="text-text-primary">{nome}</strong>? A pessoa perde o acesso à equipe; o que ela criou continua com a equipe.</>}
              </p>
              <div className="flex gap-2">
                <button type="button" onClick={() => setConfirmando(null)} className="min-h-11 flex-1 rounded-lg bg-surface-2 text-sm font-medium text-text-primary">Cancelar</button>
                <button
                  type="button"
                  disabled={ocupado}
                  onClick={() => { if (confirmando === "transferir") onTransferir?.(); else onRemover(); setAberto(false); setConfirmando(null); }}
                  className="min-h-11 flex-1 rounded-lg bg-error text-sm font-semibold text-white disabled:opacity-40"
                >
                  {confirmando === "transferir" ? "Transferir" : "Remover"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
