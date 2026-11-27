import { useCallback, useRef, useState } from "react";
import { ConfirmDeleteDialog } from "./ConfirmDeleteDialog";

export interface PedidoConfirmacao {
  title: string;
  description: string;
  confirmLabel?: string;
}

/**
 * Troca `window.confirm` pelo ConfirmDeleteDialog sem reestruturar quem chama:
 * `if (!(await confirmar({...}))) return;`. Renderize `dialogo` em qualquer ponto do componente.
 */
export function useConfirmar() {
  const [pedido, setPedido] = useState<PedidoConfirmacao | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const confirmar = useCallback((p: PedidoConfirmacao) => new Promise<boolean>((resolve) => {
    resolver.current?.(false);
    resolver.current = resolve;
    setPedido(p);
  }), []);

  const responder = (ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setPedido(null);
  };

  const dialogo = <ConfirmDeleteDialog open={pedido !== null} busy={false}
    title={pedido?.title ?? ""} description={pedido?.description ?? ""} confirmLabel={pedido?.confirmLabel}
    onCancel={() => responder(false)} onConfirm={() => responder(true)} />;

  return { confirmar, dialogo, aberto: pedido !== null };
}
