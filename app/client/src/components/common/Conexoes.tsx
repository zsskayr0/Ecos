import { useEffect, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, CheckCircle2, FileText, Link2 } from "lucide-react";
import { links, type ConexoesItem } from "@/lib/api";
import { useAbrirDestino, type TipoItem } from "@/lib/wikilinks";

interface Props {
  tipo: TipoItem;
  id: string | undefined;
  /** Muda quando o item é salvo (o servidor reindexa os links a cada gravação): dispara nova leitura. */
  versao?: string | number | null;
  /** Dentro do painel lateral do modo foco: sem borda e com títulos menores. */
  compacto?: boolean;
}

type Lado = "saida" | "entrada";

/** Conexões de uma Nota ou Tarefa: para onde ela aponta (`[[...]]`) e quem aponta para ela. Cada linha abre o destino. */
export function Conexoes({ tipo, id, versao, compacto = false }: Props) {
  const [dados, setDados] = useState<ConexoesItem | null>(null);
  const [indisponivel, setIndisponivel] = useState(false);
  const abrir = useAbrirDestino();

  useEffect(() => {
    if (!id) return;
    let ativo = true;
    links.de(tipo, id).then((d) => { if (ativo) { setDados(d); setIndisponivel(false); } }).catch(() => { if (ativo) setIndisponivel(true); });
    return () => { ativo = false; };
  }, [tipo, id, versao]);

  if (!id || (indisponivel && !dados)) return null;
  const total = (dados?.entrada.length ?? 0) + (dados?.saida.length ?? 0);

  const grupo = (lado: Lado, titulo: string, Icone: typeof ArrowUpRight) => {
    const itens = dados?.[lado] ?? [];
    if (!itens.length) return null;
    return (
      <div className="flex min-w-0 flex-col gap-1" role="group" aria-label={titulo}>
        <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-text-muted"><Icone size={13} aria-hidden />{titulo}<span className="font-normal normal-case tracking-normal">· {itens.length}</span></h3>
        <ul className="flex flex-col gap-0.5">
          {itens.map((item, i) => {
            const t: TipoItem = item.tipo === "tarefa" ? "tarefa" : "nota";
            return (
              <li key={`${t}:${item.id}`} className="ecos-conexao-item" style={{ animationDelay: `${Math.min(i, 8) * 28}ms` }}>
                <button type="button" onClick={(e) => abrir({ tipo: t, id: item.id }, e)} title={`Abrir ${t}: ${item.titulo}`}
                  className="group flex w-full min-w-0 items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-steel-400">
                  <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-transform group-hover:scale-105 ${t === "tarefa" ? "bg-success/15 text-success" : "bg-steel-300/15 text-steel-300"}`}>
                    {t === "tarefa" ? <CheckCircle2 size={14} aria-hidden /> : <FileText size={14} aria-hidden />}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-text-primary">{item.titulo}</span>
                  <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-text-muted">{t === "tarefa" ? "Tarefa" : "Nota"}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    );
  };

  return (
    <section aria-label="Conexões" className={`flex min-w-0 flex-col gap-3 ${compacto ? "" : "border-t border-border pt-6"}`}>
      <div className="flex items-center justify-between gap-2">
        <h2 className={compacto ? "text-xs font-semibold uppercase tracking-wide text-text-muted" : "flex items-center gap-2 text-sm font-semibold text-text-primary"}>
          {!compacto && <Link2 size={16} className="text-steel-300" aria-hidden />}Conexões
        </h2>
        {dados && <span className="text-sm text-text-secondary" aria-live="polite">{total ? `${total} ${total === 1 ? "link" : "links"}` : "Nenhuma"}</span>}
      </div>
      {dados && !total && <p className="text-sm text-text-muted">Digite <code className="rounded bg-surface-3 px-1">[[</code> no texto para ligar esta {tipo} a outras notas e tarefas.</p>}
      {grupo("saida", "Menciona", ArrowUpRight)}
      {grupo("entrada", "Mencionada em", ArrowDownLeft)}
    </section>
  );
}
