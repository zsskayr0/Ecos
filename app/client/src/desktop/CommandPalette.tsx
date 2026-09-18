import { useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import {
  Columns2,
  FilePlus2,
  ListPlus,
  LogOut,
  Plus,
  Search,
  StickyNote,
  ListChecks,
  Users,
  Wallet,
  X,
  type LucideProps,
} from "lucide-react";
import { busca } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useAppUI } from "@/lib/ui-context";
import { useMinhasEquipes } from "@/lib/use-minhas-equipes";
import { RAIL_PRINCIPAL, RAIL_UTILITARIOS, moduloPorId } from "./modules";
import { useWorkspace } from "./workspace-store";

interface Comando {
  id: string;
  grupo: string;
  rotulo: string;
  dica?: string;
  atalho?: string;
  icone: ComponentType<LucideProps>;
  executar: (emAba: boolean) => void;
}

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

interface Resultados {
  notas: { id: string; titulo: string; espaco: string }[];
  tarefas: { id: string; titulo: string; espaco: string }[];
}

export function CommandPalette({
  aberta,
  aoFechar,
  aoAbrirDocumento,
}: {
  aberta: boolean;
  aoFechar: () => void;
  aoAbrirDocumento: (path: string, emAba: boolean) => void;
}) {
  const { state, dispatch } = useWorkspace();
  const { abrirCaptura } = useAppUI();
  const { logout } = useAuth();
  const { equipes } = useMinhasEquipes();
  const [termo, setTermo] = useState("");
  const [ativo, setAtivo] = useState(0);
  const [resultados, setResultados] = useState<Resultados | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberta) return;
    setTermo("");
    setAtivo(0);
    setResultados(null);
    inputRef.current?.focus();
  }, [aberta]);

  useEffect(() => {
    const consulta = termo.trim();
    if (!aberta || consulta.length < 2) {
      setResultados(null);
      return;
    }
    let vivo = true;
    const t = setTimeout(() => {
      busca
        .buscar(consulta)
        .then((r) => vivo && setResultados({ notas: r.notas.slice(0, 5), tarefas: r.tarefas.slice(0, 5) }))
        .catch(() => vivo && setResultados(null));
    }, 250);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, [termo, aberta]);

  const comandos = useMemo<Comando[]>(() => {
    const abrir = (path: string) => dispatch({ type: "open", path, where: "focused", reuse: "modulo" });
    const abrirAoLado = (path: string) => dispatch({ type: "open", path, where: "new-pane", reuse: "modulo" });
    const focada = state.panes.find((p) => p.id === state.focusedPaneId);
    const podeDividir = !!focada && focada.tabs.length > 1;

    const lista: Comando[] = [
      { id: "nova-nota", grupo: "Criar", rotulo: "Nova nota", icone: FilePlus2, executar: () => abrirCaptura("nota") },
      { id: "nova-tarefa", grupo: "Criar", rotulo: "Nova tarefa", icone: ListPlus, executar: () => abrirCaptura("tarefa") },
      { id: "nova-transacao", grupo: "Criar", rotulo: "Nova transação", icone: Wallet, executar: () => abrirCaptura("transacao") },
    ];

    for (const id of [...RAIL_PRINCIPAL, ...RAIL_UTILITARIOS, "busca", "perfil", "ajuda"] as const) {
      const m = moduloPorId(id);
      lista.push({ id: `ir-${id}`, grupo: "Ir para", rotulo: m.titulo, icone: m.icone, executar: () => abrir(m.raiz) });
    }

    for (const id of ["agenda", "tarefas", "notas"] as const) {
      const m = moduloPorId(id);
      lista.push({
        id: `lado-${id}`,
        grupo: "Janela",
        rotulo: `Abrir ${m.titulo} ao lado`,
        dica: "nova coluna",
        icone: Columns2,
        executar: () => abrirAoLado(m.raiz),
      });
    }
    if (podeDividir) {
      lista.push({
        id: "dividir",
        grupo: "Janela",
        rotulo: "Dividir aba ativa à direita",
        atalho: "Ctrl+\\",
        icone: Columns2,
        executar: () => dispatch({ type: "split-active-right" }),
      });
    }
    if (focada) {
      lista.push({
        id: "fechar-aba",
        grupo: "Janela",
        rotulo: "Fechar aba ativa",
        atalho: "Ctrl+W",
        icone: X,
        executar: () => dispatch({ type: "close-tab", paneId: focada.id, tabId: focada.activeTabId }),
      });
    }

    for (const eq of equipes) {
      lista.push({ id: `eq-${eq.id}`, grupo: "Equipes", rotulo: eq.nome, dica: eq.cargo, icone: Users, executar: () => abrir(`/equipe/${eq.id}`) });
    }
    lista.push({ id: "eq-nova", grupo: "Equipes", rotulo: "Criar ou entrar numa equipe", icone: Plus, executar: () => abrir("/equipe/nova") });
    lista.push({ id: "sair", grupo: "Conta", rotulo: "Sair", icone: LogOut, executar: () => void logout() });
    return lista;
  }, [state.panes, state.focusedPaneId, equipes, dispatch, abrirCaptura, logout]);

  const itens = useMemo<Comando[]>(() => {
    const q = semAcento(termo.trim());
    const filtrados = q
      ? comandos.filter((c) => semAcento(`${c.rotulo} ${c.grupo}`).includes(q))
      : comandos.filter((c) => c.grupo === "Criar" || c.grupo === "Ir para");

    const conteudo: Comando[] = [
      ...(resultados?.notas ?? []).map<Comando>((n) => ({
        id: `nota-${n.id}`,
        grupo: "Notas",
        rotulo: n.titulo || "Sem título",
        dica: n.espaco,
        icone: StickyNote,
        executar: (emAba) => aoAbrirDocumento(`/notas/nota/${n.id}`, emAba),
      })),
      ...(resultados?.tarefas ?? []).map<Comando>((t) => ({
        id: `tarefa-${t.id}`,
        grupo: "Tarefas",
        rotulo: t.titulo,
        dica: t.espaco,
        icone: ListChecks,
        executar: (emAba) => aoAbrirDocumento(`/tarefa/${t.id}`, emAba),
      })),
    ];
    return [...filtrados, ...conteudo];
  }, [comandos, termo, resultados, aoAbrirDocumento]);

  useEffect(() => setAtivo(0), [termo]);
  useEffect(() => {
    listaRef.current?.querySelector<HTMLElement>(`[data-indice="${ativo}"]`)?.scrollIntoView({ block: "nearest" });
  }, [ativo]);

  if (!aberta) return null;

  function executar(item: Comando | undefined, emAba: boolean) {
    if (!item) return;
    aoFechar();
    item.executar(emAba);
  }

  let grupoAnterior = "";
  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center bg-black/60 px-4 pt-[12vh] backdrop-blur-[2px]"
      onMouseDown={(e) => e.target === e.currentTarget && aoFechar()}
    >
      <div
        role="dialog"
        aria-label="Paleta de comandos"
        className="flex max-h-[64vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-border bg-surface-2 shadow-nav ecos-fade-in"
      >
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <Search size={16} className="text-text-muted" />
          <input
            ref={inputRef}
            value={termo}
            onChange={(e) => setTermo(e.target.value)}
            placeholder="Digite um comando ou busque nas suas notas e tarefas…"
            className="min-w-0 flex-1 bg-transparent text-sm text-text-primary outline-none placeholder:text-text-muted"
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setAtivo((i) => Math.min(itens.length - 1, i + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setAtivo((i) => Math.max(0, i - 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                executar(itens[ativo], e.ctrlKey || e.metaKey);
              } else if (e.key === "Escape") {
                aoFechar();
              }
            }}
          />
          <kbd className="rounded border border-border bg-surface-3 px-1.5 py-0.5 font-mono text-[10px] text-text-muted">Esc</kbd>
        </div>

        <div ref={listaRef} className="overflow-y-auto p-1.5">
          {itens.length === 0 && <p className="px-3 py-8 text-center text-sm text-text-muted">Nada encontrado. Tente outro termo.</p>}
          {itens.map((item, i) => {
            const cabecalho = item.grupo !== grupoAnterior;
            grupoAnterior = item.grupo;
            return (
              <div key={item.id}>
                {cabecalho && (
                  <p className="px-3 pb-1 pt-2.5 text-[10px] font-semibold uppercase tracking-wider text-text-muted">{item.grupo}</p>
                )}
                <button
                  type="button"
                  data-indice={i}
                  onMouseMove={() => setAtivo(i)}
                  onClick={(e) => executar(item, e.ctrlKey || e.metaKey)}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-text-primary ${
                    i === ativo ? "bg-cyan/10" : ""
                  }`}
                >
                  <item.icone size={15} strokeWidth={1.75} className={i === ativo ? "text-cyan" : "text-text-muted"} />
                  <span className="min-w-0 flex-1 truncate">{item.rotulo}</span>
                  {item.dica && <span className="shrink-0 text-xs text-text-muted">{item.dica}</span>}
                  {item.atalho && (
                    <kbd className="shrink-0 rounded border border-border bg-surface-3 px-1.5 py-0.5 font-mono text-[10px] text-text-secondary">
                      {item.atalho}
                    </kbd>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
