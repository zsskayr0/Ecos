import { useEffect, useState } from "react";
import { lerPreferenciasAplicativo } from "./preferencias-aplicativo";

/** `true` quando o "Modo explorador" está ligado (Configurações › Aparência › Pastas), sempre em dia com a preferência. */
export function useLayoutExplorador(): "trilho" | "empilhado" {
  const ler = (): "trilho" | "empilhado" => (lerPreferenciasAplicativo().exploradorLayout === "empilhado" ? "empilhado" : "trilho");
  const [layout, setLayout] = useState(ler);
  useEffect(() => {
    const atualizar = () => setLayout(ler());
    window.addEventListener("ecos:preferencias-aplicativo", atualizar);
    return () => window.removeEventListener("ecos:preferencias-aplicativo", atualizar);
  }, []);
  return layout;
}

export function useModoExplorador(): boolean {
  const [ligado, setLigado] = useState(() => lerPreferenciasAplicativo().modoExplorador);
  useEffect(() => {
    const atualizar = () => setLigado(lerPreferenciasAplicativo().modoExplorador);
    window.addEventListener("ecos:preferencias-aplicativo", atualizar);
    return () => window.removeEventListener("ecos:preferencias-aplicativo", atualizar);
  }, []);
  return ligado;
}
