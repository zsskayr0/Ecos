import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ArrowDown, ArrowUp, Check, Columns3, CornerDownRight, Layers, Pencil, X } from "lucide-react";
import type { CategoriaApi } from "@/lib/api";
import { formatMoeda } from "@/lib/format";
import { SeletorEcos } from "@/components/common/SeletorEcos";
import { maesPossiveis } from "@/lib/categorias-hierarquia";
import { CategoriaIcone } from "./icone";
import { USO_VAZIO, type Uso } from "./dados";
import type { ContextoVista } from "./contexto";
import { TIPO_ROTULO } from "./Vistas";

type IdColuna = "mae" | "tipo" | "lancamentos" | "entradas" | "saidas" | "saldo" | "volume" | "ticket" | "ultimo" | "share";
type Agrupar = "nenhum" | "mae" | "tipo";
interface Ordenacao { coluna: "nome" | IdColuna; dir: 1 | -1 }
interface Linha { c: CategoriaApi; uso: Uso; mae?: CategoriaApi }

const COLUNAS: { id: IdColuna; nome: string; largura: number; num?: boolean; padrao: boolean }[] = [
  { id: "mae", nome: "Categoria-mãe", largura: 170, padrao: true },
  { id: "tipo", nome: "Tipo", largura: 130, padrao: true },
  { id: "lancamentos", nome: "Lançamentos", largura: 120, num: true, padrao: true },
  { id: "entradas", nome: "Entradas", largura: 130, num: true, padrao: false },
  { id: "saidas", nome: "Saídas", largura: 130, num: true, padrao: true },
  { id: "saldo", nome: "Saldo", largura: 130, num: true, padrao: false },
  { id: "volume", nome: "Volume", largura: 190, num: true, padrao: true },
  { id: "ticket", nome: "Ticket médio", largura: 130, num: true, padrao: false },
  { id: "share", nome: "% do total", largura: 100, num: true, padrao: false },
  { id: "ultimo", nome: "Último uso", largura: 110, padrao: true },
];
const CHAVE = "ecos.cofre.categorias.tabela";

interface Salvo { colunas: IdColuna[]; agrupar: Agrupar }
function lerSalvo(): Salvo {
  const padrao: Salvo = { colunas: COLUNAS.filter((c) => c.padrao).map((c) => c.id), agrupar: "nenhum" };
  try {
    const v = JSON.parse(localStorage.getItem(CHAVE) ?? "null") as Partial<Salvo> | null;
    if (!v) return padrao;
    const validas = new Set(COLUNAS.map((c) => c.id));
    return {
      colunas: Array.isArray(v.colunas) ? v.colunas.filter((c): c is IdColuna => validas.has(c as IdColuna)) : padrao.colunas,
      agrupar: v.agrupar === "mae" || v.agrupar === "tipo" ? v.agrupar : "nenhum",
    };
  } catch { return padrao; }
}

const valorDe = (l: Linha, col: Ordenacao["coluna"], total: number): number | string => {
  switch (col) {
    case "nome": return l.c.nome.toLocaleLowerCase("pt-BR");
    case "mae": return (l.mae?.nome ?? "").toLocaleLowerCase("pt-BR");
    case "tipo": return TIPO_ROTULO[l.c.tipo];
    case "lancamentos": return l.uso.count;
    case "entradas": return l.uso.entradas;
    case "saidas": return l.uso.saidas;
    case "saldo": return l.uso.entradas - l.uso.saidas;
    case "volume": return l.uso.volume;
    case "ticket": return l.uso.count ? l.uso.volume / l.uso.count : 0;
    case "share": return total ? l.uso.volume / total : 0;
    case "ultimo": return l.uso.ultimo ?? "";
  }
};

/** Tabela no estilo Notion: ordenar pelo cabeçalho, mostrar/ocultar colunas, agrupar, editar na célula e agir em várias linhas. */
export function VistaTabela({ v }: { v: ContextoVista }) {
  const [salvo, setSalvo] = useState<Salvo>(lerSalvo);
  const [ordenacao, setOrdenacao] = useState<Ordenacao | null>(null);
  const marcadas = v.selecao.marcadas;
  const [editandoNome, setEditandoNome] = useState<string | null>(null);
  const [menuColunas, setMenuColunas] = useState(false);
  useEffect(() => { try { localStorage.setItem(CHAVE, JSON.stringify(salvo)); } catch { /* vale só nesta sessão */ } }, [salvo]);

  const linhas = useMemo<Linha[]>(() => v.familias.flatMap((f) => [f.mae, ...(v.mostrarSubs ? f.filhas : [])]).map((c) => ({ c, uso: v.usos.get(c.id) ?? USO_VAZIO, mae: c.pai_id ? v.porId.get(c.pai_id) : undefined })), [v.familias, v.usos, v.porId, v.mostrarSubs]);
  const ordenadas = useMemo(() => {
    if (!ordenacao) return linhas;
    const { coluna, dir } = ordenacao;
    return [...linhas].sort((a, b) => {
      const x = valorDe(a, coluna, v.volumeTotal);
      const y = valorDe(b, coluna, v.volumeTotal);
      return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "pt-BR")) * dir;
    });
  }, [linhas, ordenacao, v.volumeTotal]);

  const grupos = useMemo(() => {
    if (salvo.agrupar === "nenhum") return [{ chave: "", titulo: "", itens: ordenadas }];
    const mapa = new Map<string, { titulo: string; itens: Linha[] }>();
    for (const l of ordenadas) {
      const chave = salvo.agrupar === "tipo" ? l.c.tipo : (l.mae ?? l.c).id;
      const titulo = salvo.agrupar === "tipo" ? TIPO_ROTULO[l.c.tipo] : (l.mae ?? l.c).nome;
      const g = mapa.get(chave) ?? { titulo, itens: [] };
      g.itens.push(l);
      mapa.set(chave, g);
    }
    return [...mapa.entries()].map(([chave, g]) => ({ chave, ...g }));
  }, [ordenadas, salvo.agrupar]);

  const colunas = COLUNAS.filter((c) => salvo.colunas.includes(c.id));
  const larguraMinima = 32 + 220 + colunas.reduce((n, c) => n + c.largura, 0);
  const soma = (itens: Linha[]): Uso => itens.reduce((s, l) => ({ count: s.count + l.uso.count, entradas: s.entradas + l.uso.entradas, saidas: s.saidas + l.uso.saidas, volume: s.volume + l.uso.volume, ultimo: s.ultimo && l.uso.ultimo ? (s.ultimo > l.uso.ultimo ? s.ultimo : l.uso.ultimo) : s.ultimo ?? l.uso.ultimo }), USO_VAZIO);

  const alternarOrdem = (coluna: Ordenacao["coluna"]) => setOrdenacao((o) => (!o || o.coluna !== coluna ? { coluna, dir: 1 } : o.dir === 1 ? { coluna, dir: -1 } : null));
  const alternarMarca = v.selecao.alternar;
  const todasMarcadas = linhas.length > 0 && marcadas.size === linhas.length;

  return (
    <div className="cofre-card cofre-tb">
      <div className="cofre-tb-barra">
        <div className="cofre-tb-grupo">
          <Layers size={13} aria-hidden />
          <span>Agrupar</span>
          <div className="cofre-cats-chips" role="group" aria-label="Agrupar a tabela">
            {([["nenhum", "Nada"], ["mae", "Mãe"], ["tipo", "Tipo"]] as const).map(([k, r]) => <button key={k} type="button" aria-pressed={salvo.agrupar === k} onClick={() => setSalvo((s) => ({ ...s, agrupar: k }))}>{r}</button>)}
          </div>
        </div>
        <div className="cofre-tb-colunas">
          <button type="button" className="cofre-secondary" aria-expanded={menuColunas} onClick={() => setMenuColunas((x) => !x)}><Columns3 size={13} />Colunas</button>
          {menuColunas && <MenuColunas visiveis={salvo.colunas} aoMudar={(colunas) => setSalvo((s) => ({ ...s, colunas }))} aoFechar={() => setMenuColunas(false)} />}
        </div>
      </div>

      <div className="cofre-tb-rolagem">
        <table className="cofre-tb-tabela" role="grid" aria-rowcount={linhas.length + 1} style={{ minWidth: larguraMinima } as CSSProperties}>
          <colgroup><col style={{ width: 32 }} /><col style={{ minWidth: 220 }} />{colunas.map((c) => <col key={c.id} style={{ width: c.largura }} />)}</colgroup>
          <thead>
            <tr>
              <th scope="col"><input type="checkbox" aria-label="Selecionar todas" checked={todasMarcadas} onChange={() => v.selecao.definir(todasMarcadas ? [] : linhas.map((l) => l.c.id))} /></th>
              <Cabecalho nome="Nome" ativo={ordenacao?.coluna === "nome" ? ordenacao.dir : 0} aoClicar={() => alternarOrdem("nome")} />
              {colunas.map((c) => <Cabecalho key={c.id} nome={c.nome} num={c.num} ativo={ordenacao?.coluna === c.id ? ordenacao.dir : 0} aoClicar={() => alternarOrdem(c.id)} />)}
            </tr>
          </thead>
          {grupos.map((g) => (
            <tbody key={g.chave || "tudo"}>
              {salvo.agrupar !== "nenhum" && <tr className="cofre-tb-grupo-linha"><th colSpan={colunas.length + 2} scope="rowgroup">{g.titulo}<span>{g.itens.length}</span><b className="cofre-mono">{formatMoeda(soma(g.itens).volume)}</b></th></tr>}
              {g.itens.map((l) => (
                <LinhaTabela key={l.c.id} l={l} v={v} colunas={colunas.map((c) => c.id)} marcada={marcadas.has(l.c.id)} aoMarcar={() => alternarMarca(l.c.id)}
                  editando={editandoNome === l.c.id} aoEditar={(x) => setEditandoNome(x ? l.c.id : null)} indentar={!ordenacao && salvo.agrupar === "nenhum" && !!l.c.pai_id} />
              ))}
            </tbody>
          ))}
          <tfoot>
            <tr>
              <td />
              <th scope="row">{linhas.length} categoria{linhas.length === 1 ? "" : "s"}</th>
              {colunas.map((c) => <Rodape key={c.id} id={c.id} uso={soma(linhas)} total={v.volumeTotal} num={c.num} />)}
            </tr>
          </tfoot>
        </table>
        {linhas.length === 0 && <p className="cofre-cats-none">Nenhuma categoria encontrada.</p>}
      </div>
    </div>
  );
}

function Cabecalho({ nome, num, ativo, aoClicar }: { nome: string; num?: boolean; ativo: 0 | 1 | -1; aoClicar: () => void }) {
  return (
    <th scope="col" className={num ? "num" : undefined} aria-sort={ativo === 0 ? "none" : ativo === 1 ? "ascending" : "descending"}>
      <button type="button" onClick={aoClicar} data-ativo={ativo !== 0 || undefined}>{nome}{ativo === 1 && <ArrowUp size={11} />}{ativo === -1 && <ArrowDown size={11} />}</button>
    </th>
  );
}

function Rodape({ id, uso, total, num }: { id: IdColuna; uso: Uso; total: number; num?: boolean }) {
  const texto = id === "lancamentos" ? String(uso.count)
    : id === "entradas" ? formatMoeda(uso.entradas)
    : id === "saidas" ? formatMoeda(uso.saidas)
    : id === "saldo" ? formatMoeda(uso.entradas - uso.saidas)
    : id === "volume" ? formatMoeda(uso.volume)
    : id === "ticket" ? formatMoeda(uso.count ? Math.round(uso.volume / uso.count) : 0)
    : id === "share" ? (total ? "100%" : "—")
    : "";
  return <td className={`${num ? "num " : ""}cofre-mono`}>{texto}</td>;
}

function LinhaTabela({ l, v, colunas, marcada, aoMarcar, editando, aoEditar, indentar }: { l: Linha; v: ContextoVista; colunas: IdColuna[]; marcada: boolean; aoMarcar: () => void; editando: boolean; aoEditar: (e: boolean) => void; indentar: boolean }) {
  const { c, uso, mae } = l;
  const [rascunho, setRascunho] = useState(c.nome);
  const campo = useRef<HTMLInputElement>(null);
  useEffect(() => { if (editando) { setRascunho(c.nome); campo.current?.select(); } }, [editando, c.nome]);
  const maes = useMemo(() => maesPossiveis(v.todas, c), [v.todas, c]);

  async function confirmar() {
    const nome = rascunho.trim();
    aoEditar(false);
    if (nome && nome !== c.nome) await v.salvar(c, { nome });
  }
  const celula = (id: IdColuna) => {
    switch (id) {
      case "mae": return (
        <td key={id}>
          <SeletorEcos buscar larguraMin={440} ariaLabel={`Categoria-mãe de ${c.nome}`} classe="cofre-tb-seletor" valor={c.pai_id ?? ""} onChange={(x) => { if ((x || null) !== (c.pai_id ?? null)) void v.salvar(c, { pai_id: x || null }); }}
            opcoes={[{ valor: "", rotulo: c.pai_id ? "— (tornar principal)" : "—" }, ...maes.map((m) => ({ valor: m.id, rotulo: m.nome, visual: <CategoriaIcone categoria={m} tamanho={11} className="cofre-cats-icon sm" /> })), ...(c.pai_id && mae && !maes.some((m) => m.id === mae.id) ? [{ valor: mae.id, rotulo: mae.nome }] : [])]} />
        </td>
      );
      case "tipo": return (
        <td key={id}>
          <SeletorEcos ariaLabel={`Tipo de ${c.nome}`} classe="cofre-tb-seletor" valor={c.tipo} onChange={(t) => { if (t !== c.tipo) void v.salvar(c, { tipo: t }); }}
            opcoes={(["saida", "entrada", "ambos"] as const).map((t) => ({ valor: t, rotulo: TIPO_ROTULO[t] }))} />
        </td>
      );
      case "lancamentos": return <td key={id} className="num cofre-mono">{uso.count}</td>;
      case "entradas": return <td key={id} className="num cofre-mono" data-tipo="entrada">{uso.entradas ? formatMoeda(uso.entradas) : "—"}</td>;
      case "saidas": return <td key={id} className="num cofre-mono" data-tipo="saida">{uso.saidas ? formatMoeda(uso.saidas) : "—"}</td>;
      case "saldo": return <td key={id} className="num cofre-mono" data-tipo={uso.entradas - uso.saidas >= 0 ? "entrada" : "saida"}>{uso.count ? formatMoeda(uso.entradas - uso.saidas) : "—"}</td>;
      case "volume": return (
        <td key={id} className="num cofre-tb-volume"><b className="cofre-mono">{uso.volume ? formatMoeda(uso.volume) : "—"}</b><i className="cofre-cats-bar"><u style={{ width: `${v.volumeTotal ? (uso.volume / v.volumeTotal) * 100 : 0}%`, background: c.cor }} /></i></td>
      );
      case "ticket": return <td key={id} className="num cofre-mono">{uso.count ? formatMoeda(Math.round(uso.volume / uso.count)) : "—"}</td>;
      case "share": return <td key={id} className="num cofre-mono">{v.volumeTotal && uso.volume ? `${((uso.volume / v.volumeTotal) * 100).toFixed(1)}%` : "—"}</td>;
      case "ultimo": return <td key={id} className="cofre-mono">{uso.ultimo ? uso.ultimo.split("-").reverse().join("/") : "—"}</td>;
    }
  };
  return (
    <tr data-marcada={marcada || undefined} data-sub={c.pai_id ? "true" : undefined}>
      <td><input type="checkbox" aria-label={`Selecionar ${c.nome}`} checked={marcada} onChange={aoMarcar} /></td>
      <th scope="row" className="cofre-tb-nome">
        <span style={{ paddingLeft: indentar ? 18 : 0 }}>
          {indentar && <CornerDownRight size={12} aria-hidden />}
          <CategoriaIcone categoria={c} tamanho={12} className="cofre-cats-icon sm" />
          {editando ? (
            <form onSubmit={(e) => { e.preventDefault(); void confirmar(); }}>
              <input ref={campo} value={rascunho} maxLength={40} aria-label={`Novo nome de ${c.nome}`} onChange={(e) => setRascunho(e.target.value)} onBlur={() => void confirmar()} onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); aoEditar(false); } }} />
              <button type="submit" aria-label="Confirmar nome" onMouseDown={(e) => e.preventDefault()}><Check size={12} /></button>
            </form>
          ) : (
            <>
              <button type="button" className="cofre-tb-abrir" onClick={() => v.abrir(c)} onDoubleClick={() => aoEditar(true)} title="Clique para abrir; duplo clique para renomear">{c.nome}</button>
              <button type="button" className="cofre-tb-lapis" aria-label={`Renomear ${c.nome}`} onClick={() => aoEditar(true)}><Pencil size={11} /></button>
            </>
          )}
        </span>
      </th>
      {colunas.map(celula)}
    </tr>
  );
}

function MenuColunas({ visiveis, aoMudar, aoFechar }: { visiveis: IdColuna[]; aoMudar: (c: IdColuna[]) => void; aoFechar: () => void }) {
  const raiz = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const fora = (e: PointerEvent) => { if (!raiz.current?.contains(e.target as Node)) aoFechar(); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") aoFechar(); };
    document.addEventListener("pointerdown", fora);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", fora); document.removeEventListener("keydown", esc); };
  }, [aoFechar]);
  return (
    <div className="cofre-tb-menu" ref={raiz} role="group" aria-label="Colunas visíveis">
      {COLUNAS.map((c) => (
        <label key={c.id}><input type="checkbox" checked={visiveis.includes(c.id)} onChange={() => aoMudar(visiveis.includes(c.id) ? visiveis.filter((x) => x !== c.id) : COLUNAS.map((k) => k.id).filter((k) => k === c.id || visiveis.includes(k)))} />{c.nome}</label>
      ))}
    </div>
  );
}
