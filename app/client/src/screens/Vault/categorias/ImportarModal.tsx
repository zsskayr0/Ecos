import { useEffect, useMemo, useRef, useState } from "react";
import { Download, FileUp, LayoutTemplate, X } from "lucide-react";
import { ApiError, vault, type CategoriaApi } from "@/lib/api";
import { CORES, CategoriaIcone } from "./icone";
import { exportarCsv, linhasDoCsv, planejar, type LinhaCategoria, type PlanoImportacao } from "./importar";
import { linhasDoModelo, MODELOS } from "./modelos";

type Aba = "modelos" | "arquivo" | "exportar";

/** Importar (arquivo CSV ou modelo pronto) e exportar a estrutura de categorias. Nada é criado sem a pessoa confirmar a prévia. */
export function ImportarModal({ categorias, abaInicial = "modelos", onClose, onFeito }: {
  categorias: CategoriaApi[];
  abaInicial?: Aba;
  onClose: () => void;
  onFeito: (criadas: number) => void;
}) {
  const [aba, setAba] = useState<Aba>(abaInicial);
  const [modeloId, setModeloId] = useState<string | null>(null);
  const [arquivo, setArquivo] = useState<{ nome: string; linhas: LinhaCategoria[]; erros: PlanoImportacao["ignoradas"] } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [progresso, setProgresso] = useState(0);
  const [erro, setErro] = useState<string | null>(null);
  const [saindo, setSaindo] = useState(false);
  const entrada = useRef<HTMLInputElement>(null);

  function fechar() { setSaindo(true); window.setTimeout(onClose, 160); }
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape" && !ocupado) fechar(); };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [ocupado]); // eslint-disable-line react-hooks/exhaustive-deps

  const modelo = MODELOS.find((m) => m.id === modeloId) ?? null;
  const plano = useMemo<PlanoImportacao | null>(() => {
    if (aba === "modelos" && modelo) return planejar(linhasDoModelo(modelo), categorias);
    if (aba === "arquivo" && arquivo) return planejar(arquivo.linhas, categorias, arquivo.erros);
    return null;
  }, [aba, modelo, arquivo, categorias]);

  async function lerArquivo(f: File | undefined) {
    if (!f) return;
    setErro(null);
    if (f.size > 1_000_000) { setErro("O arquivo é grande demais para uma lista de categorias."); return; }
    const { linhas, erros } = linhasDoCsv(await f.text());
    setArquivo({ nome: f.name, linhas, erros });
  }

  function baixar() {
    const url = URL.createObjectURL(new Blob([exportarCsv(categorias)], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "categorias.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function criar() {
    if (!plano || plano.criar.length === 0) return;
    setOcupado(true);
    setErro(null);
    setProgresso(0);
    const maes = new Map(categorias.filter((c) => !c.pai_id).map((c) => [c.nome.toLowerCase(), c] as const));
    const novas = new Map<string, { id: string; cor: string; icone: string | null }>();
    let feitas = 0;
    try {
      for (const l of plano.criar) {
        const mae = l.mae ? (novas.get(l.mae.toLowerCase()) ?? (maes.get(l.mae.toLowerCase()) ? { id: maes.get(l.mae.toLowerCase())!.id, cor: maes.get(l.mae.toLowerCase())!.cor, icone: maes.get(l.mae.toLowerCase())!.icone } : null)) : null;
        const cor = l.cor ?? mae?.cor ?? CORES[feitas % CORES.length]!;
        const icone = l.icone ?? mae?.icone ?? "Tag";
        const r = await vault.categorias.criar({ nome: l.nome, tipo: l.tipo, icone, cor, pai_id: mae?.id ?? null });
        if (!l.mae) novas.set(l.nome.toLowerCase(), { id: r.id, cor, icone });
        feitas++;
        setProgresso(feitas);
      }
      onFeito(feitas);
    } catch (e) {
      setErro(`${e instanceof ApiError ? e.message : "Não foi possível criar tudo."} ${feitas > 0 ? `${feitas} categoria${feitas === 1 ? "" : "s"} já foram criadas.` : ""}`);
      setOcupado(false);
      if (feitas > 0) onFeito(feitas);
    }
  }

  const abas: { id: Aba; rotulo: string; Icone: typeof Download }[] = [{ id: "modelos", rotulo: "Modelos prontos", Icone: LayoutTemplate }, { id: "arquivo", rotulo: "Importar arquivo", Icone: FileUp }, { id: "exportar", rotulo: "Exportar", Icone: Download }];
  return (
    <div className="cofre-cats-modal" data-saindo={saindo || undefined}>
      <div className="cofre-cats-backdrop" onClick={() => { if (!ocupado) fechar(); }} />
      <section className="cofre-card cofre-cats-dialog cofre-importar" role="dialog" aria-modal="true" aria-label="Importar e exportar categorias">
        <header>
          <span className="cofre-cats-icon lg" style={{ background: "var(--panel-elevated)", color: "var(--text)" }}><LayoutTemplate size={18} /></span>
          <div><p>ESTRUTURA</p><h2>Modelos, importação e exportação</h2></div>
          <button type="button" className="cofre-cats-iconbtn cofre-cats-fechar" aria-label="Fechar" disabled={ocupado} onClick={fechar}><X size={18} /></button>
        </header>
        <div className="cofre-cats-chips" role="tablist" aria-label="O que fazer">
          {abas.map(({ id, rotulo, Icone }) => <button key={id} type="button" role="tab" aria-selected={aba === id} aria-pressed={aba === id} onClick={() => { setAba(id); setErro(null); }}><Icone size={12} /> {rotulo}</button>)}
        </div>
        {erro && <p className="cofre-launch-alert" role="alert">{erro}</p>}

        {aba === "modelos" && (
          <div className="cofre-imp-modelos">
            {MODELOS.map((m) => (
              <button key={m.id} type="button" className="cofre-imp-modelo" aria-pressed={modeloId === m.id} onClick={() => setModeloId(m.id)}>
                <b>{m.nome}</b>
                <small>{m.descricao}</small>
                <span>{m.grupos.length} categorias · {m.grupos.reduce((s, g) => s + g.subs.length, 0)} subcategorias</span>
              </button>
            ))}
          </div>
        )}
        {aba === "arquivo" && (
          <div className="cofre-imp-arquivo">
            <p className="cofre-cats-nota">CSV com as colunas <code>nome</code>, <code>tipo</code> (despesa, receita ou ambas), <code>categoria_mae</code>, <code>icone</code> e <code>cor</code>. O arquivo exportado por aqui serve de exemplo. Quem já existe (mesmo nome sob a mesma mãe) é ignorado.</p>
            <input ref={entrada} type="file" accept=".csv,text/csv,text/plain" hidden onChange={(e) => { void lerArquivo(e.target.files?.[0]); e.target.value = ""; }} />
            <button type="button" className="cofre-secondary" onClick={() => entrada.current?.click()}><FileUp size={14} />{arquivo ? `Trocar arquivo (${arquivo.nome})` : "Escolher arquivo CSV"}</button>
          </div>
        )}
        {aba === "exportar" && (
          <div className="cofre-imp-arquivo">
            <p className="cofre-cats-nota">Baixa as {categorias.length} categorias (com subcategorias, tipo, ícone, cor e se estão arquivadas) em CSV. Dá para importar o mesmo arquivo em outro Cofre.</p>
            <button type="button" className="cofre-solid" disabled={categorias.length === 0} onClick={baixar}><Download size={14} />Baixar categorias.csv</button>
          </div>
        )}

        {plano && aba !== "exportar" && (
          <div className="cofre-imp-previa" aria-live="polite">
            <p><b>{plano.criar.length}</b> {plano.criar.length === 1 ? "categoria será criada" : "categorias serão criadas"}{plano.ignoradas.length > 0 && <> · <span>{plano.ignoradas.length} ignorada{plano.ignoradas.length === 1 ? "" : "s"}</span></>}</p>
            <ul>
              {plano.criar.slice(0, 80).map((l, i) => (
                <li key={`${l.mae ?? ""}>${l.nome}>${i}`} data-sub={l.mae ? "true" : undefined}>
                  <CategoriaIcone categoria={{ icone: l.icone ?? null, cor: l.cor ?? "#94a3b8", nome: l.nome }} tamanho={10} className="cofre-cats-icon sm" />
                  <span>{l.nome}</span>
                  {l.mae && <small>em {l.mae}</small>}
                </li>
              ))}
              {plano.criar.length > 80 && <li className="cofre-imp-mais">e mais {plano.criar.length - 80}…</li>}
            </ul>
            {plano.ignoradas.length > 0 && (
              <details><summary>Ver as ignoradas</summary><ul>{plano.ignoradas.map((i, k) => <li key={k}><span>{i.nome}</span><small>{i.motivo}</small></li>)}</ul></details>
            )}
          </div>
        )}

        <footer>
          <button type="button" className="cofre-secondary" disabled={ocupado} onClick={fechar}>{aba === "exportar" ? "Fechar" : "Cancelar"}</button>
          {aba !== "exportar" && <button type="button" className="cofre-solid" disabled={ocupado || !plano || plano.criar.length === 0} onClick={() => void criar()}>{ocupado ? `Criando… ${progresso}/${plano?.criar.length ?? 0}` : "Criar categorias"}</button>}
        </footer>
      </section>
    </div>
  );
}
