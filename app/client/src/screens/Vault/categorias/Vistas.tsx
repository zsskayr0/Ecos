import { useMemo, useState, type CSSProperties } from "react";
import { ChevronRight, CornerDownRight, Plus, Tag } from "lucide-react";
import type { CategoriaApi } from "@/lib/api";
import { formatMoeda } from "@/lib/format";
import { CategoriaIcone, corDoTexto } from "./icone";
import { AlcaOrdem } from "../ordem-pessoal";
import { somarSeries, treemap, USO_VAZIO, usoDaFamilia, type Familia } from "./dados";
import { Sparkline, variacaoUltimoMes } from "./Sparkline";
import type { ContextoVista } from "./contexto";

export const TIPO_ROTULO: Record<CategoriaApi["tipo"], string> = { saida: "Despesa", entrada: "Receita", ambos: "Ambas" };
const estiloI = (i: number) => ({ "--i": Math.min(i, 14) }) as CSSProperties;
const dataCurta = (iso: string | null) => (iso ? iso.split("-").reverse().slice(0, 2).join("/") : "—");
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

export function PilulaTipo({ tipo }: { tipo: CategoriaApi["tipo"] }) {
  return <span className="cofre-cv-tipo" data-tipo={tipo}>{TIPO_ROTULO[tipo]}</span>;
}

/** Caixa de seleção das vistas: aparece ao passar o mouse e fica à mostra assim que há algo selecionado. */
export function CaixaMarca({ v, id, nome }: { v: ContextoVista; id: string; nome: string }) {
  const marcada = v.selecao.marcadas.has(id);
  return <input type="checkbox" className="cofre-cv-marca" data-visivel={v.selecao.ativa || marcada || undefined} checked={marcada} aria-label={`Selecionar ${nome}`} onChange={() => v.selecao.alternar(id)} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} />;
}

export function SeloArquivada() {
  return <em className="cofre-cv-arquivada">Arquivada</em>;
}

function Tendencia({ v, ids, cor }: { v: ContextoVista; ids: string[]; cor: string }) {
  const serie = somarSeries(v.tendencia, ids, v.meses.length);
  const vari = variacaoUltimoMes(serie);
  return (
    <div className="cofre-cv-tendencia" data-carregando={v.tendencia === null || undefined}>
      <Sparkline valores={serie} cor={cor} />
      <span className="cofre-mono" data-sobe={vari === null ? undefined : vari > 0}>{vari === null ? "—" : `${vari > 0 ? "+" : ""}${vari.toFixed(0)}%`}</span>
    </div>
  );
}

function Vazio({ texto }: { texto: string }) {
  return <div className="cofre-card cofre-cats-empty"><Tag size={26} /><p>{texto}</p></div>;
}

/** Teclado: Enter/Espaço no cartão abre a edição (sem roubar a tecla dos controles de dentro dele). */
const abrirComTeclado = (abrir: () => void) => (e: React.KeyboardEvent) => {
  if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); abrir(); }
};

// ───────────────────────────── Grade ─────────────────────────────

export function VistaGrade({ v }: { v: ContextoVista }) {
  if (v.familias.length === 0) return <Vazio texto="Nenhuma categoria encontrada." />;
  return (
    <div className="cofre-cv-grade">
      {v.familias.map((f, i) => <CartaoGrade key={f.mae.id} f={f} v={v} i={i} />)}
    </div>
  );
}

function CartaoGrade({ f, v, i }: { f: Familia; v: ContextoVista; i: number }) {
  const { mae, filhas } = f;
  const uso = usoDaFamilia(f, v.usos);
  const share = v.volumeTotal > 0 ? (uso.volume / v.volumeTotal) * 100 : 0;
  return (
    <article className="cofre-card cofre-cv-card cofre-rise" role="button" tabIndex={0} aria-label={`Editar categoria ${mae.nome}`} data-ordem-linha style={{ ...estiloI(i), "--cat": mae.cor } as CSSProperties}
      data-marcada={v.selecao.marcadas.has(mae.id) || undefined} data-arquivada={mae.arquivada || undefined}
      {...v.ordem.linha(mae.id, "x")} onClick={() => v.abrir(mae)} onKeyDown={abrirComTeclado(() => v.abrir(mae))}>
      <header>
        <CaixaMarca v={v} id={mae.id} nome={mae.nome} />
        <AlcaOrdem nome={mae.nome} desativada={!v.ordenavel} {...v.ordem.alca(mae.id)} />
        <CategoriaIcone categoria={mae} tamanho={18} className="cofre-cats-icon lg" />
        <span className="cofre-cv-titulo"><b title={mae.nome}>{mae.nome}</b><span className="cofre-cv-selos"><PilulaTipo tipo={mae.tipo} />{mae.arquivada && <SeloArquivada />}</span></span>
        <button type="button" className="cofre-cv-mais" aria-label={`Nova subcategoria em ${mae.nome}`} title="Nova subcategoria" onClick={(e) => { e.stopPropagation(); v.novaSub(mae); }}><Plus size={14} /></button>
      </header>
      <dl className="cofre-cv-numeros">
        <div><dt>Lançamentos</dt><dd className="cofre-mono">{uso.count}</dd></div>
        <div><dt>Volume</dt><dd className="cofre-mono">{formatMoeda(uso.volume)}</dd></div>
      </dl>
      <Tendencia v={v} ids={[mae.id, ...filhas.map((f) => f.id)]} cor={mae.cor} />
      <i className="cofre-cats-bar" title={`${share.toFixed(1)}% do movimento do período`}><u className="cofre-grow" style={{ width: `${Math.max(uso.volume > 0 ? 3 : 0, share)}%`, background: mae.cor }} /></i>
      {v.mostrarSubs && (
        <ul className="cofre-cv-subs" aria-label={`Subcategorias de ${mae.nome}`}>
          {filhas.map((s) => (
            <li key={s.id}>
              <span className="cofre-cv-chip" role="button" tabIndex={0} aria-label={`Editar subcategoria ${s.nome}`} data-ordem-linha style={{ "--cat": s.cor } as CSSProperties} {...v.ordem.linha(s.id, "x")}
                onClick={(e) => { e.stopPropagation(); v.abrir(s); }} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); e.stopPropagation(); v.abrir(s); } }}>
                <AlcaOrdem nome={s.nome} desativada={!v.ordenavel} {...v.ordem.alca(s.id)} />
                <i style={{ background: s.cor }} aria-hidden />
                <span title={s.nome}>{s.nome}</span>
                <small className="cofre-mono">{v.usos.get(s.id)?.count ?? 0}</small>
              </span>
            </li>
          ))}
          <li><button type="button" className="cofre-cv-chip nova" onClick={(e) => { e.stopPropagation(); v.novaSub(mae); }}><Plus size={11} />Subcategoria</button></li>
        </ul>
      )}
      {!v.mostrarSubs && filhas.length > 0 && <p className="cofre-cv-resumo-subs">{plural(filhas.length, "subcategoria", "subcategorias")}</p>}
    </article>
  );
}

// ───────────────────────────── Lista ─────────────────────────────

export function VistaLista({ v }: { v: ContextoVista }) {
  const [recolhidas, setRecolhidas] = useState<Set<string>>(new Set());
  if (v.familias.length === 0) return <Vazio texto="Nenhuma categoria encontrada." />;
  const alternar = (id: string) => setRecolhidas((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <div className="cofre-card cofre-cv-lista" role="list">
      <div className="cofre-cv-lista-cab" aria-hidden><span /><span>Categoria</span><span>Tipo</span><span className="num">Lançamentos</span><span className="num cofre-cv-col-es">Entradas</span><span className="num cofre-cv-col-es">Saídas</span><span className="num cofre-cv-col-tend">Tendência</span><span className="num">Volume</span></div>
      {v.familias.map((f) => {
        const aberta = v.mostrarSubs && !recolhidas.has(f.mae.id);
        return (
          <div key={f.mae.id} className="cofre-cv-familia" role="listitem">
            <LinhaLista c={f.mae} v={v} filhas={v.mostrarSubs ? f.filhas.length : 0} aberta={aberta} aoAlternar={() => alternar(f.mae.id)} uso={usoDaFamilia(f, v.usos)} />
            {aberta && f.filhas.map((s) => <LinhaLista key={s.id} c={s} v={v} sub />)}
          </div>
        );
      })}
    </div>
  );
}

function LinhaLista({ c, v, sub, filhas = 0, aberta, aoAlternar, uso: usoFamilia }: { c: CategoriaApi; v: ContextoVista; sub?: boolean; filhas?: number; aberta?: boolean; aoAlternar?: () => void; uso?: ReturnType<typeof usoDaFamilia> }) {
  const uso = usoFamilia ?? v.usos.get(c.id) ?? USO_VAZIO;
  const share = v.volumeTotal > 0 ? (uso.volume / v.volumeTotal) * 100 : 0;
  return (
    <div className="cofre-cv-linha" data-sub={sub || undefined} role="button" tabIndex={0} aria-label={`Editar ${sub ? "subcategoria" : "categoria"} ${c.nome}`} data-ordem-linha data-marcada={v.selecao.marcadas.has(c.id) || undefined} data-arquivada={c.arquivada || undefined} {...v.ordem.linha(c.id)} onClick={() => v.abrir(c)} onKeyDown={abrirComTeclado(() => v.abrir(c))}>
      <span className="cofre-cv-linha-ini">
        <CaixaMarca v={v} id={c.id} nome={c.nome} />
        <AlcaOrdem nome={c.nome} desativada={!v.ordenavel} {...v.ordem.alca(c.id)} />
        {filhas > 0
          ? <button type="button" className="cofre-cv-seta" aria-expanded={aberta} aria-label={`${aberta ? "Recolher" : "Expandir"} subcategorias de ${c.nome}`} data-aberta={aberta || undefined} onClick={(e) => { e.stopPropagation(); aoAlternar?.(); }}><ChevronRight size={14} /></button>
          : <span className="cofre-cv-seta vazio" aria-hidden />}
      </span>
      <span className="cofre-cv-linha-nome">
        {sub && <CornerDownRight size={13} className="cofre-cv-recuo" aria-hidden />}
        <CategoriaIcone categoria={c} tamanho={sub ? 12 : 14} className={`cofre-cats-icon ${sub ? "sm" : ""}`} />
        <b title={c.nome}>{c.nome}</b>
        {filhas > 0 && <em>{filhas} sub</em>}
        {c.arquivada && <SeloArquivada />}
      </span>
      <PilulaTipo tipo={c.tipo} />
      <span className="num cofre-mono">{uso.count}</span>
      <span className="num cofre-mono cofre-cv-col-es" data-tipo="entrada">{uso.entradas ? formatMoeda(uso.entradas) : "—"}</span>
      <span className="num cofre-mono cofre-cv-col-es" data-tipo="saida">{uso.saidas ? formatMoeda(uso.saidas) : "—"}</span>
      <span className="num cofre-cv-col-tend"><Tendencia v={v} ids={filhas > 0 ? [c.id, ...(v.familias.find((f) => f.mae.id === c.id)?.filhas.map((x) => x.id) ?? [])] : [c.id]} cor={c.cor} /></span>
      <span className="num cofre-cv-volume"><b className="cofre-mono">{uso.volume ? formatMoeda(uso.volume) : "—"}</b><i className="cofre-cats-bar"><u style={{ width: `${share}%`, background: c.cor }} /></i></span>
    </div>
  );
}

// ───────────────────────────── Nuvem ─────────────────────────────

export function VistaNuvem({ v }: { v: ContextoVista }) {
  const itens = useMemo(() => v.familias.flatMap((f) => [f.mae, ...(v.mostrarSubs ? f.filhas : [])]), [v.familias, v.mostrarSubs]);
  if (itens.length === 0) return <Vazio texto="Nenhuma categoria encontrada." />;
  const max = Math.max(1, ...itens.map((c) => v.usos.get(c.id)?.count ?? 0));
  return (
    <div className="cofre-card cofre-cv-nuvem">
      {itens.map((c, i) => {
        const n = v.usos.get(c.id)?.count ?? 0;
        const tam = 12 + Math.round(Math.sqrt(n / max) * 20);
        const mae = c.pai_id ? v.porId.get(c.pai_id) : undefined;
        return (
          <button key={c.id} type="button" className="cofre-cv-bolha cofre-rise" style={{ ...estiloI(i), fontSize: tam, "--cat": c.cor } as CSSProperties} onClick={() => v.abrir(c)}
            title={`${mae ? `${mae.nome} › ` : ""}${c.nome} · ${plural(n, "lançamento", "lançamentos")}`}>
            <i style={{ background: c.cor }} aria-hidden />{c.nome}<small className="cofre-mono">{n}</small>
          </button>
        );
      })}
    </div>
  );
}

// ───────────────────────────── Mapa de blocos ─────────────────────────────

const LARGURA = 200;
const ALTURA = 100;

export function VistaMapa({ v }: { v: ContextoVista }) {
  const [sobre, setSobre] = useState<string | null>(null);
  const blocos = useMemo(() => {
    const maes = treemap(v.familias.map((f) => ({ id: f.mae.id, valor: usoDaFamilia(f, v.usos).volume })), 0, 0, LARGURA, ALTURA);
    return maes.map((b) => {
      const f = v.familias.find((x) => x.mae.id === b.id)!;
      const proprio = v.usos.get(f.mae.id)?.volume ?? 0;
      const itens = v.mostrarSubs && f.filhas.length > 0
        ? [...(proprio > 0 ? [{ id: f.mae.id, valor: proprio }] : []), ...f.filhas.map((s) => ({ id: s.id, valor: v.usos.get(s.id)?.volume ?? 0 }))]
        : [{ id: f.mae.id, valor: b.valor }];
      return { ...b, f, filhos: treemap(itens, 0, 0, b.w, b.h) };
    });
  }, [v.familias, v.usos, v.mostrarSubs]);
  const semMovimento = v.familias.filter((f) => usoDaFamilia(f, v.usos).volume === 0);
  if (v.familias.length === 0) return <Vazio texto="Nenhuma categoria encontrada." />;
  if (blocos.length === 0) return <Vazio texto="Sem movimento neste período para desenhar o mapa." />;
  return (
    <div className="cofre-cv-mapa-caixa">
      <div className="cofre-cv-mapa" role="group" aria-label="Mapa de blocos: a área de cada bloco é o volume movimentado">
        {blocos.map((b) => (
          <div key={b.id} className="cofre-cv-bloco-mae" style={{ left: `${(b.x / LARGURA) * 100}%`, top: `${(b.y / ALTURA) * 100}%`, width: `${(b.w / LARGURA) * 100}%`, height: `${(b.h / ALTURA) * 100}%` }}>
            <div className="cofre-cv-bloco-int">
              <span className="cofre-cv-bloco-nome" title={b.f.mae.nome}>{b.f.mae.nome}</span>
              <div className="cofre-cv-bloco-filhos">
                {b.filhos.map((c) => {
                  const cat = v.porId.get(c.id)!;
                  const rotulo = cat.id === b.f.mae.id && b.filhos.length > 1 ? `${cat.nome} (direto)` : cat.nome;
                  return (
                    <button key={c.id} type="button" className="cofre-cv-bloco" data-sobre={sobre === c.id || undefined} style={{ left: `${(c.x / b.w) * 100}%`, top: `${(c.y / b.h) * 100}%`, width: `${(c.w / b.w) * 100}%`, height: `${(c.h / b.h) * 100}%`, background: cat.cor, color: corDoTexto(cat.cor) }}
                      onClick={() => v.abrir(cat)} onMouseEnter={() => setSobre(c.id)} onMouseLeave={() => setSobre(null)} onFocus={() => setSobre(c.id)} onBlur={() => setSobre(null)}
                      title={`${rotulo} · ${formatMoeda(c.valor)} · ${plural(v.usos.get(c.id)?.count ?? 0, "lançamento", "lançamentos")}`}>
                      <b>{rotulo}</b><small className="cofre-mono">{formatMoeda(c.valor)}</small>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        ))}
      </div>
      {semMovimento.length > 0 && <p className="cofre-cv-mapa-nota">Sem movimento no período: {semMovimento.map((f) => f.mae.nome).join(", ")}.</p>}
    </div>
  );
}
