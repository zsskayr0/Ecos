import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { vault, type CategoriaApi } from "@/lib/api";
import { caminhoCompleto } from "@/lib/categorias-hierarquia";

interface Sugestao { id: string; motivo: "pagador" | "descricao"; usos: number }

/**
 * Sugere a categoria que a pessoa mais usou com o mesmo pagador (ou a mesma descrição). Só aparece quando há histórico,
 * a categoria sugerida ainda existe e não está arquivada, e é diferente da que já está escolhida. Nunca aplica sozinha.
 */
export function SugestaoCategoria({ pagador, descricao, tipo, atual, categorias, aoUsar }: {
  pagador: string;
  descricao: string;
  tipo: "entrada" | "saida";
  atual: string | null | undefined;
  categorias: CategoriaApi[];
  aoUsar: (id: string) => void;
}) {
  const [sugestao, setSugestao] = useState<Sugestao | null>(null);
  const [dispensada, setDispensada] = useState<string | null>(null);

  useEffect(() => {
    const p = pagador.trim();
    const d = descricao.trim();
    if (p.length < 3 && d.length < 4) { setSugestao(null); return; }
    let vivo = true;
    // Espera a pessoa parar de digitar.
    const t = window.setTimeout(() => {
      vault.categorias.sugestao({ beneficiario: p.length >= 3 ? p : undefined, descricao: d.length >= 4 ? d : undefined, tipo })
        .then((r) => { if (vivo) setSugestao(r.categoria_id ? { id: r.categoria_id, motivo: r.motivo ?? "pagador", usos: r.usos ?? 0 } : null); })
        .catch(() => { if (vivo) setSugestao(null); });
    }, 600);
    return () => { vivo = false; window.clearTimeout(t); };
  }, [pagador, descricao, tipo]);

  const porId = new Map(categorias.map((c) => [c.id, c]));
  const alvo = sugestao ? porId.get(sugestao.id) : undefined;
  if (!sugestao || !alvo || alvo.arquivada || sugestao.id === atual || dispensada === sugestao.id) return null;
  return (
    <p className="cofre-sugestao" role="status">
      <Sparkles size={12} aria-hidden />
      <span>Costuma ser <b>{caminhoCompleto(alvo, porId)}</b> <small>({sugestao.usos}× {sugestao.motivo === "pagador" ? "com este pagador" : "com esta descrição"})</small></span>
      <button type="button" onClick={() => aoUsar(sugestao.id)}>Usar</button>
      <button type="button" className="cofre-sugestao-x" aria-label="Dispensar sugestão" onClick={() => setDispensada(sugestao.id)}>×</button>
    </p>
  );
}
