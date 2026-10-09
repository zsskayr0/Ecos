import { useState, type CSSProperties, type DragEvent } from "react";
import { GripVertical, Plus, Undo2 } from "lucide-react";
import type { CategoriaApi } from "@/lib/api";
import { formatMoeda } from "@/lib/format";
import { SegmentedSlide } from "@/components/common/SegmentedSlide";
import { CategoriaIcone } from "./icone";
import { AlcaOrdem } from "../ordem-pessoal";
import { USO_VAZIO, usoDaFamilia } from "./dados";
import type { ContextoVista } from "./contexto";
import { CaixaMarca, PilulaTipo, SeloArquivada, TIPO_ROTULO } from "./Vistas";

export type AgruparKanban = "mae" | "tipo";
const TIPOS: CategoriaApi["tipo"][] = ["saida", "entrada", "ambos"];
const PRINCIPAIS = "__principais__";

/**
 * Kanban de categorias. Em "Por categoria-mãe" cada coluna é uma categoria principal e os cartões são as suas
 * subcategorias: arrastar um cartão para outra coluna muda a mãe; arrastar o cabeçalho de uma coluna para outra
 * transforma a categoria em subcategoria; soltar na faixa "Tornar principal" desfaz a subcategoria.
 * Em "Por tipo" as colunas são Despesa / Receita / Ambas e soltar muda o tipo.
 */
export function VistaKanban({ v, agrupar, aoAgrupar }: { v: ContextoVista; agrupar: AgruparKanban; aoAgrupar: (a: AgruparKanban) => void }) {
  const [arrastado, setArrastado] = useState<{ id: string; coluna: boolean } | null>(null);
  const [sobre, setSobre] = useState<string | null>(null);

  const fim = () => { setArrastado(null); setSobre(null); };
  const iniciar = (id: string, coluna: boolean) => (e: DragEvent) => {
    e.stopPropagation();
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", id);
    setArrastado({ id, coluna });
  };
  const alvoDe = (colunaId: string) => ({
    "data-sobre": sobre === colunaId && arrastado ? "true" : undefined,
    onDragOver: (e: DragEvent) => { if (!arrastado) return; e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (sobre !== colunaId) setSobre(colunaId); },
    onDragLeave: (e: DragEvent) => { if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) setSobre((s) => (s === colunaId ? null : s)); },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      const a = arrastado;
      fim();
      if (!a) return;
      const cat = v.porId.get(a.id);
      if (!cat) return;
      if (agrupar === "tipo") { if (cat.tipo !== colunaId) void v.salvar(cat, { tipo: colunaId as CategoriaApi["tipo"] }); return; }
      const novaMae = colunaId === PRINCIPAIS ? null : colunaId;
      if ((cat.pai_id ?? null) !== novaMae && cat.id !== novaMae) void v.salvar(cat, { pai_id: novaMae });
    },
  });

  return (
    <div className="cofre-kb">
      <div className="cofre-kb-barra">
        <SegmentedSlide className="cofre-launch-slide" ariaLabel="Agrupar o kanban" value={agrupar} onChange={aoAgrupar} opcoes={[{ value: "mae", label: "Por categoria-mãe", cor: "cofre-blue" }, { value: "tipo", label: "Por tipo", cor: "cofre-blue" }]} />
        <p>{agrupar === "mae" ? "Arraste um cartão para outra coluna para trocar a categoria-mãe." : "Arraste uma categoria para outra coluna para mudar o tipo."}</p>
      </div>
      <div className="cofre-kb-colunas" onDragEnd={fim}>
        {agrupar === "tipo"
          ? TIPOS.map((t) => {
              const cats = v.familias.map((f) => f.mae).filter((c) => c.tipo === t);
              return (
                <section key={t} className="cofre-kb-coluna" data-tipo={t} aria-label={`Categorias do tipo ${TIPO_ROTULO[t]}`} {...alvoDe(t)}>
                  <header><b>{TIPO_ROTULO[t]}</b><span>{cats.length}</span></header>
                  <div className="cofre-kb-cartoes">
                    {cats.map((c) => <Cartao key={c.id} c={c} v={v} comSubs onIniciar={iniciar(c.id, false)} arrastando={arrastado?.id === c.id} />)}
                    {cats.length === 0 && <p className="cofre-kb-vazio">Solte aqui para mudar o tipo.</p>}
                  </div>
                </section>
              );
            })
          : (
            <>
              {v.familias.map((f) => (
                <section key={f.mae.id} className="cofre-kb-coluna" aria-label={`Subcategorias de ${f.mae.nome}`} {...alvoDe(f.mae.id)} style={{ "--cat": f.mae.cor } as CSSProperties}>
                  <header draggable onDragStart={iniciar(f.mae.id, true)} title="Arraste para a coluna de outra categoria para torná-la subcategoria dela">
                    <GripVertical size={13} className="cofre-kb-grip" aria-hidden />
                    <CategoriaIcone categoria={f.mae} tamanho={12} className="cofre-cats-icon sm" />
                    <button type="button" className="cofre-kb-nome" onClick={() => v.abrir(f.mae)} title={f.mae.nome}>{f.mae.nome}</button>
                    <span>{f.filhas.length}</span>
                    <button type="button" className="cofre-kb-add" aria-label={`Nova subcategoria em ${f.mae.nome}`} onClick={() => v.novaSub(f.mae)}><Plus size={13} /></button>
                  </header>
                  <p className="cofre-kb-meta cofre-mono">{formatMoeda(usoDaFamilia(f, v.usos).volume)} · {usoDaFamilia(f, v.usos).count} lanç.</p>
                  <div className="cofre-kb-cartoes">
                    {f.filhas.map((s) => <Cartao key={s.id} c={s} v={v} onIniciar={iniciar(s.id, false)} arrastando={arrastado?.id === s.id} />)}
                    {f.filhas.length === 0 && <p className="cofre-kb-vazio">Solte uma categoria aqui para torná-la subcategoria.</p>}
                  </div>
                </section>
              ))}
              <section className="cofre-kb-coluna principal" aria-label="Tornar principal" {...alvoDe(PRINCIPAIS)}>
                <header><Undo2 size={13} /><b>Tornar principal</b></header>
                <div className="cofre-kb-cartoes"><p className="cofre-kb-vazio">Solte uma subcategoria aqui para que ela volte a ser uma categoria principal.</p></div>
              </section>
            </>
          )}
      </div>
    </div>
  );
}

function Cartao({ c, v, comSubs, onIniciar, arrastando }: { c: CategoriaApi; v: ContextoVista; comSubs?: boolean; onIniciar: (e: DragEvent) => void; arrastando: boolean }) {
  const uso = v.usos.get(c.id) ?? USO_VAZIO;
  const filhas = comSubs ? v.familias.find((f) => f.mae.id === c.id)?.filhas ?? [] : [];
  return (
    <div className="cofre-kb-cartao" role="button" tabIndex={0} draggable onDragStart={onIniciar} data-arrastando={arrastando || undefined} data-ordem-linha {...v.ordem.linha(c.id)} style={{ "--cat": c.cor } as CSSProperties}
      data-marcada={v.selecao.marcadas.has(c.id) || undefined} data-arquivada={c.arquivada || undefined} aria-label={`Abrir ${c.nome}`} onClick={() => v.abrir(c)} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); v.abrir(c); } }}>
      <CaixaMarca v={v} id={c.id} nome={c.nome} />
      <AlcaOrdem nome={c.nome} desativada={!v.ordenavel} {...v.ordem.alca(c.id)} />
      <CategoriaIcone categoria={c} tamanho={12} className="cofre-cats-icon sm" />
      <span className="cofre-kb-cartao-main">
        <b title={c.nome}>{c.nome}{c.arquivada && <> <SeloArquivada /></>}</b>
        <small className="cofre-mono">{uso.count} lanç. · {formatMoeda(uso.volume)}</small>
        {filhas.length > 0 && <small>{filhas.length} {filhas.length === 1 ? "subcategoria" : "subcategorias"}</small>}
      </span>
      {!comSubs && <PilulaTipo tipo={c.tipo} />}
    </div>
  );
}
