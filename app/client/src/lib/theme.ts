import { useEffect, useState } from "react";

export type Tema = "dark" | "light";
/** O que a pessoa escolheu: um tema fixo ou acompanhar o sistema operacional. */
export type ModoTema = Tema | "sistema";
const CHAVE = "ecos-tema";

export function modoTemaSalvo(): ModoTema {
  try {
    const salvo = localStorage.getItem(CHAVE);
    return salvo === "light" || salvo === "sistema" ? salvo : "dark";
  } catch { return "dark"; }
}

const sistemaPrefereClaro = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-color-scheme: light)").matches;

/** Resolve o modo no tema que de fato se aplica agora. */
export function resolverTema(modo: ModoTema): Tema {
  return modo === "sistema" ? (sistemaPrefereClaro() ? "light" : "dark") : modo;
}

export function temaInicial(): Tema { return resolverTema(modoTemaSalvo()); }

/** Aplica a preferência antes da primeira renderização, evitando um flash escuro no modo claro. */
export function aplicarTemaInicial() {
  if (typeof document !== "undefined") document.documentElement.setAttribute("data-theme", temaInicial());
}

/** Chamado uma vez na partida: com "sistema" escolhido, o tema acompanha o sistema em qualquer tela. */
export function acompanharTemaDoSistema() {
  if (typeof window === "undefined" || !window.matchMedia) return;
  window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => {
    if (modoTemaSalvo() === "sistema") document.documentElement.setAttribute("data-theme", resolverTema("sistema"));
  });
}

/** Dark is the product's default (section 1.3) — light and "follow the system" are opt-in. */
export function useTema() {
  const [modo, setModo] = useState<ModoTema>(modoTemaSalvo);
  const [tema, setTema] = useState<Tema>(() => resolverTema(modoTemaSalvo()));

  useEffect(() => {
    setTema(resolverTema(modo));
    try {
      localStorage.setItem(CHAVE, modo);
    } catch {
      /* localStorage unavailable — falls back to memory only. */
    }
    if (modo !== "sistema" || !window.matchMedia) return;
    // No modo "sistema" o tema acompanha o sistema ao vivo (ex.: o aparelho muda para escuro ao anoitecer).
    const consulta = window.matchMedia("(prefers-color-scheme: light)");
    const aoMudar = () => setTema(resolverTema("sistema"));
    consulta.addEventListener("change", aoMudar);
    return () => consulta.removeEventListener("change", aoMudar);
  }, [modo]);

  useEffect(() => { document.documentElement.setAttribute("data-theme", tema); }, [tema]);

  return { tema, modo, setTema: setModo };
}
