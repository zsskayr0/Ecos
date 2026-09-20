import { useEffect, useState } from "react";
import { ListChecks, Search, StickyNote, X } from "lucide-react";
import { busca, type EventoVinculo } from "@/lib/api";

interface Props {
  tarefas: EventoVinculo[];
  notas: EventoVinculo[];
  onChange: (vinculos: { tarefas: EventoVinculo[]; notas: EventoVinculo[] }) => void;
}

type Resultado = { tipo: "tarefa" | "nota"; id: string; titulo: string };

/** Liga o evento a Tarefas e Notas existentes (vínculo só do Ecos: nunca vai ao Google). */
export function SeletorVinculos({ tarefas, notas, onChange }: Props) {
  const [consulta, setConsulta] = useState("");
  const [resultados, setResultados] = useState<Resultado[]>([]);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    const termo = consulta.trim();
    if (termo.length < 2) { setResultados([]); setErro(null); return; }
    let ativo = true;
    const espera = setTimeout(() => {
      busca.buscar(termo).then((r) => {
        if (!ativo) return;
        setErro(null);
        setResultados([
          ...r.tarefas.map((t) => ({ tipo: "tarefa" as const, id: t.id, titulo: t.titulo })),
          ...r.notas.map((n) => ({ tipo: "nota" as const, id: n.id, titulo: n.titulo })),
        ].slice(0, 8));
      }).catch(() => { if (ativo) { setResultados([]); setErro("Não foi possível buscar agora."); } });
    }, 250);
    return () => { ativo = false; clearTimeout(espera); };
  }, [consulta]);

  const jaLigado = (r: Resultado) => (r.tipo === "tarefa" ? tarefas : notas).some((v) => v.id === r.id);
  const adicionar = (r: Resultado) => {
    const item = { id: r.id, titulo: r.titulo };
    onChange(r.tipo === "tarefa" ? { tarefas: [...tarefas, item], notas } : { tarefas, notas: [...notas, item] });
    setConsulta("");
  };
  const remover = (tipo: "tarefa" | "nota", id: string) =>
    onChange(tipo === "tarefa" ? { tarefas: tarefas.filter((t) => t.id !== id), notas } : { tarefas, notas: notas.filter((n) => n.id !== id) });

  return (
    <div>
      {(tarefas.length > 0 || notas.length > 0) && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {tarefas.map((t) => <Chip key={`t-${t.id}`} icone={<ListChecks size={12} />} texto={t.titulo} onRemover={() => remover("tarefa", t.id)} />)}
          {notas.map((n) => <Chip key={`n-${n.id}`} icone={<StickyNote size={12} />} texto={n.titulo} onRemover={() => remover("nota", n.id)} />)}
        </div>
      )}
      <label className="flex h-10 items-center gap-2 rounded-xl bg-surface-2 px-3 text-sm text-text-primary focus-within:ring-2 focus-within:ring-cyan/50">
        <Search size={15} className="shrink-0 text-text-muted" />
        <input value={consulta} onChange={(e) => setConsulta(e.target.value)} placeholder="Buscar tarefa ou nota para vincular" aria-label="Buscar tarefa ou nota para vincular" className="w-full bg-transparent outline-none placeholder:text-text-muted" />
      </label>
      {erro && <p role="alert" className="mt-1 text-xs text-error">{erro}</p>}
      {resultados.length > 0 && (
        <ul className="mt-1.5 overflow-hidden rounded-xl border border-border bg-surface-1">
          {resultados.map((r) => (
            <li key={`${r.tipo}-${r.id}`}>
              <button type="button" disabled={jaLigado(r)} onClick={() => adicionar(r)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-text-primary transition-colors hover:bg-surface-2 disabled:opacity-40">
                {r.tipo === "tarefa" ? <ListChecks size={14} className="shrink-0 text-text-muted" /> : <StickyNote size={14} className="shrink-0 text-text-muted" />}
                <span className="min-w-0 flex-1 truncate">{r.titulo}</span>
                <span className="shrink-0 text-[11px] text-text-muted">{jaLigado(r) ? "vinculado" : r.tipo === "tarefa" ? "Tarefa" : "Nota"}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Chip({ icone, texto, onRemover }: { icone: React.ReactNode; texto: string; onRemover: () => void }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-surface-2 py-1 pl-2.5 pr-1 text-xs text-text-primary">
      <span className="text-text-muted">{icone}</span>
      <span className="truncate">{texto}</span>
      <button type="button" onClick={onRemover} aria-label={`Remover vínculo com ${texto}`} className="rounded-full p-0.5 text-text-muted hover:bg-surface-3 hover:text-text-primary"><X size={12} /></button>
    </span>
  );
}
