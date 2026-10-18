import { useEffect, useRef, useState, type RefObject } from "react";
import { ChevronDown, ChevronUp, FileText, Paperclip, X } from "lucide-react";
import "@/styles/anexos-grade.css";
import { VisualizadorDeAnexos, type ItemVisualizador } from "./VisualizadorDeAnexos";
import { EditorView } from "@codemirror/view";
import { media, notas, tarefas } from "@/lib/api";

import { mensagemDeErro } from "@/lib/erros";
interface Props {
  corpo: string;
  onCorpoChange: (corpo: string) => void;
  itemId?: string;
  tipo: "nota" | "tarefa";
  onBusyChange?: (ocupado: boolean) => void;
  compact?: boolean;
  disabled?: boolean;
  /** Espaço do item: o arquivo vai para a biblioteca de mídia dele (trocar o espaço do item leva a mídia junto). */
  espaco?: string;
  /** Onde colar/arrastar vale. Padrão: o elemento pai; use quando o campo é renderizado num portal, longe do formulário. */
  escopoRef?: RefObject<HTMLElement>;
  /** `grade`: o container de miniaturas dos comprovantes do Cofre (usado no modo Focus). Padrão: lista com gaveta. */
  estilo?: "lista" | "grade";
}

const EXTENSAO_POR_TIPO: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/bmp": "bmp",
  "image/svg+xml": "svg",
};

const dois = (n: number) => String(n).padStart(2, "0");

/** Capturas de tela chegam da área de transferência todas como `image.png` — cada uma ganha um nome próprio, com data e hora. */
function nomearColado(arquivo: File, indice: number, total: number): File {
  if (arquivo.name && !/^image\.\w+$/i.test(arquivo.name)) return arquivo;
  const agora = new Date();
  const carimbo = `${agora.getFullYear()}-${dois(agora.getMonth() + 1)}-${dois(agora.getDate())}-${dois(agora.getHours())}${dois(agora.getMinutes())}${dois(agora.getSeconds())}`;
  const extensao = EXTENSAO_POR_TIPO[arquivo.type] ?? arquivo.name.split(".").pop() ?? "bin";
  const sufixo = total > 1 ? `-${indice + 1}` : "";
  return new File([arquivo], `captura-${carimbo}${sufixo}.${extensao}`, { type: arquivo.type });
}

/** Coloca a referência do anexo no texto: no cursor (colagem) ou no fim (botão), sempre em bloco próprio. */
export function inserirReferencia(corpo: string, linha: string, posicao?: number): string {
  if (posicao === undefined) return corpo.trim() ? `${corpo.trimEnd()}\n\n${linha}` : linha;
  const p = Math.min(Math.max(posicao, 0), corpo.length);
  const antes = corpo.slice(0, p);
  const depois = corpo.slice(p);
  return `${antes}${antes && !antes.endsWith("\n\n") ? (antes.endsWith("\n") ? "\n" : "\n\n") : ""}${linha}${depois && !depois.startsWith("\n") ? "\n\n" : ""}${depois}`;
}

/** Se o alvo está dentro do editor de Markdown (CodeMirror), devolve como achar a posição no texto: a do cursor ou a de um ponto da tela. */
function posicaoNoEditor(alvo: EventTarget | null): ((ponto?: { x: number; y: number }) => number | undefined) | undefined {
  const dom = alvo instanceof Element ? alvo.closest<HTMLElement>(".cm-editor") : null;
  const view = dom ? EditorView.findFromDOM(dom) : null;
  if (!view) return undefined;
  return (ponto) => (ponto ? view.posAtCoords(ponto) ?? undefined : view.state.selection.main.head);
}

/** Um único controle de anexos para criação e edição. O Markdown mantém a
 * associação; a biblioteca global guarda o arquivo antes do primeiro save.
 * Colar (Ctrl+V) uma captura de tela ou um arquivo em qualquer campo do
 * formulário também anexa. */
export function AttachmentsField(props: Props) {
  const atual = useRef(props);
  atual.current = props;
  const raiz = useRef<HTMLElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const ocupado = useRef(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [arquivoFalhou, setArquivoFalhou] = useState<File | null>(null);
  const [arrastando, setArrastando] = useState(false);
  const [todos, setTodos] = useState(false);
  const [visualizando, setVisualizando] = useState<number | null>(null);
  const anexos = [...props.corpo.matchAll(/(!?)\[([^\]]*)\]\(((?:src\/Media\/|_anexos\/)[^)]+)\)/g)];

  async function enviar(arquivo: File, posicao?: number) {
    if (ocupado.current || atual.current.disabled) return;
    if (arquivo.size > 120 * 1024 * 1024) {
      setErro("O arquivo excede o limite de 120 MB. Escolha um arquivo menor.");
      setArquivoFalhou(null);
      return;
    }
    if (!arquivo.size) {
      setErro("O arquivo está vazio.");
      setArquivoFalhou(null);
      return;
    }
    ocupado.current = true;
    setEnviando(true);
    setErro(null);
    atual.current.onBusyChange?.(true);
    try {
      const item = await media.enviar(arquivo, atual.current.espaco);
      const { corpo, onCorpoChange } = atual.current;
      onCorpoChange(inserirReferencia(corpo, media.referencia(item), posicao));
      setArquivoFalhou(null);
    } catch (e) {
      setErro(mensagemDeErro(e, "Não foi possível enviar o arquivo. Tente novamente."));
      setArquivoFalhou(arquivo);
    } finally {
      ocupado.current = false;
      setEnviando(false);
      atual.current.onBusyChange?.(false);
    }
  }

  // O ouvinte usa sempre a versão mais recente de `enviar` (que lê `atual`).
  const enviarRef = useRef(enviar);
  enviarRef.current = enviar;

  useEffect(() => {
    const escopo = atual.current.escopoRef?.current ?? raiz.current?.parentElement;
    if (!escopo) return;

    function aoColar(e: ClipboardEvent) {
      const dados = e.clipboardData;
      if (!dados || atual.current.disabled) return;
      const arquivos = Array.from(dados.files);
      if (!arquivos.length) return;
      // Texto junto com imagem (células do Word/Excel, páginas copiadas) é uma colagem de texto: deixa o navegador colar.
      if (dados.getData("text/plain").trim()) return;

      e.preventDefault();
      const alvo = e.target;
      const cursor = alvo instanceof HTMLTextAreaElement ? alvo.selectionStart : posicaoNoEditor(alvo)?.();
      void (async () => {
        let posicao = cursor;
        for (const [i, arquivo] of arquivos.entries()) {
          await enviarRef.current(nomearColado(arquivo, i, arquivos.length), posicao);
          posicao = undefined; // os seguintes vão para o fim, depois do primeiro
        }
      })();
    }

    // Arrastar arquivos (da pasta Downloads, por exemplo) para qualquer ponto do formulário também anexa.
    let profundidade = 0;
    const trazArquivos = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
    function aoEntrar(e: DragEvent) {
      if (!trazArquivos(e) || atual.current.disabled) return;
      e.preventDefault();
      profundidade++;
      setArrastando(true);
    }
    function aoSobrevoar(e: DragEvent) {
      if (!trazArquivos(e) || atual.current.disabled) return;
      e.preventDefault(); // sem isso o navegador abriria o arquivo no lugar de soltá-lo aqui
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    }
    function aoSair(e: DragEvent) {
      if (!trazArquivos(e)) return;
      profundidade = Math.max(0, profundidade - 1);
      if (!profundidade) setArrastando(false);
    }
    function aoSoltar(e: DragEvent) {
      if (!trazArquivos(e)) return;
      profundidade = 0;
      setArrastando(false);
      if (atual.current.disabled) return;
      const arquivos = Array.from(e.dataTransfer?.files ?? []);
      if (!arquivos.length) return;
      e.preventDefault(); // marca como tratado: o "soltar no Cofre" da janela respeita isso
      // Soltar sobre o texto coloca a imagem no ponto do soltar, não no fim.
      const ponto = posicaoNoEditor(e.target)?.({ x: e.clientX, y: e.clientY });
      void (async () => {
        let posicao = ponto;
        for (const arquivo of arquivos) { await enviarRef.current(arquivo, posicao); posicao = undefined; }
      })();
    }

    escopo.addEventListener("paste", aoColar);
    escopo.addEventListener("dragenter", aoEntrar);
    escopo.addEventListener("dragover", aoSobrevoar);
    escopo.addEventListener("dragleave", aoSair);
    escopo.addEventListener("drop", aoSoltar);
    return () => {
      escopo.removeEventListener("paste", aoColar);
      escopo.removeEventListener("dragenter", aoEntrar);
      escopo.removeEventListener("dragover", aoSobrevoar);
      escopo.removeEventListener("dragleave", aoSair);
      escopo.removeEventListener("drop", aoSoltar);
    };
  }, []);

  function url(caminho: string) {
    if (caminho.startsWith("src/Media/")) return media.urlArquivo(caminho);
    return props.itemId ? (props.tipo === "nota" ? notas : tarefas).anexos.urlDownload(props.itemId, caminho.split("/").slice(2).join("/")) : undefined;
  }

  const itensVisualizador: ItemVisualizador[] = anexos.flatMap((a) => { const u = url(a[3]); return u ? [{ nome: a[2], url: u, imagem: a[1] === "!" }] : []; });
  /** Clique simples abre o visualizador; Ctrl/Cmd/botão do meio continuam abrindo o arquivo em outra aba. */
  const abrirNoVisualizador = (e: React.MouseEvent, caminho: string) => {
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
    const ordem = anexos.filter((a) => url(a[3])).findIndex((a) => a[3] === caminho);
    if (ordem < 0) return;
    e.preventDefault();
    setVisualizando(ordem);
  };
  const visualizador = visualizando !== null ? <VisualizadorDeAnexos itens={itensVisualizador} inicial={visualizando} onFechar={() => setVisualizando(null)} /> : null;

  if (props.estilo === "grade") {
    return <section ref={raiz} className={`ecos-anexos-raiz min-w-0 ${arrastando ? "outline outline-2 outline-dashed outline-cyan" : ""}`} aria-label="Anexos" aria-busy={enviando}>
      {arrastando && <p role="status" className="mb-2 text-sm font-medium text-cyan">Solte para anexar {props.tipo === "nota" ? "à nota" : "à tarefa"}.</p>}
      <div className="cofre-anexos" data-tipo="anexo">
        <div className="cofre-anexos-head"><h3><Paperclip size={14} aria-hidden />Anexos{anexos.length > 0 && <span>{anexos.length}</span>}</h3></div>
        {erro && <div role="alert" className="min-w-0 text-sm text-error"><p>{arquivoFalhou && <span className="break-all font-medium">{arquivoFalhou.name}: </span>}{erro}</p>{arquivoFalhou && <button type="button" disabled={enviando || props.disabled} onClick={() => void enviar(arquivoFalhou)} className="mt-2 min-h-11 rounded-lg border border-error/40 px-3 text-sm disabled:opacity-40">Tentar novamente</button>}</div>}
        <ul className="cofre-anexos-grade">
          {anexos.map((a, i) => <li key={`${a[3]}-${i}`} className="cofre-anexo-item">
            <a href={url(a[3])} target="_blank" rel="noreferrer" className="cofre-anexo-tile" title={a[2]} aria-label={`Abrir ${a[2]}`} onClick={(e) => abrirNoVisualizador(e, a[3])}>
              <span className="cofre-comprovante-thumb">{a[1] === "!" && url(a[3]) ? <img src={url(a[3])} alt="" loading="lazy" /> : <FileText size={28} aria-hidden />}</span>
              <span className="cofre-anexo-nome">{a[2]}</span>
            </a>
            <button type="button" disabled={props.disabled || enviando} className="cofre-anexo-remover" aria-label={`Remover referência de ${a[2]}`} onClick={() => props.onCorpoChange(props.corpo.replace(a[0], "").replace(/\n{3,}/g, "\n\n").trim())}><X size={13} aria-hidden /></button>
          </li>)}
          <li className="cofre-anexo-item">
            <button type="button" className="cofre-anexo-novo" disabled={enviando || props.disabled} onClick={() => input.current?.click()}>
              <Paperclip size={20} aria-hidden />
              <span>{enviando ? "Enviando…" : "Anexar"}</span>
            </button>
          </li>
        </ul>
        {anexos.length === 0 && <p className="cofre-anexos-vazio">Cole com Ctrl+V ou arraste arquivos até aqui.</p>}
      </div>
      {visualizador}
      <input ref={input} type="file" className="hidden" onChange={(e) => { const arquivo = e.target.files?.[0]; e.target.value = ""; if (arquivo) void enviar(arquivo); }} />
    </section>;
  }

  return <section ref={raiz} className={`flex min-w-0 flex-col gap-2 ${props.compact ? "rounded-xl border border-border bg-surface-1 p-4" : ""} ${arrastando ? "outline outline-2 outline-dashed outline-cyan" : ""}`} aria-label="Anexos" aria-busy={enviando}>
    {arrastando && <p role="status" className="text-sm font-medium text-cyan">Solte para anexar {props.tipo === "nota" ? "à nota" : "à tarefa"}.</p>}
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="flex items-center gap-2 text-sm font-medium text-text-secondary"><Paperclip size={17} />Anexos<span className="hidden text-xs font-normal text-text-muted md:inline">· cole com Ctrl+V ou arraste arquivos até aqui</span></p>
      <div className="flex flex-wrap items-center gap-3">
      {anexos.length > 1 && <button type="button" aria-expanded={todos} onClick={() => setTodos((v) => !v)} className="relative flex min-h-11 items-center gap-1.5 rounded-lg py-2 pl-3 pr-7 text-sm font-medium text-steel-300">{todos ? <ChevronUp size={16} /> : <ChevronDown size={16} />}{todos ? "Mostrar só o último" : "Mostrar todos"}<span aria-label={`${anexos.length} anexos`} className="pointer-events-none absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-steel-700 px-1 text-[10px] font-semibold leading-none text-on-steel shadow-sm">{anexos.length}</span></button>}
      <button type="button" disabled={enviando || props.disabled} onClick={() => input.current?.click()} className="flex min-h-11 items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 text-sm font-medium text-text-secondary disabled:opacity-40"><Paperclip size={16} />{enviando ? "Enviando arquivo..." : "Adicionar arquivo"}</button>
      </div>
    </div>
    {anexos.length > 1 && <div className="grid transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none" style={{ gridTemplateRows: todos ? "1fr" : "0fr", opacity: todos ? 1 : 0 }} aria-hidden={!todos} {...({ inert: todos ? undefined : "" } as object)}>
      <div className="flex min-h-0 flex-col gap-2 overflow-hidden">{anexos.slice(0, -1).map((a, i) => ({ a, i })).map(({ a, i }) => <div key={`${a[3]}-${i}`} className="flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-2">
      <FileText size={16} className="shrink-0 text-text-muted" />
      <a href={url(a[3])} target="_blank" rel="noreferrer" onClick={(e) => abrirNoVisualizador(e, a[3])} className="flex-1 truncate text-sm text-steel-300">{a[2]}</a>
      <button type="button" disabled={props.disabled || enviando} className="flex min-h-11 min-w-11 items-center justify-center" aria-label={`Remover referência de ${a[2]}`} onClick={() => props.onCorpoChange(props.corpo.replace(a[0], "").replace(/\n{3,}/g, "\n\n").trim())}><X size={15} className="text-text-secondary" /></button>
    </div>)}</div>
    </div>}
    {anexos.slice(-1).map((a, k) => ({ a, i: anexos.length - 1 + k })).map(({ a, i }) => <div key={`${a[3]}-${i}`} className="flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-2">
      <FileText size={16} className="shrink-0 text-text-muted" />
      <a href={url(a[3])} target="_blank" rel="noreferrer" className="flex-1 truncate text-sm text-steel-300">{a[2]}</a>
      <button type="button" disabled={props.disabled || enviando} className="flex min-h-11 min-w-11 items-center justify-center" aria-label={`Remover referência de ${a[2]}`} onClick={() => props.onCorpoChange(props.corpo.replace(a[0], "").replace(/\n{3,}/g, "\n\n").trim())}><X size={15} className="text-text-secondary" /></button>
    </div>)}
    <input ref={input} type="file" className="hidden" onChange={(e) => { const arquivo = e.target.files?.[0]; e.target.value = ""; if (arquivo) void enviar(arquivo); }} />
    {!props.compact && <p className="text-xs text-text-secondary">Até 120 MB por arquivo. Salve a nota ou tarefa para manter o vínculo.</p>}
    {erro && <div role="alert" className="min-w-0 text-sm text-error"><p>{arquivoFalhou && <span className="break-all font-medium">{arquivoFalhou.name}: </span>}{erro}</p>{arquivoFalhou && <button type="button" disabled={enviando || props.disabled} onClick={() => void enviar(arquivoFalhou)} className="mt-2 min-h-11 rounded-lg border border-error/40 px-3 text-sm disabled:opacity-40">Tentar novamente</button>}</div>}
    {visualizador}
  </section>;
}
