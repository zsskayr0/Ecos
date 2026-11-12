import { useSyncExternalStore } from "react";
import type { PastaResumo } from "@/components/views/PastasGrade";

/**
 * Ajustes de pasta "de mentira" aplicados na hora enquanto o servidor ainda não respondeu (Optimistic UI, o mesmo
 * padrão de `status-otimista`). As telas sobrepõem isto ao que veio do servidor; quando o servidor passa a dizer o
 * mesmo a sobreposição sai sozinha, se o pedido falhar quem a criou chama o `reverter`, e uma validade evita que uma
 * sobreposição esquecida fique para sempre.
 */
export type CamposPasta = Partial<Pick<PastaResumo, "cor" | "icone" | "tags" | "descricao" | "fixada" | "prioridade_padrao" | "duracao_padrao_min">>;

const VALIDADE_MS = 20_000;
let mapa: ReadonlyMap<string, CamposPasta> = new Map();
const ouvintes = new Set<() => void>();
const assinar = (o: () => void) => { ouvintes.add(o); return () => { ouvintes.delete(o); }; };
const publicar = (proximo: Map<string, CamposPasta>) => { mapa = proximo; ouvintes.forEach((o) => o()); };

/** Aplica já os campos à pasta (pelo caminho atual). Devolve o `reverter`. */
export function definirPastaOtimista(caminho: string, campos: CamposPasta): () => void {
  const proximo = new Map(mapa);
  proximo.set(caminho, campos);
  publicar(proximo);
  const reverter = () => {
    if (mapa.get(caminho) !== campos) return; // outra edição mais nova já tomou o lugar
    const atual = new Map(mapa);
    atual.delete(caminho);
    publicar(atual);
  };
  window.setTimeout(reverter, VALIDADE_MS);
  return reverter;
}

export const usePastasOtimistas = () => useSyncExternalStore(assinar, () => mapa);

/** "Vazio" é tudo o que o servidor devolve como ausente (nulo, texto vazio, zero, falso, lista vazia). */
const normalizar = (v: unknown): string => JSON.stringify(v === "" || v === 0 || v === false || (Array.isArray(v) && !v.length) ? null : v ?? null);

/** Sobrepõe os ajustes otimistas às pastas vindas do servidor. */
export function comPastasOtimistas<T extends PastaResumo>(pastas: readonly T[], sobrepostas: ReadonlyMap<string, CamposPasta>): readonly T[] {
  if (!sobrepostas.size) return pastas;
  return pastas.map((p) => (sobrepostas.has(p.caminho) ? { ...p, ...sobrepostas.get(p.caminho) } : p));
}

/** O servidor já diz o mesmo que a sobreposição: ela não é mais necessária. */
export function reconciliarPastasOtimistas(pastas: readonly PastaResumo[]) {
  if (!mapa.size) return;
  const proximo = new Map(mapa);
  let mudou = false;
  for (const p of pastas) {
    const campos = proximo.get(p.caminho);
    if (!campos) continue;
    if ((Object.keys(campos) as (keyof CamposPasta)[]).every((k) => normalizar(campos[k]) === normalizar(p[k]))) { proximo.delete(p.caminho); mudou = true; }
  }
  if (mudou) publicar(proximo);
}
