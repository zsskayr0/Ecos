import { useMemo, useRef, useState } from "react";
import { Eye, EyeOff, FileText, ListChecks, Plus, Search, Trash2, X } from "lucide-react";
import { anexarMarcador, blocosNoCorpo } from "@/lib/subtarefas-bloco";
import { Dialog } from "@/components/common/Dialog";
import type { SubtarefaInput } from "@/lib/api";

/** Nome exibido do bloco padrão (subtarefas sem `bloco`). */
export const BLOCO_PADRAO = "Geral";

export interface GrupoSubtarefas { bloco: string | null; itens: { item: SubtarefaInput; indice: number }[] }

/** Agrupa pelo `bloco`, na ordem em que cada bloco aparece; o bloco padrão (sem nome) vem primeiro. */
export function agruparSubtarefas(lista: SubtarefaInput[]): GrupoSubtarefas[] {
  const grupos = new Map<string | null, GrupoSubtarefas>();
  lista.forEach((item, indice) => {
    const bloco = item.bloco?.trim() || null;
    if (!grupos.has(bloco)) grupos.set(bloco, { bloco, itens: [] });
    grupos.get(bloco)!.itens.push({ item, indice });
  });
  return [...grupos.values()].sort((a, b) => (a.bloco === null ? -1 : b.bloco === null ? 1 : 0));
}

/** Insere o item no fim do bloco (logo depois do último item dele) ou no fim da lista, se o bloco ainda não tem itens. */
export function adicionarNoBloco(lista: SubtarefaInput[], bloco: string | null, titulo: string): SubtarefaInput[] {
  const novo: SubtarefaInput = { titulo, concluida: false, ...(bloco ? { bloco } : {}) };
  let ultimo = -1;
  lista.forEach((s, i) => { if ((s.bloco?.trim() || null) === bloco) ultimo = i; });
  if (ultimo < 0) return [...lista, novo];
  return [...lista.slice(0, ultimo + 1), novo, ...lista.slice(ultimo + 1)];
}

const CHAVE_OCULTAR = "ecos.subtarefas.ocultarConcluidas";
function lerOcultar(): boolean { try { return localStorage.getItem(CHAVE_OCULTAR) === "1"; } catch { return false; } }
function gravarOcultar(v: boolean) { try { localStorage.setItem(CHAVE_OCULTAR, v ? "1" : "0"); } catch { /* sem armazenamento */ } }

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

interface Props {
  titulo: string;
  subtarefas: SubtarefaInput[];
  onChange: (subtarefas: SubtarefaInput[]) => void;
  onFechar: () => void;
  /** Corpo da tarefa: com ele, cada bloco mostra se está no texto e oferece "Pôr no texto". */
  corpo?: string;
  onCorpoChange?: (corpo: string) => void;
}

/** Tela grande de subtarefas: todos os blocos juntos, com contador, busca e "ocultar concluídas". Só tarefas têm subtarefas. */
export function SubtarefasTela({ titulo, subtarefas, onChange, onFechar, corpo, onCorpoChange }: Props) {
  const noTexto = useMemo(() => new Set(corpo === undefined ? [] : blocosNoCorpo(corpo)), [corpo]);
  const [ocultar, setOcultar] = useState(lerOcultar);
  const [busca, setBusca] = useState("");
  const [novos, setNovos] = useState<Record<string, string>>({});
  const [editando, setEditando] = useState<number | null>(null);
  const [rascunho, setRascunho] = useState("");
  const [novoBloco, setNovoBloco] = useState<string | null>(null);
  const [blocosVazios, setBlocosVazios] = useState<string[]>([]);
  const refs = useRef<Record<string, HTMLInputElement | null>>({});

  const grupos = useMemo(() => {
    const g = agruparSubtarefas(subtarefas);
    for (const b of blocosVazios) if (!g.some((x) => x.bloco === b)) g.push({ bloco: b, itens: [] });
    if (!g.length) g.push({ bloco: null, itens: [] });
    return g;
  }, [subtarefas, blocosVazios]);
  const feitas = subtarefas.filter((s) => s.concluida).length;
  const termo = semAcento(busca.trim());
  const visivel = (s: SubtarefaInput) => (!ocultar || !s.concluida) && (!termo || semAcento(s.titulo).includes(termo));
  const chave = (bloco: string | null) => bloco ?? "";

  function alternar(indice: number) { onChange(subtarefas.map((s, i) => (i === indice ? { ...s, concluida: !s.concluida } : s))); }
  function remover(indice: number) { onChange(subtarefas.filter((_, i) => i !== indice)); }
  function salvarTitulo(indice: number) {
    const t = rascunho.trim();
    setEditando(null);
    if (!t) return remover(indice);
    if (t !== subtarefas[indice].titulo) onChange(subtarefas.map((s, i) => (i === indice ? { ...s, titulo: t } : s)));
  }
  function adicionar(bloco: string | null) {
    const t = (novos[chave(bloco)] ?? "").trim();
    if (!t) return;
    onChange(adicionarNoBloco(subtarefas, bloco, t));
    setNovos((n) => ({ ...n, [chave(bloco)]: "" }));
  }
  function criarBloco() {
    const nome = (novoBloco ?? "").trim().slice(0, 60);
    setNovoBloco(null);
    if (!nome || nome === BLOCO_PADRAO || grupos.some((g) => g.bloco === nome)) return;
    setBlocosVazios((b) => [...b, nome]);
    window.setTimeout(() => refs.current[nome]?.focus(), 0);
  }

  const pct = subtarefas.length ? (feitas / subtarefas.length) * 100 : 0;
  const comTexto = corpo !== undefined && !!onCorpoChange;

  return (
    <Dialog onFechar={onFechar} rotuloId="subtarefas-tela-titulo" className="fixed inset-0 z-50 flex items-end justify-center bg-black/55 md:items-center md:p-6">
      {/* A janela do documento fecha com Esc no onKeyDown dela (React), antes do Esc do Dialog: o Esc daqui não pode subir. */}
      <div onKeyDown={(e) => { if (e.key === "Escape" && !e.defaultPrevented) { e.preventDefault(); e.stopPropagation(); onFechar(); } }}
        className="ecos-painel-entrando flex max-h-[88dvh] w-full flex-col rounded-t-2xl border-t border-border bg-surface-1 pb-[env(safe-area-inset-bottom)] shadow-nav md:h-[min(80dvh,46rem)] md:max-w-xl md:rounded-2xl md:border md:pb-0">
        <header className="flex flex-col gap-3 px-4 pb-3 pt-4 md:px-5">
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <h2 id="subtarefas-tela-titulo" className="text-base font-semibold text-text-primary">Subtarefas</h2>
              <p className="truncate text-xs text-text-muted">{titulo || "Sem título"}</p>
            </div>
            <button type="button" onClick={onFechar} aria-label="Fechar" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-text-muted hover:bg-surface-2 hover:text-text-primary"><X size={19} /></button>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative h-1.5 flex-1 rounded-full bg-surface-3" aria-hidden><i className="absolute inset-y-0 left-0 rounded-full bg-steel-400/70 transition-[width] duration-300 ease-out motion-reduce:transition-none" style={{ width: `${pct}%` }} /></div>
            <span className="shrink-0 text-xs text-text-secondary" aria-live="polite"><b className="font-semibold text-text-primary">{feitas}</b> de {subtarefas.length}</span>
          </div>
          <div className="flex items-center gap-2">
            <label className="relative flex min-w-0 flex-1 items-center">
              <Search size={15} className="pointer-events-none absolute left-3 text-text-muted" aria-hidden />
              <span className="sr-only">Buscar subtarefas</span>
              <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar nas subtarefas" className="ecos-input h-10 w-full !py-0 !pl-9 text-sm" />
            </label>
            <button type="button" aria-pressed={ocultar} onClick={() => { setOcultar(!ocultar); gravarOcultar(!ocultar); }} title={ocultar ? "Mostrar concluídas" : "Ocultar concluídas"}
              className="flex h-10 shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary aria-pressed:border-steel-400 aria-pressed:text-text-primary">
              {ocultar ? <EyeOff size={15} aria-hidden /> : <Eye size={15} aria-hidden />}<span className="hidden sm:inline">{ocultar ? "Concluídas ocultas" : "Ocultar concluídas"}</span>
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto border-t border-border px-4 py-4 md:px-5">
          {grupos.map((g) => {
            const visiveis = g.itens.filter(({ item }) => visivel(item));
            const feitasGrupo = g.itens.filter(({ item }) => item.concluida).length;
            const k = chave(g.bloco);
            if (termo && !visiveis.length) return null;
            return (
              <section key={k} aria-label={`Bloco ${g.bloco ?? BLOCO_PADRAO}`}>
                {(grupos.length > 1 || g.bloco || comTexto) && <h3 className="mb-1 flex min-h-7 items-center gap-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
                  <span className="min-w-0 truncate">{g.bloco ?? BLOCO_PADRAO}</span>
                  {g.itens.length > 0 && <span className="flex items-center gap-1 text-[11px] font-normal normal-case tracking-normal"><ListChecks size={12} aria-hidden />{feitasGrupo}/{g.itens.length}</span>}
                  {comTexto && (noTexto.has(g.bloco)
                    ? <span className="ml-auto flex items-center gap-1 text-[11px] font-normal normal-case tracking-normal" title="Este bloco aparece na descrição"><FileText size={12} aria-hidden />No texto</span>
                    : <button type="button" onClick={() => onCorpoChange!(anexarMarcador(corpo!, g.bloco))} title="Acrescenta o bloco no fim da descrição" className="ml-auto flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-medium normal-case tracking-normal text-steel-300 transition-colors hover:bg-surface-2"><FileText size={12} aria-hidden />Pôr no texto</button>)}
                </h3>}
                <ul>
                  {visiveis.map(({ item, indice }) => (
                    <li key={item.id ?? `novo-${indice}`} className="group flex min-w-0 items-center gap-3 rounded-lg px-2 transition-colors hover:bg-surface-2">
                      <input type="checkbox" checked={item.concluida} onChange={() => alternar(indice)} aria-label={`Concluir ${item.titulo}`} className="h-4 w-4 shrink-0 cursor-pointer accent-steel-500" />
                      {editando === indice
                        ? <input autoFocus value={rascunho} onChange={(e) => setRascunho(e.target.value)} onBlur={() => salvarTitulo(indice)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); salvarTitulo(indice); } if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setEditando(null); } }} aria-label="Editar subtarefa" className="ecos-input my-1 h-9 min-w-0 flex-1 !py-0 text-sm" />
                        : <button type="button" onClick={() => { setEditando(indice); setRascunho(item.titulo); }} title="Clique para editar" className={`min-h-10 min-w-0 flex-1 cursor-text break-words py-2 text-left text-sm ${item.concluida ? "text-text-secondary line-through" : "text-text-primary"}`}>{item.titulo}</button>}
                      <button type="button" onClick={() => remover(indice)} aria-label={`Apagar ${item.titulo}`} title="Apagar" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-text-muted transition-opacity hover:bg-surface-3 hover:text-error focus-visible:opacity-100 md:opacity-0 md:group-hover:opacity-100"><Trash2 size={14} /></button>
                    </li>
                  ))}
                  {!visiveis.length && g.itens.length > 0 && <li className="px-2 py-2 text-sm text-text-muted">Tudo concluído aqui.</li>}
                </ul>
                {!termo && <div className="flex items-center gap-3 rounded-lg px-2 focus-within:bg-surface-2">
                  <Plus size={16} className="shrink-0 text-text-muted" aria-hidden />
                  <input ref={(el) => { refs.current[k] = el; }} value={novos[k] ?? ""} onChange={(e) => setNovos((n) => ({ ...n, [k]: e.target.value }))}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); adicionar(g.bloco); } }}
                    placeholder="Adicionar subtarefa" aria-label={`Adicionar subtarefa em ${g.bloco ?? BLOCO_PADRAO}`} className="min-h-10 min-w-0 flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-muted focus-visible:outline-none" />
                </div>}
              </section>
            );
          })}
          {termo && !subtarefas.some(visivel) && <p className="py-6 text-center text-sm text-text-muted">Nenhuma subtarefa encontrada.</p>}
        </div>

        <footer className="flex items-center gap-2 border-t border-border px-4 py-3 md:px-5">
          {novoBloco === null
            ? <button type="button" onClick={() => setNovoBloco("")} className="flex h-10 items-center gap-2 rounded-lg px-3 text-sm font-medium text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary"><Plus size={16} aria-hidden />Novo bloco</button>
            : <input autoFocus value={novoBloco} maxLength={60} onChange={(e) => setNovoBloco(e.target.value)} onBlur={criarBloco} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); criarBloco(); } if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setNovoBloco(null); } }} placeholder="Nome do bloco (ex.: Fase 2)" aria-label="Nome do novo bloco" className="ecos-input h-10 min-w-0 flex-1 !py-0 text-sm" />}
          <button type="button" onClick={onFechar} className="ml-auto h-10 shrink-0 rounded-xl bg-steel-500 px-4 text-sm font-semibold text-white">Concluir</button>
        </footer>
      </div>
    </Dialog>
  );
}
