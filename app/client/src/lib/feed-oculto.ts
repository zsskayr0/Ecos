import type { FeedOcultos } from "@/lib/api";

/** Pasta oculta vale também para as subpastas (mesma regra do servidor). */
const dentroDe = (pasta: string, ancora: string) => pasta === ancora || pasta.startsWith(`${ancora}/`);

/** Mesma regra do servidor para o que entra no Feed: usada nos itens "recentes" que o cliente junta por conta própria. */
export function ocultoNoFeed(item: { id: string; espaco: string; pasta?: string | null; tags?: string[] }, ocultos: FeedOcultos | null): boolean {
  if (!ocultos) return false;
  if (ocultos.itens.some((i) => i.id === item.id)) return true;
  if (item.pasta && ocultos.pastas.some((p) => p.espaco === item.espaco && dentroDe(item.pasta!, p.caminho))) return true;
  return (item.tags ?? []).some((t) => ocultos.tags.includes(t));
}
