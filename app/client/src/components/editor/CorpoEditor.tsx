import { useLayoutEffect, useRef, useState } from "react";
import { Bold, Italic, Strikethrough, List, ListChecks, Quote, Code, Link2, Minus, Heading1, Heading2 } from "lucide-react";
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
export function CorpoEditor({ corpo, onCorpoChange, itemId, tipo, placeholder, rows = 8, layout = "split" }: Props) {
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const ehMobile = useIsMobile();
  const [preview, setPreview] = useState(false);
  const [more, setMore] = useState(false);

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

  if (layout === "document") return <div className="min-w-0 rounded-xl border border-border bg-surface-2" data-corpo-editor>
    <div className="ecos-editor-floating sticky z-20 rounded-t-xl border-b border-border bg-surface-2 shadow-sm" data-editor-toolbar>
    <div className="flex flex-wrap items-center justify-between gap-2 p-2">
      <span className="px-2 text-sm text-text-secondary">Markdown</span>
      <button type="button" aria-pressed={preview} onClick={() => setPreview(!preview)} className="min-h-11 rounded-lg px-3 text-sm text-steel-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-steel-400">{preview ? `Editar ${tipo === "tarefa" ? "descrição" : "conteúdo"}` : `Pré-visualizar ${tipo === "tarefa" ? "descrição" : "conteúdo"}`}</button>
    </div>
    {!preview && <div className="flex flex-wrap items-center gap-1 border-t border-border p-1" role="group" aria-label="Formatação da descrição">
        <ToolbarBtn Icon={Heading2} label="Título" onClick={() => prefixarLinhaAtual("## ")} />
        <ToolbarBtn Icon={Bold} label="Negrito" onClick={() => envolverSelecao("**")} />
        <ToolbarBtn Icon={Italic} label="Itálico" onClick={() => envolverSelecao("_")} />
        <ToolbarBtn Icon={ListChecks} label="Checklist" onClick={() => prefixarLinhaAtual("- [ ] ")} />
        <ToolbarBtn Icon={List} label="Lista" onClick={() => prefixarLinhaAtual("- ")} />
        <button type="button" aria-expanded={more} onClick={() => setMore(!more)} className="min-h-11 rounded-lg px-3 text-sm text-text-secondary">{more ? "Menos" : "Mais"}</button>
        {more && <div className="flex w-full flex-wrap gap-1 border-t border-border pt-1">
          <ToolbarBtn Icon={Heading1} label="Título 1" onClick={() => prefixarLinhaAtual("# ")} />
          <ToolbarBtn Icon={Strikethrough} label="Tachado" onClick={() => envolverSelecao("~~")} />
          <ToolbarBtn Icon={Quote} label="Citação" onClick={() => prefixarLinhaAtual("> ")} />
          <ToolbarBtn Icon={Code} label="Código" onClick={() => envolverSelecao("`")} />
          <ToolbarBtn Icon={Link2} label="Wikilink" onClick={() => envolverSelecao("[[", "]]")} />
          <ToolbarBtn Icon={Minus} label="Linha horizontal" onClick={() => inserirNoCursor("\n---\n")} />
        </div>}
      </div>}
    </div>
    {preview ? <div className="min-h-64 min-w-0 break-words rounded-b-xl bg-surface-1 p-5 text-sm [&_pre]:overflow-x-auto [&_img]:max-w-full">{corpo.trim() ? <MarkdownPreview corpo={corpo} itemId={itemId} tipo={tipo} /> : <p className="text-text-secondary">Escreva um conteúdo para ver a prévia.</p>}</div> :
      <textarea ref={areaRef} aria-label={tipo === "tarefa" ? "Descrição da tarefa" : "Conteúdo da nota"} value={corpo} onChange={(e) => onCorpoChange(e.target.value)} placeholder={placeholder} rows={rows}
        className="ecos-autogrow block min-h-64 w-full min-w-0 rounded-b-xl bg-transparent p-5 font-body text-[16px] text-text-primary placeholder:text-text-secondary focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-steel-400" />
    }
  </div>;

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

function ToolbarBtn({ Icon, onClick, label, disabled }: { Icon: typeof Bold; onClick: () => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-text-secondary hover:bg-surface-3 hover:text-text-primary disabled:opacity-40"
    >
      <Icon size={17} strokeWidth={1.75} />
    </button>
  );
}
