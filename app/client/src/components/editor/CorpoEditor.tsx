import { MenuSuspenso } from "@/components/common/MenuSuspenso";
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Maximize, Printer } from "lucide-react";
import { SeletorVisualizacao } from "./SeletorVisualizacao";
import { lembrarModoDaNota, modoInicialDaNota, renovarModoDaNota, type ModoVisualNota } from "@/lib/modo-visual-nota";
import { Toggle } from "@/components/common/Toggle";
import { corDoFundo, desenhoFolha, ESTILOS_FOLHA, FUNDOS_FOLHA, useFolha } from "@/lib/tinta/folha";
import { AlertTriangle, Bold, Brackets, ChevronDown, Code, Contrast, Ellipsis, Eye, Heading1, Heading2, Heading3, Italic, Keyboard, Link, Link2, List, ListChecks, ListOrdered, Minus, NotebookPen, Pencil, PenLine, Quote, RemoveFormatting, Smile, Strikethrough, Type } from "lucide-react";
import { SeletorEmoji } from "./SeletorEmoji";
import { ContadorTexto } from "./ContadorTexto";
import { EditorVivo, type AreaLike } from "./EditorVivo";
import { GRUPOS_ATALHOS } from "@/lib/atalhos";
import { MarkdownPreview, resolverSrcImagem } from "@/lib/markdown-mini";
import { OutlineTitulos, SumarioLateral } from "./OutlineTitulos";
import { IrParaTrecho } from "./IrParaTrecho";
import { alternarSumarioLateral, useSumarioLateralAberto } from "./sumario-lateral-estado";
import { extrairEstrutura } from "@/lib/sumario";
import { useIsDesktop, useIsMobile } from "@/lib/use-viewport";
import { analisarWikilink, resolverWikilink, useAbrirDestino } from "@/lib/wikilinks";
import { avisar } from "@/lib/toast";
import { media } from "@/lib/api";
import { mensagemDeErro } from "@/lib/erros";
import { inserirReferencia } from "./AttachmentsField";
import { preservandoScroll } from "@/lib/preservar-scroll";
import { ConfirmDeleteDialog } from "@/components/common/ConfirmDeleteDialog";
import { AvisoModoEscrita } from "@/components/tinta/AvisoModoEscrita";
import { BarraTinta } from "@/components/tinta/BarraTinta";
import { novoBlocoEscrita } from "@/lib/escrita-bloco";
import { definirPincelBloco } from "./escrita-widget";
import { PaletaFlutuante } from "@/components/tinta/PaletaFlutuante";
import { BarraFormatacao, type ComandoFormatacao } from "@/components/tinta/BarraFormatacao";
import { CLASSE_TEXTO_COLUNA, ColunaTinta, type FerramentaUI, type ModoBorracha, type Pincel } from "@/components/tinta/ColunaTinta";
import { useTinta } from "@/lib/tinta/use-tinta";
import { estiloColunaNota, estiloFolhaPagina, estiloTextoNota, linhaDaNota, usePreferenciasNota } from "@/lib/tipografia-nota";
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
  /** A edição está fechando: a barra de formatação faz a animação de saída. */
  fechando?: boolean;
  /** Recebe a função que abre o seletor de anexo (botão "+" do cabeçalho); o arquivo entra na linha do cursor. */
  anexarRef?: { current: (() => void) | null };
  /** Avisa quando o Modo de escrita liga/desliga (a tela esconde o que cerca a nota e o oferece num painel). */
  aoMudarEscrita?: (escrevendo: boolean) => void;
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
export function CorpoEditor({ corpo, onCorpoChange: onCorpoChangeExterno, itemId, tipo, placeholder, rows = 8, layout = "split", initialPreview = false, semBorda = false, notaId, espaco, tintaNotaId, aoMudarEscrita, fechando = false, anexarRef }: Props) {
  // ---- Modo de escrita (tinta). Sem `tintaNotaId` nada disto aparece. ----
  const tinta = useTinta(tintaNotaId);
  const [viewContador, setViewContador] = useState<import("@codemirror/view").EditorView | null>(null);
  const [escrevendo, setEscrevendo] = useState(false);
  const [avisoAberto, setAvisoAberto] = useState(false);
  const [confirmarLimpar, setConfirmarLimpar] = useState(false);
  const [dedoDesenha, setDedoDesenha] = useState(false);
  const [folha, alterarFolha] = useFolha(tintaNotaId);
  const [slotOpcoes, setSlotOpcoes] = useState<HTMLElement | null>(null);
  const memoriaPincel = useRef<Record<Ferramenta, { cor: string; espessura: number; reta?: boolean }>>({ caneta: { cor: "auto", espessura: 2.5 }, "marca-texto": { cor: "#facc15", espessura: 16 } });
  /** Altura da barra de formatação (para reservar o lugar dela no Modo escrita). */
  const alturaBarra = useRef(0);
  const [pincel, setPincel] = useState<Pincel>({ ferramenta: "caneta", ...memoriaPincel.current.caneta });
  // O bloco de escrita usa a mesma caneta, cor e espessura escolhidas na paleta.
  useEffect(() => { definirPincelBloco(pincel); }, [pincel]);
  const tracosAtivos = ativos(tinta.tracos);
  const comTinta = !!tintaNotaId && tracosAtivos.length > 0;
  // Nota que já tem escrita à mão abre direto no Modo de escrita (uma vez), sem passar pelo texto comum.
  const abriuEscrita = useRef(false);
  useEffect(() => {
    if (abriuEscrita.current || !tintaNotaId || !tinta.carregado) return;
    abriuEscrita.current = true;
    if (tracosAtivos.length > 0 && tinta.largura !== null) setEscrevendo(true);
  }, [tintaNotaId, tinta.carregado, tinta.largura, tracosAtivos.length]);
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
    if (pincel.ferramenta !== "borracha" && pincel.ferramenta !== "laco") memoriaPincel.current[pincel.ferramenta] = { cor: pincel.cor, espessura: pincel.espessura, reta: pincel.reta };
    setPincel(f === "borracha" || f === "laco" ? { ...pincel, ferramenta: f } : { ferramenta: f, ...memoriaPincel.current[f], modoBorracha: pincel.modoBorracha, tamanhoBorracha: pincel.tamanhoBorracha, soMarca: pincel.soMarca });
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
  /** Raiz deste editor: a página da nota é a que o contém (há mais de uma aberta ao mesmo tempo, p.ex. janela + Focus). */
  const raizRef = useRef<HTMLDivElement>(null);
  /** Layout "document": o editor vivo (CodeMirror) expõe a seleção como se fosse um textarea. */
  const editorRef = useRef<AreaLike | null>(null);
  const alvo = (): AreaLike | null => (layout === "document" ? editorRef.current : areaRef.current);
  const ehMobile = useIsMobile();
  const prefsNota = usePreferenciasNota();
  const barraCompacta = !useIsDesktop();
  // Largura disponível para a barra de formatação (desktop). Se a barra inteira não couber numa
  // linha (~700px), ela usa o mesmo layout compacto do celular: Normal, B, I e o resto no "⋯".
  const [larguraBarra, setLarguraBarra] = useState(0);
  const barraEstreita = !barraCompacta && larguraBarra > 0 && larguraBarra < 700;
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
    const pagina = raizRef.current?.closest<HTMLElement>(".ecos-detail-page") ?? null;
    pagina?.setAttribute("data-escrevendo", "");
    return () => pagina?.removeAttribute("data-escrevendo");
  }, [escrevendo]);
  useEffect(() => { aoMudarEscrita?.(escrevendo); }, [escrevendo, aoMudarEscrita]);
  const sumarioLateral = useSumarioLateralAberto();
  useEffect(() => {
    const el = raizRef.current;
    if (!el || barraCompacta || typeof ResizeObserver === "undefined") return;
    const obs = new ResizeObserver(([e]) => setLarguraBarra(Math.round(e.contentRect.width)));
    obs.observe(el);
    return () => obs.disconnect();
  }, [barraCompacta]);
  // Com 2+ itens o trilho de tracinhos aparece e ganha uma faixa própria à esquerda do texto.
  const temTrilho = useMemo(() => extrairEstrutura(corpo).length >= 2, [corpo]);
  // Ao sair do Modo de escrita a paleta se desfaz com animação enquanto a barra de formatação entra.
  const [paletaSaindo, setPaletaSaindo] = useState(false);
  const eraEscrevendo = useRef(false);
  useEffect(() => {
    let t = 0;
    if (eraEscrevendo.current && !escrevendo) { setPaletaSaindo(true); t = window.setTimeout(() => setPaletaSaindo(false), 260); }
    eraEscrevendo.current = escrevendo;
    return () => window.clearTimeout(t);
  }, [escrevendo]);
  // No celular, a formatação do Modo texto também é a paleta flutuante (e a nota perde a moldura, como no Modo de escrita).
  const usaPaleta = !!tintaNotaId && barraCompacta && layout === "document";
  // Modo Fluido ou Página (celular): o padrão vem das configurações; uma troca vale por 2 minutos depois de fechar a nota.
  const [modoNota, setModoNota] = useState<ModoVisualNota>(() => modoInicialDaNota(tintaNotaId, "edicao"));
  const trocouModo = useRef(false);
  function escolherModoNota(modo: ModoVisualNota) {
    if (comTinta) return;
    trocouModo.current = true;
    setModoNota(modo);
    if (tintaNotaId) lembrarModoDaNota(tintaNotaId, "edicao", modo);
  }
  useEffect(() => () => { if (tintaNotaId && trocouModo.current) renovarModoDaNota(tintaNotaId, "edicao"); }, [tintaNotaId]);
  // Nota com escrita à mão (ou no Modo de escrita) é sempre Página: a tinta é absoluta, só alinha na coluna fixa.
  const paginaNoCelular = usaPaleta && (modoNota === "pagina" || escrevendo || comTinta);
  const colunaFixa = !!tintaNotaId && (escrevendo || comTinta || paginaNoCelular);
  const [formatSaindo, setFormatSaindo] = useState(false);
  const eraTexto = useRef(true);
  useEffect(() => {
    let t = 0;
    if (eraTexto.current && escrevendo) { setFormatSaindo(true); t = window.setTimeout(() => setFormatSaindo(false), 260); }
    eraTexto.current = !escrevendo;
    return () => window.clearTimeout(t);
  }, [escrevendo]);
  const folhaPlana = usaPaleta && !escrevendo;
  useLayoutEffect(() => {
    if (!folhaPlana) return;
    const pagina = raizRef.current?.closest<HTMLElement>(".ecos-detail-page") ?? null;
    pagina?.setAttribute("data-folha-plana", "");
    return () => pagina?.removeAttribute("data-folha-plana");
  }, [folhaPlana]);
  // Os fundos escuros da folha só valem no tema escuro: no claro a tinta é escura e sumiria sobre eles.
  const [temaClaro, setTemaClaro] = useState(() => document.documentElement.getAttribute("data-theme") === "light");
  useEffect(() => {
    const obs = new MutationObserver(() => setTemaClaro(document.documentElement.getAttribute("data-theme") === "light"));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);
  const corFolha = temaClaro ? null : corDoFundo(folha.fundo);
  useLayoutEffect(() => {
    if (!(escrevendo || folhaPlana || semBorda) || !corFolha) return;
    const pagina = raizRef.current?.closest<HTMLElement>(".ecos-detail-page") ?? null;
    // A área que rola e a janela em volta pintam com a mesma cor (ver `global.css`), então a variável vale nelas também.
    const alvos = [pagina, pagina?.parentElement, pagina?.parentElement?.parentElement].filter((x): x is HTMLElement => !!x);
    alvos.forEach((x) => { x.style.setProperty("--ecos-folha", corFolha); x.style.backgroundColor = corFolha; });
    return () => { alvos.forEach((x) => { x.style.removeProperty("--ecos-folha"); x.style.removeProperty("background-color"); }); };
  }, [escrevendo, folhaPlana, semBorda, corFolha]);
  // Itens da escrita (folha, fundo, dedo, limpar…) entram no menu "⋯" da nota, que é renderizado no cabeçalho da página.
  useLayoutEffect(() => { setSlotOpcoes(tintaNotaId ? document.querySelector<HTMLElement>("[data-slot-opcoes-escrita]") : null); }, [tintaNotaId, escrevendo, tinta.carregado]);
  const [cursor, setCursor] = useState(0);
  const [emojiAberto, setEmojiAberto] = useState(false);
  const [ajudaAberta, setAjudaAberta] = useState(false);
  // Os três pontinhos da nota abrem a mesma folha de atalhos que a tecla "?".
  useEffect(() => {
    const abrirAjuda = () => setAjudaAberta(true);
    window.addEventListener("ecos:atalhos-editor", abrirAjuda);
    return () => window.removeEventListener("ecos:atalhos-editor", abrirAjuda);
  }, []);
  useEffect(() => {
    if (layout !== "document") return;
    const tecla = (e: KeyboardEvent) => {
      if (e.key !== "?" || e.ctrlKey || e.metaKey || e.altKey) return;
      const alvoTecla = e.target as HTMLElement | null;
      if (alvoTecla?.closest("input, textarea, select, [contenteditable=true], .cm-editor")) return;
      e.preventDefault();
      setAjudaAberta(true);
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [layout]);

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

  /** Texto atual: no editor vivo vem do CodeMirror (pode estar à frente da prop `corpo`). */
  const doc = () => alvo()?.texto?.() ?? corpo;

  /** Troca `[inicio, fim)` por `texto`. No editor vivo é uma transação pequena; no textarea, reescreve o corpo. */
  function substituir(inicio: number, fim: number, texto: string, selecao?: [number, number]) {
    const el = alvo();
    if (el?.substituir) { el.substituir(inicio, fim, texto, selecao); return; }
    const atual = doc();
    onCorpoChange(atual.slice(0, inicio) + texto + atual.slice(fim));
    requestAnimationFrame(() => {
      el?.focus();
      const [i, f] = selecao ?? [inicio + texto.length, inicio + texto.length];
      el?.setSelectionRange(i, f);
    });
  }

  function envolverSelecao(prefixo: string, sufixo = prefixo) {
    const el = alvo();
    if (!el) return;
    const inicio = el.selectionStart;
    const fim = el.selectionEnd;
    const selecionado = doc().slice(inicio, fim);
    const pos = inicio + prefixo.length + selecionado.length;
    substituir(inicio, fim, prefixo + selecionado + sufixo, [pos, pos]);
  }

  /** Comandos de início de linha: aplica só na linha onde o cursor está. */
  function prefixarLinhaAtual(prefixo: string) {
    const el = alvo();
    if (!el) return;
    const pos = el.selectionStart;
    const inicioLinha = doc().lastIndexOf("\n", pos - 1) + 1;
    substituir(inicioLinha, inicioLinha, prefixo, [pos + prefixo.length, pos + prefixo.length]);
  }

  /** Anexo entra no texto na linha do cursor (em bloco próprio), nunca no fim da nota. */
  const seletorAnexo = useRef<HTMLInputElement>(null);
  const posAnexo = useRef(0);
  function abrirAnexo() { posAnexo.current = alvo()?.selectionStart ?? corpo.length; seletorAnexo.current?.click(); }
  useLayoutEffect(() => {
    if (!anexarRef) return;
    anexarRef.current = abrirAnexo;
    return () => { anexarRef.current = null; };
  });
  async function anexarArquivo(arquivo: File) {
    if (arquivo.size > 120 * 1024 * 1024) { avisar("O arquivo excede o limite de 120 MB.", "erro"); return; }
    if (!arquivo.size) { avisar("O arquivo está vazio.", "erro"); return; }
    try {
      const item = await media.enviar(arquivo, espaco);
      const texto = alvo()?.texto?.() ?? corpo;
      const novo = inserirReferencia(texto, media.referencia(item), Math.min(posAnexo.current, texto.length));
      // Vários arquivos de uma vez: o próximo entra logo depois deste, na ordem em que foram escolhidos.
      posAnexo.current = Math.min(posAnexo.current, texto.length) + (novo.length - texto.length);
      onCorpoChange(novo);
    } catch (e) { avisar(mensagemDeErro(e, "Não foi possível enviar o arquivo. Tente novamente."), "erro"); }
  }

  function inserirNoCursor(texto: string) {
    const el = alvo();
    if (!el) return;
    substituir(el.selectionStart, el.selectionEnd, texto);
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
  const inicioDaLinha = (pos: number, texto = corpo) => (pos === 0 ? 0 : texto.lastIndexOf("\n", pos - 1) + 1);

  /** Aplica `fn` a cada linha que a seleção toca (uma linha só, se for só o cursor). */
  function transformarLinhas(fn: (linha: string, indice: number) => string) {
    const el = alvo();
    if (!el) return;
    const atual = doc();
    const inicio = inicioDaLinha(el.selectionStart, atual);
    let fim = atual.indexOf("\n", el.selectionEnd);
    if (fim === -1) fim = atual.length;
    const texto = atual.slice(inicio, fim).split("\n").map(fn).join("\n");
    substituir(inicio, fim, texto, el.selectionStart === el.selectionEnd ? undefined : [inicio, inicio + texto.length]);
  }

  /** Lista/citação alternam: se todas as linhas já têm o prefixo, ele sai; senão entra (trocando o de outro tipo). */
  function alternarBloco(detecta: RegExp, prefixo: (n: number) => string) {
    const el = alvo();
    if (!el) return;
    const atual = doc();
    const inicio = inicioDaLinha(el.selectionStart, atual);
    let fim = atual.indexOf("\n", el.selectionEnd);
    if (fim === -1) fim = atual.length;
    const todasJa = atual.slice(inicio, fim).split("\n").every((l) => !l.trim() || detecta.test(l));
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

  /**
   * Negrito/itálico/tachado/código alternam. Com seleção: envolve ou desembrulha.
   * Sem seleção: a palavra sob o cursor (desembrulha se já estiver marcada; no itálico vale `_x_` e `*x*`);
   * fora de palavra, insere o par com o cursor no meio (ou tira um par vazio).
   */
  function alternarInline(marca: string) {
    const el = alvo();
    if (!el) return;
    const atual = doc();
    const cursor = el.selectionStart;
    let a = el.selectionStart;
    let b = el.selectionEnd;
    const variantes = marca === "_" ? ["_", "*"] : [marca];
    const cercada = (de: number, ate: number) => variantes.find((m) => {
      if (de < m.length || atual.slice(de - m.length, de) !== m || atual.slice(ate, ate + m.length) !== m) return false;
      // `*x*` não se confunde com `**x**` (negrito).
      if (m === "*") return atual[de - 2] !== "*" && atual[ate + 1] !== "*";
      return true;
    });
    const vazia = a === b;
    if (vazia) {
      const ehLetra = (c: string | undefined) => !!c && /[\p{L}\p{N}]/u.test(c);
      while (a > 0 && ehLetra(atual[a - 1])) a--;
      while (b < atual.length && ehLetra(atual[b])) b++;
    }
    const m = cercada(a, b);
    if (vazia && a === b) {
      if (m) substituir(a - m.length, b + m.length, "", [a - m.length, a - m.length]);
      else substituir(a, a, marca + marca, [a + marca.length, a + marca.length]);
      return;
    }
    if (m) substituir(a - m.length, b + m.length, atual.slice(a, b), vazia ? [cursor - m.length, cursor - m.length] : [a - m.length, b - m.length]);
    else substituir(a, b, marca + atual.slice(a, b) + marca, vazia ? [cursor + marca.length, cursor + marca.length] : [a + marca.length, b + marca.length]);
  }

  /** Bloco de escrita à mão numa linha própria, logo abaixo da linha do cursor. */
  function inserirBlocoEscrita() {
    const atual = doc();
    const fimLinha = atual.indexOf("\n", alvo()?.selectionStart ?? cursor);
    const pos = fimLinha === -1 ? atual.length : fimLinha;
    const antes = pos > 0 ? "\n" : "";
    const texto = `${antes}${novoBlocoEscrita()}\n`;
    substituir(pos, pos, texto);
  }

  function inserirLink() {
    const el = alvo();
    if (!el) return;
    const a = el.selectionStart;
    const b = el.selectionEnd;
    const texto = doc().slice(a, b) || "texto";
    const urlInicio = a + texto.length + 3;
    substituir(a, b, `[${texto}](https://)`, [urlInicio, urlInicio + 8]);
  }

  function limparFormatacao() {
    const el = alvo();
    if (!el) return;
    const atual = doc();
    let a = el.selectionStart;
    let b = el.selectionEnd;
    if (a === b) {
      a = inicioDaLinha(a, atual);
      b = atual.indexOf("\n", b);
      if (b === -1) b = atual.length;
    }
    // Checklists ficam: o parser do backend depende delas.
    const limpo = atual
      .slice(a, b)
      .replace(/(\*\*|~~|`)(.+?)\1/g, "$2")
      .replace(/(^|[^\w])_(.+?)_(?=$|[^\w])/g, "$1$2")
      .replace(/^(\s*)(#{1,6}\s+|>\s?|[-*+]\s(?!\[[ xX]\])|\d+\.\s)/gm, "$1");
    substituir(a, b, limpo, [a, a + limpo.length]);
  }

  const alternarNumerada = () => alternarBloco(/^\d+\.\s/, (n) => `${n + 1}. `);
  const alternarLista = () => alternarBloco(/^[-*+]\s(?!\[[ xX]\])/, () => "- ");
  const alternarChecklist = () => alternarBloco(/^[-*+]\s\[[ xX]\]\s/, () => "- [ ] ");
  const atalhosEditor: Record<string, () => void> = {
    "Mod-b": () => alternarInline("**"),
    "Mod-i": () => alternarInline("_"),
    "Mod-k": inserirLink,
    "Mod-e": () => alternarInline("`"),
    "Mod-Shift-x": () => alternarInline("~~"),
    "Mod-Alt-0": () => aplicarEstilo("p"),
    "Mod-Alt-1": () => aplicarEstilo("h1"),
    "Mod-Alt-2": () => aplicarEstilo("h2"),
    "Mod-Alt-3": () => aplicarEstilo("h3"),
    "Mod-Shift-7": alternarNumerada,
    "Mod-Shift-8": alternarLista,
    "Mod-Shift-9": alternarChecklist,
    "Mod-/": () => setAjudaAberta(true),
  };


  if (layout === "document") {
    const linhaFim = corpo.indexOf("\n", cursor);
    const linhaAtual = corpo.slice(inicioDaLinha(cursor), linhaFim === -1 ? corpo.length : linhaFim);
    const estiloAtual = /^# /.test(linhaAtual) ? "h1" : /^## /.test(linhaAtual) ? "h2" : /^### /.test(linhaAtual) ? "h3" : "p";
    const tam = barraCompacta ? "h-11 w-11" : "h-8 w-8";
    const separador = <span aria-hidden className="mx-1 h-5 w-px bg-border" />;
    const comandosExtras = [
      { valor: "tachado", rotulo: "Tachado", atalho: "Ctrl+Shift+X", icone: Strikethrough, executar: () => alternarInline("~~") },
      { valor: "numerada", rotulo: "Lista numerada", atalho: "Ctrl+Shift+7", icone: ListOrdered, executar: alternarNumerada, novoGrupo: true },
      { valor: "lista", rotulo: "Lista com marcadores", atalho: "Ctrl+Shift+8", icone: List, executar: alternarLista },
      { valor: "checklist", rotulo: "Checklist", atalho: "Ctrl+Shift+9", icone: ListChecks, executar: alternarChecklist },
      { valor: "citacao", rotulo: "Citação", icone: Quote, executar: () => alternarBloco(/^>\s?/, () => "> ") },
      { valor: "link", rotulo: "Link", atalho: "Ctrl+K", icone: Link, executar: inserirLink, novoGrupo: true },
      { valor: "wikilink", rotulo: "Wikilink [[nota]]", icone: Brackets, executar: () => envolverSelecao("[[", "]]") },
      { valor: "codigo", rotulo: "Código", atalho: "Ctrl+E", icone: Code, executar: () => alternarInline("`") },
      { valor: "linha", rotulo: "Linha horizontal", icone: Minus, executar: () => inserirNoCursor("\n---\n") },
      { valor: "escrita", rotulo: "Bloco de escrita à mão", icone: NotebookPen, executar: inserirBlocoEscrita },
      { valor: "emoji", rotulo: "Emoji", icone: Smile, executar: () => setEmojiAberto((v) => !v), novoGrupo: true },
      { valor: "limpar", rotulo: "Limpar formatação", icone: RemoveFormatting, executar: limparFormatacao },
      // Os atalhos ficam nos três pontinhos; o Modo de escrita é o botão de caneta no fim da barra (controlesModo).
    ];
    const seletorEmoji = emojiAberto && <SeletorEmoji alinharDireita={barraCompacta} aoEscolher={(emoji) => { inserirNoCursor(emoji); setEmojiAberto(false); }} aoFechar={() => setEmojiAberto(false)} />;

    const controlesModo = <>
      {tintaNotaId && <button type="button" aria-pressed={escrevendo} onClick={alternarEscrita} disabled={!tinta.carregado} aria-label={escrevendo ? "Voltar ao modo texto" : "Escrever à mão"} title={escrevendo ? "Voltar ao modo texto" : "Escrever à mão"}
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
    // No desktop o "⋯" é um menu suspenso compacto (linhas de 32px); no celular, o painel com alvos de 44px.
    const compacto = !!slotOpcoes?.hasAttribute("data-compacto");
    const rotuloMenu = compacto ? "mb-1 block text-[11px] font-semibold uppercase tracking-wide text-text-muted" : "mb-1.5 block text-xs font-semibold uppercase tracking-wide text-text-muted";
    const itemMenu = compacto ? "ecos-menu-item flex min-h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[13px] text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary" : "ecos-menu-item flex min-h-[44px] w-full items-center gap-2 rounded-xl border border-border px-3 text-sm text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary";
    const conteudoMenu = <div className={compacto ? "flex flex-col gap-0.5" : "space-y-4"}>
      <div className={compacto ? "px-2.5 py-1.5" : ""}>
        <span className={rotuloMenu}>Estilo da folha</span>
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Estilo da folha">
          {ESTILOS_FOLHA.map((e) => <button key={e.id} type="button" role="radio" aria-checked={folha.estilo === e.id} onClick={() => alterarFolha({ estilo: e.id })}
            className={`${compacto ? "rounded-md px-2 py-1 text-xs" : "min-h-[40px] rounded-lg px-3 text-sm"} border transition-colors ${folha.estilo === e.id ? "border-steel-400 bg-steel-500/20 text-text-primary" : "border-border text-text-secondary hover:bg-surface-2"}`}>{e.rotulo}</button>)}
        </div>
      </div>
      {!temaClaro && <div className={compacto ? "px-2.5 py-1.5" : ""}>
        <span className={rotuloMenu}>Cor de fundo</span>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Cor de fundo">
          {FUNDOS_FOLHA.map((f) => <button key={f.id} type="button" role="radio" aria-checked={folha.fundo === f.id} aria-label={f.rotulo} title={f.rotulo} onClick={() => alterarFolha({ fundo: f.id })}
            className={`${compacto ? "h-6 w-6" : "h-9 w-9"} rounded-full border-2 ${f.cor ? "ecos-vidro" : "transition-transform"} ${folha.fundo === f.id ? "scale-110 border-steel-400" : "border-border"}`} style={{ background: f.cor ?? "rgb(var(--ecos-surface-1-rgb))", "--cor": f.cor ?? "transparent" } as React.CSSProperties}>{f.cor === null && <Contrast size={compacto ? 14 : 18} strokeWidth={2} className="mx-auto text-text-secondary" aria-hidden />}</button>)}
        </div>
      </div>}
      {usaPaleta && <SeletorVisualizacao modo={modoNota} travado={comTinta || escrevendo} aoEscolher={escolherModoNota} />}
      {escrevendo && <label className="flex min-h-[44px] items-center justify-between gap-3 text-sm text-text-secondary">Desenhar com o dedo<Toggle checked={dedoDesenha} onChange={setDedoDesenha} label="Desenhar com o dedo" /></label>}
      <button type="button" className={itemMenu} onClick={() => { fecharMenu(); if (document.fullscreenElement) void document.exitFullscreen(); else void document.documentElement.requestFullscreen?.(); }}><Maximize size={compacto ? 15 : 16} className="ecos-menu-icone" />Tela cheia</button>
      <button type="button" className={itemMenu} onClick={() => { fecharMenu(); window.setTimeout(() => window.print(), 350); }}><Printer size={compacto ? 15 : 16} className="ecos-menu-icone" />Imprimir</button>
      {tracosAtivos.length > 0 && <button type="button" className={compacto ? "flex min-h-8 w-full items-center rounded-md px-2.5 text-left text-[13px] text-error transition-colors hover:bg-error/10" : "flex min-h-[44px] w-full items-center gap-2 rounded-xl border border-error/40 px-3 text-sm text-error transition-colors hover:bg-error/10"} onClick={() => { fecharMenu(); setConfirmarLimpar(true); }}>Limpar anotações</button>}
    </div>;
    // Celular e tablet (até 1023px), nota sem escrita à mão: texto de 16px, igual ao da leitura (14px é pequeno na tela do telefone). Com tinta a coluna é fixa e o texto não pode mudar de tamanho, senão a escrita desalinha.
    const fonteMaior = usaPaleta && !colunaFixa;
    // Preferências de tipografia (Configurações > Editor e escrita): só em notas na coluna fluida; com tinta a coluna é fixa.
    const tipografia = tipo === "nota" && !colunaFixa;
    // Tudo na nota se mede em linhas (o número central, configurável): texto, títulos, imagens e a grade da folha.
    const linhaPx = linhaDaNota(prefsNota, fonteMaior ? 16 : 14);
    const linhaCentral = { "--ecos-linha-nota": `${linhaPx}px` } as React.CSSProperties;
    const estiloRaiz = tipografia ? estiloTextoNota(prefsNota, fonteMaior ? 16 : 14) : fonteMaior ? ({ "--ecos-fonte-nota": "16px", ...linhaCentral } as React.CSSProperties) : linhaCentral;
    // Modo Focus: o estilo da folha (pautada, quadriculada, pontilhada) também vale no texto corrido, em cima da mesma linha da nota.
    const estiloGrade = (() => { const { deslocamentoY, ...d } = desenhoFolha(folha.estilo, 1, linhaPx); return { ...d, backgroundPosition: `0px ${deslocamentoY}` } as React.CSSProperties; })();
    const estiloColuna = tipografia && !escrevendo ? { ...estiloColunaNota(prefsNota), ...(preview ? {} : estiloFolhaPagina(prefsNota)) } : undefined;
    return <div ref={raizRef} className="min-w-0 ecos-grade" data-corpo-editor data-escrevendo={escrevendo ? "" : undefined} data-trilho={temTrilho ? "" : undefined} data-modo-pagina={tipografia && prefsNota.notaPapel !== "desligado" ? prefsNota.notaPapel : undefined} style={estiloRaiz}>
      {!escrevendo && <OutlineTitulos corpo={corpo} view={preview ? null : viewContador} raiz={raizRef} />}
      <IrParaTrecho itemId={itemId} corpo={corpo} view={preview ? null : viewContador} raiz={raizRef} />
      {slotOpcoes && createPortal(conteudoMenu, slotOpcoes)}
      {barraCompacta && !tintaNotaId && (slotModo ? createPortal(controlesModo, slotModo) : !escrevendo && <div className="mb-2 flex justify-end gap-1" role="group" aria-label="Modo do editor">{controlesModo}</div>)}
      <div style={escrevendo || folhaPlana || semBorda ? { background: "var(--ecos-folha, transparent)" } : undefined} className={semBorda || escrevendo || folhaPlana ? "min-w-0" : "min-w-0 rounded-xl border border-border bg-surface-1"}>
      {(escrevendo || paletaSaindo) && <PaletaFlutuante saindo={!escrevendo} aoSair={alternarEscrita}>
        {({ vertical, alinhar, embaixo }) => <BarraTinta pincel={pincel} onPincel={escolherFerramenta} onCor={(cor) => setPincel((p) => ({ ...p, cor }))} onEspessura={(espessura) => setPincel((p) => ({ ...p, espessura }))} onReta={(reta) => setPincel((p) => ({ ...p, reta }))} onTamanhoBorracha={(tamanhoBorracha) => setPincel((p) => ({ ...p, tamanhoBorracha }))} onModoBorracha={(modoBorracha: ModoBorracha) => setPincel((p) => ({ ...p, modoBorracha }))} onSoMarca={(soMarca) => setPincel((p) => ({ ...p, soMarca }))}
          podeDesfazer={tinta.podeDesfazer} podeRefazer={tinta.podeRefazer} onDesfazer={tinta.desfazer} onRefazer={tinta.refazer}
          ehMobile={ehMobile} vertical={vertical} alinhar={alinhar} embaixo={embaixo} />}
      </PaletaFlutuante>}
      {usaPaleta && tinta.carregado && (!escrevendo || formatSaindo) && <PaletaFlutuante desvanecer saindo={escrevendo || fechando} rotulo="Formatação da descrição" iconeBolinha={Type} iconeSair={PenLine} rotuloSair="Escrever à mão" aoSair={alternarEscrita} reservarTopo>
        {({ vertical, alinhar }) => <BarraFormatacao estilo={estiloAtual} onEstilo={aplicarEstilo} ehMobile={ehMobile} vertical={vertical} alinhar={alinhar}
          grupos={[
            [{ valor: "negrito", rotulo: "Negrito", atalho: "Ctrl+B", icone: Bold, executar: () => alternarInline("**") }, { valor: "italico", rotulo: "Itálico", atalho: "Ctrl+I", icone: Italic, executar: () => alternarInline("_") }, comandosExtras[0]!],
            [comandosExtras[2]!, comandosExtras[4]!],
            [comandosExtras[5]!],
          ] satisfies ComandoFormatacao[][]}
          extras={[comandosExtras[1]!, comandosExtras[3]!, comandosExtras[7]!, comandosExtras[6]!, comandosExtras[8]!, comandosExtras[9]!, comandosExtras[10]!, comandosExtras[11]!]} />}
      </PaletaFlutuante>}
      {/* Modo escrita: guarda o lugar da barra de formatação, para o texto (e a tinta) não pular ao trocar de modo. */}
      {escrevendo && !usaPaleta && semBorda && <div aria-hidden className="mb-7" style={{ height: alturaBarra.current || 46 }} />}
      {!escrevendo && !usaPaleta && <div className={`${fechando ? "ecos-barra-sai" : "ecos-barra-entra"} ecos-editor-floating sticky z-20 flex flex-wrap items-center gap-0.5 px-2 py-1.5 ${semBorda ? "mx-auto mb-7 w-fit max-w-full rounded-2xl border border-steel-400/25 bg-surface-2/45 px-3 shadow-nav backdrop-blur-xl backdrop-saturate-150 [box-shadow:inset_0_1px_0_rgb(255_255_255/0.07),0_8px_28px_rgb(0_0_0/0.28)]" : "rounded-t-xl border-b border-border bg-surface-1"}`} style={semBorda ? { top: "calc(var(--ecos-editor-sticky-top, 0px) + 16px)" } : undefined} data-editor-toolbar role="toolbar" aria-label="Formatação da descrição" ref={(el) => { if (el?.offsetHeight) alturaBarra.current = el.offsetHeight; }}>
        {barraEstreita
          // Coluna estreita no desktop: a mesma barra do celular (grupos que rolam na horizontal + "⋯").
          ? <div className={`min-w-0 flex-1 transition-opacity duration-[250ms] ${preview ? "pointer-events-none opacity-35" : "opacity-100"}`} aria-hidden={preview || undefined}>
              <BarraFormatacao estilo={estiloAtual} onEstilo={aplicarEstilo} ehMobile={false}
                grupos={[
                  [{ valor: "negrito", rotulo: "Negrito", atalho: "Ctrl+B", icone: Bold, executar: () => alternarInline("**") }, { valor: "italico", rotulo: "Itálico", atalho: "Ctrl+I", icone: Italic, executar: () => alternarInline("_") }, comandosExtras[0]!],
                  [comandosExtras[2]!, comandosExtras[4]!],
                  [comandosExtras[5]!],
                ] satisfies ComandoFormatacao[][]}
                extras={[comandosExtras[1]!, comandosExtras[3]!, comandosExtras[7]!, comandosExtras[6]!, comandosExtras[8]!, comandosExtras[9]!, comandosExtras[10]!, comandosExtras[11]!]} />
              {seletorEmoji}
            </div>
          : <div className={`flex min-w-0 items-center gap-0.5 transition-opacity duration-[250ms] ease-in-out motion-reduce:transition-none ${barraCompacta ? "w-full" : "flex-wrap"} ${preview ? "pointer-events-none opacity-35" : "opacity-100"}`} aria-hidden={preview || undefined} {...(preview ? ({ inert: "" } as object) : {})}>
          <MenuSuspenso ariaLabel="Estilo do texto" valor={estiloAtual} onChange={aplicarEstilo} larguraMenu="min-w-[9rem]"
            opcoes={[{ valor: "p", rotulo: "Normal", icone: Type }, { valor: "h1", rotulo: "Título 1", icone: Heading1 }, { valor: "h2", rotulo: "Título 2", icone: Heading2 }, { valor: "h3", rotulo: "Título 3", icone: Heading3 }]}
            classeGatilho={`${barraCompacta ? "h-11" : "h-8"} flex items-center gap-1.5 rounded-lg pl-2 pr-1.5 text-sm text-text-secondary transition-colors hover:bg-surface-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-steel-400`}
            gatilho={({ aberto, atual }) => <><span className="whitespace-nowrap">{atual?.rotulo}</span><ChevronDown size={14} className={`text-text-muted transition-transform duration-150 ${aberto ? "rotate-180" : ""}`} /></>} />
          {separador}
          <ToolbarBtn Icon={Bold} label="Negrito (Ctrl+B)" tamanho={tam} onClick={() => alternarInline("**")} />
          <ToolbarBtn Icon={Italic} label="Itálico (Ctrl+I)" tamanho={tam} onClick={() => alternarInline("_")} />
          {barraCompacta ? <>
            <div className="ml-auto flex items-center">
              {tintaNotaId && controlesModo}
              <MenuSuspenso ariaLabel="Mais opções de formatação" opcoes={comandosExtras} alinhar="dir" fixo larguraMin={220}
                onChange={(valor) => comandosExtras.find((comando) => comando.valor === valor)?.executar()}
                classeGatilho={`flex ${barraCompacta ? "h-11 w-11" : "h-8 w-8"} items-center justify-center rounded-lg text-text-secondary hover:bg-surface-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-steel-400`}
                gatilho={() => <Ellipsis size={barraCompacta ? 19 : 17} aria-hidden />} />
            </div>
            {seletorEmoji}
          </> : comandosExtras.map(({ valor, rotulo, atalho, icone, executar, novoGrupo }) => {
            const botao = <ToolbarBtn Icon={icone} label={atalho ? `${rotulo} (${atalho})` : rotulo} tamanho={tam} onClick={executar} />;
            return <Fragment key={valor}>
              {novoGrupo && separador}
              {valor === "emoji" ? <div className="relative">{botao}{seletorEmoji}</div> : botao}
            </Fragment>;
          })}
        </div>}
        {!barraCompacta && controlesModo}
      </div>}
      <input ref={seletorAnexo} type="file" multiple className="hidden" aria-label="Escolher arquivos para anexar" onChange={(e) => { const lista = [...(e.target.files ?? [])]; e.target.value = ""; void (async () => { for (const a of lista) await anexarArquivo(a); })(); }} />
      {usaPaleta && emojiAberto && <div className="fixed inset-x-0 top-28 z-50 flex justify-center"><div className="relative h-0 w-72">{seletorEmoji}</div></div>}
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
        ? <ColunaTinta largura={larguraColuna} tracos={tinta.tracos} escrevendo={escrevendo} folhaPlana={folhaPlana} pincel={pincel} dedoDesenha={dedoDesenha} onOperacao={tinta.executar} onAlternarCaneta={alternarCanetaMarca} estiloFolha={folha.estilo} linhaPx={linhaPx}>
            <EditorVivo aoCriarView={setViewContador} corpo={corpo} onCorpoChange={onCorpoChange} areaRef={editorRef} ariaLabel="Conteúdo da nota" placeholder={placeholder} somenteLeitura={escrevendo || preview}
              alturaMinima={semBorda ? "60vh" : "10rem"} resolverImagem={(src) => resolverSrcImagem(src, itemId, tipo)} atalhos={atalhosEditor}
              className={CLASSE_TEXTO_COLUNA} aoAbrirWikilink={abrirWikilink} wikilinks={{ notaAtualId: notaId ?? itemId, espaco }} />
          </ColunaTinta>
        : preview
        ? <div style={estiloColuna} className={`ecos-respiro-titulos min-w-0 break-words text-sm ${semBorda ? "min-h-[60vh] px-0.5 py-2" : "min-h-40 rounded-b-xl p-4"} [&_pre]:overflow-x-auto [&_img]:max-w-full`}>{corpo.trim() ? <MarkdownPreview corpo={corpo} itemId={itemId} tipo={tipo} /> : <p className="text-text-muted">Nada para pré-visualizar ainda.</p>}</div>
        : <div style={semBorda && folha.estilo !== "lisa" ? { ...estiloColuna, ...estiloGrade } : estiloColuna} className="ecos-respiro-titulos min-w-0"><EditorVivo aoCriarView={setViewContador} corpo={corpo} onCorpoChange={onCorpoChange} areaRef={editorRef} ariaLabel={tipo === "tarefa" ? "Descrição da tarefa" : "Conteúdo da nota"} placeholder={placeholder}
            alturaMinima={semBorda ? "60vh" : "10rem"} resolverImagem={(src) => resolverSrcImagem(src, itemId, tipo)} atalhos={atalhosEditor}
            className={semBorda ? "px-0.5 py-[var(--ecos-linha-nota)]" : "p-4"} aoAbrirWikilink={abrirWikilink} wikilinks={{ notaAtualId: notaId ?? itemId, espaco }} /></div>}
      {!escrevendo && <SumarioLateral aberto={sumarioLateral} corpo={corpo} view={preview ? null : viewContador} raiz={raizRef} aoFechar={() => alternarSumarioLateral(false)} />}
      {!preview && !escrevendo && !barraCompacta && <ContadorTexto view={viewContador} paginas={tipo === "nota"} className="px-2 pb-1 text-right" />}
      {ajudaAberta && <FolhaAtalhosEditor aoFechar={() => { setAjudaAberta(false); editorRef.current?.focus(); }} />}
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

/** Folha de ajuda com os atalhos do editor (Ctrl+/ no texto, ou ? fora de campos). */
function FolhaAtalhosEditor({ aoFechar }: { aoFechar: () => void }) {
  const grupo = GRUPOS_ATALHOS.find((g) => g.titulo === "Editor de texto");
  const fechar = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    fechar.current?.focus();
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); aoFechar(); } };
    window.addEventListener("keydown", esc, true);
    return () => window.removeEventListener("keydown", esc, true);
  }, [aoFechar]);
  if (!grupo) return null;
  return createPortal(
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) aoFechar(); }}>
      <div role="dialog" aria-modal="true" aria-label="Atalhos do editor" className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl border border-border bg-surface-1 p-4 shadow-nav ecos-fade-in">
        <div className="mb-3 flex items-center justify-between">
          <p className="flex items-center gap-2 text-sm font-semibold text-text-primary"><Keyboard size={16} aria-hidden />Atalhos do editor</p>
          <button ref={fechar} type="button" onClick={aoFechar} className="rounded-lg px-2 py-1 text-xs text-text-secondary hover:bg-surface-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-steel-400">Fechar</button>
        </div>
        {grupo.atalhos.map(({ teclas, acao }) => (
          <div key={acao} className="flex min-h-9 items-center justify-between gap-4 rounded-lg px-2 py-1.5 hover:bg-surface-2">
            <span className="text-sm text-text-secondary">{acao}</span>
            <span className="flex shrink-0 items-center gap-1">{teclas.map((t) => <kbd key={t} className="rounded border border-border bg-surface-3 px-1.5 py-0.5 font-mono-value text-[11px] text-text-primary">{t}</kbd>)}</span>
          </div>
        ))}
      </div>
    </div>,
    document.body,
  );
}
