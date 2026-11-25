import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Search, X } from "lucide-react";
import type { CategoriaApi } from "@/lib/api";
import { montarHierarquia } from "@/lib/categorias-hierarquia";
import { casaBusca } from "@/lib/texto-busca";
import { CategoriaIcone } from "./categorias/icone";
import { SEM_CATEGORIA_ID } from "./SeletorCategoriaLateral";

/** Marcar uma categoria principal marca também as subcategorias dela; as subcategorias também valem sozinhas. */
export function alternarCategoriaSel(selecionadas: Set<string>, c: CategoriaApi | null, categorias: CategoriaApi[]): Set<string> {
  const prox = new Set(selecionadas);
  const filhas = c && !c.pai_id ? categorias.filter((f) => f.pai_id === c.id).map((f) => f.id) : [];
  const ids = c ? [c.id, ...filhas] : [SEM_CATEGORIA_ID];
  const marcar = !selecionadas.has(ids[0]!);
  for (const id of ids) { if (marcar) prox.add(id); else prox.delete(id); }
  return prox;
}

/** Escolha de categorias no celular: folha que sobe de baixo, com busca, linhas grandes e marcação múltipla. */
export function CategoriasSheet({ aberto, fechar, categorias, selecionadas, aoMudar }: {
  aberto: boolean; fechar: () => void; categorias: CategoriaApi[]; selecionadas: Set<string>; aoMudar: (s: Set<string>) => void;
}) {
  const [montado, setMontado] = useState(false);
  const [saindo, setSaindo] = useState(false);
  const [busca, setBusca] = useState("");
  const h = useMemo(() => montarHierarquia(categorias), [categorias]);
  // Puxar a alça (ou o cabeçalho) para baixo fecha a folha: ela acompanha o dedo e, se passar do limite ou for rápido, sai.
  const folha = useRef<HTMLDivElement>(null);
  const puxar = useRef<{ id: number; y: number; t: number; dy: number } | null>(null);
  const aoPuxar = {
    onPointerDown: (e: React.PointerEvent) => { if (!e.isPrimary || (e.target as HTMLElement).closest("button")) return; puxar.current = { id: e.pointerId, y: e.clientY, t: Date.now(), dy: 0 }; e.currentTarget.setPointerCapture(e.pointerId); if (folha.current) folha.current.style.transition = "none"; },
    onPointerMove: (e: React.PointerEvent) => {
      const g = puxar.current; if (!g || g.id !== e.pointerId) return;
      g.dy = Math.max(0, e.clientY - g.y);
      if (folha.current) { folha.current.style.transform = `translateY(${g.dy}px)`; const v = folha.current.parentElement; if (v) { v.style.transition = "none"; v.style.opacity = String(Math.max(0.15, 1 - g.dy / 420)); } }
    },
    onPointerUp: (e: React.PointerEvent) => {
      const g = puxar.current; if (!g || g.id !== e.pointerId) return;
      puxar.current = null;
      const veloz = g.dy / Math.max(1, Date.now() - g.t) > 0.5;
      const el = folha.current;
      if (g.dy > 100 || (veloz && g.dy > 30)) { if (el) { el.style.transition = "transform .22s cubic-bezier(.4,0,1,1)"; el.style.transform = "translateY(110%)"; const v = el.parentElement; if (v) { v.style.transition = "opacity .22s ease"; v.style.opacity = "0"; } } fechar(); }
      else if (el) { el.style.transition = "transform .35s cubic-bezier(.34,1.4,.5,1)"; el.style.transform = ""; const v = el.parentElement; if (v) { v.style.transition = "opacity .3s ease"; v.style.opacity = ""; } }
    },
    onPointerCancel: () => { puxar.current = null; if (folha.current) { folha.current.style.transition = "transform .3s ease"; folha.current.style.transform = ""; } },
  };

  useEffect(() => {
    if (aberto) { setMontado(true); setSaindo(false); return; }
    if (!montado) return;
    setSaindo(true);
    const t = window.setTimeout(() => { setMontado(false); setSaindo(false); setBusca(""); }, 240);
    return () => window.clearTimeout(t);
  }, [aberto, montado]);
  useEffect(() => {
    if (!aberto) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") fechar(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [aberto, fechar]);

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

  if (!montado) return null;
  const mostrarSem = casaBusca(busca, "sem categoria");
  const n = selecionadas.size;
  const alternar = (c: CategoriaApi | null) => aoMudar(alternarCategoriaSel(selecionadas, c, categorias));

  return <div className="cofre-catsheet-veu" data-saindo={saindo || undefined} role="dialog" aria-modal="true" aria-label="Escolher categorias"
    onMouseDown={(e) => { if (e.target === e.currentTarget) fechar(); }}>
    <div className="cofre-catsheet" ref={folha}>
      <div className="cofre-catsheet-puxar" {...aoPuxar}><span className="cofre-catsheet-alca" aria-hidden /></div>
      <header {...aoPuxar}>
        <h2>Categorias</h2>
        <small>{n ? `${n} selecionada${n > 1 ? "s" : ""}` : "Todas"}</small>
        <button type="button" onClick={fechar} aria-label="Fechar"><X size={18} /></button>
      </header>
      <label className="cofre-catsheet-busca"><Search size={16} aria-hidden />
        <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Pesquisar categoria…" aria-label="Pesquisar categoria" />
        {busca && <button type="button" aria-label="Limpar busca" onClick={() => setBusca("")}><X size={14} /></button>}
      </label>
      <div className="cofre-catsheet-lista" role="listbox" aria-multiselectable="true">
        {mostrarSem && <Linha marcado={selecionadas.has(SEM_CATEGORIA_ID)} onClick={() => alternar(null)} categoria={null} nome="Sem categoria" />}
        {linhas.map(({ c, sub }) => <Linha key={c.id} marcado={selecionadas.has(c.id)} onClick={() => alternar(c)} categoria={c} nome={c.nome} sub={sub} />)}
        {!mostrarSem && !linhas.length && <p className="cofre-catsheet-vazio">Nenhuma categoria encontrada.</p>}
      </div>
      <footer>
        <button type="button" className="cofre-catsheet-limpar" disabled={!n} onClick={() => aoMudar(new Set())}>Limpar</button>
        <button type="button" className="cofre-catsheet-ok" onClick={fechar}>{n ? `Aplicar (${n})` : "Concluir"}</button>
      </footer>
    </div>
  </div>;
}

function Linha({ marcado, onClick, categoria, nome, sub }: { marcado: boolean; onClick: () => void; categoria: CategoriaApi | null; nome: string; sub?: boolean }) {
  return <button type="button" role="option" aria-selected={marcado} className="cofre-catsheet-item" data-sub={sub || undefined} onClick={onClick}>
    <CategoriaIcone categoria={categoria} tamanho={15} className="cofre-cats-icon" />
    <span>{nome}</span>
    <i>{marcado && <Check size={14} />}</i>
  </button>;
}
