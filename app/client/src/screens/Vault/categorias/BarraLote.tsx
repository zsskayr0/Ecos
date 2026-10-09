import { Archive, ArchiveRestore, GitMerge, X } from "lucide-react";
import type { CategoriaApi } from "@/lib/api";
import { SeletorEcos } from "@/components/common/SeletorEcos";
import { maesPossiveis } from "@/lib/categorias-hierarquia";
import { CategoriaIcone } from "./icone";
import { TIPO_ROTULO } from "./Vistas";

/** Barra fixa de ações para o que está selecionado (vale para todas as vistas). */
export function BarraLote({ selecionadas, todas, aoMover, aoTipo, aoArquivar, aoMesclar, aoLimpar }: {
  selecionadas: CategoriaApi[];
  todas: CategoriaApi[];
  aoMover: (paiId: string | null) => void;
  aoTipo: (tipo: CategoriaApi["tipo"]) => void;
  aoArquivar: (arquivar: boolean) => void;
  aoMesclar: () => void;
  aoLimpar: () => void;
}) {
  if (selecionadas.length === 0) return null;
  const ids = new Set(selecionadas.map((c) => c.id));
  // Mães possíveis: principais fora da seleção. Quem tem filhas não pode virar subcategoria, então só aparece "Tornar principais" para elas.
  const algumaTemFilhas = selecionadas.some((c) => todas.some((x) => x.pai_id === c.id));
  const maes = algumaTemFilhas ? [] : maesPossiveis(todas, {}).filter((m) => !ids.has(m.id) && !m.arquivada);
  const todasArquivadas = selecionadas.every((c) => c.arquivada);
  const estilo = "min-h-[36px] max-w-full rounded-[10px] border border-[var(--border)] bg-[var(--panel)] px-2.5 text-[12px] text-[var(--text)]";
  return (
    <div className="cofre-lote" role="region" aria-label="Ações para as categorias selecionadas">
      <b>{selecionadas.length} selecionada{selecionadas.length > 1 ? "s" : ""}</b>
      <SeletorEcos buscar larguraMin={440} ariaLabel="Mover para" classe={estilo} valor="" onChange={(id) => { if (id === "__principal__") aoMover(null); else if (id) aoMover(id); }}
        opcoes={[{ valor: "", rotulo: "Mover para…" }, { valor: "__principal__", rotulo: "Tornar categorias principais" }, ...maes.map((m) => ({ valor: m.id, rotulo: `Subcategoria de ${m.nome}`, visual: <CategoriaIcone categoria={m} tamanho={11} className="cofre-cats-icon sm" /> }))]} />
      <SeletorEcos ariaLabel="Alterar tipo" classe={estilo} valor="" onChange={(t) => { if (t) aoTipo(t as CategoriaApi["tipo"]); }}
        opcoes={[{ valor: "", rotulo: "Alterar tipo…" }, ...(["saida", "entrada", "ambos"] as const).map((t) => ({ valor: t, rotulo: TIPO_ROTULO[t] }))]} />
      <button type="button" className="cofre-secondary" onClick={() => aoArquivar(!todasArquivadas)}>{todasArquivadas ? <><ArchiveRestore size={13} />Desarquivar</> : <><Archive size={13} />Arquivar</>}</button>
      <button type="button" className="cofre-secondary" onClick={aoMesclar}><GitMerge size={13} />Mesclar…</button>
      <button type="button" className="cofre-cats-iconbtn" aria-label="Limpar seleção" title="Limpar seleção (Esc)" onClick={aoLimpar}><X size={15} /></button>
    </div>
  );
}
