import { useEffect, useRef, type ReactNode } from "react";

/**
 * Pilha de diálogos abertos: só o do topo reage ao Esc, então um popup dentro
 * de outro diálogo fecha primeiro (e não os dois de uma vez).
 */
const pilha: symbol[] = [];

/** Esc fecha o diálogo do topo da pilha enquanto `ativo`. */
export function useEscFecha(ativo: boolean, onFechar: () => void) {
  const callback = useRef(onFechar);
  callback.current = onFechar;
  useEffect(() => {
    if (!ativo) return;
    const id = Symbol("dialogo");
    pilha.push(id);
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || pilha[pilha.length - 1] !== id) return;
      e.preventDefault();
      e.stopPropagation();
      callback.current();
    };
    document.addEventListener("keydown", aoTeclar);
    return () => {
      document.removeEventListener("keydown", aoTeclar);
      const i = pilha.indexOf(id);
      if (i >= 0) pilha.splice(i, 1);
    };
  }, [ativo]);
}

interface DialogProps {
  onFechar: () => void;
  /** Nome acessível. Use `rotuloId` quando o diálogo já tem um título visível. */
  rotulo?: string;
  rotuloId?: string;
  descricaoId?: string;
  /** Classes do contêiner de tela cheia (scrim + posicionamento). */
  className?: string;
  /** Clique no scrim fecha. Padrão: true. */
  fecharNoScrim?: boolean;
  children: ReactNode;
}

/**
 * Contêiner modal padrão: `role="dialog"` + `aria-modal`, nome acessível, Esc e
 * clique no scrim. A entrada do foco, o laço de Tab e o retorno ao gatilho vêm
 * da `ArmadilhaFoco` montada na raiz, que vale para todo `aria-modal="true"`.
 * O scrim é o próprio contêiner (não um botão), logo não entra na ordem de Tab.
 */
export function Dialog({ onFechar, rotulo, rotuloId, descricaoId, className = "fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4", fecharNoScrim = true, children }: DialogProps) {
  useEscFecha(true, onFechar);
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={rotuloId ? undefined : rotulo}
      aria-labelledby={rotuloId}
      aria-describedby={descricaoId}
      className={className}
      onMouseDown={(e) => { if (fecharNoScrim && e.target === e.currentTarget) onFechar(); }}
    >
      {children}
    </div>
  );
}
