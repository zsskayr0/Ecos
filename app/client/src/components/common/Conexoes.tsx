import { useEffect, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, CheckCircle2, ExternalLink, FileText, Globe, Link2, Maximize2 } from "lucide-react";
import { links, type ConexoesItem } from "@/lib/api";
import { useAbrirCaminho, useAbrirDestino, type TipoItem } from "@/lib/wikilinks";
import { dominio, rotuloCurto, useTitulosExternos } from "@/lib/links-externos";
import { MiniGrafo } from "@/screens/Grafico/MiniGrafo";

interface Props {
  tipo: TipoItem;
  id: string | undefined;
  /** Muda quando o item é salvo (o servidor reindexa os links a cada gravação): dispara nova leitura. */
  versao?: string | number | null;
  /** Dentro do painel lateral do modo foco: sem borda e com títulos menores. */
  compacto?: boolean;
}

type Lado = "saida" | "entrada";

const EXTERNOS_VISIVEIS = 5;

/** Conexões de uma Nota ou Tarefa: para onde ela aponta (`[[...]]`) e quem aponta para ela. Cada linha abre o destino. */
export function Conexoes({ tipo, id, versao, compacto = false }: Props) {
  const [dados, setDados] = useState<ConexoesItem | null>(null);
  const [indisponivel, setIndisponivel] = useState(false);
  const abrir = useAbrirDestino();
  const abrirCaminho = useAbrirCaminho();
  const [todosExternos, setTodosExternos] = useState(false);

  useEffect(() => {
    if (!id) return;
    let ativo = true;
    links.de(tipo, id).then((d) => { if (ativo) { setDados(d); setIndisponivel(false); } }).catch(() => { if (ativo) setIndisponivel(true); });
    return () => { ativo = false; };
  }, [tipo, id, versao]);

  const externos = dados?.externos ?? [];
  const titulos = useTitulosExternos(externos);

  if (!id || (indisponivel && !dados)) return null;
  const total = (dados?.entrada?.length ?? 0) + (dados?.saida?.length ?? 0);
  const visiveis = todosExternos ? externos : externos.slice(0, EXTERNOS_VISIVEIS);

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

  const gruposExternos = () => {
    if (!externos.length) return null;
    return (
      <div className="flex min-w-0 flex-col gap-1" role="group" aria-label="Links externos">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-text-muted"><Globe size={13} aria-hidden />Links externos<span className="font-normal normal-case tracking-normal">· {externos.length}</span></h3>
        <ul className="flex flex-col gap-0.5">
          {visiveis.map((e, i) => {
            const titulo = titulos[e.url] || e.texto || rotuloCurto(e.url);
            return (
              <li key={e.url} className="ecos-conexao-item" style={{ animationDelay: `${Math.min(i, 8) * 28}ms` }}>
                <a href={e.url} target="_blank" rel="noopener noreferrer" title={e.url}
                  className="group flex w-full min-w-0 items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-steel-400">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-surface-3 text-text-secondary transition-transform group-hover:scale-105"><Globe size={14} aria-hidden /></span>
                  <span className="min-w-0 flex-1 truncate text-text-primary">{titulo}</span>
                  <span className="max-w-[40%] shrink-0 truncate text-[10px] font-semibold tracking-wide text-text-muted">{dominio(e.url)}</span>
                  <ExternalLink size={12} className="shrink-0 text-text-muted opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden />
                </a>
              </li>
            );
          })}
        </ul>
        {externos.length > EXTERNOS_VISIVEIS && (
          <button type="button" onClick={() => setTodosExternos((v) => !v)} className="self-start rounded-md px-2 py-1 text-xs text-text-secondary hover:bg-surface-2 hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-steel-400">
            {todosExternos ? "Ver menos" : `Ver mais ${externos.length - EXTERNOS_VISIVEIS}`}
          </button>
        )}
      </div>
    );
  };

  return (
    <section aria-label="Conexões" className={`flex min-w-0 flex-col gap-3 ${compacto ? "" : "border-t border-border pt-6"}`}>
      <div className="flex items-center justify-between gap-2">
        <h2 className={compacto ? "text-xs font-semibold uppercase tracking-wide text-text-muted" : "flex items-center gap-2 text-sm font-semibold text-text-primary"}>
          {!compacto && <Link2 size={16} className="text-steel-300" aria-hidden />}Conexões
        </h2>
        <span className="flex items-center gap-1.5">
        {dados && <span className="text-sm text-text-secondary" aria-live="polite">{total ? `${total} ${total === 1 ? "link" : "links"}` : externos.length ? "" : "Nenhuma"}</span>}
        {dados && (total > 0 || externos.length > 0) && (
          <button type="button" onClick={(e) => abrirCaminho(`/conexoes/${tipo}/${id}`, e)} title="Abrir o mapa de conexões (Ctrl+clique abre em aba)" aria-label="Abrir o mapa de conexões"
            className="flex h-7 w-7 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-steel-400">
            <Maximize2 size={14} aria-hidden />
          </button>
        )}
        </span>
      </div>
      {/* Painel lateral: o mini gráfico fica dentro da própria seção, só quando há ligações. */}
      {compacto && <MiniGrafo itemId={id} semTitulo ocultarVazio />}
      {dados && !total && !externos.length && <p className="text-sm text-text-muted">Digite <code className="rounded bg-surface-3 px-1">[[</code> no texto para ligar esta {tipo} a outras notas e tarefas.</p>}
      {grupo("saida", "Menciona", ArrowUpRight)}
      {grupo("entrada", "Mencionada em", ArrowDownLeft)}
      {gruposExternos()}
    </section>
  );
}
