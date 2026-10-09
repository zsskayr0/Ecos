import { useEffect, useRef, useState } from "react";
import { Bookmark, Check, Trash2 } from "lucide-react";
import type { NomeVista } from "./contexto";
import type { Criterio } from "./dados";
import type { AgruparKanban } from "./KanbanCategorias";

/** O que uma visão guarda: a forma de ver (não os dados). */
export interface Visao {
  vista: NomeVista;
  criterio: Criterio;
  mostrarSubs: boolean;
  kanban: AgruparKanban;
  tipo: "todas" | "entrada" | "saida" | "ambos";
  arquivadas: boolean;
  busca: string;
}
interface VisaoNomeada { id: string; nome: string; visao: Visao }

const CHAVE = "ecos.cofre.categorias.visoes";

function ler(): VisaoNomeada[] {
  try {
    const v = JSON.parse(localStorage.getItem(CHAVE) ?? "[]") as VisaoNomeada[];
    return Array.isArray(v) ? v.filter((x) => x && typeof x.nome === "string" && x.visao) : [];
  } catch { return []; }
}
function guardar(lista: VisaoNomeada[]) {
  try { localStorage.setItem(CHAVE, JSON.stringify(lista)); } catch { /* vale só nesta sessão */ }
}
const igual = (a: Visao, b: Visao) => (Object.keys(a) as (keyof Visao)[]).every((k) => a[k] === b[k]);

/** Menu "Visões": guarda a combinação atual de vista, ordem, filtros e subcategorias com um nome, e a reaplica depois. */
export function VisoesSalvas({ atual, aoAplicar }: { atual: Visao; aoAplicar: (v: Visao) => void }) {
  const [aberto, setAberto] = useState(false);
  const [lista, setLista] = useState<VisaoNomeada[]>(ler);
  const [nome, setNome] = useState("");
  const raiz = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: PointerEvent) => { if (!raiz.current?.contains(e.target as Node)) setAberto(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setAberto(false); } };
    document.addEventListener("pointerdown", fora);
    document.addEventListener("keydown", esc, true);
    return () => { document.removeEventListener("pointerdown", fora); document.removeEventListener("keydown", esc, true); };
  }, [aberto]);

  const ativa = lista.find((x) => igual(x.visao, atual));
  function salvar() {
    const n = nome.trim();
    if (!n) return;
    const sem = lista.filter((x) => x.nome.toLowerCase() !== n.toLowerCase());
    const nova = [...sem, { id: `${Date.now()}`, nome: n, visao: atual }];
    setLista(nova);
    guardar(nova);
    setNome("");
  }
  function apagar(id: string) {
    const nova = lista.filter((x) => x.id !== id);
    setLista(nova);
    guardar(nova);
  }

  return (
    <div className="cofre-visoes" ref={raiz}>
      <button type="button" className="cofre-cats-interruptor cofre-visoes-botao" aria-haspopup="dialog" aria-expanded={aberto} aria-pressed={!!ativa} onClick={() => setAberto((v) => !v)} title="Visões salvas">
        <Bookmark size={13} /><span>{ativa ? ativa.nome : "Visões"}</span>
      </button>
      {aberto && (
        <div className="cofre-visoes-menu" role="dialog" aria-label="Visões salvas">
          {lista.length === 0 && <p className="cofre-cats-nota">Nenhuma visão salva ainda. Deixe a tela como quiser, dê um nome e salve.</p>}
          <ul>
            {lista.map((x) => (
              <li key={x.id} data-ativa={x.id === ativa?.id || undefined}>
                <button type="button" className="cofre-visoes-item" onClick={() => { aoAplicar(x.visao); setAberto(false); }}>{x.id === ativa?.id ? <Check size={12} /> : <span aria-hidden />}{x.nome}</button>
                <button type="button" className="cofre-visoes-apagar" aria-label={`Apagar a visão ${x.nome}`} onClick={() => apagar(x.id)}><Trash2 size={12} /></button>
              </li>
            ))}
          </ul>
          <form onSubmit={(e) => { e.preventDefault(); salvar(); }}>
            <input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={30} placeholder="Nome da visão atual…" aria-label="Nome da visão" />
            <button type="submit" className="cofre-solid" disabled={!nome.trim()}>Salvar</button>
          </form>
        </div>
      )}
    </div>
  );
}
