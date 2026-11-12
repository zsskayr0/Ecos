import { useEffect, useState } from "react";
import { lerPreferenciasAplicativo } from "./preferencias-aplicativo";

/** `true` quando o "Modo explorador" está ligado (Configurações › Aparência › Pastas), sempre em dia com a preferência. */
export function useModoExplorador(): boolean {
  const [ligado, setLigado] = useState(() => lerPreferenciasAplicativo().modoExplorador);
  useEffect(() => {
    const atualizar = () => setLigado(lerPreferenciasAplicativo().modoExplorador);
    window.addEventListener("ecos:preferencias-aplicativo", atualizar);
    return () => window.removeEventListener("ecos:preferencias-aplicativo", atualizar);
  }, []);
  return ligado;
}
