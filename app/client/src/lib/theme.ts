import { useEffect, useState } from "react";

export type Tema = "dark" | "light";
const CHAVE = "ecos-tema";

/** Dark is the product's default (section 1.3) — light is opt-in. */
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
      /* localStorage unavailable — falls back to memory only. */
    }
  }, [tema]);

  return { tema, setTema: setTemaState };
}
