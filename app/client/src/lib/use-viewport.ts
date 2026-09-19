import { useEffect, useState } from "react";

/** Breakpoint `md` do Tailwind (tailwind.config.cjs usa o padrão) — abaixo
 * disso o editor de Nota troca a coluna de preview por uma toolbar mais
 * completa (seção UX: "no mobile não pode ser algo travado"). */
const BREAKPOINT_MOBILE_PX = 768;

/** Abaixo disso o workspace multi-painel não cabe (rail + 2 painéis de 320px). */
const BREAKPOINT_DESKTOP_PX = 1024;

/**
 * Só a largura decide, em qualquer plataforma: tablet Android deitado (>= 1024px) ganha o workspace desktop, igual
 * à tela de login (breakpoint `lg` do CSS). Celular, mesmo deitado, fica abaixo disso e continua no layout mobile.
 */
export function useIsDesktop(): boolean {
  const consulta = `(min-width: ${BREAKPOINT_DESKTOP_PX}px)`;
  const [ehDesktop, setEhDesktop] = useState(() => window.matchMedia(consulta).matches);

  useEffect(() => {
    const mql = window.matchMedia(consulta);
    setEhDesktop(mql.matches);
    const ouvinte = (e: MediaQueryListEvent) => setEhDesktop(e.matches);
    mql.addEventListener("change", ouvinte);
    return () => mql.removeEventListener("change", ouvinte);
  }, [consulta]);

  return ehDesktop;
}

export function useIsMobile(): boolean {
  const [ehMobile, setEhMobile] = useState(() => window.matchMedia(`(max-width: ${BREAKPOINT_MOBILE_PX - 1}px)`).matches);

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${BREAKPOINT_MOBILE_PX - 1}px)`);
    const ouvinte = (e: MediaQueryListEvent) => setEhMobile(e.matches);
    mql.addEventListener("change", ouvinte);
    return () => mql.removeEventListener("change", ouvinte);
  }, []);

  return ehMobile;
}
