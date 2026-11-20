/**
 * Modo de visualização da nota no celular: Fluido (o texto reflui, fonte confortável) ou Página (coluna A4 reduzida, com zoom).
 * O padrão vem das configurações; trocar numa nota vale só por um tempo (as notas voltam ao padrão depois disso).
 */
import { lerPreferenciasAplicativo } from "./preferencias-aplicativo";

export type ModoVisualNota = "fluido" | "pagina";
/** Quanto tempo, depois da troca (ou da última vez que a nota foi fechada), a escolha daquela nota ainda vale. */
export const VALIDADE_MODO_NOTA_MS = 2 * 60 * 1000;
/** Leitura e edição têm padrões e escolhas separados. */
export type ContextoModoNota = "leitura" | "edicao";
const PREFIXO = "ecos.nota-modo.";
const chave = (notaId: string, contexto: ContextoModoNota) => `${PREFIXO}${contexto}.${notaId}`;

interface Escolha { modo: ModoVisualNota; em: number }

function lerEscolhaDaChave(k: string): Escolha | null {
  try {
    const v = JSON.parse(localStorage.getItem(k) ?? "null") as Partial<Escolha> | null;
    if (v && (v.modo === "fluido" || v.modo === "pagina") && typeof v.em === "number") return { modo: v.modo, em: v.em };
  } catch { /* sem armazenamento: vale o padrão */ }
  return null;
}

/** Modo com que a nota deve abrir agora: a escolha recente dela, se ainda valer, ou o padrão das configurações. */
export function modoInicialDaNota(notaId: string | undefined, contexto: ContextoModoNota, agora = Date.now()): ModoVisualNota {
  const prefs = lerPreferenciasAplicativo();
  const padrao = contexto === "leitura" ? prefs.notaModoLeitura : prefs.notaModoEdicao;
  if (!notaId) return padrao;
  const e = lerEscolhaDaChave(chave(notaId, contexto));
  return e && agora - e.em < VALIDADE_MODO_NOTA_MS ? e.modo : padrao;
}

/** Guarda a troca feita pelo usuário nesta nota (e limpa as escolhas antigas que já expiraram). */
export function lembrarModoDaNota(notaId: string, contexto: ContextoModoNota, modo: ModoVisualNota, agora = Date.now()) {
  try {
    localStorage.setItem(chave(notaId, contexto), JSON.stringify({ modo, em: agora } satisfies Escolha));
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (!k?.startsWith(PREFIXO) || k === chave(notaId, contexto)) continue;
      const e = lerEscolhaDaChave(k);
      if (!e || agora - e.em >= VALIDADE_MODO_NOTA_MS) localStorage.removeItem(k);
    }
  } catch { /* ignora */ }
}

/** Ao sair da nota o prazo recomeça: reabrir logo em seguida mantém o modo escolhido. */
export function renovarModoDaNota(notaId: string, contexto: ContextoModoNota, agora = Date.now()) {
  const e = lerEscolhaDaChave(chave(notaId, contexto));
  if (e && agora - e.em < VALIDADE_MODO_NOTA_MS) lembrarModoDaNota(notaId, contexto, e.modo, agora);
}
