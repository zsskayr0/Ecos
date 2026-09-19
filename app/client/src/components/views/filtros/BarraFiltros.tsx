import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowDownUp, ArrowLeft, Filter, GripVertical, Plus, Search, Trash2, X } from "lucide-react";
import {
  ESTADO_VAZIO, OPERADORES, PROPRIEDADES, novoFiltro, propriedadePorId, resumoFiltro, rotuloDirecao, semValor,
  type Contexto, type EstadoFiltros, type Filtro, type Ordenacao, type Propriedade,
} from "./modelo";

interface Props {
  estado: EstadoFiltros;
  onChange: (estado: EstadoFiltros) => void;
  contexto: Contexto;
  /** Quantos itens passam nos filtros / quantos existem. */
  visiveis: number;
  total: number;
}

const CAMPO = "min-h-9 rounded-lg border border-border bg-surface-2 px-2 text-sm text-text-primary focus:border-steel-400 focus:outline-none";

/** Barra "Filtrar / Ordenar" no estilo do Notion: condições por propriedade e operador, ordenação em várias camadas, chips do que está ativo. */
export function BarraFiltros({ estado, onChange, contexto, visiveis, total }: Props) {
  const [painel, setPainel] = useState<"filtros" | "ordem" | null>(null);
  const raiz = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!painel) return;
    const fora = (e: PointerEvent) => { if (!raiz.current?.contains(e.target as Node)) setPainel(null); };
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape") setPainel(null); };
    document.addEventListener("pointerdown", fora);
    document.addEventListener("keydown", tecla);
    return () => { document.removeEventListener("pointerdown", fora); document.removeEventListener("keydown", tecla); };
  }, [painel]);

  const ativos = estado.filtros.length;
  const botao = (rotulo: string, icone: ReactNode, n: number, id: "filtros" | "ordem") => (
    <button type="button" aria-haspopup="dialog" aria-expanded={painel === id} onClick={() => setPainel(painel === id ? null : id)}
      className={`flex min-h-10 items-center gap-2 rounded-lg border px-3 text-sm transition-colors ${n ? "border-steel-400 bg-steel-700/20 text-steel-200" : "border-border bg-surface-1 text-text-secondary hover:bg-surface-2"}`}>
      {icone}{rotulo}{n ? ` (${n})` : ""}
    </button>
  );

  return (
    <div ref={raiz} className="relative mb-3">
      <div className="flex flex-wrap items-center gap-2">
        {botao("Filtrar", <Filter size={16} />, ativos, "filtros")}
        {botao("Ordenar", <ArrowDownUp size={16} />, estado.ordens.length, "ordem")}
        {estado.filtros.map((f) => (
          <span key={f.id} className="flex items-center gap-1 rounded-lg bg-steel-700/25 py-1 pl-2.5 pr-1 text-xs text-steel-200">
            <button type="button" onClick={() => setPainel("filtros")} className="max-w-[16rem] truncate">{resumoFiltro(f, contexto)}</button>
            <button type="button" aria-label={`Remover filtro ${resumoFiltro(f, contexto)}`} onClick={() => onChange({ ...estado, filtros: estado.filtros.filter((x) => x.id !== f.id) })}
              className="flex h-5 w-5 items-center justify-center rounded hover:bg-steel-700/50"><X size={12} /></button>
          </span>
        ))}
        {(ativos > 0 || estado.ordens.length > 0) && <span className="text-xs text-text-muted">{visiveis} de {total}</span>}
        {ativos > 0 && <button type="button" onClick={() => onChange({ ...estado, filtros: [] })} className="text-xs text-steel-300 hover:text-text-primary">Limpar filtros</button>}
      </div>

      {painel === "filtros" && <PainelFiltros estado={estado} onChange={onChange} contexto={contexto} onFechar={() => setPainel(null)} />}
      {painel === "ordem" && <PainelOrdem estado={estado} onChange={onChange} onFechar={() => setPainel(null)} />}
    </div>
  );
}

const Painel = ({ titulo, onFechar, onVoltar, children }: { titulo: string; onFechar: () => void; onVoltar?: () => void; children: ReactNode }) => (
  <div role="dialog" aria-label={titulo} className="absolute left-0 top-full z-40 mt-1 w-[min(26rem,calc(100vw-2rem))] rounded-xl border border-border bg-surface-1 p-3 shadow-nav">
    <div className="mb-2 flex items-center gap-2">
      {onVoltar && <button type="button" onClick={onVoltar} aria-label="Voltar" className="flex h-8 w-8 items-center justify-center rounded-lg text-text-muted hover:bg-surface-2"><ArrowLeft size={16} /></button>}
      <h2 className="flex-1 text-sm font-semibold text-text-primary">{titulo}</h2>
      <button type="button" onClick={onFechar} aria-label="Fechar" className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-2 text-text-muted hover:text-text-primary"><X size={15} /></button>
    </div>
    {children}
  </div>
);

/** Lista pesquisável de propriedades ("Procurar uma propriedade..."). */
function EscolherPropriedade({ onEscolher, excluir = [] }: { onEscolher: (p: Propriedade) => void; excluir?: string[] }) {
  const [busca, setBusca] = useState("");
  const lista = useMemo(() => PROPRIEDADES.filter((p) => !excluir.includes(p.id) && p.nome.toLowerCase().includes(busca.trim().toLowerCase())), [busca, excluir]);
  return (
    <div>
      <label className="relative mb-2 block">
        <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
        <input autoFocus value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Procurar uma propriedade..." aria-label="Procurar uma propriedade"
          onKeyDown={(e) => { if (e.key === "Enter" && lista[0]) onEscolher(lista[0]); }}
          className={`${CAMPO} w-full border-steel-400 pl-8`} />
      </label>
      <ul className="max-h-64 overflow-y-auto">
        {lista.map((p) => <li key={p.id}><button type="button" onClick={() => onEscolher(p)} className="flex min-h-10 w-full items-center gap-2 rounded-lg px-2 text-left text-sm text-text-primary hover:bg-surface-2">{p.nome}<span className="ml-auto text-xs text-text-muted">{NOME_TIPO[p.tipo]}</span></button></li>)}
        {lista.length === 0 && <li className="px-2 py-3 text-sm text-text-muted">Nenhuma propriedade encontrada.</li>}
      </ul>
    </div>
  );
}

const NOME_TIPO = { texto: "Texto", selecao: "Seleção", multi: "Múltipla", data: "Data", numero: "Número" } as const;

function PainelFiltros({ estado, onChange, contexto, onFechar }: { estado: EstadoFiltros; onChange: (e: EstadoFiltros) => void; contexto: Contexto; onFechar: () => void }) {
  const [adicionando, setAdicionando] = useState(false);
  const atualizar = (id: string, patch: Partial<Filtro>) => onChange({ ...estado, filtros: estado.filtros.map((f) => (f.id === id ? { ...f, ...patch } : f)) });

  if (adicionando) {
    return (
      <Painel titulo="Novo filtro" onFechar={onFechar} onVoltar={() => setAdicionando(false)}>
        <EscolherPropriedade onEscolher={(p) => { onChange({ ...estado, filtros: [...estado.filtros, novoFiltro(p.id)] }); setAdicionando(false); }} />
      </Painel>
    );
  }

  return (
    <Painel titulo="Filtros" onFechar={onFechar}>
      {estado.filtros.length > 1 && (
        <label className="mb-2 flex items-center gap-2 text-xs text-text-muted">Combinar
          <select value={estado.juncao} onChange={(e) => onChange({ ...estado, juncao: e.target.value as "e" | "ou" })} className={CAMPO} aria-label="Como combinar as condições">
            <option value="e">Todas as condições (E)</option>
            <option value="ou">Qualquer condição (OU)</option>
          </select>
        </label>
      )}
      <div className="flex flex-col gap-2">
        {estado.filtros.map((f) => <LinhaFiltro key={f.id} filtro={f} contexto={contexto} onChange={(patch) => atualizar(f.id, patch)} onRemover={() => onChange({ ...estado, filtros: estado.filtros.filter((x) => x.id !== f.id) })} />)}
        {estado.filtros.length === 0 && <p className="px-1 py-2 text-sm text-text-muted">Nenhum filtro. Adicione uma condição para restringir a lista.</p>}
      </div>
      <button type="button" onClick={() => setAdicionando(true)} className="mt-2 flex min-h-9 items-center gap-2 rounded-lg px-2 text-sm text-text-secondary hover:bg-surface-2"><Plus size={15} />Novo filtro</button>
      {estado.filtros.length > 0 && <button type="button" onClick={() => onChange({ ...estado, filtros: [] })} className="flex min-h-9 items-center gap-2 rounded-lg px-2 text-sm text-text-secondary hover:bg-surface-2"><Trash2 size={15} />Excluir filtros</button>}
    </Painel>
  );
}

function LinhaFiltro({ filtro, contexto, onChange, onRemover }: { filtro: Filtro; contexto: Contexto; onChange: (patch: Partial<Filtro>) => void; onRemover: () => void }) {
  const prop = propriedadePorId(filtro.prop);
  if (!prop) return null;
  const operadores = OPERADORES[prop.tipo];
  const listaTags = `tags-${filtro.id}`;
  return (
    <div className="rounded-lg border border-border bg-surface-2/40 p-2">
      <div className="mb-1.5 flex items-center gap-1.5">
        <GripVertical size={14} className="shrink-0 text-text-muted" aria-hidden />
        <select value={filtro.prop} aria-label="Propriedade" onChange={(e) => { const nova = propriedadePorId(e.target.value)!; onChange({ prop: nova.id, op: OPERADORES[nova.tipo][0].op, valor: "" }); }} className={`${CAMPO} min-w-0 flex-1`}>
          {PROPRIEDADES.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
        </select>
        <select value={filtro.op} aria-label="Operador" onChange={(e) => onChange({ op: e.target.value as Filtro["op"] })} className={`${CAMPO} min-w-0 flex-1`}>
          {operadores.map((o) => <option key={o.op} value={o.op}>{o.rotulo}</option>)}
        </select>
        <button type="button" onClick={onRemover} aria-label="Remover filtro" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-text-muted hover:bg-surface-2 hover:text-text-primary"><X size={15} /></button>
      </div>
      {!semValor(filtro.op) && (
        <div className="pl-5">
          {prop.tipo === "selecao" ? (
            <select value={filtro.valor} aria-label="Valor" onChange={(e) => onChange({ valor: e.target.value })} className={`${CAMPO} w-full`}>
              <option value="">Escolha…</option>
              {(prop.opcoes?.(contexto) ?? []).map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
            </select>
          ) : prop.tipo === "data" && filtro.op !== "ultimos" ? (
            <input type="date" value={filtro.valor} aria-label="Data" onChange={(e) => onChange({ valor: e.target.value })} className={`${CAMPO} w-full`} />
          ) : prop.tipo === "numero" || filtro.op === "ultimos" ? (
            <input type="number" min={0} value={filtro.valor} aria-label="Valor" placeholder="Digite um número…" onChange={(e) => onChange({ valor: e.target.value })} className={`${CAMPO} w-full`} />
          ) : (
            <>
              <input value={filtro.valor} aria-label="Valor" placeholder="Digite um valor…" list={prop.tipo === "multi" ? listaTags : undefined} onChange={(e) => onChange({ valor: e.target.value })} className={`${CAMPO} w-full`} />
              {prop.tipo === "multi" && <datalist id={listaTags}>{contexto.tags.map((t) => <option key={t} value={t} />)}</datalist>}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function PainelOrdem({ estado, onChange, onFechar }: { estado: EstadoFiltros; onChange: (e: EstadoFiltros) => void; onFechar: () => void }) {
  const [adicionando, setAdicionando] = useState(false);
  const definir = (ordens: Ordenacao[]) => onChange({ ...estado, ordens });

  if (adicionando) {
    return (
      <Painel titulo="Nova ordenação" onFechar={onFechar} onVoltar={() => setAdicionando(false)}>
        <EscolherPropriedade excluir={estado.ordens.map((o) => o.prop)} onEscolher={(p) => { definir([...estado.ordens, { prop: p.id, dir: "asc" }]); setAdicionando(false); }} />
      </Painel>
    );
  }

  const mover = (i: number, delta: number) => {
    const j = i + delta;
    if (j < 0 || j >= estado.ordens.length) return;
    const copia = estado.ordens.slice();
    [copia[i], copia[j]] = [copia[j], copia[i]];
    definir(copia);
  };

  return (
    <Painel titulo="Ordenar" onFechar={onFechar}>
      <div className="flex flex-col gap-2">
        {estado.ordens.map((o, i) => {
          const prop = propriedadePorId(o.prop);
          if (!prop) return null;
          return (
            <div key={o.prop} className="flex items-center gap-1.5">
              <div className="flex shrink-0 flex-col">
                <button type="button" aria-label="Subir prioridade" disabled={i === 0} onClick={() => mover(i, -1)} className="h-4 w-6 text-[10px] leading-none text-text-muted disabled:opacity-25 hover:text-text-primary">▲</button>
                <button type="button" aria-label="Descer prioridade" disabled={i === estado.ordens.length - 1} onClick={() => mover(i, 1)} className="h-4 w-6 text-[10px] leading-none text-text-muted disabled:opacity-25 hover:text-text-primary">▼</button>
              </div>
              <select value={o.prop} aria-label="Propriedade" onChange={(e) => definir(estado.ordens.map((x, k) => (k === i ? { ...x, prop: e.target.value } : x)))} className={`${CAMPO} min-w-0 flex-1`}>
                {PROPRIEDADES.filter((p) => p.id === o.prop || !estado.ordens.some((x) => x.prop === p.id)).map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
              </select>
              <select value={o.dir} aria-label="Direção" onChange={(e) => definir(estado.ordens.map((x, k) => (k === i ? { ...x, dir: e.target.value as "asc" | "desc" } : x)))} className={`${CAMPO} min-w-0 flex-1`}>
                <option value="asc">{rotuloDirecao(prop, "asc")}</option>
                <option value="desc">{rotuloDirecao(prop, "desc")}</option>
              </select>
              <button type="button" onClick={() => definir(estado.ordens.filter((_, k) => k !== i))} aria-label="Remover ordenação" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-text-muted hover:bg-surface-2 hover:text-text-primary"><X size={15} /></button>
            </div>
          );
        })}
        {estado.ordens.length === 0 && <p className="px-1 py-2 text-sm text-text-muted">Sem ordenação: a ordem original da lista é mantida.</p>}
      </div>
      {estado.ordens.length < PROPRIEDADES.length && <button type="button" onClick={() => setAdicionando(true)} className="mt-2 flex min-h-9 items-center gap-2 rounded-lg px-2 text-sm text-text-secondary hover:bg-surface-2"><Plus size={15} />Adicionar ordenação</button>}
      {estado.ordens.length > 0 && <button type="button" onClick={() => definir([])} className="flex min-h-9 items-center gap-2 rounded-lg px-2 text-sm text-text-secondary hover:bg-surface-2"><Trash2 size={15} />Excluir ordenação</button>}
    </Painel>
  );
}

export { ESTADO_VAZIO };
