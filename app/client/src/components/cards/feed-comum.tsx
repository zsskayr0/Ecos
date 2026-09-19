import { useEffect, useRef, useState, type ReactNode } from "react";
import { ExternalLink, Folder, Globe, Tag } from "lucide-react";
import { tarefas, type TarefaDetalhe } from "@/lib/api";
import { useRefreshBus } from "@/lib/refresh-bus";

export interface PastaOpcao { caminho: string; nome: string }

export const nomeDaPasta = (caminho?: string | null) => caminho?.split("/").filter(Boolean).pop();

/** Detalhe da tarefa (subtarefas, prazo, corpo) — o feed só traz o resumo. Busca uma vez por versão do refresh-bus. */
export function useTarefaDetalhe(id: string) {
  const { versao } = useRefreshBus();
  const [detalhe, setDetalhe] = useState<TarefaDetalhe | null>(null);
  useEffect(() => {
    let ativo = true;
    tarefas.obter(id).then((d) => { if (ativo) setDetalhe(d); }).catch(() => { /* o card funciona só com o resumo */ });
    return () => { ativo = false; };
  }, [id, versao]);
  return [detalhe, setDetalhe] as const;
}

export function PastaChip({ caminho }: { caminho?: string | null }) {
  const nome = nomeDaPasta(caminho);
  return nome
    ? <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-text-secondary"><Folder size={13} strokeWidth={1.8} className="shrink-0 text-steel-300" /><span className="truncate">{nome}</span></span>
    : <span className="text-xs text-text-muted">Sem pasta</span>;
}

export function TagsChips({ tags, max = 3 }: { tags: string[]; max?: number }) {
  if (!tags.length) return null;
  return (
    <span className="flex min-w-0 items-center gap-1 overflow-hidden">
      <Tag size={12} strokeWidth={1.75} className="shrink-0 text-text-muted" />
      {tags.slice(0, max).map((tag) => <span key={tag} className="shrink-0 rounded-md bg-surface-3 px-1.5 py-0.5 text-[11px] text-text-secondary">#{tag}</span>)}
      {tags.length > max && <span className="shrink-0 text-[11px] text-text-muted">+{tags.length - max}</span>}
    </span>
  );
}

export function CartaoLink({ link }: { link: { url: string; dominio: string; rotulo: string } }) {
  return (
    <a href={link.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="flex items-center gap-3 rounded-xl border border-border bg-surface-2 px-3 py-2 hover:bg-surface-3">
      <Globe size={16} className="shrink-0 text-steel-300" />
      <span className="min-w-0 flex-1"><span className="block truncate text-sm text-text-primary">{link.rotulo}</span><span className="block truncate text-xs text-text-muted">{link.dominio}</span></span>
      <ExternalLink size={13} className="shrink-0 text-text-muted" />
    </a>
  );
}

/** Botão de ícone da barra que aparece no hover do card. */
export function BotaoAcao({ titulo, onClick, children, ativo }: { titulo: string; onClick: () => void; children: ReactNode; ativo?: boolean }) {
  return <button type="button" title={titulo} aria-label={titulo} onClick={(e) => { e.stopPropagation(); onClick(); }} className={`flex h-7 w-7 items-center justify-center rounded-md text-text-secondary hover:bg-surface-3 hover:text-text-primary ${ativo ? "bg-surface-3" : ""}`}>{children}</button>;
}

/** Menu pequeno ancorado no botão; fecha ao clicar fora. */
export function MenuAcao({ aberto, onFechar, children }: { aberto: boolean; onFechar: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onFechar(); };
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  }, [aberto, onFechar]);
  if (!aberto) return null;
  return <div ref={ref} role="menu" onClick={(e) => e.stopPropagation()} className="absolute right-0 top-full z-30 mt-1 max-h-64 w-52 overflow-y-auto rounded-xl border border-border bg-surface-1 p-1 shadow-nav">{children}</div>;
}

export const ItemMenu = ({ onClick, children, ativo }: { onClick: () => void; children: ReactNode; ativo?: boolean }) =>
  <button type="button" role="menuitem" onClick={onClick} className={`flex min-h-9 w-full items-center rounded-lg px-3 text-left text-sm text-text-primary hover:bg-surface-2 ${ativo ? "bg-surface-2" : ""}`}>{children}</button>;

/** Barra de ações: some até o hover/foco no desktop; em telas de toque fica sempre visível. */
export const CLASSE_BARRA = "flex items-center gap-0.5 opacity-0 transition-opacity group-hover/cartao:opacity-100 group-focus-within/cartao:opacity-100 [@media(hover:none)]:opacity-100";

/** Fim do conteúdo cortado no card expandido: leva ao documento completo. */
export function AvisoCortado({ onAbrir, tipo }: { onAbrir: () => void; tipo: "nota" | "tarefa" }) {
  return (
    <div className="mt-2 flex items-center gap-2 rounded-xl border border-dashed border-border bg-surface-2 px-3 py-2 text-xs text-text-muted">
      <span className="flex-1">Conteúdo muito longo — o resto não cabe no feed.</span>
      <button type="button" onClick={onAbrir} className="flex shrink-0 items-center gap-1 font-medium text-steel-300 hover:underline">Abrir {tipo} para ver tudo<ExternalLink size={12} /></button>
    </div>
  );
}
