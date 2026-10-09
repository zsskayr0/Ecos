import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Search, X } from "lucide-react";
import type { CategoriaApi } from "@/lib/api";
import { montarHierarquia } from "@/lib/categorias-hierarquia";
import { casaBusca } from "@/lib/texto-busca";
import { CategoriaIcone } from "./categorias/icone";
import { SEM_CATEGORIA_ID } from "./SeletorCategoriaLateral";

/** Menu de filtro por categoria, aberto junto ao botão: busca, ícones e cores das categorias e marcação múltipla. */
export function FiltroCategoriasMenu({ categorias, selecionadas, aoMudar, aoFechar }: {
  categorias: CategoriaApi[]; selecionadas: Set<string>; aoMudar: (s: Set<string>) => void; aoFechar: () => void;
}) {
  const raiz = useRef<HTMLDivElement>(null);
  const [busca, setBusca] = useState("");
  const h = useMemo(() => montarHierarquia(categorias), [categorias]);

  useEffect(() => {
    const fora = (e: PointerEvent) => { if (!raiz.current?.parentElement?.contains(e.target as Node)) aoFechar(); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") aoFechar(); };
    document.addEventListener("pointerdown", fora); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", fora); document.removeEventListener("keydown", esc); };
  }, [aoFechar]);

  const linhas = useMemo(() => {
    const out: { c: CategoriaApi; sub: boolean }[] = [];
    for (const m of h.raizes) {
      const filhas = h.filhas.get(m.id) ?? [];
      const mae = casaBusca(busca, m.nome);
      const filhasOk = mae ? filhas : filhas.filter((f) => casaBusca(busca, f.nome, m.nome));
      if (mae || filhasOk.length) { out.push({ c: m, sub: false }); for (const f of filhasOk) out.push({ c: f, sub: true }); }
    }
    return out;
  }, [h, busca]);

  // Marcar uma categoria principal marca também as subcategorias dela; as subcategorias também funcionam sozinhas.
  const alternar = (c: CategoriaApi | null) => {
    const prox = new Set(selecionadas);
    const ids = c ? [c.id, ...(c.pai_id ? [] : (h.filhas.get(c.id) ?? []).map((f) => f.id))] : [SEM_CATEGORIA_ID];
    const marcar = !selecionadas.has(ids[0]!);
    for (const id of ids) { if (marcar) prox.add(id); else prox.delete(id); }
    aoMudar(prox);
  };
  const mostrarSem = casaBusca(busca, "sem categoria");

  return <div className="cofre-catmenu ecos-menu rounded-xl border border-border bg-surface-1 p-1 shadow-nav" ref={raiz} role="dialog" aria-label="Filtrar por categoria">
    <label className="cofre-catmenu-busca flex h-10 items-center gap-2 rounded-lg border border-border bg-surface-1 px-2.5 focus-within:border-steel-400/70"><Search size={14} className="shrink-0 text-text-muted" aria-hidden /><input autoFocus value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Pesquisar…" aria-label="Buscar categoria" className="min-w-0 flex-1 bg-transparent text-sm text-text-primary outline-none placeholder:text-text-muted" />{busca && <button type="button" aria-label="Limpar busca" onClick={() => setBusca("")} className="text-xs text-text-muted hover:text-text-primary">Limpar</button>}</label>
    <div className="cofre-catmenu-lista" role="listbox" aria-multiselectable="true">
      {mostrarSem && <Item marcado={selecionadas.has(SEM_CATEGORIA_ID)} onClick={() => alternar(null)} categoria={null} nome="Sem categoria" />}
      {linhas.map(({ c, sub }) => <Item key={c.id} marcado={selecionadas.has(c.id)} onClick={() => alternar(c)} categoria={c} nome={c.nome} sub={sub} />)}
      {!mostrarSem && !linhas.length && <p className="cofre-catmenu-vazio">Nenhuma categoria encontrada.</p>}
    </div>
    <div className="cofre-catmenu-rodape"><span>{selecionadas.size ? `${selecionadas.size} selecionada${selecionadas.size > 1 ? "s" : ""}` : "Todas"}</span>
      <button type="button" disabled={!selecionadas.size} onClick={() => aoMudar(new Set())}>Limpar</button></div>
  </div>;
}

function Item({ marcado, onClick, categoria, nome, sub }: { marcado: boolean; onClick: () => void; categoria: CategoriaApi | null; nome: string; sub?: boolean }) {
  return <button type="button" role="option" aria-selected={marcado} className="cofre-catmenu-item" data-sub={sub || undefined} onClick={onClick}>
    <CategoriaIcone categoria={categoria} tamanho={12} className="cofre-cats-icon sm" /><span className="cofre-catmenu-nome">{nome}</span><i className="cofre-catmenu-check">{marcado && <Check size={12} />}</i>
  </button>;
}
