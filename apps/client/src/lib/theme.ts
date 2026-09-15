import { useEffect, useState } from "react";

export type Tema = "dark" | "light";
const CHAVE = "ecos-tema";

/** Dark é o padrão do produto (seção 1.3) — light é opt-in. */
export function useTema() {
  const [tema, setTemaState] = useState<Tema>(() => {
    try {
      return (localStorage.getItem(CHAVE) as Tema) || "dark";
    } catch {
      return "dark";
    }
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", tema);
    try {
      localStorage.setItem(CHAVE, tema);
    } catch {
      /* localStorage indisponível — segue só em memória. */
    }
  }, [tema]);

  return { tema, setTema: setTemaState };
}
