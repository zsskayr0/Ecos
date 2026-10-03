import { normalizarTexto } from "@/lib/texto-busca";

export interface Cadastro {
  id: string;
  nome: string;
  /** Quantos lançamentos usam este cadastro (do servidor). */
  transacoes: number;
}

export interface GrupoSimilar {
  /** Id estável do grupo (ids ordenados), para "não é o mesmo" lembrar a decisão. */
  chave: string;
  membros: Cadastro[];
  /** Por que o Cofre acha que são o mesmo sacado. */
  motivo: "espacos" | "digitacao";
  /** Sugestão de cadastro que fica: o mais usado. */
  principal: Cadastro;
}

const SUFIXOS = new Set(["ltda", "me", "epp", "eireli", "mei", "sa", "s", "a", "cia", "co"]);

/** Nome sem acento, caixa, pontuação, espaços nem sufixo societário ("Mercado  Extra Ltda." → "mercadoextra"). */
export function chaveCompacta(nome: string): string {
  const palavras = normalizarTexto(nome).split(" ").filter(Boolean);
  while (palavras.length > 1 && SUFIXOS.has(palavras[palavras.length - 1]!)) palavras.pop();
  return palavras.join("");
}

/** Mesmas palavras em outra ordem ("Silva Maria" / "Maria Silva"). */
function chaveOrdenada(nome: string): string {
  return normalizarTexto(nome).split(" ").filter(Boolean).sort().join("");
}

export function distancia(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let anterior = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const atual = [i];
    for (let j = 1; j <= b.length; j++) {
      atual[j] = Math.min(anterior[j]! + 1, atual[j - 1]! + 1, anterior[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    anterior = atual;
  }
  return anterior[b.length]!;
}

/** `espacos`: o mesmo texto com espaços/pontuação/sufixo/ordem diferentes; `digitacao`: textos quase iguais; null: nada a ver. */
export function parecidos(a: string, b: string): GrupoSimilar["motivo"] | null {
  const ca = chaveCompacta(a), cb = chaveCompacta(b);
  if (!ca || !cb) return null;
  if (ca === cb || chaveOrdenada(a) === chaveOrdenada(b)) return "espacos";
  const menor = Math.min(ca.length, cb.length);
  if (menor < 5) return null;
  const d = distancia(ca, cb);
  // Até 1 erro em nomes curtos, 2 nos longos, e nunca mais de ~15% do texto.
  const limite = Math.min(menor >= 12 ? 2 : 1, Math.floor(menor * 0.15) || 1);
  return d <= limite ? "digitacao" : null;
}

/** Junta, por transitividade, os cadastros que parecem ser a mesma pessoa/empresa. Só devolve grupos com 2 ou mais. */
export function agruparSimilares(cadastros: Cadastro[]): GrupoSimilar[] {
  const pai = cadastros.map((_, i) => i);
  const raiz = (i: number): number => (pai[i] === i ? i : (pai[i] = raiz(pai[i]!)));
  const motivos = new Map<number, GrupoSimilar["motivo"]>();
  for (let i = 0; i < cadastros.length; i++) {
    for (let j = i + 1; j < cadastros.length; j++) {
      const m = parecidos(cadastros[i]!.nome, cadastros[j]!.nome);
      if (!m) continue;
      const ri = raiz(i), rj = raiz(j);
      if (ri !== rj) pai[rj] = ri;
      const r = raiz(i);
      // Um par só de espaços e outro de digitação: o grupo todo é "digitação" (a revisão pede mais atenção).
      motivos.set(r, motivos.get(r) === "digitacao" || m === "digitacao" ? "digitacao" : "espacos");
    }
  }
  const porRaiz = new Map<number, Cadastro[]>();
  cadastros.forEach((c, i) => { const r = raiz(i); porRaiz.set(r, [...(porRaiz.get(r) ?? []), c]); });
  const grupos: GrupoSimilar[] = [];
  for (const [r, membros] of porRaiz) {
    if (membros.length < 2) continue;
    const ordenados = [...membros].sort((a, b) => b.transacoes - a.transacoes || a.nome.localeCompare(b.nome, "pt-BR"));
    grupos.push({ chave: membros.map((m) => m.id).sort().join("|"), membros: ordenados, motivo: motivos.get(r) ?? "espacos", principal: ordenados[0]! });
  }
  return grupos.sort((a, b) => b.membros.reduce((s, m) => s + m.transacoes, 0) - a.membros.reduce((s, m) => s + m.transacoes, 0));
}
