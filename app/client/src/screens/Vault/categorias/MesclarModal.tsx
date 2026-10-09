import { useEffect, useMemo, useState } from "react";
import { GitMerge, X } from "lucide-react";
import { ApiError, vault, type CategoriaApi, type CategoriaUsoApi } from "@/lib/api";
import { SeletorEcos } from "@/components/common/SeletorEcos";
import { caminhoCompleto, montarHierarquia } from "@/lib/categorias-hierarquia";
import { CategoriaIcone } from "./icone";

/**
 * Junta categorias: tudo que está nas "origens" (lançamentos, recorrências, pendências) passa para a que fica, as
 * subcategorias das origens vão junto, e as origens deixam de existir. Cada origem é um passo atômico no servidor.
 */
export function MesclarModal({ grupo, categorias, destinoInicial, onClose, onFeito }: {
  /** Categorias envolvidas; a que ficar sai das origens. */
  grupo: CategoriaApi[];
  categorias: CategoriaApi[];
  destinoInicial?: string;
  onClose: () => void;
  onFeito: (mesclou: number) => void;
}) {
  const { porId } = useMemo(() => montarHierarquia(categorias), [categorias]);
  const [destino, setDestino] = useState(destinoInicial ?? "");
  const [usos, setUsos] = useState<Map<string, CategoriaUsoApi>>(new Map());
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [saindo, setSaindo] = useState(false);

  const origens = grupo.filter((c) => c.id !== destino);
  const opcoes = useMemo(() => categorias.filter((c) => !c.arquivada || grupo.some((g) => g.id === c.id)), [categorias, grupo]);

  useEffect(() => {
    let vivo = true;
    Promise.all(grupo.map((c) => vault.categorias.uso(c.id).then((u) => [c.id, u] as const).catch(() => null)))
      .then((r) => { if (vivo) setUsos(new Map(r.filter((x): x is readonly [string, CategoriaUsoApi] => !!x))); });
    return () => { vivo = false; };
  }, [grupo]);

  useEffect(() => {
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape") fechar(); };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function fechar() { setSaindo(true); window.setTimeout(onClose, 160); }

  const totais = origens.reduce((s, c) => { const u = usos.get(c.id); return { lanc: s.lanc + (u?.transacoes ?? 0), rec: s.rec + (u?.recorrencias ?? 0), pend: s.pend + (u?.pendencias ?? 0), subs: s.subs + categorias.filter((x) => x.pai_id === c.id).length }; }, { lanc: 0, rec: 0, pend: 0, subs: 0 });
  const nomeDestino = destino ? caminhoCompleto(porId.get(destino), porId) : "";

  async function mesclar() {
    if (!destino || origens.length === 0) return;
    setOcupado(true);
    setErro(null);
    let feitas = 0;
    try {
      for (const o of origens) { await vault.categorias.excluir(o.id, { mover_para: destino, filhas_para_destino: true }); feitas++; }
      onFeito(feitas);
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível mesclar.");
      setOcupado(false);
      if (feitas > 0) onFeito(feitas);
    }
  }

  return (
    <div className="cofre-cats-modal" data-saindo={saindo || undefined}>
      <div className="cofre-cats-backdrop" onClick={fechar} />
      <section className="cofre-card cofre-cats-dialog cofre-mesclar" role="dialog" aria-modal="true" aria-label="Mesclar categorias">
        <header>
          <span className="cofre-cats-icon lg" style={{ background: "var(--panel-elevated)", color: "var(--text)" }}><GitMerge size={18} /></span>
          <div><p>MESCLAR</p><h2>{origens.length > 1 ? `${origens.length} categorias em uma` : "Mesclar categoria"}</h2></div>
          <button type="button" className="cofre-cats-iconbtn cofre-cats-fechar" aria-label="Fechar" onClick={fechar}><X size={18} /></button>
        </header>
        {erro && <p className="cofre-launch-alert" role="alert">{erro}</p>}
        <div className="cofre-cats-field">
          <span>Categoria que fica</span>
          <SeletorEcos buscar larguraMin={440} ariaLabel="Categoria que fica" classe="min-h-[40px] max-w-full rounded-[11px] border border-[var(--border)] bg-[var(--panel)] px-2.5 text-[13px] text-[var(--text)]" valor={destino} onChange={setDestino}
            opcoes={[{ valor: "", rotulo: "Escolha…" }, ...opcoes.map((c) => ({ valor: c.id, rotulo: caminhoCompleto(c, porId), visual: <CategoriaIcone categoria={c} tamanho={11} className="cofre-cats-icon sm" /> }))]} />
        </div>
        <div className="cofre-cats-field">
          <span>{origens.length > 1 ? "Serão mescladas e deixam de existir" : "Será mesclada e deixa de existir"}</span>
          <ul className="cofre-mesclar-lista">
            {origens.map((c) => (
              <li key={c.id}><CategoriaIcone categoria={c} tamanho={11} className="cofre-cats-icon sm" /><b>{caminhoCompleto(c, porId)}</b><small className="cofre-mono">{usos.get(c.id) ? `${usos.get(c.id)!.transacoes} lanç.` : "…"}</small></li>
            ))}
            {origens.length === 0 && <li className="cofre-mesclar-vazio">Escolha uma categoria diferente.</li>}
          </ul>
        </div>
        {destino && origens.length > 0 && (
          <p className="cofre-cats-nota">
            {totais.lanc} lançamento{totais.lanc === 1 ? "" : "s"}{totais.rec > 0 && `, ${totais.rec} recorrência${totais.rec === 1 ? "" : "s"}`}{totais.pend > 0 && `, ${totais.pend} pendência${totais.pend === 1 ? "" : "s"}`} passam para “{nomeDestino}”.
            {totais.subs > 0 && ` As ${totais.subs} subcategoria${totais.subs === 1 ? "" : "s"} também vão para ela.`} Essa ação não pode ser desfeita.
          </p>
        )}
        <footer>
          <button type="button" className="cofre-secondary" onClick={fechar}>Cancelar</button>
          <button type="button" className="cofre-solid" disabled={ocupado || !destino || origens.length === 0} onClick={() => void mesclar()}>{ocupado ? "Mesclando…" : "Mesclar"}</button>
        </footer>
      </section>
    </div>
  );
}
