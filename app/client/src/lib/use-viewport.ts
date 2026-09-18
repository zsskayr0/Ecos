import { useEffect, useState } from "react";
import { ehAndroid } from "@/lib/platform";

/** Breakpoint `md` do Tailwind (tailwind.config.cjs usa o padrão) — abaixo
 * disso o editor de Nota troca a coluna de preview por uma toolbar mais
 * completa (seção UX: "no mobile não pode ser algo travado"). */
const BREAKPOINT_MOBILE_PX = 768;

/** Abaixo disso o workspace multi-painel não cabe (rail + 2 painéis de 320px). */
const BREAKPOINT_DESKTOP_PX = 1024;

export function useIsDesktop(): boolean {
  const consulta = `(min-width: ${BREAKPOINT_DESKTOP_PX}px)`;
  const [ehDesktop, setEhDesktop] = useState(() => !ehAndroid() && window.matchMedia(consulta).matches);

  useEffect(() => {
    const mql = window.matchMedia(consulta);
    const ouvinte = (e: MediaQueryListEvent) => setEhDesktop(!ehAndroid() && e.matches);
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
