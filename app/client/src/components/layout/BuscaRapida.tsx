import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ChevronDown, Clock, CornerDownLeft, FileText, ListChecks, Search, Wallet } from "lucide-react";
import { busca, vault, type TransacaoApi } from "@/lib/api";
import { formatMoeda } from "@/lib/format";
import { useAppUI } from "@/lib/ui-context";
import { useAbrirDocumento } from "@/lib/documento-popup";

const CHAVE_RECENTES = "ecos-buscas-recentes";
const DURACAO_SAIDA_MS = 200;

interface Sugestao {
  chave: string;
  tipo: "nota" | "tarefa" | "transacao" | "recente" | "mais";
  titulo: string;
  detalhe?: string;
  /** Classe de cor do ícone (transação roxa, nota azul, tarefa pela prioridade). */
  cor?: string;
  /** Tarefa concluída ou transação efetivada: pesa menos na busca (vem depois) e aparece apagada e riscada. */
  concluida?: boolean;
  destino: string;
}

const COR_PRIORIDADE = { baixa: "text-cyan", media: "text-warning", alta: "text-error" } as const;

const lerRecentes = (): string[] => { try { return JSON.parse(localStorage.getItem(CHAVE_RECENTES) ?? "[]"); } catch { return []; } };
const ICONE = { nota: FileText, tarefa: ListChecks, transacao: Wallet, recente: Clock, mais: ChevronDown } as const;
/** Altura fixa de cada linha (px): é o que permite contar quantas cabem. */
const ALTURA_LINHA = 52;
const ORDEM_TIPO = { nota: 0, tarefa: 1, transacao: 2, recente: 3, mais: 4 } as const;
const PADDING_LISTA = 12;
const ROTULO = { nota: "Nota", tarefa: "Tarefa", transacao: "Cofre", recente: "", mais: "" } as const;

/**
 * Busca rápida: um véu desfocado por cima da tela em uso, com o campo no topo e sugestões enquanto digita.
 * Procura em tudo (notas, tarefas) e, se o Cofre do espaço atual estiver destrancado, nas transações dele.
 * Mostra quantos resultados couberem entre o campo e o teclado virtual (a última linha, "Mostrar tudo", fica colada nele);
 * "Mostrar tudo" amplia a lista aqui mesmo, com rolagem. Enter abre a sugestão marcada; sair é por toque fora, Esc ou Cancelar.
 */
export function BuscaRapida() {
  const { buscaAberta, fecharBusca, espacoAtivo, intercalarEquipes } = useAppUI();
  const [montada, setMontada] = useState(false);
  const [saindo, setSaindo] = useState(false);
  useEffect(() => {
    if (buscaAberta) { setMontada(true); setSaindo(false); return; }
    if (!montada) return;
    setSaindo(true);
    const t = window.setTimeout(() => { setMontada(false); setSaindo(false); }, DURACAO_SAIDA_MS);
    return () => window.clearTimeout(t);
  }, [buscaAberta, montada]);
  if (!montada) return null;
  return <Painel key={espacoAtivo} espaco={intercalarEquipes ? undefined : espacoAtivo} saindo={saindo} fechar={fecharBusca} />;
}

/** `espaco`: só procura nele (pessoal ou a equipe ativa); `undefined` = todos os espaços (modo de equipes intercaladas). */
function Painel({ espaco, saindo, fechar }: { espaco?: string; saindo: boolean; fechar: () => void }) {
  const navigate = useNavigate();
  /** Dentro do Cofre a busca é só de transações: notas e tarefas ficam de fora. */
  const noCofre = useLocation().pathname.startsWith("/cofre");
  const abrirDocumento = useAbrirDocumento();
  const [termo, setTermo] = useState("");
  const [debounced, setDebounced] = useState("");
  const [achados, setAchados] = useState<Sugestao[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [marcada, setMarcada] = useState(0);
  const [tudo, setTudo] = useState(false);
  const [alturaArea, setAlturaArea] = useState(0);
  const [vv, setVv] = useState<{ top: number; height: number }>(() => ({ top: window.visualViewport?.offsetTop ?? 0, height: window.visualViewport?.height ?? window.innerHeight }));
  const areaRef = useRef<HTMLDivElement>(null);
  const [cofreAberto, setCofreAberto] = useState<boolean | null>(null);
  const recentes = useMemo(lerRecentes, []);
  const entrada = useRef<HTMLInputElement>(null);

  useEffect(() => { entrada.current?.focus(); }, []);
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => { if (e.key === "Escape") fechar(); };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [fechar]);
  // Altura visível de verdade (descontando o teclado virtual): o véu acompanha o visualViewport.
  useEffect(() => {
    const v = window.visualViewport;
    if (!v) return;
    const atualizar = () => setVv({ top: v.offsetTop, height: v.height });
    v.addEventListener("resize", atualizar);
    v.addEventListener("scroll", atualizar);
    return () => { v.removeEventListener("resize", atualizar); v.removeEventListener("scroll", atualizar); };
  }, []);
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const medir = () => setAlturaArea(el.clientHeight);
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // O Cofre só entra na busca se o do espaço atual estiver destrancado agora.
  useEffect(() => {
    let vivo = true;
    vault.config().then((c) => { if (vivo) setCofreAberto(!!c.destrancado); }).catch(() => { if (vivo) setCofreAberto(false); });
    return () => { vivo = false; };
  }, []);
  useEffect(() => {
    const t = window.setTimeout(() => { setDebounced(termo.trim()); setTudo(false); }, 160);
    return () => window.clearTimeout(t);
  }, [termo]);

  useEffect(() => {
    if (!debounced) { setAchados([]); setCarregando(false); return; }
    if (cofreAberto === null) return;
    let vivo = true;
    setCarregando(true);
    const doCofre: Promise<TransacaoApi[]> = cofreAberto
      ? vault.busca(debounced, { limit: 40 })
          .then((r) => Promise.allSettled(r.items.slice(0, 40).map((i) => vault.transacoes.obter(i.id))))
          .then((rs) => rs.flatMap((x) => (x.status === "fulfilled" ? [x.value] : [])))
      : Promise.resolve([]);
    Promise.all([(noCofre ? Promise.resolve({ notas: [], tarefas: [] }) : busca.buscar(debounced, espaco ? { espaco } : {})).catch(() => ({ notas: [], tarefas: [] })), doCofre.catch(() => [] as TransacaoApi[])]).then(([r, tx]) => {
      if (!vivo) return;
      setAchados([
        ...r.notas.map((n): Sugestao => ({ chave: `n${n.id}`, tipo: "nota", titulo: n.titulo, cor: "text-sky-400", destino: `/notas/nota/${n.id}` })),
        ...r.tarefas.map((t): Sugestao => ({ chave: `t${t.id}`, tipo: "tarefa", titulo: t.titulo, detalhe: t.status === "concluida" ? "Concluída" : "Pendente", cor: COR_PRIORIDADE[t.prioridade ?? "baixa"] ?? "text-cyan", concluida: t.status === "concluida", destino: `/tarefa/${t.id}` })),
        ...tx.map((x): Sugestao => ({ chave: `x${x.id}`, tipo: "transacao", titulo: x.descricao, detalhe: `${formatMoeda(x.valor_centavos)} · ${x.status === "efetivada" ? "Efetivada" : "Pendente"}`, cor: "text-violet", concluida: x.status === "efetivada", destino: `/cofre/transacao/${x.id}` })),
      ]);
      setMarcada(0);
      setCarregando(false);
    });
    return () => { vivo = false; };
  }, [debounced, cofreAberto, espaco, noCofre]);

  // Linhas que cabem na área livre; se não couberem todas, uma é reservada para o "Mostrar tudo".
  const cabem = Math.max(2, Math.floor((alturaArea - PADDING_LISTA) / ALTURA_LINHA));
  const { sugestoes, temMais } = useMemo(() => {
    if (!debounced) return { sugestoes: recentes.map((r): Sugestao => ({ chave: `r${r}`, tipo: "recente", titulo: r, destino: r })), temMais: false };
    if (tudo || achados.length <= cabem) return { sugestoes: [...achados.filter((x) => !x.concluida), ...achados.filter((x) => x.concluida)].sort((x, y) => ORDEM_TIPO[x.tipo] - ORDEM_TIPO[y.tipo]), temMais: false };
    // Reparte as vagas entre notas, tarefas e Cofre, um de cada vez, para todos os tipos aparecerem.
    // O que já está resolvido (tarefa concluída, transação efetivada) pesa menos: só entra nas vagas que sobrarem
    // e fica depois dos pendentes do seu tipo.
    const vagas = cabem - 1;
    const tipos = ["nota", "tarefa", "transacao"] as const;
    const grupos = tipos.map((t) => achados.filter((x) => x.tipo === t && !x.concluida));
    const resolvidos = tipos.map((t) => achados.filter((x) => x.tipo === t && x.concluida));
    const pegos = grupos.map(() => 0);
    let total = 0;
    while (total < vagas && grupos.some((g, i) => pegos[i] < g.length)) {
      for (let i = 0; i < grupos.length && total < vagas; i++) if (pegos[i] < grupos[i].length) { pegos[i]++; total++; }
    }
    const pegosResolvidos = resolvidos.map(() => 0);
    while (total < vagas && resolvidos.some((g, i) => pegosResolvidos[i] < g.length)) {
      for (let i = 0; i < resolvidos.length && total < vagas; i++) if (pegosResolvidos[i] < resolvidos[i].length) { pegosResolvidos[i]++; total++; }
    }
    const visiveis = grupos.flatMap((g, i) => [...g.slice(0, pegos[i]), ...resolvidos[i].slice(0, pegosResolvidos[i])]);
    return { sugestoes: [...visiveis, { chave: "mais", tipo: "mais", titulo: "Mostrar tudo", destino: "" } as Sugestao], temMais: true };
  }, [achados, debounced, recentes, tudo, cabem]);

  function abrir(s: Sugestao, e?: React.MouseEvent) {
    if (s.tipo === "mais") { setTudo(true); return; }
    if (s.tipo === "recente") { setTermo(s.destino); entrada.current?.focus(); return; }
    if (debounced) {
      try { localStorage.setItem(CHAVE_RECENTES, JSON.stringify([debounced, ...recentes.filter((r) => r !== debounced)].slice(0, 5))); } catch { /* sem armazenamento local */ }
    }
    fechar();
    if (s.tipo === "nota" || s.tipo === "tarefa") abrirDocumento(s.destino, e);
    else navigate(s.destino);
  }

  function aoTeclar(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setMarcada((m) => Math.min(sugestoes.length - 1, m + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setMarcada((m) => Math.max(0, m - 1)); }
    else if (e.key === "Enter") {
      e.preventDefault();
      const alvo = sugestoes[marcada];
      if (alvo) abrir(alvo);
    }
  }

  return (
    <div className={`ecos-busca-veu ${saindo ? "ecos-busca-saindo" : "ecos-busca-entrando"}`} role="dialog" aria-modal="true" aria-label="Buscar" style={{ top: vv.top, height: vv.height, bottom: "auto", overflow: "hidden" }} onMouseDown={(e) => { const t = e.target as HTMLElement; if (t === e.currentTarget || t.classList.contains("ecos-busca-painel") || t === areaRef.current) fechar(); }}>
      <div className="ecos-busca-painel mx-auto flex h-full w-full max-w-xl flex-col px-4 pb-2 pt-[calc(env(safe-area-inset-top)+14px)] lg:max-w-3xl">
        <div className="flex shrink-0 items-center gap-2 rounded-2xl border border-border/60 bg-surface-1/80 px-4 py-3 shadow-nav backdrop-blur-nav">
          <Search size={18} strokeWidth={1.75} className="shrink-0 text-text-muted" aria-hidden />
          <input
            ref={entrada}
            type="search"
            enterKeyHint="search"
            role="combobox"
            aria-expanded
            aria-controls="busca-rapida-lista"
            autoComplete="off"
            value={termo}
            onChange={(e) => setTermo(e.target.value)}
            onKeyDown={aoTeclar}
            placeholder={noCofre ? "Buscar transações…" : cofreAberto ? "Buscar em tudo, inclusive no Cofre…" : "Buscar em notas e tarefas…"}
            className="min-w-0 flex-1 appearance-none bg-transparent text-[16px] text-text-primary outline-none ring-0 focus:outline-none focus:ring-0 focus-visible:outline-none placeholder:text-text-muted [&::-webkit-search-cancel-button]:hidden"
          />
          <button type="button" onClick={fechar} className="shrink-0 text-sm font-medium text-text-muted">Cancelar</button>
        </div>

        <div ref={areaRef} className="mt-2 flex min-h-0 flex-1 flex-col">
          {sugestoes.length > 0 && (
            <ul id="busca-rapida-lista" role="listbox" className={`ecos-busca-lista flex max-h-full min-h-0 flex-col overflow-y-auto overscroll-contain rounded-2xl border border-border/60 bg-surface-1/80 p-1.5 shadow-nav backdrop-blur-nav ${temMais ? "flex-1" : ""}`}>
              {!debounced && <li className="px-3 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-muted" aria-hidden>Buscas recentes</li>}
              {sugestoes.map((s, i) => {
                const Icone = ICONE[s.tipo];
                const ehMais = s.tipo === "mais";
                return (
                  <li key={s.chave} role="option" aria-selected={i === marcada} className={ehMais ? "flex min-h-[52px] flex-1" : "shrink-0"}>
                    <button
                      type="button"
                      onMouseEnter={() => setMarcada(i)}
                      onClick={(e) => abrir(s, e)}
                      style={{ "--op": s.concluida ? 0.55 : 1, animationDelay: `${Math.min(i, 8) * 22}ms`, minHeight: ALTURA_LINHA, height: ehMais ? undefined : ALTURA_LINHA } as React.CSSProperties}
                      className={`ecos-busca-item flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left ${ehMais ? "h-full" : ""} ${i === marcada ? "bg-surface-3" : ""}`}
                    >
                      <Icone size={17} strokeWidth={1.75} className={ehMais || s.tipo === "recente" ? "shrink-0 text-text-muted" : `shrink-0 ${s.cor ?? "text-cyan"}`} aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className={`block truncate text-[15px] ${ehMais ? "text-text-secondary" : "text-text-primary"} ${s.concluida ? "line-through" : ""}`}>{s.titulo}</span>
                        {s.detalhe && <span className="block truncate text-xs text-text-muted">{s.detalhe}</span>}
                      </span>
                      {ROTULO[s.tipo] && <span className="shrink-0 rounded-md bg-surface-3 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-text-muted">{ROTULO[s.tipo]}</span>}
                      {i === marcada && !ehMais && s.tipo !== "recente" && <CornerDownLeft size={14} className="hidden shrink-0 text-text-muted sm:block" aria-hidden />}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {debounced && !carregando && achados.length === 0 && (
            <p className="px-3 pt-3 text-center text-sm text-text-muted">Nada encontrado para “{debounced}”.{cofreAberto === false ? " O Cofre está trancado, então as transações ficaram de fora." : ""}</p>
          )}
        </div>
      </div>
    </div>
  );
}
