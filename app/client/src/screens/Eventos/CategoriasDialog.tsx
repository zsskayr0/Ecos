import { useLayoutEffect, useRef, useState } from "react";
import { Check, Plus, Trash2, X } from "lucide-react";
import { ApiError, eventos, type CategoriaEvento } from "@/lib/api";
import { PALETAS_CORES } from "@/components/common/PaletaCores";

interface Props {
  aberto: boolean;
  categorias: CategoriaEvento[];
  onFechar: () => void;
  /** Depois de criar, renomear, recolorir ou excluir: quem chamou recarrega listas e tempo. */
  onAlterado: () => void;
}

const CORES_SUGERIDAS = PALETAS_CORES[0].cores;

/** Gerencia as categorias de evento (nome + cor). Excluir devolve os eventos dela para "Sem categoria". */
export function CategoriasDialog({ aberto, categorias, onFechar, onAlterado }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [nome, setNome] = useState("");
  const [cor, setCor] = useState<string>(CORES_SUGERIDAS[1]);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useLayoutEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (aberto && !el.open) el.showModal();
    else if (!aberto && el.open) el.close();
  }, [aberto]);

  async function executar(acao: () => Promise<unknown>) {
    setOcupado(true);
    setErro(null);
    try { await acao(); onAlterado(); }
    catch (e) { setErro(e instanceof ApiError ? e.message : "Não foi possível concluir. Tente novamente."); }
    finally { setOcupado(false); }
  }

  const criar = () => executar(async () => {
    await eventos.categorias.criar({ nome: nome.trim(), cor });
    setNome("");
  });

  return (
    <dialog ref={dialog} aria-label="Categorias de evento" onCancel={(e) => { e.preventDefault(); if (!ocupado) onFechar(); }}
      className="w-[min(28rem,calc(100vw-2rem))] rounded-2xl border border-border bg-surface-1 p-0 text-text-primary backdrop:bg-black/60">
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <h2 className="text-base font-semibold">Categorias de evento</h2>
        <button type="button" onClick={onFechar} aria-label="Fechar" className="rounded-lg p-1.5 text-text-muted hover:bg-surface-2"><X size={18} /></button>
      </div>
      <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
        {erro && <p role="alert" className="mb-3 text-sm text-error">{erro}</p>}
        {categorias.length === 0 ? (
          <p className="mb-4 text-sm text-text-muted">Nenhuma categoria ainda. Crie uma para saber quanto tempo vai em reuniões, estudos, foco…</p>
        ) : (
          <ul className="mb-4 flex flex-col gap-2">
            {categorias.map((c) => <LinhaCategoria key={c.id} categoria={c} ocupado={ocupado} onSalvar={(nomeNovo, corNova) => executar(() => eventos.categorias.atualizar(c.id, { nome: nomeNovo, cor: corNova }))} onExcluir={() => executar(() => eventos.categorias.excluir(c.id))} />)}
          </ul>
        )}
        <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-text-muted">Nova categoria</p>
        <div className="flex items-center gap-2">
          <input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={60} placeholder="Ex.: Reunião" aria-label="Nome da nova categoria"
            onKeyDown={(e) => { if (e.key === "Enter" && nome.trim() && !ocupado) void criar(); }}
            className="h-10 min-w-0 flex-1 rounded-xl bg-surface-2 px-3 text-sm outline-none placeholder:text-text-muted focus:ring-2 focus:ring-cyan/50" />
          <button type="button" onClick={() => void criar()} disabled={!nome.trim() || ocupado} className="flex h-10 items-center gap-1.5 rounded-xl bg-cyan px-3 text-sm font-medium text-black disabled:opacity-40"><Plus size={15} />Criar</button>
        </div>
        <Cores valor={cor} onChange={setCor} />
      </div>
    </dialog>
  );
}

function Cores({ valor, onChange }: { valor: string; onChange: (cor: string) => void }) {
  return (
    <div role="radiogroup" aria-label="Cor da categoria" className="mt-3 flex flex-wrap gap-1.5">
      {CORES_SUGERIDAS.map((c) => (
        <button key={c} type="button" role="radio" aria-checked={valor.toLowerCase() === c.toLowerCase()} aria-label={`Cor ${c}`} onClick={() => onChange(c)}
          className={`h-6 w-6 rounded-full border-2 transition-transform hover:scale-110 ${valor.toLowerCase() === c.toLowerCase() ? "border-white ring-2 ring-cyan/60" : "border-black/10"}`} style={{ backgroundColor: c }} />
      ))}
    </div>
  );
}

function LinhaCategoria({ categoria, ocupado, onSalvar, onExcluir }: { categoria: CategoriaEvento; ocupado: boolean; onSalvar: (nome: string, cor: string) => void; onExcluir: () => void }) {
  const [editando, setEditando] = useState(false);
  const [nome, setNome] = useState(categoria.nome);
  const [cor, setCor] = useState(categoria.cor);
  const [confirma, setConfirma] = useState(false);

  if (!editando) {
    return (
      <li className="flex items-center gap-3 rounded-xl bg-surface-2 px-3 py-2">
        <span className="h-4 w-4 shrink-0 rounded-full" style={{ backgroundColor: categoria.cor }} />
        <button type="button" onClick={() => setEditando(true)} className="min-w-0 flex-1 truncate text-left text-sm" aria-label={`Editar categoria ${categoria.nome}`}>{categoria.nome}</button>
        <span className="shrink-0 text-xs text-text-muted">{categoria.eventos ?? 0} {categoria.eventos === 1 ? "evento" : "eventos"}</span>
        {confirma ? (
          <button type="button" disabled={ocupado} onClick={onExcluir} className="rounded-lg bg-error px-2 py-1 text-xs font-medium text-white disabled:opacity-40">Excluir mesmo?</button>
        ) : (
          <button type="button" onClick={() => setConfirma(true)} aria-label={`Excluir categoria ${categoria.nome}`} className="rounded-lg p-1.5 text-text-muted hover:bg-surface-3 hover:text-error"><Trash2 size={15} /></button>
        )}
      </li>
    );
  }
  return (
    <li className="rounded-xl bg-surface-2 p-3">
      <div className="flex items-center gap-2">
        <input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={60} aria-label="Nome da categoria" className="h-9 min-w-0 flex-1 rounded-lg bg-surface-1 px-2 text-sm outline-none focus:ring-2 focus:ring-cyan/50" />
        <button type="button" disabled={!nome.trim() || ocupado} onClick={() => { onSalvar(nome.trim(), cor); setEditando(false); }} aria-label="Salvar categoria" className="rounded-lg bg-cyan p-2 text-black disabled:opacity-40"><Check size={15} /></button>
        <button type="button" onClick={() => { setNome(categoria.nome); setCor(categoria.cor); setEditando(false); }} aria-label="Cancelar edição" className="rounded-lg p-2 text-text-muted hover:bg-surface-3"><X size={15} /></button>
      </div>
      <Cores valor={cor} onChange={setCor} />
    </li>
  );
}
