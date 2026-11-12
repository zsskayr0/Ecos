import { MenuSuspenso } from "@/components/common/MenuSuspenso";
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Maximize, Printer } from "lucide-react";
import { Toggle } from "@/components/common/Toggle";
import { corDoFundo, ESTILOS_FOLHA, FUNDOS_FOLHA, useFolha } from "@/lib/tinta/folha";
import { AlertTriangle, Bold, Brackets, ChevronDown, Code, Ellipsis, Eye, Heading1, Heading2, Heading3, Italic, Keyboard, Link, Link2, List, ListChecks, ListOrdered, Minus, Pencil, PenLine, Quote, RemoveFormatting, Smile, Strikethrough, Type } from "lucide-react";
import { EditorVivo, type AreaLike } from "./EditorVivo";
import { MarkdownPreview, resolverSrcImagem } from "@/lib/markdown-mini";
import { useIsDesktop, useIsMobile } from "@/lib/use-viewport";
import { analisarWikilink, resolverWikilink, useAbrirDestino } from "@/lib/wikilinks";
import { avisar } from "@/lib/toast";
import { preservandoScroll } from "@/lib/preservar-scroll";
import { ConfirmDeleteDialog } from "@/components/common/ConfirmDeleteDialog";
import { AvisoModoEscrita } from "@/components/tinta/AvisoModoEscrita";
import { BarraTinta } from "@/components/tinta/BarraTinta";
import { PaletaFlutuante } from "@/components/tinta/PaletaFlutuante";
import { CLASSE_TEXTO_COLUNA, ColunaTinta, type FerramentaUI, type ModoBorracha, type Pincel } from "@/components/tinta/ColunaTinta";
import { useTinta } from "@/lib/tinta/use-tinta";
import { ativos, LARGURA_COLUNA_PADRAO, type Ferramenta } from "@/lib/tinta/tipos";

interface Props {
  corpo: string;
  onCorpoChange: (corpo: string) => void;
  /** Usado somente para resolver referências legadas no preview. */
  itemId?: string;
  /** Nota e Tarefa têm rotas de anexo espelhadas mas distintas
   * (`notas.anexos` / `tarefas.anexos`) — decide qual chamar no upload. */
  tipo: "nota" | "tarefa";
  placeholder?: string;
  rows?: number;
  /** Tasks use one wide writing canvas, with preview available on demand. */
  layout?: "split" | "document";
  /** Layout "document" sem moldura: o texto ocupa todo o espaço, como numa nota do Obsidian (modo foco). */
  semBorda?: boolean;
  /** Tarefas existentes abrem a descrição em leitura, mantendo a edição a um clique. */
  initialPreview?: boolean;
  /** Nota em edição: some da lista do `[[` (não linka para si). */
  notaId?: string;
  /** Espaço em que "Criar nota" do `[[` cria a nova. */
  espaco?: string;
  /** Nota que já existe: liga o Modo de escrita (tinta à mão sobre o texto). */
  tintaNotaId?: string;
}

const AVISO_DIGITAR_COM_TINTA = "ecos.tinta.aviso-digitar";

/**
 * Editor de corpo — toolbar única, usada tanto na criação quanto na edição
 * de Nota e de Tarefa (user feedback: o editor rico só valia pra Nota
 * "ficava ruim" na Tarefa ter uma toolbar reduzida à parte — agora as duas
 * usam o mesmo componente, só trocando `tipo`/`itemId` pra apontar pra
 * rota de anexo certa). O corpo continua sendo Markdown puro (mesma
 * técnica de inserir-no-cursor que já existia, só mais completa) — nunca
 * um WYSIWYG que reescreve o texto por baixo dos panos, pra não arriscar
 * reformatar wikilink/checkbox que o parser Rust espera literal.
 *
 * Mobile (`useIsMobile`) esconde a coluna de preview — a toolbar mais
 * completa é a própria "aba de cima" pedida, sem seção separada ocupando
 * a tela pequena. Desktop mantém textarea + preview lado a lado.
 */
export function CorpoEditor({ corpo, onCorpoChange: onCorpoChangeExterno, itemId, tipo, placeholder, rows = 8, layout = "split", initialPreview = false, semBorda = false, notaId, espaco, tintaNotaId }: Props) {
  // ---- Modo de escrita (tinta). Sem `tintaNotaId` nada disto aparece. ----
  const tinta = useTinta(tintaNotaId);
  const [escrevendo, setEscrevendo] = useState(false);
  const [avisoAberto, setAvisoAberto] = useState(false);
  const [confirmarLimpar, setConfirmarLimpar] = useState(false);
  const [dedoDesenha, setDedoDesenha] = useState(false);
  const [folha, alterarFolha] = useFolha(tintaNotaId);
  const [slotOpcoes, setSlotOpcoes] = useState<HTMLElement | null>(null);
  const memoriaPincel = useRef<Record<Ferramenta, { cor: string; espessura: number }>>({ caneta: { cor: "auto", espessura: 2.5 }, "marca-texto": { cor: "#facc15", espessura: 16 } });
  const [pincel, setPincel] = useState<Pincel>({ ferramenta: "caneta", ...memoriaPincel.current.caneta });
  const tracosAtivos = ativos(tinta.tracos);
  const comTinta = !!tintaNotaId && tracosAtivos.length > 0;
  // Nota que já tem escrita à mão abre direto no Modo de escrita (uma vez), sem passar pelo texto comum.
  const abriuEscrita = useRef(false);
  useEffect(() => {
    if (abriuEscrita.current || !tintaNotaId || !tinta.carregado) return;
    abriuEscrita.current = true;
    if (tracosAtivos.length > 0 && tinta.largura !== null) setEscrevendo(true);
  }, [tintaNotaId, tinta.carregado, tinta.largura, tracosAtivos.length]);
  const colunaFixa = !!tintaNotaId && (escrevendo || comTinta);
  const larguraColuna = tinta.largura ?? LARGURA_COLUNA_PADRAO;
  const { desfazer: desfazerTinta, refazer: refazerTinta } = tinta;

  function onCorpoChange(novo: string) {
    if (comTinta) {
      try {
        if (!sessionStorage.getItem(AVISO_DIGITAR_COM_TINTA)) {
          sessionStorage.setItem(AVISO_DIGITAR_COM_TINTA, "1");
          avisar("Esta Nota tem anotações à mão: elas não acompanham o texto, então editar acima delas as desalinha.");
        }
      } catch { /* sessionStorage indisponível: sem aviso */ }
    }
    onCorpoChangeExterno(novo);
  }

  function alternarEscrita() {
    if (escrevendo) {
      setEscrevendo(false);
      tinta.soltarSeVazia();
      void tinta.gravarAgora();
    } else if (tinta.largura !== null) setEscrevendo(true);
    else setAvisoAberto(true);
  }

  function escolherFerramenta(f: FerramentaUI) {
    if (pincel.ferramenta !== "borracha" && pincel.ferramenta !== "laco") memoriaPincel.current[pincel.ferramenta] = { cor: pincel.cor, espessura: pincel.espessura };
    setPincel(f === "borracha" || f === "laco" ? { ...pincel, ferramenta: f } : { ferramenta: f, ...memoriaPincel.current[f], modoBorracha: pincel.modoBorracha });
  }

  /** Duplo clique no botão da S Pen: caneta ↔ marca-texto (da borracha volta para a caneta). */
  function alternarCanetaMarca() {
    escolherFerramenta(pincel.ferramenta === "caneta" ? "marca-texto" : "caneta");
  }

  useEffect(() => {
    if (!escrevendo) return;
    const teclas = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) { e.preventDefault(); desfazerTinta(); }
      else if (k === "y" || (k === "z" && e.shiftKey)) { e.preventDefault(); refazerTinta(); }
    };
    window.addEventListener("keydown", teclas);
    return () => window.removeEventListener("keydown", teclas);
  }, [escrevendo, desfazerTinta, refazerTinta]);

  const areaRef = useRef<HTMLTextAreaElement>(null);
  /** Layout "document": o editor vivo (CodeMirror) expõe a seleção como se fosse um textarea. */
  const editorRef = useRef<AreaLike | null>(null);
  const alvo = (): AreaLike | null => (layout === "document" ? editorRef.current : areaRef.current);
  const ehMobile = useIsMobile();
  const barraCompacta = !useIsDesktop();
  /** No celular, os botões de modo (escrever, pré-visualizar) vão para o cabeçalho da página, se ele tiver o espaço. */
  const [slotModo, setSlotModo] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => { setSlotModo(barraCompacta ? document.querySelector<HTMLElement>("[data-slot-modo-editor]") : null); }, [barraCompacta]);
  const abrirDestino = useAbrirDestino();
  function abrirWikilink(interno: string, clique: MouseEvent) {
    const { referencia } = analisarWikilink(interno);
    void resolverWikilink(referencia, itemId ? { tipo, id: itemId } : undefined).then((d) => {
      if (d) abrirDestino(d, clique);
      else avisar("Nenhuma nota ou tarefa com este título.");
    });
  }
  const [preview, setPreview] = useState(initialPreview);
  // Nota com o Modo de escrita disponível não tem pré-visualização: o texto já é editado direto.
  useEffect(() => { if (tintaNotaId && preview) setPreview(false); }, [tintaNotaId, preview]);
  // Escrevendo, a página inteira abaixo do cabeçalho vira a folha cinza (sem faixas pretas em volta); ver `global.css`.
  useEffect(() => {
    if (!escrevendo) return;
    const pagina = document.querySelector<HTMLElement>(".ecos-detail-page");
    pagina?.setAttribute("data-escrevendo", "");
    return () => pagina?.removeAttribute("data-escrevendo");
  }, [escrevendo]);
  // Os fundos escuros da folha só valem no tema escuro: no claro a tinta é escura e sumiria sobre eles.
  const [temaClaro, setTemaClaro] = useState(() => document.documentElement.getAttribute("data-theme") === "light");
  useEffect(() => {
    const obs = new MutationObserver(() => setTemaClaro(document.documentElement.getAttribute("data-theme") === "light"));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);
  const corFolha = temaClaro ? null : corDoFundo(folha.fundo);
  useEffect(() => {
    if (!escrevendo || !corFolha) return;
    const pagina = document.querySelector<HTMLElement>(".ecos-detail-page");
    pagina?.style.setProperty("--ecos-folha", corFolha);
    return () => { pagina?.style.removeProperty("--ecos-folha"); };
  }, [escrevendo, corFolha]);
  // Itens da escrita (folha, fundo, dedo, limpar…) entram no menu "⋯" da nota, que é renderizado no cabeçalho da página.
  useLayoutEffect(() => { setSlotOpcoes(tintaNotaId ? document.querySelector<HTMLElement>("[data-slot-opcoes-escrita]") : null); }, [tintaNotaId, escrevendo, tinta.carregado]);
  const [cursor, setCursor] = useState(0);
  const [emojiAberto, setEmojiAberto] = useState(false);

  function resizeArea() {
    const area = areaRef.current;
    if (!area || !area.getBoundingClientRect().width) return;
    area.style.height = "auto";
    const css = getComputedStyle(area);
    area.style.height = `${area.scrollHeight + parseFloat(css.borderTopWidth || "0") + parseFloat(css.borderBottomWidth || "0")}px`;
    area.scrollTop = 0;
  }

  useLayoutEffect(resizeArea, [corpo, rows, preview, layout]);
  useLayoutEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    let width = -1;
    let active = true;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width !== width) { width = entry.contentRect.width; resizeArea(); }
    });
    observer.observe(area);
    document.fonts.ready.then(() => { if (active) resizeArea(); });
    return () => { active = false; observer.disconnect(); };
  }, [preview, layout]);

  function envolverSelecao(prefixo: string, sufixo = prefixo) {
    const el = alvo();
    if (!el) return;
    const inicio = el.selectionStart;
    const fim = el.selectionEnd;
    const selecionado = corpo.slice(inicio, fim);
    onCorpoChange(corpo.slice(0, inicio) + prefixo + selecionado + sufixo + corpo.slice(fim));
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = inicio + prefixo.length + selecionado.length;
    });
  }

  /** Comandos de início de linha (título, lista, citação, checklist) —
   * aplica só na linha onde o cursor está, não na seleção inteira: mais
   * simples e previsível que decidir "prefixar cada linha selecionada",
   * e cobre o caso real de uso (cursor numa linha, formata ela). */
  function prefixarLinhaAtual(prefixo: string) {
    const el = alvo();
    if (!el) return;
    const pos = el.selectionStart;
    const inicioLinha = corpo.lastIndexOf("\n", pos - 1) + 1;
    const novoCorpo = corpo.slice(0, inicioLinha) + prefixo + corpo.slice(inicioLinha);
    onCorpoChange(novoCorpo);
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = pos + prefixo.length;
    });
  }

  function inserirNoCursor(texto: string) {
    const el = alvo();
    if (!el) return;
    const pos = el.selectionStart;
    onCorpoChange(corpo.slice(0, pos) + texto + corpo.slice(pos));
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = pos + texto.length;
    });
  }

  // ---- Layout "document" (descrição de Tarefa): barra única no topo, sempre Markdown por baixo ----

  /** Prefixos de bloco que o Markdown aceita — trocar de tipo (lista → citação) tira o anterior. */
  const PREFIXOS_BLOCO = [/^#{1,6}\s+/, /^>\s?/, /^[-*+]\s\[[ xX]\]\s/, /^[-*+]\s/, /^\d+\.\s/];
  const semPrefixoBloco = (linha: string) => {
    for (const r of PREFIXOS_BLOCO) {
      const m = r.exec(linha);
      if (m) return linha.slice(m[0].length);
    }
    return linha;
  };
  const inicioDaLinha = (pos: number) => (pos === 0 ? 0 : corpo.lastIndexOf("\n", pos - 1) + 1);

  function substituir(inicio: number, fim: number, texto: string, selecao?: [number, number]) {
    const el = alvo();
    onCorpoChange(corpo.slice(0, inicio) + texto + corpo.slice(fim));
    requestAnimationFrame(() => {
      el?.focus();
      const [i, f] = selecao ?? [inicio + texto.length, inicio + texto.length];
      el?.setSelectionRange(i, f);
    });
  }

  /** Aplica `fn` a cada linha que a seleção toca (uma linha só, se for só o cursor). */
  function transformarLinhas(fn: (linha: string, indice: number) => string) {
    const el = alvo();
    if (!el) return;
    const inicio = inicioDaLinha(el.selectionStart);
    let fim = corpo.indexOf("\n", el.selectionEnd);
    if (fim === -1) fim = corpo.length;
    const texto = corpo.slice(inicio, fim).split("\n").map(fn).join("\n");
    substituir(inicio, fim, texto, el.selectionStart === el.selectionEnd ? undefined : [inicio, inicio + texto.length]);
  }

  /** Lista/citação alternam: se todas as linhas já têm o prefixo, ele sai; senão entra (trocando o de outro tipo). */
  function alternarBloco(detecta: RegExp, prefixo: (n: number) => string) {
    const el = alvo();
    if (!el) return;
    const inicio = inicioDaLinha(el.selectionStart);
    let fim = corpo.indexOf("\n", el.selectionEnd);
    if (fim === -1) fim = corpo.length;
    const todasJa = corpo.slice(inicio, fim).split("\n").every((l) => !l.trim() || detecta.test(l));
    let n = 0;
    transformarLinhas((l) => (!l.trim() ? l : todasJa ? semPrefixoBloco(l) : prefixo(n++) + semPrefixoBloco(l)));
  }

  function aplicarEstilo(valor: string) {
    const nivel = valor === "h1" ? 1 : valor === "h2" ? 2 : valor === "h3" ? 3 : 0;
    transformarLinhas((l) => {
      if (!l.trim()) return l;
      if (!nivel) return l.replace(/^#{1,6}\s+/, "");
      return `${"#".repeat(nivel)} ${semPrefixoBloco(l)}`;
    });
  }

  /** Negrito/itálico/tachado alternam: já envolvido → desembrulha; senão envolve e mantém o texto selecionado. */
  function alternarInline(marca: string) {
    const el = alvo();
    if (!el) return;
    const a = el.selectionStart;
    const b = el.selectionEnd;
    const envolvido = a >= marca.length && corpo.slice(a - marca.length, a) === marca && corpo.slice(b, b + marca.length) === marca;
    if (envolvido) substituir(a - marca.length, b + marca.length, corpo.slice(a, b), [a - marca.length, b - marca.length]);
    else substituir(a, b, marca + corpo.slice(a, b) + marca, [a + marca.length, b + marca.length]);
  }

  function inserirLink() {
    const el = alvo();
    if (!el) return;
    const a = el.selectionStart;
    const b = el.selectionEnd;
    const texto = corpo.slice(a, b) || "texto";
    const urlInicio = a + texto.length + 3;
    substituir(a, b, `[${texto}](https://)`, [urlInicio, urlInicio + 8]);
  }

  function limparFormatacao() {
    const el = alvo();
    if (!el) return;
    let a = el.selectionStart;
    let b = el.selectionEnd;
    if (a === b) {
      a = inicioDaLinha(a);
      b = corpo.indexOf("\n", b);
      if (b === -1) b = corpo.length;
    }
    // Checklists ficam: o parser do backend depende delas.
    const limpo = corpo
      .slice(a, b)
      .replace(/(\*\*|~~|`)(.+?)\1/g, "$2")
      .replace(/(^|[^\w])_(.+?)_(?=$|[^\w])/g, "$1$2")
      .replace(/^(\s*)(#{1,6}\s+|>\s?|[-*+]\s(?!\[[ xX]\])|\d+\.\s)/gm, "$1");
    substituir(a, b, limpo, [a, a + limpo.length]);
  }


  if (layout === "document") {
    const linhaFim = corpo.indexOf("\n", cursor);
    const linhaAtual = corpo.slice(inicioDaLinha(cursor), linhaFim === -1 ? corpo.length : linhaFim);
    const estiloAtual = /^# /.test(linhaAtual) ? "h1" : /^## /.test(linhaAtual) ? "h2" : /^### /.test(linhaAtual) ? "h3" : "p";
    const tam = barraCompacta ? "h-11 w-11" : "h-8 w-8";
    const separador = <span aria-hidden className="mx-1 h-5 w-px bg-border" />;
    const comandosExtras = [
      { valor: "tachado", rotulo: "Tachado", icone: Strikethrough, executar: () => alternarInline("~~") },
      { valor: "numerada", rotulo: "Lista numerada", icone: ListOrdered, executar: () => alternarBloco(/^\d+\.\s/, (n) => `${n + 1}. `), novoGrupo: true },
      { valor: "lista", rotulo: "Lista com marcadores", icone: List, executar: () => alternarBloco(/^[-*+]\s(?!\[[ xX]\])/, () => "- ") },
      { valor: "checklist", rotulo: "Checklist", icone: ListChecks, executar: () => alternarBloco(/^[-*+]\s\[[ xX]\]\s/, () => "- [ ] ") },
      { valor: "citacao", rotulo: "Citação", icone: Quote, executar: () => alternarBloco(/^>\s?/, () => "> ") },
      { valor: "link", rotulo: "Link", icone: Link, executar: inserirLink, novoGrupo: true },
      { valor: "wikilink", rotulo: "Wikilink [[nota]]", icone: Brackets, executar: () => envolverSelecao("[[", "]]") },
      { valor: "codigo", rotulo: "Código", icone: Code, executar: () => alternarInline("`") },
      { valor: "linha", rotulo: "Linha horizontal", icone: Minus, executar: () => inserirNoCursor("\n---\n") },
      { valor: "emoji", rotulo: "Emoji", icone: Smile, executar: () => setEmojiAberto((v) => !v), novoGrupo: true },
      { valor: "limpar", rotulo: "Limpar formatação", icone: RemoveFormatting, executar: limparFormatacao },
    ];
    const seletorEmoji = emojiAberto && <SeletorEmoji alinharDireita={barraCompacta} aoEscolher={(emoji) => { inserirNoCursor(emoji); setEmojiAberto(false); }} aoFechar={() => setEmojiAberto(false)} />;

    const controlesModo = <>
      {tintaNotaId && <button type="button" aria-pressed={escrevendo} onClick={alternarEscrita} disabled={!tinta.carregado} aria-label={escrevendo ? "Voltar ao modo texto" : "Modo de escrita"} title={escrevendo ? "Voltar ao modo texto" : "Modo de escrita (escrever à mão sobre a Nota)"}
        className={`ml-auto flex ${tam} items-center justify-center rounded-lg transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-steel-400 disabled:opacity-40 ${escrevendo ? "text-text-secondary hover:bg-surface-3 hover:text-text-primary" : "text-steel-300 hover:bg-surface-3"}`}>
        {escrevendo ? <Keyboard size={16} strokeWidth={1.75} /> : <PenLine size={16} strokeWidth={1.75} />}
      </button>}
      {!escrevendo && !tintaNotaId && <button type="button" aria-pressed={preview} onClick={(e) => preservandoScroll(e.currentTarget, () => setPreview(!preview))} aria-label={preview ? "Editar descrição" : "Pré-visualizar descrição"}
        className={`relative ${tintaNotaId ? "" : "ml-auto"} flex ${tam} items-center justify-center rounded-lg text-steel-300 hover:bg-surface-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-steel-400`}>
        {/* O olho fecha até virar um traço na diagonal e esse traço vira o lápis; na volta, o caminho inverso. */}
        <Eye size={16} strokeWidth={1.75} aria-hidden
          className={`absolute [transition-property:transform,opacity] ease-in-out motion-reduce:transition-none ${preview ? "[transform:rotate(-45deg)_scaleY(0.06)_scaleX(0.9)] opacity-0 [transition-duration:300ms,120ms] [transition-delay:0ms,150ms]" : "[transform:none] opacity-100 [transition-duration:300ms,100ms] [transition-delay:70ms,0ms]"}`} />
        {tintaNotaId ? <Keyboard size={16} strokeWidth={1.75} aria-hidden
          className={`absolute [transition-property:transform,opacity] ease-in-out motion-reduce:transition-none ${preview ? "[transform:none] opacity-100 [transition-duration:250ms,140ms] [transition-delay:90ms,120ms]" : "[transform:scale(0.7)] opacity-0 [transition-duration:250ms,120ms] [transition-delay:0ms,0ms]"}`} /> : <Pencil size={15} strokeWidth={1.75} aria-hidden
          className={`absolute [transition-property:transform,opacity] ease-in-out motion-reduce:transition-none ${preview ? "[transform:none] opacity-100 [transition-duration:250ms,140ms] [transition-delay:90ms,120ms]" : "[transform:scale(0.7)] opacity-0 [transition-duration:250ms,120ms] [transition-delay:0ms,0ms]"}`} />}
      </button>}
    </>;

    const fecharMenu = () => document.dispatchEvent(new CustomEvent("ecos:fechar-opcoes-nota"));
    const rotuloMenu = "mb-1.5 block text-xs font-semibold uppercase tracking-wide text-text-muted";
    const itemMenu = "flex min-h-[44px] w-full items-center gap-2 rounded-xl border border-border px-3 text-sm text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary";
    const conteudoMenu = <>
      <div>
        <span className={rotuloMenu}>Estilo da folha</span>
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Estilo da folha">
          {ESTILOS_FOLHA.map((e) => <button key={e.id} type="button" role="radio" aria-checked={folha.estilo === e.id} onClick={() => alterarFolha({ estilo: e.id })}
            className={`min-h-[40px] rounded-lg border px-3 text-sm transition-colors ${folha.estilo === e.id ? "border-steel-400 bg-steel-500/20 text-text-primary" : "border-border text-text-secondary hover:bg-surface-2"}`}>{e.rotulo}</button>)}
        </div>
      </div>
      {!temaClaro && <div>
        <span className={rotuloMenu}>Cor de fundo</span>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Cor de fundo">
          {FUNDOS_FOLHA.map((f) => <button key={f.id} type="button" role="radio" aria-checked={folha.fundo === f.id} aria-label={f.rotulo} title={f.rotulo} onClick={() => alterarFolha({ fundo: f.id })}
            className={`h-9 w-9 rounded-full border-2 transition-transform ${folha.fundo === f.id ? "scale-110 border-steel-400" : "border-border"}`} style={{ background: f.cor ?? "rgb(var(--ecos-surface-1-rgb))" }} />)}
        </div>
      </div>}
      {escrevendo && <label className="flex min-h-[44px] items-center justify-between gap-3 text-sm text-text-secondary">Desenhar com o dedo<Toggle checked={dedoDesenha} onChange={setDedoDesenha} label="Desenhar com o dedo" /></label>}
      <button type="button" className={itemMenu} onClick={() => { fecharMenu(); if (document.fullscreenElement) void document.exitFullscreen(); else void document.documentElement.requestFullscreen?.(); }}><Maximize size={16} />Tela cheia</button>
      <button type="button" className={itemMenu} onClick={() => { fecharMenu(); window.setTimeout(() => window.print(), 350); }}><Printer size={16} />Imprimir ou salvar em PDF</button>
      {tracosAtivos.length > 0 && <button type="button" className="flex min-h-[44px] w-full items-center gap-2 rounded-xl border border-error/40 px-3 text-sm text-error transition-colors hover:bg-error/10" onClick={() => { fecharMenu(); setConfirmarLimpar(true); }}>Limpar anotações</button>}
    </>;
    return <div className="min-w-0" data-corpo-editor>
      {slotOpcoes && createPortal(conteudoMenu, slotOpcoes)}
      {barraCompacta && (slotModo ? createPortal(controlesModo, slotModo) : !escrevendo && <div className="mb-2 flex justify-end gap-1" role="group" aria-label="Modo do editor">{controlesModo}</div>)}
      <div style={escrevendo ? { background: "var(--ecos-folha, rgb(var(--ecos-surface-1-rgb)))" } : undefined} className={semBorda ? "min-w-0" : escrevendo ? "min-w-0" : "min-w-0 rounded-xl border border-border bg-surface-1"}>
      {escrevendo ? <PaletaFlutuante aoSair={barraCompacta && slotModo ? undefined : alternarEscrita}>
        {({ vertical, alinhar, embaixo }) => <BarraTinta pincel={pincel} onPincel={escolherFerramenta} onCor={(cor) => setPincel((p) => ({ ...p, cor }))} onEspessura={(espessura) => setPincel((p) => ({ ...p, espessura }))} onModoBorracha={(modoBorracha: ModoBorracha) => setPincel((p) => ({ ...p, modoBorracha }))}
          podeDesfazer={tinta.podeDesfazer} podeRefazer={tinta.podeRefazer} onDesfazer={tinta.desfazer} onRefazer={tinta.refazer}
          ehMobile={ehMobile} vertical={vertical} alinhar={alinhar} embaixo={embaixo} />}
      </PaletaFlutuante> : <div className={`ecos-editor-floating sticky z-20 flex flex-wrap items-center gap-0.5 px-2 py-1.5 ${semBorda ? "mx-auto mb-4 w-fit max-w-full rounded-2xl border border-steel-400/25 bg-surface-2/45 px-3 shadow-nav backdrop-blur-xl backdrop-saturate-150 [box-shadow:inset_0_1px_0_rgb(255_255_255/0.07),0_8px_28px_rgb(0_0_0/0.28)]" : "rounded-t-xl border-b border-border bg-surface-1"}`} style={semBorda ? { top: "calc(var(--ecos-editor-sticky-top, 0px) + 16px)" } : undefined} data-editor-toolbar role="toolbar" aria-label="Formatação da descrição">
        <div className={`flex min-w-0 items-center gap-0.5 transition-opacity duration-[250ms] ease-in-out motion-reduce:transition-none ${barraCompacta ? "w-full" : "flex-wrap"} ${preview ? "pointer-events-none opacity-35" : "opacity-100"}`} aria-hidden={preview || undefined} {...(preview ? ({ inert: "" } as object) : {})}>
          <MenuSuspenso ariaLabel="Estilo do texto" valor={estiloAtual} onChange={aplicarEstilo} larguraMenu="min-w-[9rem]"
            opcoes={[{ valor: "p", rotulo: "Normal", icone: Type }, { valor: "h1", rotulo: "Título 1", icone: Heading1 }, { valor: "h2", rotulo: "Título 2", icone: Heading2 }, { valor: "h3", rotulo: "Título 3", icone: Heading3 }]}
            classeGatilho={`${barraCompacta ? "h-11" : "h-8"} flex items-center gap-1.5 rounded-lg pl-2 pr-1.5 text-sm text-text-secondary transition-colors hover:bg-surface-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-steel-400`}
            gatilho={({ aberto, atual }) => <><span>{atual?.rotulo}</span><ChevronDown size={14} className={`text-text-muted transition-transform duration-150 ${aberto ? "rotate-180" : ""}`} /></>} />
          {separador}
          <ToolbarBtn Icon={Bold} label="Negrito (Ctrl+B)" tamanho={tam} onClick={() => alternarInline("**")} />
          <ToolbarBtn Icon={Italic} label="Itálico (Ctrl+I)" tamanho={tam} onClick={() => alternarInline("_")} />
          {barraCompacta ? <>
            <div className="ml-auto">
              <MenuSuspenso ariaLabel="Mais opções de formatação" opcoes={comandosExtras} alinhar="dir" fixo larguraMin={220}
                onChange={(valor) => comandosExtras.find((comando) => comando.valor === valor)?.executar()}
                classeGatilho="flex h-11 w-11 items-center justify-center rounded-lg text-text-secondary hover:bg-surface-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-steel-400"
                gatilho={() => <Ellipsis size={19} aria-hidden />} />
            </div>
            {seletorEmoji}
          </> : comandosExtras.map(({ valor, rotulo, icone, executar, novoGrupo }) => {
            const botao = <ToolbarBtn Icon={icone} label={rotulo} tamanho={tam} onClick={executar} />;
            return <Fragment key={valor}>
              {novoGrupo && separador}
              {valor === "emoji" ? <div className="relative">{botao}{seletorEmoji}</div> : botao}
            </Fragment>;
          })}
        </div>
        {!barraCompacta && controlesModo}
      </div>}
      {tintaNotaId && <>
        <AvisoModoEscrita open={avisoAberto} largura={LARGURA_COLUNA_PADRAO} onRecusar={() => setAvisoAberto(false)} onAceitar={() => { setAvisoAberto(false); tinta.converter(LARGURA_COLUNA_PADRAO); setEscrevendo(true); }} />
        <ConfirmDeleteDialog open={confirmarLimpar} title="Limpar as anotações?" busy={false} description="Apaga toda a escrita à mão desta Nota. O texto não muda, e dá para desfazer enquanto a Nota estiver aberta." onCancel={() => setConfirmarLimpar(false)}
          onConfirm={() => { setConfirmarLimpar(false); tinta.executar({ tipo: "apagar", ids: tracosAtivos.map((t) => t.id), em: new Date().toISOString() }); }} />
        {tinta.erro && (escrevendo || comTinta) && <div role="alert" className="mb-3 flex items-start gap-2 rounded-xl border border-error/40 bg-error/10 p-3 text-sm text-error">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span className="min-w-0 flex-1">{tinta.erro}</span>
          {tinta.estado === "conflito" && <button type="button" onClick={tinta.recarregar} className="shrink-0 rounded-lg bg-surface-2 px-2 py-1 text-xs font-medium text-text-primary">Recarregar</button>}
        </div>}
      </>}
      {tintaNotaId && !tinta.carregado
        ? <div aria-hidden className={semBorda ? "min-h-[60vh]" : "min-h-40"} />
        : colunaFixa
        ? <ColunaTinta largura={larguraColuna} tracos={tinta.tracos} escrevendo={escrevendo} pincel={pincel} dedoDesenha={dedoDesenha} onOperacao={tinta.executar} onAlternarCaneta={alternarCanetaMarca} estiloFolha={folha.estilo}>
            <EditorVivo corpo={corpo} onCorpoChange={onCorpoChange} areaRef={editorRef} ariaLabel="Conteúdo da nota" placeholder={placeholder} somenteLeitura={escrevendo || preview}
              alturaMinima={semBorda ? "60vh" : "10rem"} resolverImagem={(src) => resolverSrcImagem(src, itemId, tipo)} atalhos={{ "Mod-b": () => alternarInline("**"), "Mod-i": () => alternarInline("_") }}
              className={CLASSE_TEXTO_COLUNA} aoAbrirWikilink={abrirWikilink} wikilinks={{ notaAtualId: notaId ?? itemId, espaco }} />
          </ColunaTinta>
        : preview
        ? <div className={`min-w-0 break-words text-sm ${semBorda ? "min-h-[60vh] px-0.5 py-2" : "min-h-40 rounded-b-xl p-4"} [&_pre]:overflow-x-auto [&_img]:max-w-full`}>{corpo.trim() ? <MarkdownPreview corpo={corpo} itemId={itemId} tipo={tipo} /> : <p className="text-text-muted">Nada para pré-visualizar ainda.</p>}</div>
        : <EditorVivo corpo={corpo} onCorpoChange={onCorpoChange} areaRef={editorRef} ariaLabel={tipo === "tarefa" ? "Descrição da tarefa" : "Conteúdo da nota"} placeholder={placeholder}
            alturaMinima={semBorda ? "60vh" : "10rem"} resolverImagem={(src) => resolverSrcImagem(src, itemId, tipo)} atalhos={{ "Mod-b": () => alternarInline("**"), "Mod-i": () => alternarInline("_") }}
            className={semBorda ? "px-0.5 py-2" : "p-4"} aoAbrirWikilink={abrirWikilink} wikilinks={{ notaAtualId: notaId ?? itemId, espaco }} />}
      </div>
    </div>;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className={ehMobile ? "flex flex-col gap-3" : "grid grid-cols-2 gap-4"}>
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-1 overflow-x-auto rounded-xl bg-surface-2 p-1">
          <ToolbarBtn Icon={Heading1} label="Título 1" onClick={() => prefixarLinhaAtual("# ")} />
          <ToolbarBtn Icon={Heading2} label="Título 2" onClick={() => prefixarLinhaAtual("## ")} />
          <ToolbarBtn Icon={Bold} label="Negrito" onClick={() => envolverSelecao("**")} />
          <ToolbarBtn Icon={Italic} label="Itálico" onClick={() => envolverSelecao("_")} />
          <ToolbarBtn Icon={Strikethrough} label="Tachado" onClick={() => envolverSelecao("~~")} />
          <ToolbarBtn Icon={ListChecks} label="Checklist" onClick={() => prefixarLinhaAtual("- [ ] ")} />
          <ToolbarBtn Icon={List} label="Lista" onClick={() => prefixarLinhaAtual("- ")} />
          <ToolbarBtn Icon={Quote} label="Citação" onClick={() => prefixarLinhaAtual("> ")} />
          <ToolbarBtn Icon={Code} label="Código" onClick={() => envolverSelecao("`")} />
          <ToolbarBtn Icon={Link2} label="Wikilink" onClick={() => envolverSelecao("[[", "]]")} />
          <ToolbarBtn Icon={Minus} label="Linha horizontal" onClick={() => inserirNoCursor("\n---\n")} />
        </div>

        <textarea
          ref={areaRef}
          aria-label={tipo === "tarefa" ? "Descrição da tarefa" : "Conteúdo da nota"}
          value={corpo}
          onChange={(e) => onCorpoChange(e.target.value)}
          placeholder={placeholder}
          rows={rows}
          className="ecos-autogrow w-full rounded-2xl bg-surface-2 p-5 font-body text-[16px] text-text-primary placeholder:text-text-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-steel-400"
        />
      </div>

      {!ehMobile && (
        <div className="rounded-2xl border border-border bg-surface-1 p-4 text-sm">
          {corpo.trim() ? <MarkdownPreview corpo={corpo} itemId={itemId} tipo={tipo} /> : <p className="text-text-muted">Preview aparece aqui.</p>}
        </div>
      )}
      </div>
    </div>
  );
}

function ToolbarBtn({ Icon, onClick, label, disabled, tamanho = "h-11 w-11" }: { Icon: typeof Bold; onClick: () => void; label: string; disabled?: boolean; tamanho?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`flex ${tamanho} shrink-0 items-center justify-center rounded-lg text-text-secondary hover:bg-surface-3 hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-steel-400 disabled:opacity-40`}
    >
      <Icon size={17} strokeWidth={1.75} />
    </button>
  );
}

const EMOJIS = ["😀", "😄", "😊", "😉", "😍", "🤔", "😅", "😢", "😡", "👍", "👎", "👏", "🙏", "💪", "🔥", "⭐", "✨", "💡", "✅", "❌", "⚠️", "❗", "❓", "📌", "📎", "📅", "⏰", "📝", "📚", "💰", "🚀", "🎯", "🔒", "🎉", "❤️", "👀"];

function SeletorEmoji({ aoEscolher, aoFechar, alinharDireita }: { aoEscolher: (emoji: string) => void; aoFechar: () => void; alinharDireita: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const fora = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) aoFechar(); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") aoFechar(); };
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", fora); document.removeEventListener("keydown", esc); };
  }, [aoFechar]);
  return <div ref={ref} role="dialog" aria-label="Escolher emoji" className={`absolute top-full z-40 mt-1 grid w-64 grid-cols-9 gap-0.5 rounded-xl border border-border bg-surface-2 p-1.5 shadow-nav ecos-fade-in ${alinharDireita ? "right-0" : "left-0"}`}>
    {EMOJIS.map((emoji) => <button key={emoji} type="button" onClick={() => aoEscolher(emoji)} className="flex h-7 w-7 items-center justify-center rounded-md text-base hover:bg-surface-3">{emoji}</button>)}
  </div>;
}
