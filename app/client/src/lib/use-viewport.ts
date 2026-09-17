import { useEffect, useState } from "react";

/** Breakpoint `md` do Tailwind (tailwind.config.cjs usa o padrão) — abaixo
 * disso o editor de Nota troca a coluna de preview por uma toolbar mais
 * completa (seção UX: "no mobile não pode ser algo travado"). */
const BREAKPOINT_MOBILE_PX = 768;

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
