import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Archive, ArchiveRestore, ExternalLink, GitMerge, Pencil, Plus, X } from "lucide-react";
import { vault, type CategoriaApi, type TransacaoApi } from "@/lib/api";
import { formatMoeda } from "@/lib/format";
import { caminhoCompleto } from "@/lib/categorias-hierarquia";
import { CategoriaIcone } from "./icone";
import { Sparkline, variacaoUltimoMes } from "./Sparkline";
import { somarSeries, USO_VAZIO, usoPorCategoria } from "./dados";
import { PilulaTipo } from "./Vistas";
import type { ContextoVista } from "./contexto";

const ROTULO_MES = (m: string) => new Date(`${m}-01T12:00:00`).toLocaleDateString("pt-BR", { month: "short" }).replace(".", "");
const dataBr = (iso: string) => iso.split("-").reverse().join("/");

/** Painel lateral com tudo de uma categoria: números do período, tendência, subcategorias, pagadores, últimos lançamentos e recorrências. */
export function DetalheCategoria({ categoria, v, lancamentos, recorrencias, aoFechar, aoEditar, aoNovaSub, aoMesclar, aoArquivar, aoVerLancamentos }: {
  categoria: CategoriaApi;
  v: ContextoVista;
  /** Lançamentos do período da tela. */
  lancamentos: TransacaoApi[];
  recorrencias: { id: string; descricao: string; tipo: string; valor_centavos: number; ativa: boolean; categoria_id?: string | null }[];
  aoFechar: () => void;
  aoEditar: () => void;
  aoNovaSub: () => void;
  aoMesclar: () => void;
  aoArquivar: () => void;
  aoVerLancamentos: (comSubs: boolean) => void;
}) {
  const [pagadores, setPagadores] = useState<Map<string, string>>(new Map());
  const filhas = useMemo(() => v.todas.filter((c) => c.pai_id === categoria.id), [v.todas, categoria.id]);
  const ids = useMemo(() => [categoria.id, ...filhas.map((f) => f.id)], [categoria.id, filhas]);
  const idSet = useMemo(() => new Set(ids), [ids]);
  const propriosDaFamilia = useMemo(() => lancamentos.filter((t) => t.categoria_id && idSet.has(t.categoria_id)), [lancamentos, idSet]);
  const usoFamilia = useMemo(() => [...usoPorCategoria(propriosDaFamilia).values()].reduce((s, u) => ({ count: s.count + u.count, entradas: s.entradas + u.entradas, saidas: s.saidas + u.saidas, volume: s.volume + u.volume, ultimo: s.ultimo && u.ultimo ? (s.ultimo > u.ultimo ? s.ultimo : u.ultimo) : s.ultimo ?? u.ultimo }), USO_VAZIO), [propriosDaFamilia]);
  const serie = somarSeries(v.tendencia, ids, v.meses.length);
  const vari = variacaoUltimoMes(serie);
  const maxSerie = Math.max(1, ...serie);
  const mae = categoria.pai_id ? v.porId.get(categoria.pai_id) : undefined;

  useEffect(() => {
    let vivo = true;
    vault.beneficiarios.listar().then((l) => { if (vivo) setPagadores(new Map(l.map((b) => [b.id, b.nome]))); }).catch(() => {});
    // Com o modal de edição (ou outro) por cima, o Esc fecha só ele.
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape" && !document.querySelector(".cofre-cats-modal")) aoFechar(); };
    window.addEventListener("keydown", tecla);
    return () => { vivo = false; window.removeEventListener("keydown", tecla); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const topPagadores = useMemo(() => {
    const soma = new Map<string, { total: number; n: number }>();
    for (const t of propriosDaFamilia) { const k = t.beneficiario_id ?? ""; const x = soma.get(k) ?? { total: 0, n: 0 }; x.total += t.valor_centavos; x.n++; soma.set(k, x); }
    return [...soma.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 5);
  }, [propriosDaFamilia]);
  const recentes = useMemo(() => [...propriosDaFamilia].sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : 0)).slice(0, 6), [propriosDaFamilia]);
  const recs = recorrencias.filter((r) => r.ativa && r.categoria_id && idSet.has(r.categoria_id));
  const ticket = usoFamilia.count ? Math.round(usoFamilia.volume / usoFamilia.count) : 0;
  const maxPag = Math.max(1, ...topPagadores.map(([, x]) => x.total));
  const destino = document.querySelector<HTMLElement>(".cofre-app") ?? document.body;

  return createPortal(
    <div className="cofre-cd-wrap">
      <div className="cofre-cd-fundo" onClick={aoFechar} />
      <aside className="cofre-cd" role="dialog" aria-modal="true" aria-label={`Detalhes de ${categoria.nome}`} style={{ "--cat": categoria.cor } as React.CSSProperties}>
        <header>
          <CategoriaIcone categoria={categoria} tamanho={20} className="cofre-cats-icon lg" />
          <div className="cofre-cd-titulo">
            <p>{mae ? `SUBCATEGORIA DE ${mae.nome.toUpperCase()}` : "CATEGORIA"}</p>
            <h2 title={caminhoCompleto(categoria, v.porId)}>{categoria.nome}</h2>
            <span><PilulaTipo tipo={categoria.tipo} />{categoria.arquivada && <em className="cofre-cv-arquivada">Arquivada</em>}</span>
          </div>
          <button type="button" className="cofre-cats-iconbtn cofre-cats-fechar" aria-label="Fechar" onClick={aoFechar}><X size={18} /></button>
        </header>

        <div className="cofre-cd-acoes">
          <button type="button" className="cofre-secondary" onClick={aoEditar}><Pencil size={13} />Editar</button>
          {!categoria.pai_id && <button type="button" className="cofre-secondary" onClick={aoNovaSub}><Plus size={13} />Subcategoria</button>}
          <button type="button" className="cofre-secondary" onClick={aoMesclar}><GitMerge size={13} />Mesclar…</button>
          <button type="button" className="cofre-secondary" onClick={aoArquivar}>{categoria.arquivada ? <><ArchiveRestore size={13} />Desarquivar</> : <><Archive size={13} />Arquivar</>}</button>
        </div>

        <div className="cofre-cd-corpo">
          <dl className="cofre-cd-numeros">
            <div><dt>Lançamentos</dt><dd className="cofre-mono">{usoFamilia.count}</dd></div>
            <div><dt>Volume</dt><dd className="cofre-mono">{formatMoeda(usoFamilia.volume)}</dd></div>
            <div><dt>Ticket médio</dt><dd className="cofre-mono">{usoFamilia.count ? formatMoeda(ticket) : "—"}</dd></div>
            <div><dt>Último uso</dt><dd className="cofre-mono">{usoFamilia.ultimo ? dataBr(usoFamilia.ultimo) : "—"}</dd></div>
            {usoFamilia.entradas > 0 && <div><dt>Entradas</dt><dd className="cofre-mono" data-tipo="entrada">{formatMoeda(usoFamilia.entradas)}</dd></div>}
            {usoFamilia.saidas > 0 && <div><dt>Saídas</dt><dd className="cofre-mono" data-tipo="saida">{formatMoeda(usoFamilia.saidas)}</dd></div>}
          </dl>
          {filhas.length > 0 && <p className="cofre-cats-nota">Os números somam a categoria e as {filhas.length} subcategorias.</p>}

          <section className="cofre-cd-secao">
            <h3>Tendência <small>últimos {v.meses.length} meses{vari !== null && <> · <b className="cofre-mono" data-sobe={vari > 0}>{vari > 0 ? "+" : ""}{vari.toFixed(0)}% no último mês</b></>}</small></h3>
            {v.tendencia === null ? <p className="cofre-cats-none">Carregando…</p> : (
              <div className="cofre-cd-barras" role="img" aria-label="Volume por mês">
                {serie.map((valor, i) => (
                  <div key={v.meses[i]} title={`${ROTULO_MES(v.meses[i]!)}: ${formatMoeda(valor)}`}>
                    <i style={{ height: `${Math.max(valor > 0 ? 6 : 2, (valor / maxSerie) * 100)}%`, background: categoria.cor, opacity: i === serie.length - 1 ? 1 : 0.55 }} />
                    <span>{ROTULO_MES(v.meses[i]!)}</span>
                  </div>
                ))}
              </div>
            )}
            <Sparkline valores={serie} cor={categoria.cor} largura={420} altura={34} />
          </section>

          {filhas.length > 0 && (
            <section className="cofre-cd-secao">
              <h3>Subcategorias</h3>
              <ul className="cofre-cd-lista">
                {filhas.map((f) => (
                  <li key={f.id}>
                    <button type="button" onClick={() => v.abrir(f)}>
                      <CategoriaIcone categoria={f} tamanho={10} className="cofre-cats-icon sm" />
                      <b>{f.nome}</b>{f.arquivada && <em className="cofre-cv-arquivada">Arquivada</em>}
                      <small className="cofre-mono">{v.usos.get(f.id)?.count ?? 0} lanç.</small>
                      <span className="cofre-mono">{formatMoeda(v.usos.get(f.id)?.volume ?? 0)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="cofre-cd-secao">
            <h3>Quem mais aparece</h3>
            {topPagadores.length === 0 ? <p className="cofre-cats-none">Sem lançamentos no período.</p> : (
              <ul className="cofre-cd-lista">
                {topPagadores.map(([id, x]) => (
                  <li key={id || "sem"}>
                    <div className="cofre-cd-pagador">
                      <b>{id ? pagadores.get(id) ?? "…" : "Sem pagador"}</b><small className="cofre-mono">{x.n}×</small><span className="cofre-mono">{formatMoeda(x.total)}</span>
                      <i className="cofre-cats-bar"><u style={{ width: `${(x.total / maxPag) * 100}%`, background: categoria.cor }} /></i>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="cofre-cd-secao">
            <h3>Últimos lançamentos</h3>
            {recentes.length === 0 ? <p className="cofre-cats-none">Sem lançamentos no período.</p> : (
              <ul className="cofre-cd-lista">
                {recentes.map((t) => (
                  <li key={t.id} className="cofre-cd-lanc"><time>{dataBr(t.data).slice(0, 5)}</time><span title={t.descricao}>{t.descricao}</span><strong className="cofre-mono" data-tipo={t.tipo}>{t.tipo === "entrada" ? "+" : "−"}{formatMoeda(t.valor_centavos)}</strong></li>
                ))}
              </ul>
            )}
          </section>

          {recs.length > 0 && (
            <section className="cofre-cd-secao">
              <h3>Recorrências ativas</h3>
              <ul className="cofre-cd-lista">
                {recs.slice(0, 6).map((r) => <li key={r.id} className="cofre-cd-lanc"><span title={r.descricao}>{r.descricao}</span><strong className="cofre-mono" data-tipo={r.tipo}>{formatMoeda(r.valor_centavos)}</strong></li>)}
              </ul>
            </section>
          )}
        </div>

        <footer>
          <button type="button" className="cofre-solid" onClick={() => aoVerLancamentos(filhas.length > 0)}><ExternalLink size={14} />Ver lançamentos</button>
        </footer>
      </aside>
    </div>,
    destino,
  );
}
