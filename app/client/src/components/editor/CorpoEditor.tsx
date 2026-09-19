import { MenuSuspenso } from "@/components/common/MenuSuspenso";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Bold, Brackets, ChevronDown, Code, Eye, Heading1, Heading2, Italic, Link, Link2, List, ListChecks, ListOrdered, Minus, Pencil, Quote, RemoveFormatting, Smile, Strikethrough } from "lucide-react";
import { MarkdownPreview } from "@/lib/markdown-mini";
import { useIsMobile } from "@/lib/use-viewport";

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
  /** Tarefas existentes abrem a descrição em leitura, mantendo a edição a um clique. */
  initialPreview?: boolean;
}

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
export function CorpoEditor({ corpo, onCorpoChange, itemId, tipo, placeholder, rows = 8, layout = "split", initialPreview = false }: Props) {
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const ehMobile = useIsMobile();
  const [preview, setPreview] = useState(initialPreview);
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
    const el = areaRef.current;
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
    const el = areaRef.current;
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
    const el = areaRef.current;
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
    const el = areaRef.current;
    onCorpoChange(corpo.slice(0, inicio) + texto + corpo.slice(fim));
    requestAnimationFrame(() => {
      el?.focus();
      const [i, f] = selecao ?? [inicio + texto.length, inicio + texto.length];
      el?.setSelectionRange(i, f);
    });
  }

  /** Aplica `fn` a cada linha que a seleção toca (uma linha só, se for só o cursor). */
  function transformarLinhas(fn: (linha: string, indice: number) => string) {
    const el = areaRef.current;
    if (!el) return;
    const inicio = inicioDaLinha(el.selectionStart);
    let fim = corpo.indexOf("\n", el.selectionEnd);
    if (fim === -1) fim = corpo.length;
    const texto = corpo.slice(inicio, fim).split("\n").map(fn).join("\n");
    substituir(inicio, fim, texto, el.selectionStart === el.selectionEnd ? undefined : [inicio, inicio + texto.length]);
  }

  /** Lista/citação alternam: se todas as linhas já têm o prefixo, ele sai; senão entra (trocando o de outro tipo). */
  function alternarBloco(detecta: RegExp, prefixo: (n: number) => string) {
    const el = areaRef.current;
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
    const el = areaRef.current;
    if (!el) return;
    const a = el.selectionStart;
    const b = el.selectionEnd;
    const envolvido = a >= marca.length && corpo.slice(a - marca.length, a) === marca && corpo.slice(b, b + marca.length) === marca;
    if (envolvido) substituir(a - marca.length, b + marca.length, corpo.slice(a, b), [a - marca.length, b - marca.length]);
    else substituir(a, b, marca + corpo.slice(a, b) + marca, [a + marca.length, b + marca.length]);
  }

  function inserirLink() {
    const el = areaRef.current;
    if (!el) return;
    const a = el.selectionStart;
    const b = el.selectionEnd;
    const texto = corpo.slice(a, b) || "texto";
    const urlInicio = a + texto.length + 3;
    substituir(a, b, `[${texto}](https://)`, [urlInicio, urlInicio + 8]);
  }

  function limparFormatacao() {
    const el = areaRef.current;
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

  function aoTeclarNaDescricao(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const tecla = e.key.toLowerCase();
    if (tecla === "b") { e.preventDefault(); alternarInline("**"); }
    else if (tecla === "i") { e.preventDefault(); alternarInline("_"); }
  }

  if (layout === "document") {
    const linhaFim = corpo.indexOf("\n", cursor);
    const linhaAtual = corpo.slice(inicioDaLinha(cursor), linhaFim === -1 ? corpo.length : linhaFim);
    const estiloAtual = /^# /.test(linhaAtual) ? "h1" : /^## /.test(linhaAtual) ? "h2" : /^### /.test(linhaAtual) ? "h3" : "p";
    const tam = ehMobile ? "h-11 w-11" : "h-8 w-8";
    const separador = <span aria-hidden className="mx-1 h-5 w-px bg-border" />;

    return <div className="min-w-0 rounded-xl border border-border bg-surface-1 transition-colors focus-within:border-violet/70" data-corpo-editor>
      <div className="ecos-editor-floating sticky z-20 flex flex-wrap items-center gap-0.5 rounded-t-xl border-b border-border bg-surface-1 px-2 py-1.5" data-editor-toolbar role="toolbar" aria-label="Formatação da descrição">
        {!preview && <>
          <MenuSuspenso ariaLabel="Estilo do texto" valor={estiloAtual} onChange={aplicarEstilo} larguraMenu="min-w-[9rem]"
            opcoes={[{ valor: "p", rotulo: "Normal" }, { valor: "h1", rotulo: "Título 1" }, { valor: "h2", rotulo: "Título 2" }, { valor: "h3", rotulo: "Título 3" }]}
            classeGatilho={`${ehMobile ? "h-11" : "h-8"} flex items-center gap-1.5 rounded-lg pl-2 pr-1.5 text-sm text-text-secondary transition-colors hover:bg-surface-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-steel-400`}
            gatilho={({ aberto, atual }) => <><span>{atual?.rotulo}</span><ChevronDown size={14} className={`text-text-muted transition-transform duration-150 ${aberto ? "rotate-180" : ""}`} /></>} />
          {separador}
          <ToolbarBtn Icon={Bold} label="Negrito (Ctrl+B)" tamanho={tam} onClick={() => alternarInline("**")} />
          <ToolbarBtn Icon={Italic} label="Itálico (Ctrl+I)" tamanho={tam} onClick={() => alternarInline("_")} />
          <ToolbarBtn Icon={Strikethrough} label="Tachado" tamanho={tam} onClick={() => alternarInline("~~")} />
          {separador}
          <ToolbarBtn Icon={ListOrdered} label="Lista numerada" tamanho={tam} onClick={() => alternarBloco(/^\d+\.\s/, (n) => `${n + 1}. `)} />
          <ToolbarBtn Icon={List} label="Lista com marcadores" tamanho={tam} onClick={() => alternarBloco(/^[-*+]\s(?!\[[ xX]\])/, () => "- ")} />
          <ToolbarBtn Icon={ListChecks} label="Checklist" tamanho={tam} onClick={() => alternarBloco(/^[-*+]\s\[[ xX]\]\s/, () => "- [ ] ")} />
          <ToolbarBtn Icon={Quote} label="Citação" tamanho={tam} onClick={() => alternarBloco(/^>\s?/, () => "> ")} />
          {separador}
          <ToolbarBtn Icon={Link} label="Link" tamanho={tam} onClick={inserirLink} />
          <ToolbarBtn Icon={Brackets} label="Wikilink [[nota]]" tamanho={tam} onClick={() => envolverSelecao("[[", "]]")} />
          <ToolbarBtn Icon={Code} label="Código" tamanho={tam} onClick={() => alternarInline("`")} />
          <ToolbarBtn Icon={Minus} label="Linha horizontal" tamanho={tam} onClick={() => inserirNoCursor("\n---\n")} />
          {separador}
          <div className="relative">
            <ToolbarBtn Icon={Smile} label="Emoji" tamanho={tam} onClick={() => setEmojiAberto((v) => !v)} />
            {emojiAberto && <SeletorEmoji aoEscolher={(emoji) => { inserirNoCursor(emoji); setEmojiAberto(false); }} aoFechar={() => setEmojiAberto(false)} />}
          </div>
          <ToolbarBtn Icon={RemoveFormatting} label="Limpar formatação" tamanho={tam} onClick={limparFormatacao} />
        </>}
        <button type="button" aria-pressed={preview} onClick={() => setPreview(!preview)} title={preview ? "Editar descrição" : "Pré-visualizar descrição"} aria-label={preview ? "Editar descrição" : "Pré-visualizar descrição"}
          className={`ml-auto flex ${ehMobile ? "h-11" : "h-8"} items-center gap-2 rounded-lg px-2.5 text-sm text-steel-300 hover:bg-surface-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-steel-400`}>
          {preview ? <><Pencil size={15} strokeWidth={1.75} />Editar descrição</> : <Eye size={16} strokeWidth={1.75} />}
        </button>
      </div>
      {preview
        ? <div className="min-h-40 min-w-0 break-words rounded-b-xl p-4 text-sm [&_pre]:overflow-x-auto [&_img]:max-w-full">{corpo.trim() ? <MarkdownPreview corpo={corpo} itemId={itemId} tipo={tipo} /> : <p className="text-text-muted">Nada para pré-visualizar ainda.</p>}</div>
        : <textarea ref={areaRef} aria-label={tipo === "tarefa" ? "Descrição da tarefa" : "Conteúdo da nota"} value={corpo} onChange={(e) => { onCorpoChange(e.target.value); setCursor(e.target.selectionStart); }}
            onSelect={(e) => setCursor(e.currentTarget.selectionStart)} onKeyDown={aoTeclarNaDescricao} placeholder={placeholder} rows={rows}
            className="ecos-autogrow block min-h-40 w-full min-w-0 rounded-b-xl bg-transparent p-4 font-body text-[15px] leading-relaxed text-text-primary placeholder:text-text-secondary focus:outline-none" />}
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

function SeletorEmoji({ aoEscolher, aoFechar }: { aoEscolher: (emoji: string) => void; aoFechar: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const fora = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) aoFechar(); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") aoFechar(); };
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", fora); document.removeEventListener("keydown", esc); };
  }, [aoFechar]);
  return <div ref={ref} role="dialog" aria-label="Escolher emoji" className="absolute left-0 top-full z-40 mt-1 grid w-64 grid-cols-9 gap-0.5 rounded-xl border border-border bg-surface-2 p-1.5 shadow-nav ecos-fade-in">
    {EMOJIS.map((emoji) => <button key={emoji} type="button" onClick={() => aoEscolher(emoji)} className="flex h-7 w-7 items-center justify-center rounded-md text-base hover:bg-surface-3">{emoji}</button>)}
  </div>;
}
