import type { CategoriaApi } from "@/lib/api";
import { parecidos } from "../sacados/similares";
import type { Uso } from "./dados";

export interface GrupoDuplicado {
  /** Id estável (ids ordenados): "não é duplicata" lembra a decisão por ele. */
  chave: string;
  membros: CategoriaApi[];
  motivo: "espacos" | "digitacao";
  /** Sugestão de quem fica: a mais usada (empate: a principal, depois a mais antiga na lista). */
  principal: CategoriaApi;
}

/**
 * Categorias com nomes que parecem ser a mesma coisa ("Impostos e Taxas" / "Impostos  e taxas", "Alimentaçao").
 * Arquivadas ficam de fora, e subcategorias de mães diferentes com o mesmo nome ("Outros") são normais, não duplicata.
 */
export function acharDuplicatas(categorias: CategoriaApi[], usos: Map<string, Uso>, dispensadas: Set<string> = new Set()): GrupoDuplicado[] {
  const ativas = categorias.filter((c) => !c.arquivada);
  const pai = new Map<string, string>(ativas.map((c) => [c.id, c.id]));
  const raiz = (id: string): string => { let r = id; while (pai.get(r) !== r) r = pai.get(r)!; return r; };
  const motivos = new Map<string, "espacos" | "digitacao">();
  for (let i = 0; i < ativas.length; i++) {
    for (let j = i + 1; j < ativas.length; j++) {
      const a = ativas[i]!, b = ativas[j]!;
      if (a.pai_id && b.pai_id && a.pai_id !== b.pai_id) continue;
      const m = parecidos(a.nome, b.nome);
      if (!m) continue;
      const ra = raiz(a.id), rb = raiz(b.id);
      if (ra !== rb) pai.set(rb, ra);
      const r = raiz(a.id);
      motivos.set(r, motivos.get(r) === "espacos" || m === "espacos" ? "espacos" : "digitacao");
    }
  }
  const grupos = new Map<string, CategoriaApi[]>();
  for (const c of ativas) grupos.set(raiz(c.id), [...(grupos.get(raiz(c.id)) ?? []), c]);
  return [...grupos.entries()]
    .filter(([, m]) => m.length > 1)
    .map(([r, membros]): GrupoDuplicado => {
      const chave = membros.map((m) => m.id).sort().join("+");
      const principal = [...membros].sort((x, y) => (usos.get(y.id)?.count ?? 0) - (usos.get(x.id)?.count ?? 0) || Number(!!x.pai_id) - Number(!!y.pai_id))[0]!;
      return { chave, membros, motivo: motivos.get(r) ?? "digitacao", principal };
    })
    .filter((g) => !dispensadas.has(g.chave));
}
