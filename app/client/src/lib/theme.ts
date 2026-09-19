import { useEffect, useState } from "react";

export type Tema = "dark" | "light";
const CHAVE = "ecos-tema";

export function temaInicial(): Tema {
  try { return localStorage.getItem(CHAVE) === "light" ? "light" : "dark"; }
  catch { return "dark"; }
}

/** Aplica a preferência antes da primeira renderização, evitando um flash escuro no modo claro. */
export function aplicarTemaInicial() {
  if (typeof document !== "undefined") document.documentElement.setAttribute("data-theme", temaInicial());
}

/** Dark is the product's default (section 1.3) — light is opt-in. */
export function useTema() {
  const [tema, setTemaState] = useState<Tema>(() => {
    return temaInicial();
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
