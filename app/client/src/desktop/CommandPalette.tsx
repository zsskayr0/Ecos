import { useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { Dialog } from "@/components/common/Dialog";
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
import { busca, vault } from "@/lib/api";
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
  /** Segunda linha (trecho da nota, por exemplo). */
  detalhe?: string;
  atalho?: string;
  icone: ComponentType<LucideProps>;
  executar: (emAba: boolean) => void;
}

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export type FiltroPaleta = "tudo" | "comandos" | "notas" | "tarefas";

const FILTROS: { valor: FiltroPaleta; rotulo: string; dica: string }[] = [
  { valor: "tudo", rotulo: "Tudo", dica: "" },
  { valor: "comandos", rotulo: "Comandos", dica: ">" },
  { valor: "notas", rotulo: "Notas", dica: "n:" },
  { valor: "tarefas", rotulo: "Tarefas", dica: "t:" },
];

/** Atalhos de prefixo (`>`, `n:`, `t:`) escolhem o filtro sem tirar a mão do teclado; sem prefixo vale o filtro dos botões. */
export function interpretarConsulta(termo: string, filtro: FiltroPaleta): { texto: string; filtro: FiltroPaleta } {
  const bruto = termo.trimStart();
  if (bruto.startsWith(">")) return { texto: bruto.slice(1).trim(), filtro: "comandos" };
  const prefixo = /^([nt]):\s*/i.exec(bruto);
  if (prefixo) return { texto: bruto.slice(prefixo[0].length).trim(), filtro: prefixo[1].toLowerCase() === "n" ? "notas" : "tarefas" };
  return { texto: bruto.trim(), filtro };
}

interface Resultados {
  notas: { id: string; titulo: string; espaco: string; trecho?: string }[];
  tarefas: { id: string; titulo: string; espaco: string; status?: string }[];
  transacoes?: { id: string; descricao: string; data: string; valor_centavos: number }[];
}

export function CommandPalette({
  aberta,
  aoFechar,
  aoAbrirDocumento,
  aoAbrirCofre,
  escopoCofre = false,
}: {
  aberta: boolean;
  aoFechar: () => void;
  aoAbrirDocumento: (path: string, emAba: boolean) => void;
  aoAbrirCofre: () => void;
  escopoCofre?: boolean;
}) {
  const { state, dispatch } = useWorkspace();
  const { abrirCaptura } = useAppUI();
  const { logout } = useAuth();
  const { equipes } = useMinhasEquipes();
  const [termo, setTermo] = useState("");
  const [ativo, setAtivo] = useState(0);
  const [resultados, setResultados] = useState<Resultados | null>(null);
  const [filtroManual, setFiltroManual] = useState<FiltroPaleta>("tudo");
  const [buscando, setBuscando] = useState(false);
  const { texto: consultaTexto, filtro } = interpretarConsulta(termo, escopoCofre ? "tudo" : filtroManual);
  const inputRef = useRef<HTMLInputElement>(null);
  const listaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberta) return;
    setTermo("");
    setFiltroManual("tudo");
    setAtivo(0);
    setResultados(null);
    inputRef.current?.focus();
  }, [aberta]);

  useEffect(() => {
    const consulta = consultaTexto;
    if (!aberta || consulta.length < 2 || filtro === "comandos") {
      setResultados(null);
      setBuscando(false);
      return;
    }
    let vivo = true;
    setBuscando(true);
    const t = setTimeout(() => {
      (escopoCofre
        ? vault.transacoes.listar({limit:100}).then(r=>({notas:[],tarefas:[],transacoes:r.items.filter(t=>`${t.descricao} ${t.observacoes??""}`.toLowerCase().includes(consulta.toLowerCase())).slice(0,12)}))
        : busca.buscar(consulta, filtro === "notas" ? { tipo: "nota" } : filtro === "tarefas" ? { tipo: "tarefa" } : {}).then(r=>{
            const limite = filtro === "tudo" ? 5 : 15;
            return { notas: filtro === "tarefas" ? [] : r.notas.slice(0, limite), tarefas: filtro === "notas" ? [] : r.tarefas.slice(0, limite) };
          }))
        .then((r) => { if (vivo) { setResultados(r); setBuscando(false); } })
        .catch(() => { if (vivo) { setResultados(null); setBuscando(false); } });
    }, 250);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, [consultaTexto, filtro, aberta, escopoCofre]);

  const comandos = useMemo<Comando[]>(() => {
    const abrir = (path: string) => dispatch({ type: "open", path, where: "focused", reuse: "modulo" });
    const abrirAoLado = (path: string) => dispatch({ type: "open", path, where: "new-pane", reuse: "modulo" });
    const focada = state.panes.find((p) => p.id === state.focusedPaneId);
    const podeDividir = !!focada && focada.tabs.length > 1;

    const lista: Comando[] = [
      { id: "nova-nota", grupo: "Criar", rotulo: "Nova nota", icone: FilePlus2, executar: () => abrirCaptura("nota") },
      { id: "nova-tarefa", grupo: "Criar", rotulo: "Nova tarefa", icone: ListPlus, executar: () => abrirCaptura("tarefa") },
      { id: "nova-transacao", grupo: "Criar", rotulo: "Nova transação", icone: Wallet, executar: () => abrirCaptura("transacao") },
      { id: "organizar-pastas", grupo: "Configurações", rotulo: "Organizar pastas", dica: "Notas e tarefas", icone: ListChecks, executar: () => abrir("/configuracoes/organizacao") },
    ];

    for (const id of [...RAIL_PRINCIPAL, ...RAIL_UTILITARIOS, "busca", "perfil", "ajuda"] as const) {
      const m = moduloPorId(id);
      lista.push({ id: `ir-${id}`, grupo: "Ir para", rotulo: m.titulo, icone: m.icone, executar: () => id === "cofre" ? aoAbrirCofre() : abrir(m.raiz) });
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
    return escopoCofre ? lista.filter((item) => item.id === "nova-transacao" || item.id === "ir-cofre" || item.id === "sair") : lista;
  }, [state.panes, state.focusedPaneId, equipes, dispatch, abrirCaptura, logout, aoAbrirCofre, escopoCofre]);

  const itens = useMemo<Comando[]>(() => {
    const q = semAcento(consultaTexto);
    const soConteudo = filtro === "notas" || filtro === "tarefas";
    const filtrados = soConteudo
      ? []
      : q
        ? comandos.filter((c) => semAcento(`${c.rotulo} ${c.grupo}`).includes(q))
        : filtro === "comandos" ? comandos : comandos.filter((c) => c.grupo === "Criar" || c.grupo === "Ir para");

    const conteudo: Comando[] = [
      ...(resultados?.notas ?? []).map<Comando>((n) => ({
        id: `nota-${n.id}`,
        grupo: "Notas",
        rotulo: n.titulo || "Sem título",
        dica: n.espaco,
        detalhe: n.trecho?.trim() || undefined,
        icone: StickyNote,
        executar: (emAba) => aoAbrirDocumento(`/notas/nota/${n.id}`, emAba),
      })),
      ...(resultados?.tarefas ?? []).map<Comando>((t) => ({
        id: `tarefa-${t.id}`,
        grupo: "Tarefas",
        rotulo: t.titulo,
        dica: t.status === "concluida" ? "Concluída" : t.espaco,
        icone: ListChecks,
        executar: (emAba) => aoAbrirDocumento(`/tarefa/${t.id}`, emAba),
      })),
      ...(resultados?.transacoes ?? []).map<Comando>((t) => ({id:`transacao-${t.id}`,grupo:"Transações",rotulo:t.descricao,dica:new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(t.valor_centavos/100),icone:Wallet,executar:()=>aoAbrirDocumento(`/cofre/transacao/${t.id}`,false)})),
    ];
    return [...filtrados, ...conteudo];
  }, [comandos, consultaTexto, filtro, resultados, aoAbrirDocumento]);

  useEffect(() => setAtivo(0), [termo, filtroManual]);
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
    <Dialog
      rotulo="Paleta de comandos"
      onFechar={aoFechar}
      className="fixed inset-0 z-[60] flex items-start justify-center bg-black/60 px-4 pt-[12dvh] backdrop-blur-[2px]"
    >
      <div
        className="flex max-h-[64dvh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-border bg-surface-2 shadow-nav ecos-fade-in"
      >
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <Search size={16} className="text-text-muted" />
          <input
            ref={inputRef}
            value={termo}
            onChange={(e) => setTermo(e.target.value)}
            placeholder={escopoCofre?"Busque descrições e observações do Cofre…":"Digite um comando ou busque nas suas notas e tarefas…"}
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
              }
            }}
          />
          <kbd className="rounded border border-border bg-surface-3 px-1.5 py-0.5 font-mono text-[10px] text-text-muted">Esc</kbd>
        </div>

        {!escopoCofre && (
          <div role="group" aria-label="Filtrar resultados" className="flex flex-wrap items-center gap-1.5 border-b border-border px-3 py-2">
            {FILTROS.map((f) => (
              <button
                key={f.valor}
                type="button"
                aria-pressed={filtro === f.valor}
                title={f.dica ? `Atalho: digite ${f.dica} antes do termo` : undefined}
                onClick={() => { setFiltroManual(f.valor); inputRef.current?.focus(); }}
                className={`min-h-7 rounded-pill px-2.5 text-xs ${filtro === f.valor ? "bg-cyan/15 font-medium text-text-primary" : "bg-surface-3 text-text-secondary hover:text-text-primary"}`}
              >
                {f.rotulo}
              </button>
            ))}
            <span className="ml-auto hidden text-[10px] text-text-muted sm:inline">Ctrl+Enter abre em nova aba</span>
          </div>
        )}

        <div ref={listaRef} className="overflow-y-auto p-1.5">
          {buscando && <p role="status" className="px-3 py-2 text-xs text-text-muted">Buscando…</p>}
          {itens.length === 0 && !buscando && <p className="px-3 py-8 text-center text-sm text-text-muted">{consultaTexto.length === 1 ? "Digite ao menos 2 letras para buscar." : "Nada encontrado. Tente outro termo ou outro filtro."}</p>}
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
                  onFocus={() => setAtivo(i)}
                  onMouseMove={() => setAtivo(i)}
                  onClick={(e) => executar(item, e.ctrlKey || e.metaKey)}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-text-primary ${
                    i === ativo ? "bg-cyan/10" : ""
                  }`}
                >
                  <item.icone size={15} strokeWidth={1.75} className={i === ativo ? "text-cyan" : "text-text-muted"} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{item.rotulo}</span>
                    {item.detalhe && <span className="block truncate text-xs text-text-muted">{item.detalhe}</span>}
                  </span>
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
    </Dialog>
  );
}
