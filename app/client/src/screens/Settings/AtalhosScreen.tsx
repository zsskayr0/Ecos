import { Keyboard } from "lucide-react";
import { GRUPOS_ATALHOS } from "@/lib/atalhos";
import { ListaAtalhos } from "@/components/common/ListaAtalhos";
import { Cabecalho, ancoraDe } from "./campos-config";

/** A lista mora em `lib/atalhos.ts` (também usada pela Ajuda e pela paleta). Ainda não dá para remapear. */
export function AtalhosScreen() {
  return (
    <div className="px-4 pt-[calc(env(safe-area-inset-top)+12px)] pb-nav-safe">
      <Cabecalho titulo="Atalhos de teclado" />
      <p className="mb-5 flex items-center gap-2 text-sm text-text-muted"><Keyboard size={16} />Lista de consulta. Ainda não é possível remapear.</p>
      <ListaAtalhos grupos={GRUPOS_ATALHOS} ancora={ancoraDe} />
    </div>
  );
}
