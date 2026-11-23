import { useEffect, useState } from "react";
import { links } from "@/lib/api";
import { guardarTituloPagina, lerTituloPagina } from "@/lib/conexoes-cache";

/** `https://www.exemplo.com/a/b` -> `exemplo.com`. */
export function dominio(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}

/** Sem título buscado nem texto escrito: domínio + caminho curto, em vez da URL inteira. */
export function rotuloCurto(url: string): string {
  try {
    const u = new URL(url);
    const caminho = (u.pathname + u.search).replace(/\/$/, "");
    const base = u.hostname.replace(/^www\./, "") + (caminho && caminho !== "/" ? caminho : "");
    return base.length > 60 ? `${base.slice(0, 57)}…` : base;
  } catch { return url; }
}

/**
 * Título das páginas dos links externos. Otimista: usa o que já foi visto (guardado por 5 minutos) na hora e pergunta ao
 * servidor de novo, que também guarda em cache; só atualiza se algo mudou. Enquanto não há título vale o texto ou o domínio.
 */
export function useTitulosExternos(externos: { url: string }[]): Record<string, string | null> {
  const urls = externos.map((e) => e.url).slice(0, 20);
  const chave = urls.join("|");
  const guardados = () => {
    const r: Record<string, string | null> = {};
    for (const u of urls) { const t = lerTituloPagina(u); if (t !== undefined) r[u] = t; }
    return r;
  };
  const [titulos, setTitulos] = useState<Record<string, string | null>>(guardados);
  useEffect(() => {
    setTitulos((atual) => ({ ...guardados(), ...atual }));
    if (!urls.length) return;
    let ativo = true;
    links.titulos(urls).then((r) => {
      if (!ativo) return;
      for (const [u, t] of Object.entries(r.titulos)) guardarTituloPagina(u, t);
      setTitulos((atual) => (urls.every((u) => atual[u] === r.titulos[u]) ? atual : { ...atual, ...r.titulos }));
    }).catch(() => {});
    return () => { ativo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave]);
  return titulos;
}
