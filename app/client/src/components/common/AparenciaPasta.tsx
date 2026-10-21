import { lazy, Suspense } from "react";
import { SeletorCor } from "@/screens/Vault/contas/SeletorCor";
import { CORES } from "@/screens/Vault/categorias/icone";

const IconPicker = lazy(() => import("@/screens/Vault/IconPicker"));

/** Cor sugerida quando a pasta ainda não tem uma (primeira da paleta do Cofre). */
export const COR_PADRAO_PASTA = CORES[7]!;

/**
 * Cor e ícone de uma pasta, com os mesmos seletores das categorias do Cofre. É carregado sob demanda
 * (o catálogo de ícones é grande) e traz as variáveis de tema que esses seletores esperam.
 */
export default function AparenciaPasta({ cor, icone, onCor, onIcone }: { cor: string; icone: string; onCor: (cor: string) => void; onIcone: (icone: string) => void }) {
  return (
    <div className="ecos-anexos-raiz flex flex-col gap-4">
      <div className="cofre-cats-field">
        <span>Cor</span>
        <SeletorCor valor={cor} onChange={onCor} />
      </div>
      <div className="cofre-cats-field">
        <span>Ícone</span>
        <Suspense fallback={<p className="cofre-cats-none">Carregando ícones…</p>}>
          <IconPicker value={icone} onChange={onIcone} cor={cor} personalizados />
        </Suspense>
      </div>
    </div>
  );
}
