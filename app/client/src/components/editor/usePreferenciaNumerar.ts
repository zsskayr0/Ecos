import { useEffect, useState } from "react";
import { lerPreferenciasAplicativo, type PreferenciasAplicativo } from "@/lib/preferencias-aplicativo";

/** A preferência "Numerar títulos", atualizada quando muda em Configurações. */
export function usePreferenciaNumerar(): boolean {
  const [ligado, setLigado] = useState(() => lerPreferenciasAplicativo().numerarTitulos);
  useEffect(() => {
    const ouvir = (e: Event) => setLigado(!!(e as CustomEvent<PreferenciasAplicativo>).detail?.numerarTitulos);
    window.addEventListener("ecos:preferencias-aplicativo", ouvir);
    return () => window.removeEventListener("ecos:preferencias-aplicativo", ouvir);
  }, []);
  return ligado;
}
