import { normalizarTexto } from "@/lib/texto-busca";

export interface NotaSugestao {
  id: string;
  titulo: string;
  pasta: string | null;
  tags: string[];
  atualizado_em: string;
  /** Ausente = nota (a lista local de reserva só tem notas). */
  tipo?: "nota" | "tarefa";
}

/**
 * Pontuação de uma Nota para o que foi digitado depois de `[[` (maior = melhor, `null` = não aparece).
 * Ignora acento, caixa e pontuação. Título que começa com a consulta vence palavra que começa com ela,
 * que vence trecho no meio, que vence letras espalhadas ("pjx" acha "Projeto X"); pasta e tags só desempatam por baixo.
 */
export function pontuar(consulta: string, nota: NotaSugestao): number | null {
  const q = normalizarTexto(consulta);
  if (!q) return 0;
  const titulo = normalizarTexto(nota.titulo);
  if (titulo === q) return 1000;
  if (titulo.startsWith(q)) return 800 - Math.min(titulo.length - q.length, 100);
  const palavras = q.split(" ");
  if (palavras.every((p) => titulo.split(" ").some((t) => t.startsWith(p)))) return 600;
  if (palavras.every((p) => titulo.includes(p))) return 450;
  if (subsequencia(q.replace(/ /g, ""), titulo.replace(/ /g, ""))) return 300;
  const contexto = normalizarTexto([nota.pasta ?? "", ...nota.tags].join(" "));
  if (palavras.every((p) => contexto.includes(p) || titulo.includes(p))) return 150;
  return null;
}

function subsequencia(q: string, alvo: string): boolean {
  let i = 0;
  for (const c of alvo) if (c === q[i] && ++i === q.length) return true;
  return q.length === 0;
}

/** Melhores Notas para a consulta; sem consulta, as editadas mais recentemente. A própria Nota fica de fora. */
export function sugerir(consulta: string, notas: NotaSugestao[], excluirId?: string, limite = 30): NotaSugestao[] {
  const pontuadas: { nota: NotaSugestao; pontos: number }[] = [];
  for (const nota of notas) {
    if (nota.id === excluirId) continue;
    const pontos = pontuar(consulta, nota);
    if (pontos !== null) pontuadas.push({ nota, pontos });
  }
  pontuadas.sort((a, b) => b.pontos - a.pontos || b.nota.atualizado_em.localeCompare(a.nota.atualizado_em));
  return pontuadas.slice(0, limite).map((p) => p.nota);
}

/** Já existe Nota com exatamente este título (sem diferenciar acento/caixa)? Então não se oferece "criar". */
export function tituloExiste(consulta: string, notas: NotaSugestao[]): boolean {
  const q = normalizarTexto(consulta);
  return notas.some((n) => normalizarTexto(n.titulo) === q);
}

// ---- Reserva local: lista de Notas em memória, usada quando o servidor ainda não tem as rotas de links ----

const POR_PAGINA = 100;
const MAX_PAGINAS = 20;
const VALIDADE_MS = 20_000;
let cache: { em: number; notas: NotaSugestao[] } | null = null;
let carregando: Promise<NotaSugestao[]> | null = null;

export async function carregarNotas(): Promise<NotaSugestao[]> {
  if (cache && Date.now() - cache.em < VALIDADE_MS) return cache.notas;
  carregando ??= (async () => {
    const { notas } = await import("@/lib/api");
    const todas: NotaSugestao[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < MAX_PAGINAS; i++) {
      const pagina = await notas.listar({ limit: POR_PAGINA, cursor });
      for (const n of pagina.items) todas.push({ id: n.id, titulo: n.titulo, pasta: n.pasta, tags: n.tags, atualizado_em: n.atualizado_em, tipo: "nota" });
      if (!pagina.next_cursor) break;
      cursor = pagina.next_cursor;
    }
    cache = { em: Date.now(), notas: todas };
    return todas;
  })().finally(() => { carregando = null; });
  return carregando;
}

export function invalidarSugestoesDeNotas() { cache = null; }
