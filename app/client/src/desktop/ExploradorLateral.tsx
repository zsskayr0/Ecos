import { anexoComoArquivo, BadgeAnexos, rotaDoAnexo } from "@/components/files/Anexos";
import { useCallback, useContext, useEffect, useMemo, useRef, useState, type PointerEvent as PointerReact, type KeyboardEvent as TeclaReact, type MouseEvent as ReactMouseEvent } from "react";
import { ChevronDown, ChevronRight, ChevronsDownUp, CircleCheck, ExternalLink, File, FolderInput, MoreHorizontal, Pencil, SlidersHorizontal, RotateCcw, Trash2 } from "lucide-react";
import { type TipoFantasma } from "@/lib/arraste-fantasma";
import { aoPressionarItem } from "@/lib/arraste-itens";
import { arquivos, tarefas, type ArquivoExplorador, type PastaExplorador } from "@/lib/api";
import { IconeArquivo, IconePasta, rotuloArquivo as rotulo, selo, useMarcasArquivo } from "@/lib/icones-arquivo";
import { DocumentoPopupContext } from "@/lib/documento-popup";
import { useEspacoFiltro } from "@/lib/use-espaco-filtro";
import { useRefreshBus } from "@/lib/refresh-bus";
import { avisar } from "@/lib/toast";
import { mensagemDeErro } from "@/lib/erros";
import { useWorkspaceOpcional } from "./workspace-store";
import { moduloDaRota } from "./modules";
import { navegacaoDaAba } from "./navegacao-abas";
import { MenuExplorador, type ItemMenuExplorador } from "./MenuExplorador";
import type { ItemParaMover } from "./MoverExplorador";
import { EditarPasta } from "@/components/views/EditarPasta";
import { comPastasOtimistas, reconciliarPastasOtimistas, usePastasOtimistas } from "@/lib/pasta-otimista";
import { AcaoExplorador, type AlvoExplorador, type ResultadoAcao, type TipoAcao } from "./AcaoExplorador";

type Conteudo = { pastas: PastaExplorador[]; arquivos: ArquivoExplorador[] };

const ESPERA_ABRIR_MS = 700;

const paiDe = (caminho: string) => caminho.split("/").slice(0, -1).join("/");

const CHAVE_ABERTAS = "ecos.desktop.explorador.abertas.v1";

function lerAbertas(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(CHAVE_ABERTAS) ?? "[]") as string[]); } catch { return new Set(); }
}

type ItemArvore = { tipo: "pasta"; pasta: PastaExplorador } | { tipo: "arquivo"; arquivo: ArquivoExplorador };

/** Árvore de arquivos do espaço no menu lateral (modo explorador): pastas expansíveis e arquivos pelo nome. */
export function ExploradorLateral() {
  const espaco = useEspacoFiltro() ?? "pessoal";
  const { versao, notificar } = useRefreshBus();
  const abrirDocumento = useContext(DocumentoPopupContext);
  const [cache, setCache] = useState<Record<string, Conteudo>>({});
  const [abertas, setAbertas] = useState<Set<string>>(lerAbertas);
  const workspace = useWorkspaceOpcional();
  const focada = workspace?.state.panes.find((p) => p.id === workspace.state.focusedPaneId);
  const caminhoAtivo = focada?.tabs.find((t) => t.id === focada.activeTabId)?.path ?? null;
  const pedindo = useRef(new Set<string>());
  const { marca, icones: iconesExtensao } = useMarcasArquivo();
  const [alvo, setAlvo] = useState<string | null>(null);
  const esperaAbrir = useRef<{ caminho: string; timer: number } | null>(null);
  const limparEspera = () => { if (esperaAbrir.current) { window.clearTimeout(esperaAbrir.current.timer); esperaAbrir.current = null; } };
  useEffect(() => limparEspera, []);
  const [menu, setMenu] = useState<{ x: number; y: number; item: ItemArvore } | null>(null);
  const [pastaEmEdicao, setPastaEmEdicao] = useState<PastaExplorador | null>(null);
  const sobrepostas = usePastasOtimistas();
  useEffect(() => { Object.values(cache).forEach((c) => reconciliarPastasOtimistas(c.pastas.map((p) => ({ ...p, contagem_itens: 0 })))); }, [cache]);
  const [acaoAberta, setAcaoAberta] = useState<{ acao: TipoAcao; alvo: AlvoExplorador } | null>(null);
  const caminhoDoMenu = menu ? (menu.item.tipo === "pasta" ? menu.item.pasta.caminho : menu.item.arquivo.caminho) : null;
  const fecharMenu = useCallback(() => setMenu(null), []);
  /** Seleção como no Explorador do sistema: Ctrl/Cmd alterna, Shift marca o intervalo; ações valem para todos os marcados. */
  const [selecao, setSelecao] = useState<Set<string>>(() => new Set());
  const [ancora, setAncora] = useState<string | null>(null);

  const cacheRef = useRef(cache);
  cacheRef.current = cache;
  /** Itens que acabaram de aparecer (criados ou movidos para uma pasta visível): entram com animação e empurram os de baixo. */
  const [entrando, setEntrando] = useState<Set<string>>(() => new Set());
  const marcarEntrando = (novos: string[]) => {
    if (!novos.length) return;
    setEntrando((a) => new Set([...a, ...novos]));
    window.setTimeout(() => setEntrando((a) => { const p = new Set(a); novos.forEach((n) => p.delete(n)); return p; }), 600);
  };

  // Outro espaço: recomeça. Qualquer outra mudança (versao) atualiza no lugar, sem esvaziar a árvore (nada de piscar).
  useEffect(() => { setCache({}); pedindo.current.clear(); }, [espaco]);
  const primeiraVersao = useRef(true);
  useEffect(() => {
    if (primeiraVersao.current) { primeiraVersao.current = false; return; }
    const pastas = new Set(["", ...abertas, ...Object.keys(cacheRef.current)]);
    for (const pasta of pastas) {
      arquivos.listar({ espaco, pasta })
        .then((r) => {
          const antes = cacheRef.current[pasta];
          if (antes) {
            const tinha = new Set([...antes.pastas.map((p) => p.caminho), ...antes.arquivos.map((a) => a.caminho)]);
            marcarEntrando([...r.pastas.map((p) => p.caminho), ...r.arquivos.map((a) => a.caminho)].filter((c) => !tinha.has(c)));
          }
          setCache((c) => ({ ...c, [pasta]: { pastas: r.pastas, arquivos: r.arquivos } }));
        })
        .catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versao]);
  useEffect(() => { try { localStorage.setItem(CHAVE_ABERTAS, JSON.stringify([...abertas])); } catch { /* só conveniência */ } }, [abertas]);

  useEffect(() => {
    const faltando = ["", ...abertas].filter((p) => !cache[p] && !pedindo.current.has(p));
    for (const pasta of faltando) {
      pedindo.current.add(pasta);
      arquivos.listar({ espaco, pasta })
        .then((r) => setCache((c) => ({ ...c, [pasta]: { pastas: r.pastas, arquivos: r.arquivos } })))
        .catch(() => setCache((c) => ({ ...c, [pasta]: { pastas: [], arquivos: [] } })))
        .finally(() => pedindo.current.delete(pasta));
    }
  }, [abertas, cache, espaco]);

  /** Linhas na ordem em que aparecem (pastas abertas incluídas): base do intervalo com Shift e das setas. */
  const { ordem, itensPorCaminho } = useMemo(() => {
    const ordem: string[] = [];
    const itensPorCaminho = new Map<string, ItemArvore>();
    const percorrer = (caminho: string) => {
      const c = cache[caminho];
      if (!c) return;
      for (const p of c.pastas) {
        ordem.push(p.caminho);
        itensPorCaminho.set(p.caminho, { tipo: "pasta", pasta: p });
        if (abertas.has(p.caminho)) percorrer(p.caminho);
      }
      for (const a of c.arquivos) {
        ordem.push(a.caminho);
        itensPorCaminho.set(a.caminho, { tipo: "arquivo", arquivo: a });
      }
    };
    percorrer("");
    return { ordem, itensPorCaminho };
  }, [cache, abertas]);

  /** Itens marcados, sem os que já vão dentro de uma pasta marcada. */
  const raizesDe = (caminhos: Iterable<string>) => {
    const todos = [...caminhos];
    return todos.filter((c) => !todos.some((o) => o !== c && c.startsWith(`${o}/`)));
  };

  /** Aplica o clique à seleção. Devolve `true` se foi só seleção (com Ctrl/Cmd ou Shift), sem abrir nada. */
  function selecionar(caminho: string, e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): boolean {
    const alterna = e.ctrlKey || e.metaKey;
    if (e.shiftKey && ancora && ordem.includes(ancora)) {
      const a = ordem.indexOf(ancora);
      const b = ordem.indexOf(caminho);
      const faixa = ordem.slice(Math.min(a, b), Math.max(a, b) + 1);
      setSelecao(alterna ? new Set([...selecao, ...faixa]) : new Set(faixa));
      return true;
    }
    if (alterna) {
      setSelecao((atual) => { const n = new Set(atual); if (n.has(caminho)) n.delete(caminho); else n.add(caminho); return n; });
      setAncora(caminho);
      return true;
    }
    setSelecao(new Set([caminho]));
    setAncora(caminho);
    return false;
  }

  function aoTeclar(e: TeclaReact<HTMLUListElement>) {
    const foco = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>("[data-caminho]")?.dataset.caminho ?? null;
    const alvosDaAcao = () => raizesDe(selecao.size ? selecao : foco ? [foco] : []);
    const abrirAcaoLote = (acao: "mover" | "excluir") => {
      const lote = alvosDaAcao();
      const primeiro = itensPorCaminho.get(lote[0] ?? "");
      if (!primeiro) return;
      setAcaoAberta({ acao, alvo: lote.length > 1 ? { ...alvoDe(primeiro), rotulo: `${lote.length} itens`, lote, detalhes: detalhesDe(lote) } : { ...alvoDe(primeiro), detalhes: [detalheDe(primeiro)] } });
    };
    if (e.key === "Escape" && selecao.size) { e.preventDefault(); setSelecao(new Set()); return; }
    if (e.key === "Delete" && (selecao.size || foco)) { e.preventDefault(); abrirAcaoLote("excluir"); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") { e.preventDefault(); setSelecao(new Set(ordem)); return; }
    if (e.key === "F2") {
      const unico = selecao.size <= 1 ? (foco ?? [...selecao][0]) : null;
      const item = unico ? itensPorCaminho.get(unico) : undefined;
      if (item) { e.preventDefault(); setAcaoAberta({ acao: "renomear", alvo: alvoDe(item) }); }
      return;
    }
    if (foco && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
      const item = itensPorCaminho.get(foco);
      if (item?.tipo !== "pasta") return;
      const aberta = abertas.has(foco);
      if ((e.key === "ArrowRight") === aberta) return;
      e.preventDefault();
      alternar(foco);
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const atual = foco ? ordem.indexOf(foco) : -1;
      const proximo = ordem[Math.max(0, Math.min(ordem.length - 1, atual + (e.key === "ArrowDown" ? 1 : -1)))];
      if (!proximo) return;
      if (e.shiftKey && ancora && ordem.includes(ancora)) {
        const a = ordem.indexOf(ancora);
        const b = ordem.indexOf(proximo);
        setSelecao(new Set(ordem.slice(Math.min(a, b), Math.max(a, b) + 1)));
      } else {
        setSelecao(new Set([proximo]));
        setAncora(proximo);
      }
      document.querySelector<HTMLElement>(`[data-caminho="${CSS.escape(proximo)}"]`)?.focus();
    }
  }

  /** Pasta aberta na tela de Arquivos da aba ativa (para destacá-la na árvore). */
  const pastaNaTela = (() => {
    if (!caminhoAtivo?.startsWith("/arquivos")) return null;
    const q = caminhoAtivo.split("?")[1];
    return q ? new URLSearchParams(q).get("pasta") ?? "" : "";
  })();

  /** Como o Explorador do Windows: clicar no nome da pasta mostra o conteúdo dela na tela de Arquivos. */
  function abrirPastaNaTela(caminho: string, emAba = false) {
    if (!workspace) return;
    const path = `/arquivos${caminho ? `?pasta=${encodeURIComponent(caminho)}` : ""}`;
    if (!emAba) {
      const paineis = [...workspace.state.panes].sort((a, b) => Number(b.id === workspace.state.focusedPaneId) - Number(a.id === workspace.state.focusedPaneId));
      for (const painel of paineis) {
        const aba = painel.tabs.find((t) => moduloDaRota(t.path).id === "arquivos");
        if (!aba) continue;
        workspace.dispatch({ type: "activate-tab", paneId: painel.id, tabId: aba.id });
        navegacaoDaAba(`aba:${aba.id}`)?.navegar?.(path);
        return;
      }
    }
    workspace.dispatch({ type: "open", path, where: "focused", reuse: "path" });
  }

  const alternar = useCallback((caminho: string) => setAbertas((a) => {
    const p = new Set(a);
    if (p.has(caminho)) p.delete(caminho); else p.add(caminho);
    return p;
  }), []);

  const destinoDe = (a: ArquivoExplorador) => a.tipo === "nota" && a.id ? `/notas/nota/${a.id}`
    : a.tipo === "tarefa" && a.id ? `/tarefa/${a.id}`
    : `/media/ver?a=${encodeURIComponent(a.caminho)}&e=${encodeURIComponent(espaco)}`;
  const [anexosAbertos, setAnexosAbertos] = useState<Set<string>>(new Set());
  const alternarAnexos = (c: string) => setAnexosAbertos((x) => { const n = new Set(x); if (n.has(c)) n.delete(c); else n.add(c); return n; });
  const abrir = (a: ArquivoExplorador, emAba: boolean) => abrirDocumento?.(destinoDe(a), emAba);

  /** Mostra o movimento na hora (otimista); se o servidor discordar, o recarregamento que segue corrige. */
  function moverNoCache(itens: string[], destino: string) {
    const novoCaminho = (c: string) => (destino ? `${destino}/${c.split("/").pop()}` : c.split("/").pop()!);
    const novos: string[] = [];
    setCache((atual) => {
      const prox: Record<string, Conteudo> = { ...atual };
      const pastasMov: PastaExplorador[] = [];
      const arqsMov: ArquivoExplorador[] = [];
      for (const i of itens) {
        const origem = prox[paiDe(i)];
        if (!origem) continue;
        const p = origem.pastas.find((x) => x.caminho === i);
        const a = origem.arquivos.find((x) => x.caminho === i);
        prox[paiDe(i)] = { pastas: origem.pastas.filter((x) => x.caminho !== i), arquivos: origem.arquivos.filter((x) => x.caminho !== i) };
        if (p) pastasMov.push({ ...p, caminho: novoCaminho(i) });
        if (a) arqsMov.push({ ...a, caminho: novoCaminho(i) });
      }
      // Pastas já carregadas dentro do que foi movido acompanham o novo caminho.
      for (const chave of Object.keys(prox)) {
        const raiz = itens.find((i) => chave === i || chave.startsWith(`${i}/`));
        if (!raiz) continue;
        const nova = novoCaminho(raiz) + chave.slice(raiz.length);
        prox[nova] = prox[chave];
        delete prox[chave];
      }
      const dest = prox[destino];
      if (dest) {
        const porNome = (x: { nome: string }, y: { nome: string }) => x.nome.localeCompare(y.nome, "pt-BR", { numeric: true, sensitivity: "base" });
        prox[destino] = { pastas: [...dest.pastas, ...pastasMov].sort(porNome), arquivos: [...dest.arquivos, ...arqsMov].sort(porNome) };
        novos.push(...pastasMov.map((p) => p.caminho), ...arqsMov.map((a) => a.caminho));
      }
      return prox;
    });
    window.setTimeout(() => marcarEntrando(novos), 0);
  }

  async function mover(itens: string[], destino: string) {
    if (itens.every((i) => paiDe(i) === destino) || itens.some((i) => destino === i || destino.startsWith(`${i}/`))) return;
    moverNoCache(itens, destino);
    setSelecao(new Set());
    try {
      const r = await arquivos.mover({ espaco, itens, destino });
      if (r.movidos.length) avisar(`${r.movidos.length === 1 ? "Item movido" : `${r.movidos.length} itens movidos`} para ${destino || "a raiz"}.`, "sucesso");
      if (r.falhas.length) avisar(`Não foi possível mover: ${r.falhas.map((f) => `${f.caminho.split("/").pop()} (${f.motivo})`).join("; ")}.`, "erro");
      setSelecao(new Set());
      notificar();
    } catch (e) {
      avisar(mensagemDeErro(e, "Não foi possível mover."), "erro");
      notificar();
    }
  }

  /** Arrasta com o ponteiro (mouse ou toque): um item marcado leva todos os marcados; um fora da seleção leva só ele. */
  function arrastar(e: PointerReact, caminho: string, abrirEm: string, rotuloItem: string, tipo: TipoFantasma) {
    aoPressionarItem(e, {
      preparar: () => {
        const lote = selecao.has(caminho) && selecao.size > 1 ? raizesDe(selecao) : [caminho];
        if (!selecao.has(caminho)) { setSelecao(new Set([caminho])); setAncora(caminho); }
        return { itens: lote, rotulo: lote.length > 1 ? `${lote.length} itens` : rotuloItem, tipo };
      },
      aoPairar: (destino) => {
        setAlvo(destino);
        // Pasta fechada abre se o arraste esperar nela.
        if (esperaAbrir.current && esperaAbrir.current.caminho !== destino) limparEspera();
        if (destino && !esperaAbrir.current) {
          esperaAbrir.current = { caminho: destino, timer: window.setTimeout(() => { setAbertas((a) => (a.has(destino) ? a : new Set(a).add(destino))); esperaAbrir.current = null; }, ESPERA_ABRIR_MS) };
        }
      },
      aoSoltar: (destino, itens) => { void mover(itens, destino); },
      // Soltar na lateral de um painel abre o item lá, num painel novo.
      aoAbrirAoLado: (paneId, lado) => {
        workspace?.dispatch({ type: "focus-pane", paneId });
        workspace?.dispatch({ type: "open", path: abrirEm, where: "new-pane", reuse: "path", side: lado });
      },
      aoTerminar: () => { setAlvo(null); limparEspera(); },
    });
  }

  /** Lugar onde dá para soltar: a pasta de destino ("" = raiz). A mais de dentro decide (ver `arraste-itens`). */
  const soltarEm = (destino: string) => ({ "data-soltar": destino });

  const alvoDe = (item: ItemArvore): AlvoExplorador => item.tipo === "pasta"
    ? { caminho: item.pasta.caminho, rotulo: item.pasta.nome, nomeEditavel: item.pasta.nome, pasta: true, cor: item.pasta.cor, icone: item.pasta.icone }
    : { caminho: item.arquivo.caminho, rotulo: rotulo(item.arquivo), nomeEditavel: item.arquivo.tipo ? rotulo(item.arquivo) : item.arquivo.nome, pasta: false };

  async function alternarConclusao(a: ArquivoExplorador) {
    if (!a.id) return;
    try {
      await tarefas.atualizarStatus(a.id, a.status === "concluida" ? "pendente" : "concluida");
      notificar();
    } catch (e) {
      avisar(mensagemDeErro(e, "Não foi possível atualizar a tarefa."), "erro");
    }
  }

  const detalheDe = (item: ItemArvore): ItemParaMover => item.tipo === "pasta"
    ? { caminho: item.pasta.caminho, rotulo: item.pasta.nome, tipo: "pasta" }
    : { caminho: item.arquivo.caminho, rotulo: rotulo(item.arquivo), tipo: item.arquivo.tipo ?? "arquivo", id: item.arquivo.id };
  const detalhesDe = (caminhos: string[]) => caminhos.flatMap((c) => { const i = itensPorCaminho.get(c); return i ? [detalheDe(i)] : []; });

  /** Vários itens marcados e o clique foi num deles: o menu atua sobre todos. */
  const loteDoMenu = (item: ItemArvore) => {
    const caminho = item.tipo === "pasta" ? item.pasta.caminho : item.arquivo.caminho;
    return selecao.size > 1 && selecao.has(caminho) ? raizesDe(selecao) : null;
  };

  function itensDoMenu(item: ItemArvore): ItemMenuExplorador[] {
    const lote = loteDoMenu(item);
    if (lote) {
      const alvo: AlvoExplorador = { ...alvoDe(item), caminho: lote[0] ?? "", rotulo: `${lote.length} itens`, pasta: false, lote, detalhes: detalhesDe(lote) };
      return [
        { rotulo: `Mover ${lote.length} itens para…`, icone: FolderInput, acao: () => setAcaoAberta({ acao: "mover", alvo }) },
        { rotulo: `Excluir ${lote.length} itens`, icone: Trash2, perigo: true, acao: () => setAcaoAberta({ acao: "excluir", alvo }) },
      ];
    }
    const alvo = { ...alvoDe(item), detalhes: [detalheDe(item)] };
    const comuns: ItemMenuExplorador[] = [
      { rotulo: "Renomear", icone: Pencil, acao: () => setAcaoAberta({ acao: "renomear", alvo }) },
      ...(item.tipo === "pasta" ? [{ rotulo: "Editar", icone: SlidersHorizontal, acao: () => setPastaEmEdicao(item.pasta) }] : []),
      { rotulo: "Mover", icone: FolderInput, acao: () => setAcaoAberta({ acao: "mover", alvo }) },
      { rotulo: "Excluir", icone: Trash2, perigo: true, acao: () => setAcaoAberta({ acao: "excluir", alvo }) },
    ];
    if (item.tipo === "pasta") {
      return [
        { rotulo: "Abrir em nova aba", icone: ExternalLink, acao: () => abrirPastaNaTela(item.pasta.caminho, true) },
        ...comuns,
      ];
    }
    const a = item.arquivo;
    return [
      { rotulo: "Abrir", icone: File, acao: () => abrir(a, false) },
      { rotulo: "Abrir em aba", icone: ExternalLink, acao: () => abrir(a, true) },
      ...(a.tipo === "tarefa" && a.id ? [a.status === "concluida"
        ? { rotulo: "Reabrir tarefa", icone: RotateCcw, acao: () => void alternarConclusao(a) }
        : { rotulo: "Concluir tarefa", icone: CircleCheck, acao: () => void alternarConclusao(a) }] : []),
      ...comuns,
    ];
  }

  /** Botão direito na linha. */
  const aoClicarDireito = (item: ItemArvore) => (e: ReactMouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const caminho = item.tipo === "pasta" ? item.pasta.caminho : item.arquivo.caminho;
    if (!selecao.has(caminho)) { setSelecao(new Set([caminho])); setAncora(caminho); }
    setMenu({ x: e.clientX, y: e.clientY, item });
  };

  /** "⋯" que aparece ao passar o mouse na linha (e fica visível com o menu aberto ou com o foco). */
  function botaoMais(item: ItemArvore, nome: string, caminho: string) {
    return (
      <button type="button" aria-label={`Ações para ${nome}`} aria-haspopup="menu" aria-expanded={caminhoDoMenu === caminho} data-gatilho-menu-explorador="" data-sem-arraste=""
        onClick={(e) => {
          e.stopPropagation();
          if (!selecao.has(caminho)) { setSelecao(new Set([caminho])); setAncora(caminho); }
          const r = e.currentTarget.getBoundingClientRect();
          setMenu((atual) => (atual && caminhoDoMenu === caminho ? null : { x: r.right - 208, y: r.bottom + 2, item }));
        }}
        className={`absolute right-1 top-0.5 flex h-6 w-6 items-center justify-center rounded bg-surface-2 text-text-muted hover:bg-surface-3 hover:text-text-primary focus-visible:opacity-100 ${caminhoDoMenu === caminho ? "bg-surface-3 opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
        <MoreHorizontal size={14} />
      </button>
    );
  }

  /** Depois de renomear/mover/excluir, as pastas abertas dentro do que mudou trocam de caminho (ou somem). */
  function aoConcluirAcao(r: ResultadoAcao) {
    setAbertas((a) => {
      const novo = new Set<string>();
      for (const c of a) {
        const m = r.mudancas.find((x) => c === x.de || c.startsWith(`${x.de}/`));
        if (!m) novo.add(c);
        else if (m.para) novo.add(m.para + c.slice(m.de.length));
      }
      return novo;
    });
    setSelecao(new Set());
    setAcaoAberta(null);
    avisar(r.mensagem, "sucesso");
    notificar();
  }

  const recuo = (nivel: number) => ({ paddingLeft: 6 + nivel * 14 });

  function filhos(caminho: string, nivel: number) {
    const c = cache[caminho];
    if (!c) return <li className="flex h-7 items-center text-[12px] text-text-muted" style={recuo(nivel + 1)}>Carregando…</li>;
    if (!c.pastas.length && !c.arquivos.length) return <li className="flex h-7 items-center text-[12px] italic text-text-muted" style={recuo(nivel + 1)}>vazia</li>;
    return (
      <>
        {comPastasOtimistas(c.pastas.map((p) => ({ ...p, contagem_itens: 0 })), sobrepostas).map((p) => {
          const aberta = abertas.has(p.caminho);
          return (
            <li key={p.caminho} role="treeitem" aria-expanded={aberta} aria-selected={selecao.has(p.caminho)} className={entrando.has(p.caminho) ? "ecos-entra-item" : undefined}>
              <div
                className={`group relative flex h-7 w-full items-center rounded-md pr-2 text-[13px] font-semibold text-text-primary ${alvo === p.caminho ? "bg-surface-3 ring-1 ring-inset ring-cyan/60" : selecao.has(p.caminho) ? "bg-surface-3" : pastaNaTela === p.caminho ? "bg-surface-2" : "hover:bg-surface-2"}`}
                style={recuo(nivel)}
                onContextMenu={aoClicarDireito({ tipo: "pasta", pasta: p })}
                onPointerDown={(e) => arrastar(e, p.caminho, `/arquivos?pasta=${encodeURIComponent(p.caminho)}`, p.nome, "pasta")}
                {...soltarEm(p.caminho)}>
                {pastaNaTela === p.caminho && <span className="absolute -left-1 bottom-1.5 top-1.5 w-0.5 rounded-full bg-cyan" />}
                <button type="button" tabIndex={-1} data-sem-arraste="" aria-label={aberta ? `Recolher ${p.nome}` : `Expandir ${p.nome}`} onClick={() => alternar(p.caminho)}
                  className="mr-0.5 flex h-6 w-5 shrink-0 items-center justify-center rounded text-text-muted hover:bg-surface-3 hover:text-text-primary">
                  {aberta ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </button>
                <button type="button" data-caminho={p.caminho} title={p.nome} className="flex h-full min-w-0 flex-1 items-center text-left"
                  onClick={(e) => {
                    if (selecionar(p.caminho, e)) return;
                    if (!aberta) alternar(p.caminho);
                    abrirPastaNaTela(p.caminho);
                  }}
                  onMouseDown={(e) => { if (e.button === 1) e.preventDefault(); }}
                  onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); abrirPastaNaTela(p.caminho, true); } }}>
                  <IconePasta pasta={p} aberta={aberta} className="mr-2" />
                  <span className="truncate">{p.nome}</span>
                </button>
                {botaoMais({ tipo: "pasta", pasta: p }, p.nome, p.caminho)}
              </div>
              {aberta && <ul role="group" {...soltarEm(p.caminho)}>{filhos(p.caminho, nivel + 1)}</ul>}
            </li>
          );
        })}
        {c.arquivos.map((a) => {
          // Nota, tarefa e Markdown comum sempre levam o ícone; a marca escolhida vale para os demais arquivos.
          const comum = !!a.tipo || a.categoria === "markdown";
          const mostrarIcone = comum || marca === "ambos" || marca === "icone";
          const s = !comum && (marca === "ambos" || marca === "selo") ? selo(a) : null;
          const ativo = caminhoAtivo === destinoDe(a);
          const marcado = selecao.has(a.caminho);
          const feita = a.tipo === "tarefa" && a.status === "concluida";
          const anexos = a.anexos ?? [];
          const anexosVisiveis = anexos.length > 0 && anexosAbertos.has(a.caminho);
          return (
            <li key={a.caminho} role="treeitem" aria-selected={marcado || ativo} className={entrando.has(a.caminho) ? "ecos-entra-item" : undefined}>
              <div className="group relative" onContextMenu={aoClicarDireito({ tipo: "arquivo", arquivo: a })}>
              <button type="button" title={a.nome} data-caminho={a.caminho}
                onClick={(e) => { if (!selecionar(a.caminho, e)) abrir(a, false); }}
                onMouseDown={(e) => { if (e.button === 1) e.preventDefault(); }}
                onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); abrir(a, true); } }}
                onPointerDown={(e) => arrastar(e, a.caminho, destinoDe(a), a.titulo ?? a.nome, a.tipo ?? "arquivo")}
                {...soltarEm(paiDe(a.caminho))}
                className={`relative flex h-7 w-full items-center gap-2 rounded-md pr-2 text-left text-[13px] ${marcado ? "bg-surface-3 text-text-primary" : ativo ? "bg-surface-2 text-text-primary" : "text-text-secondary hover:bg-surface-2 hover:text-text-primary"}`}
                style={{ paddingLeft: 6 + nivel * 14 + 20 }}>
                {ativo && <span className="absolute -left-1 bottom-1.5 top-1.5 w-0.5 rounded-full bg-cyan" />}
                {/* +20px = seta da pasta (14px + 6px de vão): o ícone do arquivo alinha com o da pasta */}
                {mostrarIcone ? <IconeArquivo a={a} personalizados={iconesExtensao} className={`text-text-muted ${feita ? "opacity-50" : ""}`} /> : <span aria-hidden className="h-3.5 w-3.5 shrink-0" />}
                <span className={`min-w-0 flex-1 truncate ${feita ? "line-through opacity-50" : ""}`}>{rotulo(a)}</span>
                {s && <span className="shrink-0 text-[10px] font-medium tracking-wide text-text-muted">{s}</span>}
              </button>
              {anexos.length > 0 && <span className="absolute right-8 top-1/2 -translate-y-1/2"><BadgeAnexos quantidade={anexos.length} aberto={anexosVisiveis} aoAlternar={() => alternarAnexos(a.caminho)} /></span>}
              {botaoMais({ tipo: "arquivo", arquivo: a }, rotulo(a), a.caminho)}
              </div>
              {anexosVisiveis && (
                <ul role="group">
                  {anexos.map((m) => (
                    <li key={m.caminho} role="treeitem" aria-selected={false}>
                      <button type="button" title={m.nome}
                        onClick={(e) => abrirDocumento?.(rotaDoAnexo(m), e.ctrlKey || e.metaKey)}
                        onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); abrirDocumento?.(rotaDoAnexo(m), true); } }}
                        className="flex h-7 w-full items-center gap-2 rounded-md pr-2 text-left text-[12px] text-text-muted hover:bg-surface-2 hover:text-text-primary"
                        style={{ paddingLeft: 6 + (nivel + 1) * 14 + 20 }}>
                        <IconeArquivo a={anexoComoArquivo(m)} personalizados={iconesExtensao} className="text-text-muted" />
                        <span className="min-w-0 flex-1 truncate">{anexoComoArquivo(m).nome}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </>
    );
  }

  return (
    <div className="relative flex flex-col">
      {/* Fica na linha do cabeçalho "ARQUIVOS" (h-7 + gap-1 acima deste bloco), à direita, sem ocupar linha própria. */}
      <button type="button" onClick={() => setAbertas(new Set())} aria-label="Recolher todas as pastas" title="Recolher todas as pastas"
        className="absolute right-1 -top-[32px] z-10 flex h-6 w-6 items-center justify-center rounded text-text-muted hover:bg-surface-2 hover:text-text-primary">
        <ChevronsDownUp size={14} />
      </button>
      <ul role="tree" aria-label="Arquivos do espaço" aria-multiselectable onKeyDown={aoTeclar}
        onClick={(e) => { if (e.target === e.currentTarget) setSelecao(new Set()); }}
        className={`select-none rounded-md pb-2 ${alvo === "" ? "ring-1 ring-inset ring-cyan/60" : ""}`} {...soltarEm("")}>{filhos("", 0)}</ul>
      {menu && <MenuExplorador x={menu.x} y={menu.y} rotulo={loteDoMenu(menu.item) ? `${loteDoMenu(menu.item)!.length} itens` : alvoDe(menu.item).rotulo} itens={itensDoMenu(menu.item)} aoFechar={fecharMenu} />}
      {pastaEmEdicao && (
        <EditarPasta pasta={{ ...pastaEmEdicao, contagem_itens: 0 }} tipo="nota" espaco={espaco} aoFechar={() => setPastaEmEdicao(null)}
          aoSalvar={(novo) => {
            const antigo = pastaEmEdicao.caminho;
            // O servidor já confirmou: as pastas abertas dentro dela acompanham o caminho novo.
            if (novo !== antigo) setAbertas((a) => new Set([...a].map((c) => (c === antigo || c.startsWith(`${antigo}/`) ? novo + c.slice(antigo.length) : c))));
          }} />
      )}
      {acaoAberta && <AcaoExplorador acao={acaoAberta.acao} alvo={acaoAberta.alvo} espaco={espaco} aoFechar={() => setAcaoAberta(null)} aoConcluir={aoConcluirAcao} />}
    </div>
  );
}
